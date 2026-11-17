// Uji long shift: rider yang sudah masuk boleh menutup shift lain di hari yang sama (migrasi 0042). Database PGlite.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const GALAXY = id(101)
const SUPER = id(1)
const [P, P2, S, S2, S3, EXTRA, REKAN] = [id(21), id(22), id(23), id(24), id(25), id(26), id(27)]
const q = async (sql, p) => (await db.query(sql, p)).rows
const tgl = (n) => `today_wib() - ${n}`

// panggil sebagai Super-admin, seperti Captain/Super lewat aplikasi
const sebagaiSuper = async (fn) => {
  await db.exec(`reset role; select set_config('request.jwt.claims', '{"email":"super@test.local"}', false); set role authenticated`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
}
const catat = (n, rider, status, backup = null, ins = 0, pot = null, tanpa = false) =>
  sebagaiSuper(() => q(`select catat_actual(${tgl(n)}, $1, $2, $3, null, $4, $5, $6)`, [rider, status, backup, pot, ins, tanpa]))
const absen = (n, rider) => q(`select status, backup_untuk_id, insentif from actual_harian where tanggal = ${tgl(n)} and rider_id = $1 order by status`, [rider])
const jadwal = (n, rider, shift) => db.exec(`insert into jadwal (tanggal, rider_id, shift, ds_id) values (${tgl(n)}, '${rider}', '${shift}', '${GALAXY}')`)

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
    insert into ds (id, nama, kuota_pagi, kuota_siang) values ('${GALAXY}', 'Galaxy', 2, 2);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${SUPER}', null, 'Super', null, 'super_admin', 'super@test.local', 'aktif'),
      ('${P}', 'M1', 'Pagi Satu', '${GALAXY}', 'rider', null, 'aktif'), ('${P2}', 'M2', 'Pagi Dua', '${GALAXY}', 'rider', null, 'aktif'),
      ('${S}', 'M3', 'Siang Satu', '${GALAXY}', 'rider', null, 'aktif'), ('${S2}', 'M4', 'Siang Dua', '${GALAXY}', 'rider', null, 'aktif'),
      ('${S3}', 'M5', 'Siang Tiga', '${GALAXY}', 'rider', null, 'aktif'), ('${EXTRA}', 'M6', 'Tanpa Jadwal', '${GALAXY}', 'rider', null, 'aktif'),
      ('${REKAN}', 'M7', 'Rekan Tukar', '${GALAXY}', 'rider', null, 'aktif');`)
})
after(() => db.close())

test('long shift: A hadir pagi lalu menutup siang B yang alpha. A punya dua isian, insentif di isian pengganti', async () => {
  await jadwal(1, P, 'pagi'); await jadwal(1, S, 'siang')
  await catat(1, P, 'hadir')
  await catat(1, S, 'alpha', P, 25000, true)
  const a = await absen(1, P)
  assert.deepEqual(a.map((r) => [r.status, r.backup_untuk_id, r.insentif]), [['hadir', null, 0], ['pengganti', S, 25000]])
  assert.deepEqual((await absen(1, S)).map((r) => r.status), ['alpha'])
})

test('laporan menghitung long shift sebagai 2 shift tanpa menggandakan jadwal', async () => {
  const r = await sebagaiSuper(() => q(`select * from laporan_rider(${tgl(1)}, ${tgl(1)})`))
  const a = r.find((x) => x.rider_id === P)
  assert.deepEqual([a.dijadwalkan, a.hadir, a.pengganti, a.belum_diisi, Number(a.insentif)], [1, 1, 1, 0, 25000])
  const ds = (await sebagaiSuper(() => q(`select * from laporan_ds(${tgl(1)}, ${tgl(1)})`))).find((x) => x.ds_nama === 'Galaxy')
  assert.deepEqual([ds.dijadwalkan, ds.terisi, ds.patuh, ds.pengganti, ds.belum_diisi], [2, 2, 1, 1, 0]) // terisi tidak jadi 3
  const f = (await sebagaiSuper(() => q(`select * from laporan_fulfillment(${tgl(1)}, ${tgl(1)})`)))[0]
  assert.deepEqual([f.terpenuhi_pagi, f.terpenuhi_siang, f.terpenuhi_lain], [1, 1, 0]) // pagi: A; siang: A sebagai pengganti B
})

test('shift yang sama ditolak (pagi tidak bisa menutup pagi)', async () => {
  await jadwal(2, P, 'pagi'); await jadwal(2, P2, 'pagi')
  await catat(2, P, 'hadir')
  await assert.rejects(catat(2, P2, 'alpha', P, 0, true), /shift yang sama/)
})

test('rider yang sedang menutup shift lain boleh bertukar (isian pengganti tetap), hadir juga aman', async () => {
  // hari 1: P sedang menutup siang S. Dulu tukar ditolak; sekarang boleh (kasus berantai tukar libur), isian pengganti P tidak tertimpa.
  await catat(1, P, 'tukar', REKAN)
  assert.deepEqual((await absen(1, P)).map((r) => r.status), ['tukar', 'pengganti'])
  await catat(1, P, 'hadir')
  assert.equal((await absen(1, P)).length, 2) // isian pengganti tidak hilang
})

test('kasus lelah: X menutup shift pagi B, lalu shift siang milik X diganti Y (isian X: izin + pengganti)', async () => {
  // X = S (siang), B = P (pagi, alpha), Y = P2 (pagi)
  await jadwal(9, S, 'siang'); await jadwal(9, P, 'pagi'); await jadwal(9, P2, 'pagi')
  await catat(9, P, 'alpha', S, 0, true) // S menutup shift pagi P
  assert.deepEqual((await absen(9, S)).map((r) => [r.status, r.backup_untuk_id]), [['pengganti', P]])
  await catat(9, S, 'izin', P2, 15000, false) // S kelelahan: shift siangnya diganti P2
  assert.deepEqual((await absen(9, S)).map((r) => [r.status, r.backup_untuk_id]), [['izin', null], ['pengganti', P]])
  assert.deepEqual((await absen(9, P2)).map((r) => [r.status, r.backup_untuk_id, r.insentif]), [['pengganti', S, 15000]])
  const x = (await sebagaiSuper(() => q(`select * from laporan_rider(${tgl(9)}, ${tgl(9)})`))).find((r) => r.rider_id === S)
  assert.deepEqual([x.dijadwalkan, x.izin, x.pengganti, x.belum_diisi], [1, 1, 1, 0]) // jadwal tidak dobel
  const f = (await sebagaiSuper(() => q(`select * from laporan_fulfillment(${tgl(9)}, ${tgl(9)})`)))[0]
  assert.deepEqual([f.terpenuhi_pagi, f.terpenuhi_siang], [1, 1]) // pagi: S menutup P; siang: P2 menggantikan S
})

test('kasus lelah, urutan dibalik: X dicatat izin dulu, baru tercatat menutup shift lain', async () => {
  await jadwal(10, S, 'siang'); await jadwal(10, P, 'pagi'); await jadwal(10, P2, 'pagi')
  await catat(10, S, 'izin', P2, 0, false)
  await catat(10, P, 'alpha', S, 0, true) // S sedang izin di shiftnya sendiri, tetap boleh menutup pagi P
  assert.deepEqual((await absen(10, S)).map((r) => r.status), ['izin', 'pengganti'])
})

test('tukar terencana tidak boleh menimpa isian pengganti long shift rekan', async () => {
  await jadwal(11, P, 'pagi'); await jadwal(11, S, 'siang'); await jadwal(11, S2, 'siang')
  await catat(11, S, 'alpha', P, 0, true) // P menutup siang S
  await assert.rejects(catat(11, S2, 'tukar', P), /Rekan tukar sedang menutup shift rider lain/)
  assert.deepEqual((await absen(11, P)).map((r) => [r.status, r.backup_untuk_id]), [['pengganti', S]])
})

test('Batalkan pada rider yang hanya punya isian pengganti (termasuk isian lama tanpa rider yang digantikan) menghapusnya', async () => {
  await jadwal(12, P, 'pagi')
  await db.exec(`insert into actual_harian (tanggal, rider_id, ds_id, status) values (${tgl(12)}, '${P}', '${GALAXY}', 'pengganti')`)
  await sebagaiSuper(() => q(`select hapus_actual(${tgl(12)}, $1)`, [P]))
  assert.deepEqual(await absen(12, P), [])
})

test('maksimal satu shift tambahan per hari', async () => {
  await jadwal(3, P, 'pagi'); await jadwal(3, S, 'siang'); await jadwal(3, S3, 'siang')
  await catat(3, P, 'hadir'); await catat(3, S, 'alpha', P, 0, true)
  await assert.rejects(catat(3, S3, 'alpha', P, 0, true), /sudah menutup shift rider lain/)
})

test('rider yang tidak hadir di shiftnya sendiri tetap boleh menutup shift lain (shift harus beda)', async () => {
  await jadwal(4, P, 'pagi'); await jadwal(4, S, 'siang'); await jadwal(4, S2, 'siang')
  await catat(4, P, 'sakit', null, 0, false, true)
  await assert.rejects(catat(4, S2, 'alpha', S, 0, true), /shift yang sama/) // siang tidak bisa menutup siang
  await catat(4, S, 'alpha', P, 0, true) // P (sakit di pagi) menutup siang S
  assert.deepEqual((await absen(4, P)).map((r) => r.status), ['sakit', 'pengganti'])
})

test('rider terjadwal tidak bisa dicatat sebagai pengganti langsung', async () => {
  await jadwal(5, P, 'pagi')
  await assert.rejects(catat(5, P, 'pengganti', S), /hanya bisa jadi pengganti lewat isian rider yang tidak hadir/)
})

test('rider tanpa jadwal tetap satu isian per hari seperti sebelumnya', async () => {
  await jadwal(6, S, 'siang'); await jadwal(6, S2, 'siang')
  await catat(6, S, 'alpha', EXTRA, 10000, true)
  assert.deepEqual((await absen(6, EXTRA)).map((r) => r.status), ['pengganti'])
  await assert.rejects(catat(6, S2, 'alpha', EXTRA, 0, true), /sudah punya absensi/) // EXTRA sudah menutup orang lain
})

test('tukar terencana tetap menggantikan isian rekan, bukan menambah (sekarang dua arah, lihat test/tukar.test.mjs)', async () => {
  await jadwal(7, P, 'pagi'); await jadwal(7, REKAN, 'siang')
  await catat(7, REKAN, 'hadir')
  await catat(7, P, 'tukar', REKAN)
  assert.deepEqual((await absen(7, REKAN)).map((r) => r.status), ['tukar'])
})

test('membatalkan: isian milik A saja, atau penggantian lewat isian B', async () => {
  // hari 1: A (P) hadir + pengganti untuk S. Batalkan hadir A: pengganti tetap.
  await sebagaiSuper(() => q(`select hapus_actual(${tgl(1)}, $1)`, [P]))
  assert.deepEqual((await absen(1, P)).map((r) => r.status), ['pengganti'])
  // Batalkan absensi B: penggantian A hilang
  await sebagaiSuper(() => q(`select hapus_actual(${tgl(1)}, $1)`, [S]))
  assert.deepEqual(await absen(1, P), [])
  assert.deepEqual(await absen(1, S), [])
})

test('aturan unik: satu isian biasa dan satu isian pengganti per rider per hari', async () => {
  await jadwal(8, P, 'pagi')
  await db.exec(`insert into actual_harian (tanggal, rider_id, ds_id, status) values (${tgl(8)}, '${P}', '${GALAXY}', 'hadir')`)
  await assert.rejects(db.exec(`insert into actual_harian (tanggal, rider_id, ds_id, status) values (${tgl(8)}, '${P}', '${GALAXY}', 'alpha')`), /duplicate key|unique/i)
})
