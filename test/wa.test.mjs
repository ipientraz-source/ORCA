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

// ───────── pesan gabungan (migrasi 0060): DS dengan ID grup yang sama dijadikan satu pesan ringkas ─────────
const KEMBAR = id(103), SENDIRI = id(104), [K1, K2, X1, K3] = [id(26), id(27), id(28), id(29)]
const gabung = (sesi, n, ds = null) => q(`select * from laporan_wa_gabung($1, ${tgl(n)}, 'https://orca.test', $2) order by ds_namas[1]`, [sesi, ds])

test('gabungan: DS satu grup jadi satu pesan ringkas dengan penanda status, urut dari yang bermasalah, dan tautan rekap hari itu; DS dengan grup sendiri tetap rinci', async () => {
  await db.exec(`
    insert into ds (id, nama, kuota_pagi, kuota_siang, group_wa_id) values ('${KEMBAR}', 'Kembar', 2, 0, '120363000@g.us'), ('${SENDIRI}', 'Sendiri', 1, 0, '120363999@g.us');
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${K1}', 'M6', 'Kembar Satu', '${KEMBAR}', 'rider', null, 'aktif'), ('${K2}', 'M7', 'Kembar Dua', '${KEMBAR}', 'rider', null, 'aktif'),
      ('${X1}', 'M8', 'Sendiri Satu', '${SENDIRI}', 'rider', null, 'aktif')`)
  await jadwal(7, P, 'pagi'); await jadwal(7, P2, 'pagi'); await jadwal(7, K1, 'pagi', KEMBAR); await jadwal(7, K2, 'pagi', KEMBAR); await jadwal(7, X1, 'pagi', SENDIRI)
  await catat(7, P, 'hadir'); await catat(7, K1, 'hadir'); await catat(7, X1, 'hadir') // P2 dan K2 belum diabsen
  const tanggal = (await q(`select (${tgl(7)})::text as t`))[0].t
  const r = await gabung('laporan_pagi', 7)
  const grup = r.find((x) => x.group_wa_id === '120363000@g.us')
  assert.deepEqual(grup.ds_namas, ['Galaxy', 'Kembar'])
  assert.ok(grup.pesan.startsWith('📋 *LAPORAN ABSENSI · SHIFT PAGI*\n'))
  assert.ok(grup.pesan.includes('*Ringkasan:* 2 dari 4 (50%) · 2 DS\n2 rider belum diabsen')) // total semua DS di grup, dan berapa yang belum diisi captain
  assert.ok(grup.pesan.includes('⚠️ *Galaxy*\n    1 dari 2 (50%)\n    1 belum diabsen')) // DS yang captain-nya belum mengisi tampak jelas
  assert.ok(grup.pesan.includes('⚠️ *Kembar*\n    1 dari 2 (50%)\n    1 belum diabsen'))
  assert.ok(grup.pesan.endsWith(`🔗 Detail per rider:\nhttps://orca.test/?tab=rekap&tgl=${tanggal}`))
  assert.doesNotMatch(grup.pesan, /Hadir:/) // ringkas, tanpa rincian per DS
  const sendiri = r.find((x) => x.group_wa_id === '120363999@g.us')
  assert.deepEqual(sendiri.ds_namas, ['Sendiri'])
  assert.match(sendiri.pesan, /Terpenuhi: 1 dari 1 rider/) // DS sendirian di grupnya: pesan rinci
  assert.ok(sendiri.pesan.includes(`https://orca.test/?tab=rekap&tgl=${tanggal}`))
})

test('gabungan: pengingat satu pesan memuat jumlah rider belum diabsen per DS dan tautan halaman absensi', async () => {
  const p = (await gabung('ingat_pagi', 7)).find((x) => x.group_wa_id === '120363000@g.us')
  assert.ok(p.pesan.startsWith('⏰ *PENGINGAT ABSENSI · SHIFT PAGI*\n'))
  assert.ok(p.pesan.includes('*Belum diabsen:* 2 rider di 2 DS'))
  assert.ok(p.pesan.includes('⚠️ *Galaxy*\n    1 rider belum diabsen\n\n⚠️ *Kembar*\n    1 rider belum diabsen'))
  assert.ok(p.pesan.endsWith('🔗 Isi absensi:\nhttps://orca.test/?tab=absensi'))
  assert.equal((await gabung('ingat_pagi', 7)).find((x) => x.group_wa_id === '120363999@g.us'), undefined) // Sendiri semuanya sudah diabsen
})

test('gabungan: laporan siang (shift terakhir) menampilkan proses fulfillment seharian, pagi dan siang, per DS dan total', async () => {
  await db.exec(`
    update ds set kuota_siang = 1 where id in ('${GALAXY}', '${KEMBAR}');
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values ('${K3}', 'M9', 'Kembar Tiga', '${KEMBAR}', 'rider', null, 'aktif')`)
  await jadwal(7, S, 'siang'); await jadwal(7, K3, 'siang', KEMBAR)
  await catat(7, S, 'hadir'); await catat(7, K3, 'hadir')
  const s = (await gabung('laporan_siang', 7)).find((x) => x.group_wa_id === '120363000@g.us')
  assert.ok(s.pesan.startsWith('📋 *LAPORAN ABSENSI · SHIFT SIANG*\n'))
  assert.ok(s.pesan.includes('*Fulfillment hari ini:* 4 dari 6 (67%) · 2 DS\nPagi 2/4 · Siang 2/2')) // pagi 1+1 dari 2+2, siang 1+1 dari 1+1
  assert.ok(s.pesan.includes('⚠️ *Galaxy*\n    2 dari 3 (67%)\n    Pagi 1/2 · Siang 1/1'))
  assert.ok(s.pesan.includes('⚠️ *Kembar*\n    2 dari 3 (67%)\n    Pagi 1/2 · Siang 1/1'))
  const pagi = (await gabung('laporan_pagi', 7)).find((x) => x.group_wa_id === '120363000@g.us')
  assert.doesNotMatch(pagi.pesan, /Fulfillment hari ini/) // laporan pagi hanya menilai shift pagi
})

test('gabungan: dibatasi ke satu DS (tombol kirim manual) memakai pesan rinci DS itu saja', async () => {
  const r = await gabung('laporan_pagi', 7, GALAXY)
  assert.equal(r.length, 1)
  assert.deepEqual(r[0].ds_namas, ['Galaxy'])
  assert.match(r[0].pesan, /Terpenuhi: 1 dari 2 rider/)
  assert.doesNotMatch(r[0].pesan, /Kembar/)
})

test('gabungan: tidak bisa dipanggil lewat API, dan DS tanpa grup dikembalikan tanpa pesan yang akan dikirim', async () => {
  await db.exec(`reset role; set role authenticated`)
  await assert.rejects(q(`select * from laporan_wa_gabung('laporan_pagi')`), /permission denied/)
  await db.exec(`reset role; set role anon`)
  await assert.rejects(q(`select * from laporan_wa_gabung('laporan_pagi')`), /permission denied/)
  await db.exec('reset role')
  await db.exec(`update ds set group_wa_id = null where id = '${SENDIRI}'`)
  const r = (await gabung('laporan_pagi', 7)).find((x) => x.ds_namas[0] === 'Sendiri')
  assert.equal(r.group_wa_id, null) // fungsi kirim-laporan melewatinya
})
