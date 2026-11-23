// Uji pesan WhatsApp otomatis (migrasi 0059): laporan_wa menyusun teks laporan dan pengingat per DS. Database PGlite, tanpa Fonnte.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const GALAXY = id(101), ALSUT = id(102)
const [P, P2, S, S2, EXTRA] = [id(21), id(22), id(23), id(24), id(25)]
const q = async (sql, p) => (await db.query(sql, p)).rows
const tgl = (n) => `today_wib() - ${n}`

const sebagaiSuper = async (fn) => {
  await db.exec(`reset role; select set_config('request.jwt.claims', '{"email":"super@test.local"}', false); set role authenticated`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
}
const catat = (n, rider, status, backup = null, potongan = null) =>
  sebagaiSuper(() => q(`select catat_actual(${tgl(n)}, $1, $2, $3, null, $4, 0, ${status === 'alpha' && !backup ? 'true' : 'false'})`, [rider, status, backup, potongan]))
const konf = (n, rider) => sebagaiSuper(() => q(`select konfirmasi_tukar(${tgl(n)}, $1, true)`, [rider]))
const jadwal = (n, rider, shift, ds = GALAXY) => db.exec(`insert into jadwal (tanggal, rider_id, shift, ds_id) values (${tgl(n)}, '${rider}', '${shift}', '${ds}')`)
// pesan untuk satu DS pada hari ke-n (service role = pemanggil tanpa JWT, jadi dipanggil sebagai superuser database)
const pesan = async (sesi, n, ds = 'Galaxy') => (await q(`select * from laporan_wa($1, ${tgl(n)}) where ds_nama = $2`, [sesi, ds]))[0]

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
    insert into ds (id, nama, kuota_pagi, kuota_siang, group_wa_id) values ('${GALAXY}', 'Galaxy', 2, 1, '120363000@g.us'), ('${ALSUT}', 'Alam Sutera', 1, 1, null);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${id(1)}', null, 'Super', null, 'super_admin', 'super@test.local', 'aktif'),
      ('${P}', 'M1', 'Pagi Satu', '${GALAXY}', 'rider', null, 'aktif'), ('${P2}', 'M2', 'Pagi Dua', '${GALAXY}', 'rider', null, 'aktif'),
      ('${S}', 'M3', 'Siang Satu', '${GALAXY}', 'rider', null, 'aktif'), ('${S2}', 'M4', 'Siang Dua', '${GALAXY}', 'rider', null, 'aktif'),
      ('${EXTRA}', 'M5', 'Tanpa Jadwal', '${GALAXY}', 'rider', null, 'aktif');`)
})
after(() => db.close())

test('sesi yang tidak dikenal ditolak, dan fungsi tidak bisa dipanggil lewat API (anon dan authenticated)', async () => {
  await assert.rejects(q(`select * from laporan_wa('kirim_semua')`), /Sesi tidak dikenal/)
  await db.exec(`reset role; set role authenticated`)
  await assert.rejects(q(`select * from laporan_wa('laporan_pagi')`), /permission denied/)
  await db.exec(`reset role; set role anon`)
  await assert.rejects(q(`select * from laporan_wa('laporan_pagi')`), /permission denied/)
  await db.exec('reset role')
})

test('pengingat: hanya muncul bila ada rider terjadwal di shift itu yang belum diabsen, dan menyebut namanya', async () => {
  await jadwal(1, P, 'pagi'); await jadwal(1, P2, 'pagi'); await jadwal(1, S, 'siang')
  await catat(1, P, 'hadir')
  const a = await pesan('ingat_pagi', 1)
  assert.match(a.pesan, /Pengingat Absensi Shift Pagi/)
  assert.match(a.pesan, /Masih ada 1 rider/)
  assert.match(a.pesan, /- Pagi Dua/)
  assert.doesNotMatch(a.pesan, /Pagi Satu/)
  assert.equal(a.group_wa_id, '120363000@g.us')
  assert.match((await pesan('ingat_siang', 1)).pesan, /- Siang Satu/) // siang belum diabsen sama sekali
  await catat(1, P2, 'hadir'); await catat(1, S, 'hadir')
  assert.equal(await pesan('ingat_pagi', 1), undefined) // semua sudah: tidak ada pesan
  assert.equal(await pesan('ingat_siang', 1), undefined)
})

test('laporan: terpenuhi vs kebutuhan, hadir, tidak hadir beserta penggantinya, dan rekap hari di sesi siang', async () => {
  await jadwal(2, P, 'pagi'); await jadwal(2, P2, 'pagi'); await jadwal(2, S, 'siang')
  await catat(2, P, 'hadir')
  await catat(2, P2, 'alpha', EXTRA, true) // P2 alpha, EXTRA (tanpa jadwal) menggantikan
  await catat(2, S, 'hadir')
  const pg = (await pesan('laporan_pagi', 2)).pesan
  assert.match(pg, /Laporan Absensi Shift Pagi/)
  assert.match(pg, /Terpenuhi: 2 dari 2 rider \(100%\)/)
  assert.match(pg, /Hadir: 1 · Pengganti: 1/)
  assert.match(pg, /Tidak hadir: 1\n- Pagi Dua \(alpha\), diganti Tanpa Jadwal/)
  assert.match(pg, /Belum diabsen: 0/)
  const sg = (await pesan('laporan_siang', 2)).pesan
  assert.match(sg, /Terpenuhi: 1 dari 1 rider \(100%\)/)
  assert.match(sg, /Rekap hari ini\*\nPagi: 2\/2 · Siang: 1\/1/)
})

test('laporan menyebut yang belum diabsen, dan tidak hadir tanpa pengganti', async () => {
  await jadwal(3, P, 'pagi'); await jadwal(3, P2, 'pagi')
  await catat(3, P, 'alpha', null, true) // tanpa pengganti
  const pg = (await pesan('laporan_pagi', 3)).pesan
  assert.match(pg, /Terpenuhi: 0 dari 2 rider \(0%\)/)
  assert.match(pg, /- Pagi Satu \(alpha\), tanpa pengganti/)
  assert.match(pg, /Belum diabsen: 1\n- Pagi Dua/)
})

test('tukar dua arah: belum dikonfirmasi dihitung belum diabsen di shift yang dikerjakan, sesudah konfirmasi dihitung hadir', async () => {
  await jadwal(4, P, 'pagi'); await jadwal(4, S, 'siang')
  await catat(4, P, 'tukar', S) // P kerja siang, S kerja pagi
  assert.match((await pesan('ingat_siang', 4)).pesan, /- Pagi Satu/) // P mengerjakan siang
  assert.match((await pesan('ingat_pagi', 4)).pesan, /- Siang Satu/) // S mengerjakan pagi
  await konf(4, P); await konf(4, S)
  assert.equal(await pesan('ingat_pagi', 4), undefined)
  assert.equal(await pesan('ingat_siang', 4), undefined)
  assert.match((await pesan('laporan_pagi', 4)).pesan, /Hadir: 1 · Pengganti: 0/)
})

test('tukar separuh (0052): P tidak hadir di siang dan diganti EXTRA, S tetap hadir di pagi, EXTRA terhitung menutup siang', async () => {
  await jadwal(5, P, 'pagi'); await jadwal(5, S, 'siang')
  await catat(5, P, 'tukar', S); await konf(5, S)
  await catat(5, P, 'sakit', EXTRA, false)
  const sg = (await pesan('laporan_siang', 5)).pesan
  assert.match(sg, /Terpenuhi: 1 dari 1 rider/) // EXTRA menutup siang
  assert.match(sg, /Tidak hadir: 1\n- Pagi Satu \(sakit\), diganti Tanpa Jadwal/) // P tampil di siang, shift yang ditinggalkannya
  assert.match((await pesan('laporan_pagi', 5)).pesan, /Hadir: 1/) // S hadir di pagi
})

test('DS tanpa kebutuhan dan tanpa rider tidak dilaporkan, DS tanpa grup tetap dikembalikan dengan group_wa_id kosong', async () => {
  assert.notEqual(await pesan('laporan_pagi', 6, 'Alam Sutera'), undefined) // kuota 1: dilaporkan walau belum ada yang masuk
  assert.equal((await pesan('laporan_pagi', 6, 'Alam Sutera')).group_wa_id, null)
  await db.exec(`update ds set kuota_pagi = 0, kuota_siang = 0 where id = '${ALSUT}'`)
  assert.equal(await pesan('laporan_pagi', 6, 'Alam Sutera'), undefined)
})
