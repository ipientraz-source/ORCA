// Uji rekrutmen: peran Recruiter, pipeline kandidat, "Terima jadi rider", kebutuhan rekrut per DS, dan hak lihat (RLS), di Postgres (PGlite).
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const S = 'super@test.local', REC = 'recruiter@test.local', CG = 'cap-galaxy@test.local', AA = 'arcon-a@test.local', AB = 'arcon-b@test.local'
const GALAXY = id(101), ALSUT = id(102), GOWA = id(103)
const [R_REC, R_CG, R_CA, R_CW, R_AA, R_AB, R_G] = [id(5), id(10), id(11), id(12), id(30), id(31), id(21)]

const q = async (sql, p) => (await db.query(sql, p)).rows
async function as(email, fn) {
  const claims = JSON.stringify(email ? { email } : {})
  await db.exec(`reset role; select set_config('request.jwt.claims', '${claims}', false); set role ${email ? 'authenticated' : 'anon'}`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`)
  }
}
const tambah = (nama, hp, ds = GALAXY) => q("insert into kandidat (nama, no_hp, sumber, ds_id) values ($1, $2, 'Referral', $3) returning id", [nama, hp, ds]).then((r) => r[0].id)

before(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.jwt() to anon, authenticated;`)
  for (const f of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'))
  await db.exec('grant select, insert, update, delete on all tables in schema public to authenticated')
  await db.exec(`
    insert into ds (id, nama, kuota_pagi, kuota_siang) values ('${GALAXY}', 'Galaxy', 1, 1), ('${ALSUT}', 'Alam Sutera', 1, 1), ('${GOWA}', 'Gowa', 1, 1);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${id(1)}', null, 'Super', null, 'super_admin', '${S}', 'aktif'),
      ('${R_REC}', null, 'Recruiter', null, 'recruiter', '${REC}', 'aktif'),
      ('${R_CG}', 'MTR-CG', 'Captain Galaxy', '${GALAXY}', 'captain', '${CG}', 'aktif'),
      ('${R_CA}', 'MTR-CA', 'Captain Alsut', '${ALSUT}', 'captain', 'cap-alsut@test.local', 'aktif'),
      ('${R_CW}', 'MTR-CW', 'Captain Gowa', '${GOWA}', 'captain', 'cap-gowa@test.local', 'aktif'),
      ('${R_AA}', null, 'Arcon A', null, 'arcon', '${AA}', 'aktif'),
      ('${R_AB}', null, 'Arcon B', null, 'arcon', '${AB}', 'aktif'),
      ('${R_G}', 'MTR021', 'Rider Galaxy', '${GALAXY}', 'rider', null, 'aktif');
    update ds set captain_id = '${R_CG}', arcon_id = '${R_AA}' where id = '${GALAXY}';
    update ds set captain_id = '${R_CA}', arcon_id = '${R_AA}' where id = '${ALSUT}';
    update ds set captain_id = '${R_CW}', arcon_id = '${R_AB}' where id = '${GOWA}';`)
})
beforeEach(() => db.exec('delete from kandidat; delete from log_aktivitas'))
after(() => db.close())

test('Recruiter bisa membaca barisnya sendiri untuk login, tapi tidak melihat rider, DS, atau jadwal', async () => {
  await as(REC, async () => {
    assert.deepEqual((await q('select nama, peran from riders')).map((r) => `${r.nama}:${r.peran}`), ['Recruiter:recruiter'])
    assert.equal((await q('select * from ds')).length, 0)
    assert.equal((await q('select * from jadwal')).length, 0)
    await assert.rejects(q("insert into riders (nama, peran) values ('Rider Gelap', 'rider')"), /row-level security/)
  })
})

test('Recruiter menambah kandidat: nomor HP dirapikan, pembuat tercatat, nomor aktif tidak boleh dobel', async () => {
  const kid = await as(REC, () => tambah('  Budi  ', '0812-3456-7890'))
  const [k] = await q('select * from kandidat where id = $1', [kid])
  assert.equal(k.nama, 'Budi')
  assert.equal(k.no_hp, '081234567890')
  assert.equal(k.status, 'baru')
  assert.equal(k.dibuat_oleh, R_REC)
  await as(REC, () => assert.rejects(tambah('Budi Lagi', '081234567890'), /kandidat_hp_aktif/))
})

