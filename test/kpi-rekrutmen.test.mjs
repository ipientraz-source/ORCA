// Uji angka rekrutmen: rider direkrut, yang betul-betul aktif, turnover mingguan/bulanan, retensi, kualitas sumber, impor riwayat, dan hak lihat.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const S = 'super@test.local', REC = 'recruiter@test.local', CG = 'cap-galaxy@test.local', AA = 'arcon-a@test.local'
const GALAXY = id(101), GOWA = id(103), TDS = id(104)
const [R_REC, R_CG, R_CW, R_AA] = [id(5), id(10), id(12), id(30)]

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
const jumlah = (rows, k) => rows.reduce((a, r) => a + r[k], 0)

// terima kandidat lewat fungsi aslinya, lalu mundurkan waktu diterimanya
async function rekrut(nama, hariLalu, { ds = GALAXY, sumber = 'Walk-in' } = {}) {
  const perujuk = sumber === 'Referral rider' ? R_CG : null // referral wajib menyebut perujuk (rider atau Captain aktif)
  const [{ id: kid }] = await q('insert into kandidat (nama, sumber, ds_id, perujuk_id) values ($1, $2, $3, $4) returning id', [nama, sumber, ds, perujuk])
  const [{ terima_kandidat: rid }] = await as(S, () => q('select terima_kandidat($1)', [kid]))
  await q("update kandidat set ditutup = now() - ($2 || ' days')::interval where id = $1", [kid, String(hariLalu)])
  return rid
}
const hadir = (rid, hariLalu, status = 'hadir') =>
  db.exec(`insert into actual_harian (tanggal, rider_id, ds_id, status) values (today_wib() - ${hariLalu}, '${rid}', '${GALAXY}', '${status}')`)

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
    insert into ds (id, nama, kuota_pagi, kuota_siang) values ('${GALAXY}', 'Galaxy', 1, 1), ('${GOWA}', 'Gowa', 1, 1), ('${TDS}', 'Turnover', 1, 1);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${id(1)}', null, 'Super', null, 'super_admin', '${S}', 'aktif'),
      ('${R_REC}', null, 'Recruiter', null, 'recruiter', '${REC}', 'aktif'),
      ('${R_CG}', 'MTR-CG', 'Captain Galaxy', '${GALAXY}', 'captain', '${CG}', 'aktif'),
      ('${R_CW}', 'MTR-CW', 'Captain Gowa', '${GOWA}', 'captain', 'cap-gowa@test.local', 'aktif'),
      ('${R_AA}', null, 'Arcon A', null, 'arcon', '${AA}', 'aktif');
    update ds set captain_id = '${R_CG}', arcon_id = '${R_AA}' where id = '${GALAXY}';
    update ds set captain_id = '${R_CW}' where id = '${GOWA}';`)
})
beforeEach(() => db.exec(`
  delete from kandidat; delete from log_aktivitas; delete from actual_harian;
  delete from riders where peran = 'rider'; delete from rider_peristiwa;`))
after(() => db.close())

test('Menonaktifkan rider wajib beralasan: tercatat lengkap, hanya yang berwenang, tanggal tidak boleh masa depan', async () => {
  const [{ id: rid }] = await q("insert into riders (nama, ds_id, kode_mtr) values ('Rider A', $1, 'MTR-A') returning id", [GALAXY])
  const [{ id: lain }] = await q("insert into riders (nama, ds_id, kode_mtr) values ('Rider Gowa', $1, 'MTR-W') returning id", [GOWA])
  await as(CG, async () => {
    await assert.rejects(q("select nonaktifkan_rider($1, 'pilih-sembarang')", [rid]), /Pilih alasan berhenti/)
    await assert.rejects(q("select nonaktifkan_rider($1, 'mengundurkan_diri')", [lain]), /Tidak berwenang/) // DS lain
    await assert.rejects(q("select nonaktifkan_rider($1, 'mengundurkan_diri', null, today_wib() + 1)", [rid]), /masa depan/)
    await q("select nonaktifkan_rider($1, 'mengundurkan_diri', ' pindah kota ', today_wib() - 2)", [rid])
  })
  const [e] = await q("select kategori, alasan, tanggal = today_wib() - 2 as dua_hari, dicatat_oleh from rider_peristiwa where rider_id = $1 and jenis = 'berhenti'", [rid])
  assert.deepEqual([e.kategori, e.alasan, e.dua_hari, e.dicatat_oleh], ['mengundurkan_diri', 'pindah kota', true, R_CG])
  assert.equal((await q('select status from riders where id = $1', [rid]))[0].status, 'nonaktif')
  await as(CG, () => assert.rejects(q("select nonaktifkan_rider($1, 'diberhentikan')", [rid]), /sudah nonaktif/))
  await as(CG, () => assert.rejects(q("select nonaktifkan_rider($1, 'diberhentikan')", [R_CW]), /Hanya rider biasa/)) // bukan rider
})

test('Perubahan status lewat jalur lain tetap tercatat; mengaktifkan kembali dicatat sebagai kembali', async () => {
  const [{ id: rid }] = await q("insert into riders (nama, ds_id) values ('Rider B', $1) returning id", [GALAXY])
  assert.equal((await q("select count(*)::int as n from rider_peristiwa where rider_id = $1 and jenis = 'bergabung'", [rid]))[0].n, 1) // rider baru = bergabung
  await db.exec(`update riders set status = 'nonaktif' where id = '${rid}'`)
  const [b] = await q("select kategori, alasan from rider_peristiwa where rider_id = $1 and jenis = 'berhenti'", [rid])
  assert.deepEqual([b.kategori, b.alasan], ['tidak_diketahui', null])
  await db.exec(`update riders set status = 'aktif' where id = '${rid}'`)
  assert.equal((await q("select count(*)::int as n from rider_peristiwa where rider_id = $1 and jenis = 'kembali'", [rid]))[0].n, 1)
})

const jadwal = (rid, hariDariSekarang) =>
  db.exec(`insert into jadwal (tanggal, rider_id, shift, ds_id) values (today_wib() + (${hariDariSekarang}), '${rid}', 'pagi', '${GALAXY}')`)

test('Rider direkrut dan betul-betul aktif: mulai aktif = masuk jadwal atau tercatat di laporan Captain', async () => {
  const a = await rekrut('Aktif', 30)
  const b = await rekrut('Hadir Lama', 40)
  const c = await rekrut('Tidak Pernah', 30)
  await rekrut('Belum Dijadwalkan', 30)
  const baru = await rekrut('Baru', 3)
  const e = await rekrut('Berhenti', 30)
  const pengganti = await rekrut('Pengganti', 25)
  await rekrut('Di Luar Rentang', 200)
  await hadir(a, 3)
  await hadir(a, 10)
  await hadir(b, 20)
  await hadir(pengganti, 5, 'pengganti') // menggantikan rider lain juga dihitung bekerja
  await jadwal(c, -25) // sudah masuk jadwal tapi tidak pernah hadir
  await jadwal(baru, 1) // dijadwalkan besok, belum sempat hadir
  await db.exec(`update riders set status = 'nonaktif' where id = '${e}'`)
  await as(S, async () => {
    const [k] = await q('select * from kpi_rekrut(today_wib() - 100, today_wib())')
    assert.deepEqual(
      [k.direkrut, k.aktif, k.aktif_tidak_hadir, k.tidak_pernah_hadir, k.belum_dijadwalkan, k.baru, k.berhenti],
      [7, 2, 1, 1, 1, 1, 1], // aktif = Aktif + Pengganti
    )
    assert.equal(k.sudah_mulai, 5) // Aktif, Hadir Lama, Tidak Pernah (jadwal), Baru (jadwal), Pengganti
    // hari dari diterima ke mulai aktif (jadwal atau hadir pertama, mana yang lebih dulu): 20, 20, 5, 4, 20 → 13,8
    assert.equal(Number(k.hari_ke_mulai), 13.8)
    // hari ke hadir pertama: Aktif 30-10=20, Pengganti 25-5=20, Hadir Lama 40-20=20
    assert.equal(Number(k.hari_ke_hadir_pertama), 20)
    const singkat = await q('select * from kpi_rekrut(today_wib() - 5, today_wib())')
    assert.equal(singkat[0].direkrut, 1) // hanya "Baru"
    // status per kandidat untuk daftar kandidat (semua waktu)
    const p = await q('select k.nama, p.kelas, p.mulai_aktif is not null as mulai from kandidat_penempatan() p join kandidat k on k.id = p.kandidat_id order by k.nama')
    const per = Object.fromEntries(p.map((x) => [x.nama, [x.kelas, x.mulai]]))
    assert.deepEqual(per['Belum Dijadwalkan'], ['belum_dijadwalkan', false])
    assert.deepEqual(per['Tidak Pernah'], ['tidak_pernah_hadir', true])
    assert.deepEqual(per['Baru'], ['baru', true])
    assert.equal(p.length, 8)
  })
  await as(CG, async () => assert.equal((await q('select * from kandidat_penempatan()')).length, 8)) // semua di DS Galaxy
  await as(REC, async () => assert.equal((await q('select * from kandidat_penempatan()')).length, 8))
})

test('Kualitas per sumber: sumber yang ridernya betul-betul bertahan terlihat berbeda dari yang hanya banyak', async () => {
  const a = await rekrut('Ref 1', 30, { sumber: 'Referral rider' })
  const b = await rekrut('Ref 2', 30, { sumber: 'Referral rider' })
  const c = await rekrut('Job 1', 30, { sumber: 'Job board' })
  await rekrut('Job 2', 30, { sumber: 'Job board' })
  await rekrut('Job 3', 30, { sumber: 'Job board' })
  await hadir(a, 2)
  await hadir(b, 4)
  await hadir(c, 6)
  await as(S, async () => {
    const rows = await q('select * from kpi_sumber(today_wib() - 100, today_wib())')
    const per = Object.fromEntries(rows.map((r) => [r.sumber, [r.direkrut, r.aktif, r.belum_dijadwalkan]]))
    assert.deepEqual(per['Referral rider'], [2, 2, 0])
    assert.deepEqual(per['Job board'], [3, 1, 2])
  })
})

test('Turnover bulanan dan mingguan: awal, akhir, bergabung, berhenti per alasan, berhenti dini, dan persen', async () => {
  const ids = []
  for (const [i, st] of [['1', 'nonaktif'], ['2', 'aktif'], ['3', 'nonaktif'], ['4', 'aktif'], ['5', 'aktif']]) {
    ids.push((await q('insert into riders (nama, ds_id, status) values ($1, $2, $3) returning id', ['T' + i, TDS, st]))[0].id)
  }
  const [r1, r2, r3, r4, r5] = ids
  await db.exec('delete from rider_peristiwa')
  // M0 = awal bulan lalu. R1 berhenti M0+4 (mengundurkan diri); R3 bergabung M0+1 lalu berhenti M0+10 (diberhentikan, 9 hari = dini); R5 bergabung M0+15
  const [{ m0 }] = await q("select to_char(date_trunc('month', today_wib() - interval '1 month'), 'YYYY-MM-DD') as m0")
  await db.exec(`
    insert into rider_peristiwa (rider_id, jenis, tanggal, sumber) values
      ('${r1}', 'bergabung', null, 'awal'), ('${r2}', 'bergabung', null, 'awal'), ('${r4}', 'bergabung', null, 'awal');
    insert into rider_peristiwa (rider_id, jenis, tanggal, kategori) values ('${r1}', 'berhenti', date '${m0}' + 4, 'mengundurkan_diri');
    insert into rider_peristiwa (rider_id, jenis, tanggal) values ('${r3}', 'bergabung', date '${m0}' + 1);
    insert into rider_peristiwa (rider_id, jenis, tanggal, kategori) values ('${r3}', 'berhenti', date '${m0}' + 10, 'diberhentikan');
    insert into rider_peristiwa (rider_id, jenis, tanggal) values ('${r5}', 'bergabung', date '${m0}' + 15);`)
  await as(S, async () => {
    const [b] = await q("select * from kpi_turnover($1::date, $1::date + 27, 'bulan', $2)", [m0, TDS])
    // awal (akhir bulan sebelumnya): R1, R2, R4 = 3; akhir bulan: R2, R4, R5 = 3; 2 bergabung; 2 berhenti
    assert.deepEqual([b.awal, b.akhir, b.bergabung, b.berhenti, b.mengundurkan_diri, b.diberhentikan, b.berhenti_dini], [3, 3, 2, 2, 1, 1, 1])
    assert.equal(Number(b.persen), 66.7) // 2 / ((3 + 3) / 2)
    assert.equal(b.berjalan, false)
    const mg = await q("select * from kpi_turnover($1::date, $1::date + 27, 'minggu', $2)", [m0, TDS])
    assert.ok(mg.length >= 4)
    assert.equal(jumlah(mg, 'berhenti'), 2) // jumlah mingguan = jumlah bulanan
    assert.equal(jumlah(mg, 'bergabung'), 2)
    await assert.rejects(q("select * from kpi_turnover(today_wib() - 30, today_wib(), 'tahun')"), /minggu atau bulan/)
  })
  await as(CG, async () => {
    const [b] = await q("select * from kpi_turnover($1::date, $1::date + 27, 'bulan', $2)", [m0, TDS])
    assert.deepEqual([b.awal, b.akhir, b.berhenti, b.persen], [0, 0, 0, null]) // DS Turnover bukan DS Captain Galaxy
  })
})

test('Retensi 30/60/90 hari per angkatan: hanya yang sudah cukup umur dihitung', async () => {
  const lama = await rekrut('Cepat Berhenti', 100) // berhenti 20 hari setelah diterima
  await rekrut('Bertahan', 40)
  await rekrut('Terlalu Baru', 10)
  await db.exec(`update riders set status = 'nonaktif' where id = '${lama}'`)
  await db.exec(`delete from rider_peristiwa where rider_id = '${lama}' and jenis = 'berhenti'`)
  await db.exec(`insert into rider_peristiwa (rider_id, jenis, tanggal, kategori) values ('${lama}', 'berhenti', today_wib() - 80, 'mengundurkan_diri')`)
  await as(S, async () => {
    const rows = await q('select * from kpi_retensi(today_wib() - 150, today_wib())')
    assert.equal(jumlah(rows, 'direkrut'), 3)
    assert.deepEqual([jumlah(rows, 'eval30'), jumlah(rows, 'tetap30')], [2, 1]) // Terlalu Baru belum cukup 30 hari
    assert.deepEqual([jumlah(rows, 'eval60'), jumlah(rows, 'tetap60')], [1, 0])
    assert.deepEqual([jumlah(rows, 'eval90'), jumlah(rows, 'tetap90')], [1, 0])
  })
})

test('Alasan berhenti dirangkum per kategori', async () => {
  const [{ id: a }] = await q("insert into riders (nama, ds_id) values ('Alasan A', $1) returning id", [GALAXY])
  const [{ id: b }] = await q("insert into riders (nama, ds_id) values ('Alasan B', $1) returning id", [GALAXY])
  const [{ id: c }] = await q("insert into riders (nama, ds_id) values ('Alasan C', $1) returning id", [GALAXY])
  await as(S, async () => {
    await q("select nonaktifkan_rider($1, 'mengundurkan_diri')", [a])
    await q("select nonaktifkan_rider($1, 'mengundurkan_diri')", [b])
    await q("select nonaktifkan_rider($1, 'diberhentikan')", [c])
    const rows = await q('select * from kpi_alasan(today_wib() - 1, today_wib())')
    assert.deepEqual(rows.map((r) => [r.kategori, r.jumlah]), [['mengundurkan_diri', 2], ['diberhentikan', 1]])
  })
})

test('Impor riwayat rider lama: hanya Super-admin, melaporkan yang tidak ditemukan/bertentangan, dan memajukan tanggal valid', async () => {
  await q("insert into riders (nama, ds_id, kode_mtr) values ('Lama Aktif', $1, 'MTR-LA')", [GALAXY])
  const [{ id: keluar }] = await q("insert into riders (nama, ds_id, kode_mtr, status) values ('Lama Keluar', $1, 'MTR-LK', 'nonaktif') returning id", [GALAXY])
  const berkas = JSON.stringify([
    { kode_mtr: 'mtr-la', bergabung: '2025-03-10' },
    { kode_mtr: 'MTR-LK', bergabung: '2025-04-01', berhenti: '2026-01-05', kategori: 'diberhentikan', alasan: 'sering alpha' },
    { kode_mtr: 'MTR-XX', bergabung: '2025-01-01' },
    { kode_mtr: 'MTR-LA', bergabung: '2025-03-10', berhenti: '2026-02-01' }, // masih aktif tapi ada tanggal berhenti
  ])
  await as(CG, () => assert.rejects(q('select impor_riwayat_rider($1::jsonb)', [berkas]), /Hanya Super-admin/))
  await as(REC, () => assert.rejects(q('select impor_riwayat_rider($1::jsonb)', [berkas]), /Hanya Super-admin/))
  const [{ impor_riwayat_rider: h }] = await as(S, () => q('select impor_riwayat_rider($1::jsonb)', [berkas]))
  // MTR-LA muncul dua kali: baris pertama sah, baris keempat bertentangan (aktif tapi berhenti)
  assert.deepEqual([h.diproses, h.tidak_ditemukan, h.konflik], [2, ['MTR-XX'], ['MTR-LA']])
  const ev = await q("select jenis, to_char(tanggal, 'YYYY-MM-DD') as t, kategori, alasan, sumber from rider_peristiwa where rider_id = $1 order by jenis", [keluar])
  assert.deepEqual(ev.map((e) => [e.jenis, e.t, e.kategori, e.alasan, e.sumber]), [
    ['bergabung', '2025-04-01', null, null, 'impor'], ['berhenti', '2026-01-05', 'diberhentikan', 'sering alpha', 'impor']])
  assert.equal((await q("select to_char(kpi_valid_sejak(), 'YYYY-MM-DD') as d"))[0].d, '2025-03-10')
})

test('Hak lihat: Recruiter dan Super-admin semua DS; Captain hanya DS-nya; tabel peristiwa hanya dibaca Super-admin', async () => {
  const a = await rekrut('Galaxy 1', 20, { ds: GALAXY })
  await rekrut('Gowa 1', 20, { ds: GOWA })
  await hadir(a, 1)
  const hitung = async () => (await q('select direkrut from kpi_rekrut(today_wib() - 60, today_wib())'))[0].direkrut
  await as(S, async () => assert.equal(await hitung(), 2))
  await as(REC, async () => assert.equal(await hitung(), 2))
  await as(CG, async () => assert.equal(await hitung(), 1))
  await as(AA, async () => assert.equal(await hitung(), 1)) // Arcon A memegang Galaxy saja
  await as(S, async () => assert.ok((await q('select * from rider_peristiwa')).length > 0))
  await as(REC, async () => assert.equal((await q('select * from rider_peristiwa')).length, 0))
  await as(CG, async () => assert.equal((await q('select * from rider_peristiwa')).length, 0))
})
