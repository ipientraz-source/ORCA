// Uji shift_dikerjakan (migrasi 0046): satu definisi siapa bekerja di shift apa, dipakai Fulfillment dan laporan per rider. PGlite.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const GALAXY = id(101)
const [P, P2, S, S2, EXTRA, REKAN] = [id(21), id(22), id(23), id(24), id(25), id(26)]
const q = async (sql, p) => (await db.query(sql, p)).rows
const tgl = (n) => `today_wib() - ${n}`

const sebagaiSuper = async (fn) => {
  await db.exec(`reset role; select set_config('request.jwt.claims', '{"email":"super@test.local"}', false); set role authenticated`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
}
const jadwal = (n, rider, shift) => db.exec(`insert into jadwal (tanggal, rider_id, shift, ds_id) values (${tgl(n)}, '${rider}', '${shift}', '${GALAXY}')`)
// isian ditulis langsung (bukan lewat catat_actual) supaya bentuk data lama dan kombinasi bebas bisa diuji
const isi = (n, rider, status, backup = null) =>
  db.exec(`insert into actual_harian (tanggal, rider_id, ds_id, status, backup_untuk_id) values (${tgl(n)}, '${rider}', '${GALAXY}', '${status}', ${backup ? `'${backup}'` : 'null'})`)
const kerja = async (n) =>
  (await q(`select r.nama, w.shift::text s, w.sumber from shift_dikerjakan(${tgl(n)}, ${tgl(n)}) w join riders r on r.id = w.rider_id order by r.nama, w.shift, w.sumber`))
    .map((x) => `${x.nama}:${x.s ?? 'lain'}:${x.sumber}`)
const ful = async (n) => (await sebagaiSuper(() => q(`select * from laporan_fulfillment(${tgl(n)}, ${tgl(n)})`))).find((x) => x.ds_nama === 'Galaxy')
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
    insert into ds (id, nama, kuota_pagi, kuota_siang) values ('${GALAXY}', 'Galaxy', 1, 1);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${id(1)}', null, 'Super', null, 'super_admin', 'super@test.local', 'aktif'),
      ('${P}', 'M1', 'Pagi Satu', '${GALAXY}', 'rider', null, 'aktif'), ('${P2}', 'M2', 'Pagi Dua', '${GALAXY}', 'rider', null, 'aktif'),
      ('${S}', 'M3', 'Siang Satu', '${GALAXY}', 'rider', null, 'aktif'), ('${S2}', 'M4', 'Siang Dua', '${GALAXY}', 'rider', null, 'aktif'),
      ('${EXTRA}', 'M5', 'Tanpa Jadwal', '${GALAXY}', 'rider', null, 'aktif'), ('${REKAN}', 'M6', 'Rekan Libur', '${GALAXY}', 'rider', null, 'aktif');`)
})
after(() => db.close())

test('hadir mengerjakan shift terjadwalnya; alpha, izin, sakit tidak bekerja', async () => {
  await jadwal(1, P, 'pagi'); await jadwal(1, P2, 'pagi'); await jadwal(1, S, 'siang'); await jadwal(1, S2, 'siang')
  await isi(1, P, 'hadir'); await isi(1, P2, 'alpha'); await isi(1, S, 'izin'); await isi(1, S2, 'sakit')
  assert.deepEqual(await kerja(1), ['Pagi Satu:pagi:jadwal'])
})

test('pengganti mengerjakan shift rider yang digantikan; tanpa yang digantikan masuk "lain"', async () => {
  await jadwal(2, P, 'pagi')
  await isi(2, P, 'alpha'); await isi(2, EXTRA, 'pengganti', P)
  await isi(2, REKAN, 'pengganti') // mandiri, tidak menggantikan siapa pun
  assert.deepEqual(await kerja(2), ['Rekan Libur:lain:pengganti', 'Tanpa Jadwal:pagi:pengganti'])
})

test('long shift: dua baris untuk satu rider, shift_kerja di laporan per rider = 2', async () => {
  await jadwal(3, P, 'pagi'); await jadwal(3, S, 'siang')
  await isi(3, P, 'hadir'); await isi(3, S, 'alpha'); await isi(3, P, 'pengganti', S)
  assert.deepEqual(await kerja(3), ['Pagi Satu:pagi:jadwal', 'Pagi Satu:siang:pengganti'])
  assert.equal((await rider(3, P)).shift_kerja, 2)
  assert.equal((await rider(3, S)).shift_kerja, 0)
})

test('tukar dua arah: masing-masing mengerjakan shift rekannya', async () => {
  await jadwal(4, P, 'pagi'); await jadwal(4, S, 'siang')
  await isi(4, P, 'tukar', S); await isi(4, S, 'tukar', P)
  assert.deepEqual(await kerja(4), ['Pagi Satu:siang:tukar', 'Siang Satu:pagi:tukar'])
})

test('tukar dengan rekan yang tidak terjadwal atau libur: yang bertukar tidak bekerja', async () => {
  await jadwal(5, P, 'pagi'); await jadwal(5, REKAN, 'off')
  await isi(5, P, 'tukar', REKAN)
  assert.deepEqual(await kerja(5), [])
  await jadwal(6, P, 'pagi')
  await isi(6, P, 'tukar', EXTRA); await isi(6, EXTRA, 'pengganti', P)
  assert.deepEqual(await kerja(6), ['Tanpa Jadwal:pagi:pengganti']) // dulu P ikut terhitung "lain"
})

test('data tukar lama tanpa rekan: shift sendiri, pengganti di shift yang sama (angka lama tidak berubah)', async () => {
  await jadwal(7, P, 'pagi'); await jadwal(7, S, 'siang')
  await isi(7, P, 'tukar'); await isi(7, S, 'pengganti', P)
  assert.deepEqual(await kerja(7), ['Pagi Satu:pagi:tukar', 'Siang Satu:pagi:pengganti'])
})

test('hadir tanpa jadwal (atau libur) masuk "lain"', async () => {
  await jadwal(8, REKAN, 'off')
  await isi(8, EXTRA, 'hadir'); await isi(8, REKAN, 'hadir')
  assert.deepEqual(await kerja(8), ['Rekan Libur:lain:jadwal', 'Tanpa Jadwal:lain:jadwal'])
})

test('Fulfillment membaca dari shift_dikerjakan: kasus tukar libur Gatsu (pagi Asep, siang Diego, yang tukar libur tidak dihitung)', async () => {
  // Aqsa=P (pagi) tukar libur dengan Diego=EXTRA (libur); Asep=S (siang) menutup pagi Aqsa; Diego menutup siang Asep
  await jadwal(9, P, 'pagi'); await jadwal(9, S, 'siang')
  await isi(9, P, 'tukar', EXTRA); await isi(9, S, 'pengganti', P); await isi(9, EXTRA, 'pengganti', S)
  assert.deepEqual(await kerja(9), ['Siang Satu:pagi:pengganti', 'Tanpa Jadwal:siang:pengganti'])
  const f = await ful(9)
  assert.deepEqual([f.kebutuhan_pagi, f.kebutuhan_siang, f.terpenuhi_pagi, f.terpenuhi_siang, f.terpenuhi_lain], [1, 1, 1, 1, 0])
  assert.deepEqual([(await rider(9, P)).shift_kerja, (await rider(9, S)).shift_kerja, (await rider(9, EXTRA)).shift_kerja], [0, 1, 1])
})

test('shift_kerja tidak menggandakan kolom lain di laporan per rider', async () => {
  const r = await rider(3, P) // long shift: dijadwalkan 1, hadir 1, pengganti 1
  assert.deepEqual([r.dijadwalkan, r.hadir, r.pengganti, r.belum_diisi, r.shift_kerja], [1, 1, 1, 0, 2])
})
