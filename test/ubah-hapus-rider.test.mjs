// Uji ubah dan hapus rider (migrasi 0077): hak akses, Kode MTR tetap unik, hapus hanya bila rider belum punya riwayat, dan pencatatan ke
// riwayat aktivitas. Database PGlite.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const [SUPER, CAP_A, ARC_A, DS_A, DS_B] = [id(1), id(2), id(3), id(101), id(102)]
const [R_A, R_B, R_BERSIH] = [id(201), id(202), id(203)]
const q = async (sql, p) => (await db.query(sql, p)).rows
const sebagai = async (email, fn) => {
  await db.exec(`reset role; select set_config('request.jwt.claims', '{"email":"${email}"}', false); set role authenticated`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
}
const [sSuper, sArcon, sCaptain] = ['super', 'arc', 'cap'].map((e) => (fn) => sebagai(`${e}@test.local`, fn))
const ubah = (rid, nama, kode, hp) => q(`select ubah_rider($1, $2, $3, $4)`, [rid, nama, kode, hp])
const hapus = (rid) => q(`select hapus_rider($1)`, [rid])
const rider = async (rid) => (await q(`select * from riders where id = $1`, [rid]))[0]
const log = (jenis) => q(`select * from log_aktivitas where jenis = $1 and tabel = 'riders' order by waktu desc`, [jenis])
const baru = async (n, ds = DS_A, nama = 'Rider ' + n) => {
  await q(`insert into riders (id, kode_mtr, nama, no_hp, ds_id) values ($1, $2, $3, '081200000000', $4)`, [id(n), 'MTR' + n, nama, ds])
  return id(n)
}

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
    insert into ds (id, nama) values ('${DS_A}', 'DS A'), ('${DS_B}', 'DS B');
    insert into riders (id, kode_mtr, nama, ds_id, peran, email) values
      ('${SUPER}', null, 'Super', null, 'super_admin', 'super@test.local'),
      ('${CAP_A}', null, 'Captain A', '${DS_A}', 'captain', 'cap@test.local'),
      ('${ARC_A}', null, 'Arcon A', null, 'arcon', 'arc@test.local');
    update ds set captain_id = '${CAP_A}', arcon_id = '${ARC_A}' where id = '${DS_A}';
    insert into riders (id, kode_mtr, nama, no_hp, ds_id) values
      ('${R_A}', 'MTR0000201', 'Budi Santoso', '081200000201', '${DS_A}'),
      ('${R_B}', 'MTR0000202', 'Rider DS B', '081200000202', '${DS_B}'),
      ('${R_BERSIH}', 'MTR0000203', 'Salah Masuk', null, '${DS_A}');`)
})
after(() => db.close())

test('Super-admin mengubah nama, Kode MTR, dan no HP: dirapikan dan tercatat di riwayat dengan nilai lama dan baru', async () => {
  await sSuper(() => ubah(R_A, '  Budi   Santosa ', ' mtr0000211 ', '0812-0000-0211'))
  const r = await rider(R_A)
  assert.deepEqual([r.nama, r.kode_mtr, r.no_hp, r.ds_id], ['Budi Santosa', 'MTR0000211', '081200000211', DS_A])
  const [l] = await log('ubah')
  assert.equal(l.captain_id, SUPER, 'pelaku')
  assert.equal(l.ds_id, DS_A)
  const kolom = Object.fromEntries(l.perubahan.map((p) => [p.kolom, [p.lama, p.baru]]))
  assert.deepEqual(kolom.nama, ['Budi Santoso', 'Budi Santosa'])
  assert.deepEqual(kolom.kode_mtr, ['MTR0000201', 'MTR0000211'])
})

test('no HP boleh dikosongkan; no HP yang tidak masuk akal ditolak', async () => {
  await sSuper(() => ubah(R_A, 'Budi Santosa', 'MTR0000211', ''))
  assert.equal((await rider(R_A)).no_hp, null)
  await assert.rejects(sSuper(() => ubah(R_A, 'Budi Santosa', 'MTR0000211', '08ab')), /No HP tidak valid/)
  await sSuper(() => ubah(R_A, 'Budi Santosa', 'MTR0000211', '+6281200000211'))
})

test('nama dan Kode MTR wajib diisi', async () => {
  await assert.rejects(sSuper(() => ubah(R_A, '  ', 'MTR0000211', null)), /Nama rider wajib/)
  await assert.rejects(sSuper(() => ubah(R_A, 'Budi', '  ', null)), /Kode MTR rider wajib/)
  assert.equal((await rider(R_A)).nama, 'Budi Santosa')
})

test('Kode MTR bentrok ditolak dengan pesan jelas; nama pemilik kode hanya diberitahukan ke Super-admin', async () => {
  await assert.rejects(sSuper(() => ubah(R_A, 'Budi Santosa', 'mtr0000202', null)), /Kode MTR MTR0000202 sudah dipakai rider lain \(Rider DS B\)/)
  await assert.rejects(sArcon(() => ubah(R_A, 'Budi Santosa', 'MTR0000202', null)), (e) => /sudah dipakai rider lain\. Periksa/.test(e.message) && !/Rider DS B/.test(e.message))
  assert.equal((await rider(R_A)).kode_mtr, 'MTR0000211')
  await sSuper(() => ubah(R_A, 'Budi Santosa', 'MTR0000211', null)) // kode sendiri tidak dianggap bentrok
})

test('Arcon dan Captain mengubah rider di DS-nya; rider DS lain, peran lain, dan isian langsung tetap ditolak', async () => {
  await sArcon(() => ubah(R_A, 'Budi S', 'MTR0000211', null))
  await sCaptain(() => ubah(R_A, 'Budi Santosa', 'MTR0000211', null))
  for (const s of [sArcon, sCaptain]) {
    await assert.rejects(s(() => ubah(R_B, 'Dibajak', 'MTR0000202', null)), /Tidak berwenang/)
    await assert.rejects(s(() => ubah(CAP_A, 'Dibajak', null, null)), /Tidak berwenang/)
  }
  assert.equal((await rider(R_B)).nama, 'Rider DS B')
  // penjaga lama tidak dilonggarkan: ubah isian langsung oleh Arcon masih ditolak
  await assert.rejects(sArcon(() => q(`update riders set nama = 'Langsung' where id = $1`, [R_A])), /hanya boleh mengubah status/)
})

test('Super-admin boleh memperbaiki Captain dan Arcon (kode boleh kosong), tetapi bukan Super-admin', async () => {
  await sSuper(() => ubah(CAP_A, 'Captain A2', null, null))
  assert.equal((await rider(CAP_A)).nama, 'Captain A2')
  assert.equal((await rider(CAP_A)).email, 'cap@test.local')
  await assert.rejects(sSuper(() => ubah(SUPER, 'Super 2', null, null)), /Super-admin diatur di Hub Control/)
})

test('Kode MTR yang sudah punya clock-in BO tidak bisa diganti, tetapi nama dan no HP tetap bisa', async () => {
  await q(`insert into kehadiran_bo (hub, ds_id, kode_mtr, tanggal, masuk_lokal, zona, masuk_wib, sumber)
           values ('H', $1, 'MTR0000202', today_wib(), '06:00', 'WIB', now(), 'api')`, [DS_B])
  await assert.rejects(sSuper(() => ubah(R_B, 'Rider DS B', 'MTR0000299', null)), /sudah punya 1 clock-in BO/)
  await sSuper(() => ubah(R_B, 'Rider DS B baru', 'MTR0000202', '081200000202'))
  assert.equal((await rider(R_B)).nama, 'Rider DS B baru')
})

test('hapus: rider yang belum punya riwayat dihapus oleh Arcon DS-nya dan tercatat di riwayat', async () => {
  assert.equal((await sArcon(() => q(`select jejak_rider($1) as j`, [R_BERSIH])))[0].j, '')
  await sArcon(() => hapus(R_BERSIH))
  assert.equal(await rider(R_BERSIH), undefined)
  const [l] = await log('hapus')
  assert.equal(l.captain_id, ARC_A, 'pelaku')
  assert.match(l.detail, /Salah Masuk/)
  assert.equal(l.ds_id, DS_A)
})

test('hapus: Captain, Arcon DS lain, dan peran selain rider ditolak', async () => {
  const x = await baru(210)
  await assert.rejects(sCaptain(() => hapus(x)), /Hanya Super-admin atau Arcon/)
  await assert.rejects(sArcon(() => hapus(R_B)), /Hanya Super-admin atau Arcon/)
  await assert.rejects(sSuper(() => hapus(CAP_A)), /Hanya rider biasa/)
  await assert.rejects(sArcon(() => hapus(id(999))), /tidak ditemukan/)
  assert.ok(await rider(x))
  await sSuper(() => hapus(x))
  assert.equal(await rider(x), undefined)
})

const punyaRiwayat = {
  jadwal: [(r) => q(`insert into jadwal (tanggal, rider_id, shift, ds_id) values (today_wib() - 5, $1, 'pagi', $2)`, [r, DS_A]), /1 jadwal/],
  absensi: [(r) => q(`insert into actual_harian (tanggal, rider_id, ds_id, status) values (today_wib() - 5, $1, $2, 'hadir')`, [r, DS_A]), /1 absensi/],
  'absensi sebagai pengganti': [(r) => q(`insert into actual_harian (tanggal, rider_id, ds_id, status, backup_untuk_id) values (today_wib() - 5, $1, $2, 'pengganti', $3)`, [R_A, DS_A, r]), /1 absensi/],
  'clock-in BO': [(r) => q(`insert into kehadiran_bo (hub, ds_id, kode_mtr, tanggal, masuk_lokal, zona, masuk_wib, sumber)
                            select 'H', $2, kode_mtr, today_wib(), '06:00', 'WIB', now(), 'api' from riders where id = $1`, [r, DS_A]), /1 clock-in BO/],
  'laporan order': [(r) => q(`insert into laporan_order (tanggal, rider_id, ds_id, jumlah_order) values (today_wib() - 5, $1, $2, 12)`, [r, DS_A]), /1 laporan order/],
  'kandidat yang diterima jadi rider ini': [(r) => q(`insert into kandidat (nama, rider_id, ds_id, status) values ('Calon', $1, $2, 'diterima')`, [r, DS_A]), /1 data rekrutmen/],
  'riwayat berhenti': [(r) => q(`insert into rider_peristiwa (rider_id, jenis, tanggal, kategori) values ($1, 'berhenti', today_wib() - 5, 'tidak_diketahui')`, [r]), /1 riwayat bergabung/],
  'riwayat bergabung dari impor': [(r) => q(`insert into rider_peristiwa (rider_id, jenis, tanggal, sumber) values ($1, 'bergabung', today_wib() - 90, 'impor')`, [r]), /riwayat bergabung/],
  'motor dipegang': [(r) => q(`insert into motor (kode_motor, ds_id, dipegang_oleh) values ('B-' || $3::text, $2, $1)`, [r, DS_A, r.slice(-3)]), /1 motor dipegang/],
}
let n = 300
for (const [nama, [isi, pesan]] of Object.entries(punyaRiwayat)) {
  test(`hapus ditolak bila rider punya riwayat: ${nama}`, async () => {
    const r = await baru(n++, DS_A, 'Punya Riwayat')
    await isi(r)
    for (const s of [sArcon, sSuper]) {
      await assert.rejects(s(() => hapus(r)), (e) => pesan.test(e.message) && /Nonaktifkan saja/.test(e.message), nama)
    }
    assert.ok(await rider(r), 'rider tetap ada')
  })
}

test('rider yang sudah dinonaktifkan lewat alur resmi tidak bisa dihapus: riwayat berhentinya terjaga', async () => {
  const r = await baru(n++, DS_A, 'Sudah Berhenti')
  await sArcon(() => q(`select nonaktifkan_rider($1, 'mengundurkan_diri', null, today_wib())`, [r]))
  await assert.rejects(sSuper(() => hapus(r)), /riwayat bergabung\/berhenti/)
})

test('rider yang pernah merujuk kandidat tetap bisa dihapus (nama perujuk tersimpan di kandidat)', async () => {
  const r = await baru(n++, DS_A, 'Perujuk Salah Masuk')
  await q(`insert into kandidat (nama, sumber, perujuk_id, ds_id) values ('Calon Rujukan', 'Referral rider', $1, $2)`, [r, DS_A])
  await sArcon(() => hapus(r))
  const [k] = await q(`select perujuk_id, perujuk_nama from kandidat where nama = 'Calon Rujukan'`)
  assert.deepEqual([k.perujuk_id, k.perujuk_nama], [null, 'Perujuk Salah Masuk'])
})

test('jadwal rider di DS lain tidak ikut menghalangi, dan fungsi tidak bisa dipanggil anon', async () => {
  const r = await baru(n++, DS_A, 'Bersih Lagi')
  await q(`insert into jadwal (tanggal, rider_id, shift, ds_id) values (today_wib(), $1, 'pagi', $2)`, [R_B, DS_B])
  await sArcon(() => hapus(r))
  assert.equal(await rider(r), undefined)
  await db.exec(`reset role; set role anon`)
  await assert.rejects(q(`select hapus_rider($1)`, [R_A]), /permission denied/)
  await assert.rejects(q(`select ubah_rider($1, 'x', 'y', null)`, [R_A]), /permission denied/)
  await db.exec('reset role')
})
