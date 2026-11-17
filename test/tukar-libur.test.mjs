// Uji status tukar_libur (migrasi 0047-0048): tanpa potongan, pengganti bebas, dan kasus berantai Gatsu. PGlite.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const G = id(101)
const [AQSA, ASEP, DIEGO] = [id(21), id(22), id(23)]
const q = async (sql, p) => (await db.query(sql, p)).rows
const tgl = (n) => `today_wib() - ${n}`

const sebagaiSuper = async (fn) => {
  await db.exec(`reset role; select set_config('request.jwt.claims', '{"email":"super@test.local"}', false); set role authenticated`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
}
const catat = (n, rider, status, backup = null, pot = null, tanpa = false) =>
  sebagaiSuper(() => q(`select catat_actual(${tgl(n)}, $1, $2, $3, null, $4, 0, $5)`, [rider, status, backup, pot, tanpa]))
const konf = (n, rider, ya = true) => sebagaiSuper(() => q(`select konfirmasi_tukar(${tgl(n)}, $1, $2)`, [rider, ya]))
const hapus = (n, rider) => sebagaiSuper(() => q(`select hapus_actual(${tgl(n)}, $1)`, [rider]))
const jadwal = (n) => db.exec(`insert into jadwal (tanggal, rider_id, shift, ds_id) values (${tgl(n)}, '${AQSA}', 'pagi', '${G}'), (${tgl(n)}, '${ASEP}', 'siang', '${G}')`)
const isian = async (n) =>
  (await q(`select r.nama, a.status::text s, (select nama from riders where id = a.backup_untuk_id) untuk, a.potongan from actual_harian a join riders r on r.id = a.rider_id where a.tanggal = ${tgl(n)} order by r.nama, a.status`))
    .map((x) => `${x.nama}:${x.s}${x.untuk ? '>' + x.untuk : ''}${x.potongan === null ? '' : x.potongan ? ':pot' : ':nopot'}`)
const kerja = async (n) =>
  (await q(`select r.nama, w.shift::text s from shift_dikerjakan(${tgl(n)}, ${tgl(n)}) w join riders r on r.id = w.rider_id order by r.nama, w.shift`)).map((x) => `${x.nama}:${x.s}`)
const ful = async (n) => (await sebagaiSuper(() => q(`select * from laporan_fulfillment(${tgl(n)}, ${tgl(n)})`))).find((x) => x.ds_nama === 'Gatsu')
const rider = async (n, rid) => (await sebagaiSuper(() => q(`select * from laporan_rider(${tgl(n)}, ${tgl(n)})`))).find((x) => x.rider_id === rid)

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
    insert into ds (id, nama, kuota_pagi, kuota_siang) values ('${G}', 'Gatsu', 1, 1);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${id(1)}', null, 'Super', null, 'super_admin', 'super@test.local', 'aktif'),
      ('${AQSA}', 'M1', 'Aqsa', '${G}', 'rider', null, 'aktif'), ('${ASEP}', 'M2', 'Asep', '${G}', 'rider', null, 'aktif'),
      ('${DIEGO}', 'M3', 'Diego', '${G}', 'rider', null, 'aktif');`)
})
after(() => db.close())

test('kasus Gatsu berantai: Aqsa tukar libur, Asep menutup pagi, siang Asep ditukar ke Diego', async () => {
  await jadwal(1)
  await catat(1, AQSA, 'tukar_libur', ASEP)
  await catat(1, ASEP, 'tukar', DIEGO) // dulu ditolak: Asep sedang menutup shift rider lain
  assert.deepEqual(await isian(1), ['Aqsa:tukar_libur', 'Asep:tukar>Diego', 'Asep:pengganti>Aqsa', 'Diego:pengganti>Asep'])
  assert.deepEqual(await kerja(1), ['Asep:pagi', 'Diego:siang'])
  const f = await ful(1)
  assert.deepEqual([f.terpenuhi_pagi, f.terpenuhi_siang, f.terpenuhi_lain], [1, 1, 0])
  const a = await rider(1, AQSA), s = await rider(1, ASEP)
  assert.deepEqual([a.tukar, a.potongan, a.belum_diisi, a.shift_kerja], [1, 0, 0, 0])
  assert.deepEqual([s.tukar, s.pengganti, s.belum_diisi, s.shift_kerja], [1, 1, 0, 1])
})

test('urutan dibalik menghasilkan catatan yang sama', async () => {
  await jadwal(2)
  await catat(2, ASEP, 'tukar', DIEGO)
  await catat(2, AQSA, 'tukar_libur', ASEP)
  assert.deepEqual(await isian(2), ['Aqsa:tukar_libur', 'Asep:tukar>Diego', 'Asep:pengganti>Aqsa', 'Diego:pengganti>Asep'])
  assert.deepEqual(await kerja(2), ['Asep:pagi', 'Diego:siang'])
})

test('tukar libur tidak pernah kena potongan, walau potongan dikirim; tanpa pengganti diperbolehkan', async () => {
  await jadwal(3)
  await catat(3, AQSA, 'tukar_libur', null, true, true)
  assert.deepEqual(await isian(3), ['Aqsa:tukar_libur'])
  assert.equal((await rider(3, AQSA)).potongan, 0)
  assert.deepEqual(await kerja(3), [])
})

test('tukar libur wajib memilih pengganti atau "Tidak dapat pengganti"', async () => {
  await jadwal(4)
  await assert.rejects(catat(4, AQSA, 'tukar_libur'), /Pilih rider pengganti/)
})

test('membatalkan tukar libur ikut menghapus isian pengganti yang menunjuknya', async () => {
  await jadwal(5)
  await catat(5, AQSA, 'tukar_libur', ASEP)
  await hapus(5, AQSA)
  assert.deepEqual(await isian(5), [])
})

test('rekan tukar yang sedang menutup rider lain tetap ditolak (isian pengganti tidak boleh tertimpa)', async () => {
  await jadwal(6)
  await catat(6, AQSA, 'tukar_libur', DIEGO) // Diego menutup pagi Aqsa
  await assert.rejects(catat(6, ASEP, 'tukar', DIEGO), /Rekan tukar sedang menutup shift rider lain/)
})

test('tukar shift batal: yang pagi tidak masuk di siangnya, rekan menutup pagi lalu lanjut siang (migrasi 0049)', async () => {
  await jadwal(7) // Aqsa pagi, Asep siang
  await catat(7, AQSA, 'tukar', ASEP) // Aqsa seharusnya kerja siang, Asep pagi
  assert.deepEqual(await kerja(7), []) // belum dikonfirmasi: belum dihitung bekerja
  await konf(7, AQSA); await konf(7, ASEP)
  assert.deepEqual(await kerja(7), ['Aqsa:siang', 'Asep:pagi'])
  await catat(7, AQSA, 'alpha', ASEP, true) // dulu ditolak "shift yang sama"
  await catat(7, ASEP, 'hadir')
  assert.deepEqual(await isian(7), ['Aqsa:alpha:pot', 'Asep:hadir', 'Asep:pengganti>Aqsa'])
  assert.deepEqual(await kerja(7), ['Asep:pagi', 'Asep:siang'])
  const f = await ful(7)
  assert.deepEqual([f.terpenuhi_pagi, f.terpenuhi_siang], [1, 1])
  assert.deepEqual([(await rider(7, AQSA)).potongan, (await rider(7, AQSA)).alpha], [1, 1])
  assert.equal((await rider(7, ASEP)).shift_kerja, 2)
})