test('Pipeline: maju antar tahap, tolak wajib alasan, "diterima" hanya lewat terima_kandidat', async () => {
  const kid = await as(REC, () => tambah('Sari', '081111111111'))
  await as(REC, async () => {
    await q("update kandidat set status = 'interview' where id = $1", [kid])
    await assert.rejects(q("update kandidat set status = 'ditolak' where id = $1", [kid]), /kandidat_check|violates check/) // tanpa alasan
    await assert.rejects(q("update kandidat set status = 'diterima' where id = $1", [kid]), /Terima jadi rider/)
    await q("update kandidat set status = 'ditolak', alasan_tolak = 'Tidak punya SIM' where id = $1", [kid])
  })
  const [k] = await q('select * from kandidat where id = $1', [kid])
  assert.equal(k.status, 'ditolak')
  assert.ok(k.ditutup) // waktu tutup diisi sistem
  await as(REC, async () => {
    await q("update kandidat set status = 'baru' where id = $1", [kid]) // dibuka lagi
    assert.equal((await q('select alasan_tolak, ditutup from kandidat where id = $1', [kid]))[0].ditutup, null)
  })
})

test('Terima jadi rider: rider aktif terbuat di DS tujuan, kandidat terkunci, kode MTR dobel ditolak', async () => {
  const kid = await as(REC, () => tambah('Andi', '082222222222', GOWA))
  const sudah = await as(REC, () => tambah('Tanpa DS', '083333333333', null))
  const rid = await as(REC, async () => {
    await assert.rejects(q('select terima_kandidat($1)', [sudah]), /DS tujuan/)
    await assert.rejects(q("select terima_kandidat($1, 'MTR021')", [kid]), /sudah dipakai/) // MTR021 milik Rider Galaxy
    const [{ terima_kandidat }] = await q("select terima_kandidat($1, ' mtr777 ')", [kid])
    const [k] = await q('select * from kandidat where id = $1', [kid])
    assert.equal(k.status, 'diterima')
    assert.equal(k.rider_id, terima_kandidat)
    await assert.rejects(q("update kandidat set catatan = 'ubah' where id = $1", [kid]), /sudah diterima/)
    await assert.rejects(q('select terima_kandidat($1)', [kid]), /sudah diterima/)
    return terima_kandidat
  })
  // Recruiter tidak boleh membaca daftar rider, jadi ridernya diperiksa dari sisi sistem
  const [r] = await q('select * from riders where id = $1', [rid])
  assert.deepEqual([r.nama, r.kode_mtr, r.ds_id, r.peran, r.status, r.no_hp], ['Andi', 'MTR777', GOWA, 'rider', 'aktif', '082222222222'])
})

test('Hak lihat: Captain dan Arcon hanya melihat kandidat DS-nya dan tidak bisa mengubah; rider tidak punya akses', async () => {
  await tambah('Kandidat Galaxy', '084000000001', GALAXY)
  await tambah('Kandidat Gowa', '084000000002', GOWA)
  const nama = async () => (await q('select nama from kandidat order by nama')).map((r) => r.nama)
  await as(S, async () => assert.deepEqual(await nama(), ['Kandidat Galaxy', 'Kandidat Gowa']))
  await as(REC, async () => assert.deepEqual(await nama(), ['Kandidat Galaxy', 'Kandidat Gowa']))
  await as(CG, async () => assert.deepEqual(await nama(), ['Kandidat Galaxy']))
  await as(AA, async () => assert.deepEqual(await nama(), ['Kandidat Galaxy']))
  await as(AB, async () => assert.deepEqual(await nama(), ['Kandidat Gowa']))
  await as(CG, async () => {
    assert.equal((await db.query("update kandidat set catatan = 'x'")).affectedRows, 0)
    await assert.rejects(q("insert into kandidat (nama, ds_id) values ('Titipan', $1)", [GALAXY]), /row-level security/)
    await assert.rejects(q('select terima_kandidat($1)', [id(999)]), /Hanya Super-admin atau Recruiter/)
  })
  await as(null, () => assert.rejects(q('select * from kandidat'), /permission denied/))
})

