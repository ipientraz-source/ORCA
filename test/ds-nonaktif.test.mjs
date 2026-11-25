// Uji DS nonaktif (migrasi 0072): hanya Super-admin, DS dengan rider aktif atau jadwal ke depan tidak bisa dinonaktifkan, riwayat tetap utuh,
// dan daftar DS tanpa clock-in BO beberapa hari. Database PGlite.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const [SUPER, CAP, ARC] = [id(1), id(2), id(3)]
const [KOSONG, ADA_RIDER, ADA_JADWAL, TERBARU, TANPA_HUB, LAMA] = [id(101), id(102), id(103), id(104), id(105), id(106)]
const q = async (sql, p) => (await db.query(sql, p)).rows
const sebagai = async (email, fn) => {
  await db.exec(`reset role; select set_config('request.jwt.claims', '{"email":"${email}"}', false); set role authenticated`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
}
const sebagaiSuper = (fn) => sebagai('super@test.local', fn)
const hariIni = async (selisih = 0) => (await q(`select to_char(today_wib() + $1::int, 'YYYY-MM-DD') as d`, [selisih]))[0].d
const clockin = async (dsId, hub, selisih) => {
  const t = await hariIni(selisih)
  await q(`insert into kehadiran_bo (hub, ds_id, kode_mtr, tanggal, masuk_lokal, zona, masuk_wib, sumber)
           values ($1, $2, 'MTR0000001', $3::date, '06:00', 'WIB', ($3::date + time '06:00')::timestamptz, 'api')`, [hub, dsId, t])
}
const setAktif = (dsId, aktif) => sebagaiSuper(() => q(`update ds set aktif = $2 where id = $1`, [dsId, aktif]))
const aktifDi = async (dsId) => (await q(`select aktif from ds where id = $1`, [dsId]))[0].aktif
const tanpaClockin = (hari) => sebagaiSuper(async () => (await q(`select * from ds_tanpa_clockin($1) as id`, [hari])).map((r) => r.id))

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
    insert into ds (id, nama, hub_bo) values
      ('${KOSONG}', 'DS KOSONG', 'HUB KOSONG'), ('${ADA_RIDER}', 'DS ADA RIDER', 'HUB ADA RIDER'), ('${ADA_JADWAL}', 'DS ADA JADWAL', 'HUB ADA JADWAL'),
      ('${TERBARU}', 'DS CLOCKIN TERBARU', 'HUB TERBARU'), ('${TANPA_HUB}', 'DS TANPA HUB', null), ('${LAMA}', 'DS CLOCKIN LAMA', 'HUB LAMA');
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${SUPER}', null, 'Super', null, 'super_admin', 'super@test.local', 'aktif'),
      ('${CAP}', null, 'Cap', '${KOSONG}', 'captain', 'cap@test.local', 'aktif'),
      ('${ARC}', null, 'Arcon', null, 'arcon', 'arc@test.local', 'aktif'),
      ('${id(201)}', 'MTR0000201', 'Rider Aktif', '${ADA_RIDER}', 'rider', null, 'aktif'),
      ('${id(202)}', 'MTR0000202', 'Rider Dengan Jadwal', null, 'rider', null, 'nonaktif');
    update ds set arcon_id = '${ARC}' where id = '${KOSONG}';`)
  await q(`insert into jadwal (tanggal, rider_id, shift, ds_id) values (today_wib() + 1, $1, 'pagi', $2)`, [id(202), ADA_JADWAL])
})
after(() => db.close())

test('semua DS yang ada tetap aktif secara bawaan', async () => {
  assert.equal(await aktifDi(KOSONG), true)
  assert.equal((await q(`select count(*)::int as n from ds where not aktif`))[0].n, 0)
})

test('Super-admin menonaktifkan lalu mengaktifkan lagi DS yang kosong', async () => {
  await setAktif(KOSONG, false)
  assert.equal(await aktifDi(KOSONG), false)
  await setAktif(KOSONG, true)
  assert.equal(await aktifDi(KOSONG), true)
})

test('DS dengan rider aktif atau jadwal mulai hari ini tidak bisa dinonaktifkan', async () => {
  await assert.rejects(setAktif(ADA_RIDER, false), /masih punya rider aktif/)
  await assert.rejects(setAktif(ADA_JADWAL, false), /masih punya jadwal/)
  assert.equal(await aktifDi(ADA_RIDER), true)
  assert.equal(await aktifDi(ADA_JADWAL), true)
})

test('jadwal kemarin tidak menghalangi; data riwayat tetap utuh setelah nonaktif dan aktif lagi', async () => {
  await q(`insert into jadwal (tanggal, rider_id, shift, ds_id) values (today_wib() - 1, $1, 'pagi', $2)`, [id(202), LAMA])
  await q(`insert into actual_harian (tanggal, rider_id, ds_id, status) values (today_wib() - 1, $1, $2, 'hadir')`, [id(202), LAMA])
  await setAktif(LAMA, false)
  assert.equal((await q(`select count(*)::int as n from jadwal where ds_id = $1`, [LAMA]))[0].n, 1)
  assert.equal((await q(`select count(*)::int as n from actual_harian where ds_id = $1`, [LAMA]))[0].n, 1)
  await setAktif(LAMA, true)
  assert.equal((await q(`select count(*)::int as n from actual_harian where ds_id = $1`, [LAMA]))[0].n, 1)
})

test('hanya Super-admin: Captain dan Arcon ditolak mengubah status aktif', async () => {
  // Bisa ditolak penjaga (error) atau disaring RLS (0 baris, tanpa error); yang penting statusnya tidak berubah
  for (const email of ['arc@test.local', 'cap@test.local']) {
    await sebagai(email, () => q(`update ds set aktif = false where id = $1`, [KOSONG])).catch(() => {})
    assert.equal(await aktifDi(KOSONG), true, email)
  }
})

test('ds_tanpa_clockin: hanya DS aktif yang terhubung BO dan tidak ada clock-in dalam 3 hari terakhir', async () => {
  await clockin(TERBARU, 'HUB TERBARU', 0) // clock-in hari ini
  await clockin(LAMA, 'HUB LAMA', -3) // terakhir 3 hari lalu: di luar jendela 3 hari (hari ini, kemarin, 2 hari lalu)
  await clockin(ADA_RIDER, 'HUB ADA RIDER', -2) // dua hari lalu: masih di dalam jendela
  const hasil = await tanpaClockin(3)
  assert.ok(hasil.includes(KOSONG) && hasil.includes(LAMA) && hasil.includes(ADA_JADWAL))
  assert.ok(!hasil.includes(TERBARU), 'clock-in hari ini')
  assert.ok(!hasil.includes(ADA_RIDER), 'clock-in 2 hari lalu masih dalam jendela')
  assert.ok(!hasil.includes(TANPA_HUB), 'DS yang tidak terhubung ke BO bukan kandidat')
  await setAktif(KOSONG, false)
  assert.ok(!(await tanpaClockin(3)).includes(KOSONG), 'DS yang sudah nonaktif tidak disarankan lagi')
  await setAktif(KOSONG, true)
})

test('ds_tanpa_clockin: hanya Super-admin; Arcon, Captain, dan anon tidak mendapat apa pun', async () => {
  assert.deepEqual(await sebagai('arc@test.local', () => q(`select * from ds_tanpa_clockin(3)`)), [])
  assert.deepEqual(await sebagai('cap@test.local', () => q(`select * from ds_tanpa_clockin(3)`)), [])
  await db.exec(`reset role; set role anon`)
  await assert.rejects(q(`select * from ds_tanpa_clockin(3)`), /permission denied/)
  await db.exec('reset role')
})
