// Uji rekap_order_rider_teratas (migrasi 0078): rider dengan rata-rata order per hari lapor tertinggi, lintas DS.
// Hak pemanggil: Super-admin semua DS, Arcon dan Captain hanya DS yang dipegang. Database PGlite, semua data sintetis.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const S = 'super@test.local', CG = 'cap-galaxy@test.local', CW = 'cap-gowa@test.local', AA = 'arcon-a@test.local', RG = 'orang-asing@test.local'
const GALAXY = id(101), GOWA = id(103)
const [R_CG, R_CW, R_AA, R_A, R_B, R_C, R_W] = [id(10), id(12), id(30), id(21), id(22), id(23), id(24)]
const q = async (sql, p) => (await db.query(sql, p)).rows
async function as(email, fn) {
  const claims = JSON.stringify(email ? { email } : {})
  await db.exec(`reset role; select set_config('request.jwt.claims', '${claims}', false); set role ${email ? 'authenticated' : 'anon'}`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
}
const num = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])))
// n hari berturut-turut ke belakang dari hari ini, masing-masing satu laporan pagi berisi jml order
const lapor = (rider, ds, hari, jml) => Array.from({ length: hari }, (_, i) => `(today_wib() - ${i}, 'pagi', '${rider}', '${ds}', ${jml})`).join(', ')

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
      ('${R_A}', 'MTR021', 'Rider A', '${GALAXY}', 'rider', null, 'aktif'),
      ('${R_B}', 'MTR022', 'Rider B', '${GALAXY}', 'rider', null, 'aktif'),
      ('${R_C}', 'MTR023', 'Rider C', '${GALAXY}', 'rider', null, 'aktif'),
      ('${R_W}', 'MTR024', 'Rider W', '${GOWA}', 'rider', null, 'aktif');
    update ds set captain_id = '${R_CG}', arcon_id = '${R_AA}' where id = '${GALAXY}';
    update ds set captain_id = '${R_CW}' where id = '${GOWA}';
    insert into laporan_order (tanggal, shift, rider_id, ds_id, jumlah_order) values
      ${lapor(R_A, GALAXY, 6, 10)},
      ${lapor(R_B, GALAXY, 6, 7)},
      ${lapor(R_C, GALAXY, 3, 50)},
      ${lapor(R_W, GOWA, 5, 9)};`)
})
after(() => db.close())
// Rider A: 6 hari x 10 = rata 10. Rider B: 6 x 7 = rata 7. Rider C: rata 50 tetapi baru 3 hari lapor (di bawah batas bawaan 5). Rider W: 5 x 9 = rata 9.

const teratas = (email, args = '') => as(email, async () => num(await q(`select nama, ds_nama, total_order, hari_lapor, rata::float8 as rata from rekap_order_rider_teratas(today_wib() - 29, today_wib()${args})`)))

test('urut rata-rata order per hari lapor tertinggi; rider dengan hari lapor di bawah batas tidak jadi juara palsu', async () => {
  assert.deepEqual(await teratas(S), [
    { nama: 'Rider A', ds_nama: 'Galaxy', total_order: 60, hari_lapor: 6, rata: 10 },
    { nama: 'Rider W', ds_nama: 'Gowa', total_order: 45, hari_lapor: 5, rata: 9 },
    { nama: 'Rider B', ds_nama: 'Galaxy', total_order: 42, hari_lapor: 6, rata: 7 },
  ]) // Rider C (rata 50, 3 hari) tidak ikut
})

test('batas minimal hari lapor bisa diturunkan, dan jumlah baris dibatasi p_limit', async () => {
  assert.equal((await teratas(S, ', 3'))[0].nama, 'Rider C') // rata 50 sekarang memenuhi batas
  assert.deepEqual((await teratas(S, ', 5, 1')).map((r) => r.nama), ['Rider A'])
  assert.deepEqual((await teratas(S, ', 5, 0')).map((r) => r.nama), ['Rider A']) // p_limit 0 dibulatkan ke 1
})

test('hak pemanggil: Super semua DS, Arcon dan Captain hanya DS yang dipegang, akun tak dikenal kosong, anon ditolak', async () => {
  assert.deepEqual((await teratas(AA)).map((r) => r.nama), ['Rider A', 'Rider B']) // Arcon A memegang Galaxy
  assert.deepEqual((await teratas(CG)).map((r) => r.nama), ['Rider A', 'Rider B'])
  assert.deepEqual((await teratas(CW)).map((r) => r.nama), ['Rider W'])
  assert.deepEqual(await teratas(RG), [])
  await assert.rejects(as(null, () => q('select * from rekap_order_rider_teratas(today_wib() - 29, today_wib())')), /permission denied/)
})

test('rentang lebih dari 92 hari dan rentang terbalik kosong; laporan di luar rentang tidak dihitung', async () => {
  assert.deepEqual(await as(S, () => q('select * from rekap_order_rider_teratas(today_wib() - 200, today_wib())')), [])
  assert.deepEqual(await as(S, () => q('select * from rekap_order_rider_teratas(today_wib(), today_wib() - 5)')), [])
  // hanya 3 hari terakhir: Rider A (3 hari x 10) tidak memenuhi batas bawaan 5 hari
  assert.deepEqual(await as(S, () => q('select nama from rekap_order_rider_teratas(today_wib() - 2, today_wib())')), [])
})