test('Kebutuhan rekrut: kuota × 7/6 dibulatkan ke atas, dikurangi rider aktif; Captain hanya DS-nya', async () => {
  await tambah('Proses 1', '085000000001', GALAXY)
  await tambah('Proses 2', '085000000002', GALAXY)
  const sudah = await tambah('Sudah Ditolak', '085000000003', GALAXY)
  await db.exec(`update kandidat set status = 'ditolak', alasan_tolak = 'x' where id = '${sudah}'`)
  await as(S, async () => {
    const rows = await q('select * from ds_rekrut()')
    assert.equal(rows.length, 3)
    const g = rows.find((r) => r.ds_nama === 'Galaxy')
    // kuota 1 + 1 = 2 per hari → 2 × 7/6 = 2,33 → butuh 3 rider; aktif: Captain Galaxy + Rider Galaxy = 2 → kurang 1; 2 kandidat sedang diproses
    assert.deepEqual([g.kuota, g.perlu, g.rider_aktif, g.kandidat_proses, g.kurang], [2, 3, 2, 2, 1])
  })
  await as(REC, async () => assert.equal((await q('select * from ds_rekrut()')).length, 3))
  await as(CG, async () => assert.deepEqual((await q('select ds_nama from ds_rekrut()')).map((r) => r.ds_nama), ['Galaxy']))
  await as(AA, async () => assert.deepEqual((await q('select ds_nama from ds_rekrut()')).map((r) => r.ds_nama), ['Alam Sutera', 'Galaxy']))
})

test('Referral: wajib menyebut perujuk (rider/Captain aktif), nama tersimpan, dikosongkan bila sumber diganti', async () => {
  const kid = await as(REC, async () => {
    await assert.rejects(q("insert into kandidat (nama, sumber) values ('Tanpa Perujuk', 'Referral rider')"), /Pilih rider yang merujuk/)
    await assert.rejects(q("insert into kandidat (nama, sumber, perujuk_id) values ('Perujuk Salah', 'Referral rider', $1)", [R_AA]), /rider atau Captain yang aktif/) // Arcon bukan perujuk
    const [{ id }] = await q("insert into kandidat (nama, sumber, perujuk_id, ds_id) values ('Dirujuk', 'Referral rider', $1, $2) returning id", [R_G, GALAXY])
    const [k] = await q('select perujuk_id, perujuk_nama from kandidat where id = $1', [id])
    assert.deepEqual([k.perujuk_id, k.perujuk_nama], [R_G, 'Rider Galaxy'])
    // Recruiter tidak boleh membaca daftar rider, tapi boleh mencari perujuk lewat fungsi khusus
    assert.deepEqual((await q("select nama from cari_perujuk('galaxy')")).map((r) => r.nama), ['Captain Galaxy', 'Rider Galaxy'])
    assert.deepEqual((await q("select nama from cari_perujuk('MTR021')")).map((r) => r.nama), ['Rider Galaxy'])
    return id
  })
  await as(CG, () => assert.rejects(q("select * from cari_perujuk('galaxy')"), /Tidak berwenang/))
  await as(REC, async () => {
    await q("update kandidat set sumber = 'Walk-in' where id = $1", [kid])
    const [k] = await q('select perujuk_id, perujuk_nama from kandidat where id = $1', [kid])
    assert.deepEqual([k.perujuk_id, k.perujuk_nama], [null, null]) // sumber bukan referral lagi
    await assert.rejects(q("update kandidat set sumber = 'Referral rider' where id = $1", [kid]), /Pilih rider yang merujuk/)
  })
  // perujuk berhenti (dihapus): nama saat dirujuk tetap terbaca
  await db.exec(`insert into riders (id, nama, ds_id, peran, status) values ('${id(777)}', 'Rider Sementara', '${GALAXY}', 'rider', 'aktif')`)
  await db.exec(`insert into kandidat (nama, sumber, perujuk_id) values ('Dirujuk Sementara', 'Referral rider', '${id(777)}')`)
  await db.exec(`delete from riders where id = '${id(777)}'`)
  const [s] = await q("select perujuk_id, perujuk_nama from kandidat where nama = 'Dirujuk Sementara'")
  assert.deepEqual([s.perujuk_id, s.perujuk_nama], [null, 'Rider Sementara'])
})

test('Aktivitas kandidat tercatat di Riwayat dengan pelaku dan nilai lama → baru', async () => {
  const kid = await as(REC, () => tambah('Rina', '086000000001'))
  await as(REC, () => q("update kandidat set status = 'dihubungi' where id = $1", [kid]))
  const [t] = await q("select * from log_aktivitas where aksi = 'tambah kandidat'")
  assert.equal(t.detail, 'Rina')
  assert.equal(t.captain_id, R_REC)
  assert.equal(t.ds_id, GALAXY)
  const [u] = await q("select * from log_aktivitas where aksi = 'ubah kandidat'")
  assert.equal(u.detail, 'Rina: status baru → dihubungi')
})
