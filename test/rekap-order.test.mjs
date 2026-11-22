// Uji rekap order (rekap_order_ds / rekap_order_rider / rekap_order_hari) dan riwayat masuk rider (riwayat_absensi_rider), migrasi 0057.
// Rekap berhak pemanggil: Super-admin semua DS, Captain dan Arcon hanya DS yang dipegang. Riwayat masuk dipanggil rider (anon) dengan Kode MTR. Database PGlite.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const S = 'super@test.local', CG = 'cap-galaxy@test.local', CW = 'cap-gowa@test.local', AA = 'arcon-a@test.local', RG = 'orang-asing@test.local'
const GALAXY = id(101), GOWA = id(103)
const [R_CG, R_CW, R_AA, R_G, R_G2, R_W] = [id(10), id(12), id(30), id(21), id(24), id(23)]
const q = async (sql, p) => (await db.query(sql, p)).rows
async function as(email, fn) {
  const claims = JSON.stringify(email ? { email } : {})
  await db.exec(`reset role; select set_config('request.jwt.claims', '${claims}', false); set role ${email ? 'authenticated' : 'anon'}`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
}
const num = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])))

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
    insert into ds (id, nama, kuota_pagi, kuota_siang) values ('${GALAXY}', 'Galaxy', 1, 1), ('${GOWA}', 'Gowa', 1, 1);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${id(1)}', null, 'Super', null, 'super_admin', '${S}', 'aktif'),
      ('${R_CG}', 'MTR-CG', 'Captain Galaxy', '${GALAXY}', 'captain', '${CG}', 'aktif'),
      ('${R_CW}', 'MTR-CW', 'Captain Gowa', '${GOWA}', 'captain', '${CW}', 'aktif'),
      ('${R_AA}', null, 'Arcon A', null, 'arcon', '${AA}', 'aktif'),
      ('${R_G}', 'MTR021', 'Rider Galaxy', '${GALAXY}', 'rider', null, 'aktif'),
      ('${R_G2}', 'MTR024', 'Rider Galaxy Dua', '${GALAXY}', 'rider', null, 'aktif'),
      ('${R_W}', 'MTR023', 'Rider Gowa', '${GOWA}', 'rider', null, 'aktif');
    update ds set captain_id = '${R_CG}', arcon_id = '${R_AA}' where id = '${GALAXY}';
    update ds set captain_id = '${R_CW}' where id = '${GOWA}';
    -- Rider Galaxy: terjadwal 4 hari ke belakang sampai hari ini; melapor hari ini (pagi dan siang) dan kemarin (pagi)
    insert into jadwal (tanggal, rider_id, shift, ds_id) values
      (today_wib(), '${R_G}', 'pagi', '${GALAXY}'), (today_wib() - 1, '${R_G}', 'pagi', '${GALAXY}'),
      (today_wib() - 2, '${R_G}', 'pagi', '${GALAXY}'), (today_wib() - 3, '${R_G}', 'pagi', '${GALAXY}'),
      (today_wib(), '${R_G2}', 'siang', '${GALAXY}'),
      (today_wib(), '${R_W}', 'pagi', '${GOWA}');
    insert into laporan_order (tanggal, shift, rider_id, ds_id, jumlah_order) values
      (today_wib(), 'pagi', '${R_G}', '${GALAXY}', 12), (today_wib(), 'siang', '${R_G}', '${GALAXY}', 8), (today_wib() - 1, 'pagi', '${R_G}', '${GALAXY}', 5),
      (today_wib(), 'pagi', '${R_W}', '${GOWA}', 7);
    -- Absensi Rider Galaxy: kemarin hadir, dua hari lalu izin, tiga hari lalu belum dicatat. Rider Gowa hadir hari ini (tidak boleh bocor).
    insert into actual_harian (tanggal, rider_id, ds_id, status) values
      (today_wib() - 1, '${R_G}', '${GALAXY}', 'hadir'), (today_wib() - 2, '${R_G}', '${GALAXY}', 'izin'),
      (today_wib(), '${R_W}', '${GOWA}', 'hadir');`)
})
after(() => db.close())

test('rekap per DS: Super semua DS, Captain dan Arcon hanya DS yang dipegang, akun tak dikenal kosong, anon ditolak', async () => {
  const dari = 'today_wib() - 6', sampai = 'today_wib()'
  const ds = (email) => as(email, async () => num(await q(`select ds_nama, total_order, rider_lapor, hari_rider_jadwal, hari_rider_lapor from rekap_order_ds(${dari}, ${sampai})`)))
  assert.deepEqual(await ds(S), [
    { ds_nama: 'Galaxy', total_order: 25, rider_lapor: 1, hari_rider_jadwal: 5, hari_rider_lapor: 2 }, // 12+8+5; jadwal 4 hari R_G + 1 R_G2; yang ada laporan: hari ini dan kemarin
    { ds_nama: 'Gowa', total_order: 7, rider_lapor: 1, hari_rider_jadwal: 1, hari_rider_lapor: 1 },
  ])
  assert.deepEqual((await ds(CG)).map((r) => r.ds_nama), ['Galaxy'])
  assert.deepEqual((await ds(AA)).map((r) => r.ds_nama), ['Galaxy'])
  assert.deepEqual((await ds(CW)).map((r) => r.ds_nama), ['Gowa'])
  assert.deepEqual(await ds(RG), [])
  await assert.rejects(as(null, () => q(`select * from rekap_order_ds(${dari}, ${sampai})`)), /permission denied/)
})

test('rekap per rider: urut total terbesar, rider tanpa laporan tetap tampil, DS orang lain kosong', async () => {
  const rd = (email, ds) => as(email, async () => num(await q(`select nama, total_order, hari_lapor, hari_jadwal from rekap_order_rider(today_wib() - 6, today_wib(), '${ds}')`)))
  assert.deepEqual(await rd(CG, GALAXY), [
    { nama: 'Rider Galaxy', total_order: 25, hari_lapor: 2, hari_jadwal: 4 }, // dua shift di hari yang sama dihitung satu hari lapor
    { nama: 'Rider Galaxy Dua', total_order: 0, hari_lapor: 0, hari_jadwal: 1 },
  ])
  assert.equal((await rd(S, GOWA)).length, 1)
  assert.equal((await rd(AA, GALAXY)).length, 2)
  assert.deepEqual(await rd(CW, GALAXY), []) // Captain Gowa tidak bisa mengintip Galaxy
  assert.deepEqual(await rd(AA, GOWA), []) // Arcon A tidak memegang Gowa
  assert.deepEqual(await rd(RG, GALAXY), [])
})

test('rekap harian per shift: filter DS, dan tanpa filter hanya DS yang boleh dilihat', async () => {
  const hr = (email, ds = null) => as(email, async () => num(await q(`select tanggal::text as tanggal, shift, total_order, pelapor from rekap_order_hari(today_wib() - 6, today_wib(), $1)`, [ds])))
  const hariIni = (await q('select today_wib()::text as t'))[0].t
  const sup = await hr(S)
  assert.equal(sup.reduce((n, r) => n + r.total_order, 0), 32)
  assert.deepEqual((await hr(S, GALAXY)).filter((r) => r.tanggal === hariIni).map((r) => [r.shift, r.total_order]), [['pagi', 12], ['siang', 8]])
  assert.equal((await hr(CW)).reduce((n, r) => n + r.total_order, 0), 7) // Captain Gowa tanpa filter: hanya Gowa
  assert.deepEqual(await hr(CW, GALAXY), []) // dengan filter DS orang lain: kosong
  assert.deepEqual(await hr(RG), [])
})

test('rentang lebih dari 93 hari ditolak diam-diam (hasil kosong), supaya satu panggilan tidak menyapu seluruh tabel', async () => {
  await as(S, async () => {
    assert.equal((await q('select * from rekap_order_ds(today_wib() - 200, today_wib())')).length, 0)
    assert.equal((await q(`select * from rekap_order_rider(today_wib() - 200, today_wib(), '${GALAXY}')`)).length, 0)
    assert.equal((await q('select * from rekap_order_hari(today_wib() - 200, today_wib(), null)')).length, 0)
    assert.equal((await q('select * from rekap_order_ds(today_wib(), today_wib() - 1)')).length, 0) // dari setelah sampai
    assert.equal((await q('select * from rekap_order_ds(today_wib() - 92, today_wib())')).length, 2) // batas masih boleh
  })
})

test('riwayat masuk rider: status per hari beserta shift, hari terjadwal tanpa catatan = belum, tidak membocorkan rider lain', async () => {
  const rw = (kode, hari) => as(null, async () => num(await q(`select tanggal::text as tanggal, status, shift from riwayat_absensi_rider($1, $2)`, [kode, hari])))
  const t = (n) => q('select (today_wib() - $1::int)::text as t', [n]).then((r) => r[0].t)
  const hasil = await rw('MTR021', 60)
  assert.deepEqual(hasil, [
    { tanggal: await t(1), status: 'hadir', shift: 'pagi' },
    { tanggal: await t(2), status: 'izin', shift: 'pagi' }, // shift diambil dari jadwal hari itu
    { tanggal: await t(3), status: 'belum', shift: 'pagi' }, // terjadwal, belum dicatat Captain
  ])
  assert.deepEqual((await rw('  mtr021 ', 60)).length, 3) // huruf kecil dan spasi dimaklumi seperti jadwal_rider
  assert.deepEqual((await rw('MTR023', 60)).map((r) => [r.status, r.shift]), [['hadir', 'pagi']]) // rider Gowa hanya melihat miliknya
  assert.deepEqual(await rw('MTR999', 60), []) // kode tidak dikenal
  assert.deepEqual(await rw('', 60), [])
  assert.equal((await rw('MTR021', 1)).length, 1) // jendela 1 hari: hanya kemarin dan hari ini
  await db.exec(`update riders set status = 'nonaktif' where id = '${R_G}'`)
  assert.deepEqual(await rw('MTR021', 60), []) // rider nonaktif tidak bisa melihat
  await db.exec(`update riders set status = 'aktif' where id = '${R_G}'`)
})

test('riwayat masuk: pengganti memakai shift yang ia tutup, dan hari ini yang belum dicatat tidak dihitung belum', async () => {
  // Rider Galaxy Dua menggantikan Rider Galaxy (shift pagi) kemarin
  await db.exec(`insert into actual_harian (tanggal, rider_id, ds_id, status, backup_untuk_id) values (today_wib() - 1, '${R_G2}', '${GALAXY}', 'pengganti', '${R_G}')`)
  const r = await as(null, async () => num(await q(`select status, shift, jenis from riwayat_absensi_rider('MTR024', 30)`)))
  assert.deepEqual(r, [{ status: 'pengganti', shift: 'pagi', jenis: 'backup' }]) // jadwal siang hari ini belum dicatat, tapi hari ini tidak masuk 'belum'; kemarin ia tanpa jadwal = backup
})


test('penanda pengganti untuk Jadwal Saya: hari ini ke depan saja, shift yang ditutup, dan hanya milik rider itu', async () => {
  const t2 = (await q('select (today_wib() + 2)::text as t'))[0].t
  // Rider Galaxy terjadwal siang di hari itu; Rider Galaxy Dua dicatat sebagai pengganti shift siang tersebut
  await db.exec(`insert into jadwal (tanggal, rider_id, shift, ds_id) values (today_wib() + 2, '${R_G}', 'siang', '${GALAXY}');
    insert into actual_harian (tanggal, rider_id, ds_id, status, backup_untuk_id) values (today_wib() + 2, '${R_G2}', '${GALAXY}', 'pengganti', '${R_G}')`)
  const pg = (kode) => as(null, async () => num(await q('select tanggal::text as tanggal, shift, jenis from pengganti_rider($1)', [kode])))
  assert.deepEqual(await pg('MTR024'), [{ tanggal: t2, shift: 'siang', jenis: 'backup' }]) // pengganti kemarin tidak ikut: hanya hari ini dan ke depan; tanpa jadwal hari itu = backup
  assert.deepEqual(await pg(' mtr024 '), [{ tanggal: t2, shift: 'siang', jenis: 'backup' }])
  assert.deepEqual(await pg('MTR021'), []) // yang digantikan tidak punya penanda
  assert.deepEqual(await pg('MTR999'), [])
  await db.exec('delete from actual_harian where tanggal = today_wib() + 2; delete from jadwal where tanggal = today_wib() + 2')
})

test('jenis pengganti: terjadwal hari itu = long shift, tanpa jadwal = backup (Jadwal Saya dan Riwayat Masuk)', async () => {
  const t3 = (await q('select (today_wib() + 3)::text as t'))[0].t
  // Galaxy pagi dan Galaxy Dua siang di hari yang sama; Galaxy Dua menutup pagi Galaxy sambil tetap kerja siangnya = long shift
  await db.exec(`insert into jadwal (tanggal, rider_id, shift, ds_id) values (today_wib() + 3, '${R_G}', 'pagi', '${GALAXY}'), (today_wib() + 3, '${R_G2}', 'siang', '${GALAXY}');
    insert into actual_harian (tanggal, rider_id, ds_id, status, backup_untuk_id) values (today_wib() + 3, '${R_G2}', '${GALAXY}', 'pengganti', '${R_G}')`)
  const pg = await as(null, async () => num(await q(`select tanggal::text as tanggal, shift, jenis from pengganti_rider('MTR024')`)))
  assert.deepEqual(pg.filter((p) => p.tanggal === t3), [{ tanggal: t3, shift: 'pagi', jenis: 'long_shift' }])
  await db.exec('delete from actual_harian where tanggal = today_wib() + 3; delete from jadwal where tanggal = today_wib() + 3')
  // riwayat: hari ini ia terjadwal siang lalu menutup pagi = long shift; jenis hanya terisi untuk baris pengganti
  await db.exec(`insert into actual_harian (tanggal, rider_id, ds_id, status) values (today_wib(), '${R_G2}', '${GALAXY}', 'hadir');
    insert into actual_harian (tanggal, rider_id, ds_id, status, backup_untuk_id) values (today_wib(), '${R_G2}', '${GALAXY}', 'pengganti', '${R_G}')`)
  const rw = await as(null, async () => num(await q(`select tanggal::text as tanggal, status, jenis from riwayat_absensi_rider('MTR024', 1) order by status`)))
  const t0 = (await q('select today_wib()::text as t'))[0].t
  assert.deepEqual(rw.filter((r) => r.tanggal === t0).map(({ status, jenis }) => ({ status, jenis })), [{ status: 'hadir', jenis: null }, { status: 'pengganti', jenis: 'long_shift' }])
  await db.exec('delete from actual_harian where tanggal = today_wib()')
})
