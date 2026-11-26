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

test('DS yang hari itu belum ada jadwalnya tidak dilaporkan; DS tanpa grup tetap dikembalikan dengan group_wa_id kosong', async () => {
  assert.equal(await pesan('laporan_pagi', 6, 'Alam Sutera'), undefined) // kuota 1 tetapi belum ada jadwal: tidak dilaporkan dulu
  assert.equal(await pesan('ingat_pagi', 6, 'Alam Sutera'), undefined)
  const alsut1 = id(30)
  await db.exec(`insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values ('${alsut1}', 'M0', 'Alsut Satu', '${ALSUT}', 'rider', null, 'aktif')`)
  await jadwal(6, alsut1, 'pagi', ALSUT)
  assert.notEqual(await pesan('laporan_pagi', 6, 'Alam Sutera'), undefined) // ada jadwal: dilaporkan walau belum ada yang masuk
  assert.equal((await pesan('laporan_pagi', 6, 'Alam Sutera')).group_wa_id, null)
  await db.exec(`update ds set kuota_pagi = 0, kuota_siang = 0 where id = '${ALSUT}'; delete from jadwal where rider_id = '${alsut1}'`)
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

test('gabungan: laporan seharian menampilkan proses fulfillment pagi, Middle, dan siang, per DS dan total', async () => {
  await db.exec(`
    update ds set kuota_siang = 1 where id in ('${GALAXY}', '${KEMBAR}');
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values ('${K3}', 'M9', 'Kembar Tiga', '${KEMBAR}', 'rider', null, 'aktif')`)
  await jadwal(7, S, 'siang'); await jadwal(7, K3, 'siang', KEMBAR)
  await catat(7, S, 'hadir'); await catat(7, K3, 'hadir')
  const h = (await gabung('laporan_hari', 7)).find((x) => x.group_wa_id === '120363000@g.us')
  assert.ok(h.pesan.startsWith('📋 *FULFILLMENT SEHARIAN*\n'))
  assert.ok(h.pesan.includes('*Fulfillment hari ini:* 4 dari 6 (67%) · 2 DS\nPagi 2/4 · Siang 2/2')) // pagi 1+1 dari 2+2, siang 1+1 dari 1+1
  assert.ok(h.pesan.includes('⚠️ *Galaxy*\n    2 dari 3 (67%)\n    Pagi 1/2 · Siang 1/1'))
  assert.ok(h.pesan.includes('⚠️ *Kembar*\n    2 dari 3 (67%)\n    Pagi 1/2 · Siang 1/1'))
  // laporan shift hanya menilai shift itu
  const pagi = (await gabung('laporan_pagi', 7)).find((x) => x.group_wa_id === '120363000@g.us')
  assert.doesNotMatch(pagi.pesan, /Fulfillment hari ini/)
  const siang = (await gabung('laporan_siang', 7)).find((x) => x.group_wa_id === '120363000@g.us')
  assert.ok(siang.pesan.includes('*Ringkasan:* 2 dari 2 (100%) · 2 DS'))
  assert.doesNotMatch(siang.pesan, /Fulfillment hari ini/)
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

test('shift Middle: laporan dan pengingat tersendiri, ikut dihitung di fulfillment seharian, dan hanya tampil untuk DS yang memakainya', async () => {
  await db.exec(`update ds set kuota_tengah = 1 where id in ('${GALAXY}', '${KEMBAR}')`)
  await db.exec(`update ds set group_wa_id = '120363999@g.us' where id = '${SENDIRI}'`)
  await jadwal(8, P, 'tengah'); await jadwal(8, K1, 'tengah', KEMBAR)
  await catat(8, P, 'hadir') // K1 belum diabsen
  const t = (await gabung('laporan_tengah', 8)).find((x) => x.group_wa_id === '120363000@g.us')
  assert.ok(t.pesan.startsWith('📋 *LAPORAN ABSENSI · SHIFT MIDDLE*\n'))
  assert.ok(t.pesan.includes('*Ringkasan:* 1 dari 2 (50%) · 2 DS\n1 rider belum diabsen'))
  assert.ok(t.pesan.includes('⚠️ *Kembar*\n    0 dari 1 (0%)\n    1 belum diabsen'))
  assert.ok(t.pesan.includes('✅ *Galaxy*\n    1 dari 1 (100%)'))
  assert.ok(t.pesan.indexOf('*Kembar*') < t.pesan.indexOf('*Galaxy*')) // yang bermasalah di atas
  // DS tanpa Middle (Sendiri) tidak ikut dilaporkan di sesi Middle
  assert.equal((await gabung('laporan_tengah', 8)).find((x) => x.group_wa_id === '120363999@g.us'), undefined)
  // pengingat Middle: hanya DS yang masih ada rider Middle belum diabsen (satu DS = pesan rinci)
  const i = (await gabung('ingat_tengah', 8)).find((x) => x.group_wa_id === '120363000@g.us')
  assert.deepEqual(i.ds_namas, ['Kembar'])
  assert.match(i.pesan, /Pengingat Absensi Shift Middle/)
  assert.match(i.pesan, /- Kembar Satu/)
  // laporan siang: fulfillment seharian memuat Middle di tiap DS dan di total
  const s = (await gabung('laporan_hari', 8)).find((x) => x.group_wa_id === '120363000@g.us')
  assert.ok(s.pesan.includes('Pagi 0/2 · Middle 1/1 · Siang 0/1'))
  assert.ok(s.pesan.includes('*Fulfillment hari ini:* 1 dari 8 (13%) · 2 DS\nPagi 0/4 · Middle 1/2 · Siang 0/2'))
  // DS tanpa Middle: tampilan tidak berubah (tanpa kata Middle)
  assert.doesNotMatch((await gabung('laporan_siang', 7)).find((x) => x.group_wa_id === '120363000@g.us' && x.ds_namas.length === 1)?.pesan ?? '', /Middle:/)
})

test('semua DS satu pesan: p_grup_semua menggabungkan semua DS yang punya jadwal ke satu grup, mengabaikan ID grup per DS dan melewati DS tanpa jadwal', async () => {
  const r = await q(`select * from laporan_wa_gabung('laporan_pagi', ${tgl(7)}, 'https://orca.test', null, '120363777@g.us')`)
  assert.equal(r.length, 1)
  assert.equal(r[0].group_wa_id, '120363777@g.us')
  assert.deepEqual(r[0].ds_namas, ['Galaxy', 'Kembar', 'Sendiri']) // Alam Sutera tidak punya jadwal hari itu, jadi tidak ikut
  assert.match(r[0].pesan, /· 3 DS/)
  assert.doesNotMatch(r[0].pesan, /Alam Sutera/)
  // tanpa p_grup_semua, perilaku per grup DS tetap
  assert.ok((await gabung('laporan_pagi', 7)).length >= 2)
})

test('pengaturan WhatsApp: hanya Super-admin yang bisa membaca dan mengubah, dan batasan pesan terjadwal dijaga database', async () => {
  const CAP = id(40)
  await db.exec(`insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values ('${CAP}', null, 'Cap', '${GALAXY}', 'captain', 'cap@test.local', 'aktif')`)
  const sebagai = async (email, fn) => {
    await db.exec(`reset role; select set_config('request.jwt.claims', '{"email":"${email}"}', false); set role authenticated`)
    try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
  }
  // saklar utama: bawaan hidup
  assert.deepEqual(await sebagaiSuper(() => q(`select aktif from pengaturan_wa where id = 1`)), [{ aktif: true }])
  assert.equal((await sebagaiSuper(() => q(`update pengaturan_wa set aktif = false where id = 1 returning aktif`))).length, 1)
  await sebagaiSuper(() => q(`update pengaturan_wa set aktif = true where id = 1`))
  // contoh awal: enam pesan, semuanya mati
  const awal = await sebagaiSuper(() => q(`select nama, jenis, shift, jam, aktif, grup from pesan_wa order by jam, nama`))
  assert.equal(awal.length, 6)
  assert.ok(awal.every((x) => x.aktif === false && x.grup.length === 0))
  assert.deepEqual(awal.map((x) => x.jam), ['07:00', '09:00', '11:00', '13:00', '14:00', '16:00'])
  // Super-admin boleh menambah dan mengubah pesan, banyak grup per pesan
  const baru = await sebagaiSuper(() => q(`insert into pesan_wa (nama, jenis, jam, grup) values ('Budget pagi', 'budget', '08:00', array['120363777@g.us', '120363888@g.us']) returning id, hari, cakupan`))
  assert.deepEqual(baru[0].hari, [1, 2, 3, 4, 5, 6, 7])
  assert.equal(baru[0].cakupan, 'semua')
  // captain tidak melihat dan tidak mengubah
  assert.deepEqual(await sebagai('cap@test.local', () => q(`select * from pesan_wa`)), [])
  assert.deepEqual(await sebagai('cap@test.local', () => q(`update pesan_wa set aktif = false returning id`)), [])
  assert.deepEqual(await sebagai('cap@test.local', () => q(`select * from pengaturan_wa`)), [])
  await assert.rejects(sebagai('cap@test.local', () => q(`insert into pesan_wa (nama, jenis, jam) values ('x', 'budget', '08:00')`)), /row-level security/i)
  // batasan data
  const coba = (sql) => sebagaiSuper(() => q(sql))
  await assert.rejects(coba(`insert into pesan_wa (nama, jenis, jam) values ('x', 'fulfillment_shift', '09:00')`), /check constraint/i) // jenis per shift wajib shift
  await assert.rejects(coba(`insert into pesan_wa (nama, jenis, shift, jam) values ('x', 'budget', 'pagi', '09:00')`), /check constraint/i) // budget tanpa shift
  await assert.rejects(coba(`insert into pesan_wa (nama, jenis, jam) values ('x', 'budget', '9:00')`), /check constraint/i) // jam harus HH:MM
  await assert.rejects(coba(`insert into pesan_wa (nama, jenis, jam) values ('x', 'budget', '24:00')`), /check constraint/i)
  await assert.rejects(coba(`insert into pesan_wa (nama, jenis, jam, hari) values ('x', 'budget', '09:00', '{}')`), /check constraint/i) // minimal satu hari
  await assert.rejects(coba(`insert into pesan_wa (nama, jenis, jam, hari) values ('x', 'budget', '09:00', '{0,8}')`), /check constraint/i)
  await assert.rejects(coba(`insert into pesan_wa (nama, jenis, jam, cakupan) values ('x', 'budget', '09:00', 'ds')`), /check constraint/i) // cakupan khusus wajib memilih
  await assert.rejects(coba(`insert into pesan_wa (nama, jenis, jam) values ('  ', 'budget', '09:00')`), /check constraint/i)
  await assert.rejects(coba(`insert into pesan_wa (nama, jenis, jam) values ('x', 'lain', '09:00')`), /check constraint/i)
  await coba(`delete from pesan_wa where id = '${baru[0].id}'`)
})
test('jadwal otomatis: pesan jatuh tempo dari jam yang diatur (WIB), dalam jendela 30 menit, di hari terpilih, bila pesan dan saklar utama hidup', async () => {
  const jatuh = async (waktuUtc) => (await q(`select p.nama, j.tanggal::text as tanggal from pesan_wa_jatuh_tempo($1::timestamptz) j join pesan_wa p on p.id = j.id order by p.nama`, [waktuUtc]))
  const ubah = (sql) => db.exec(sql)
  // Senin 23 Nov 2026 (WIB = UTC+7). Contoh awal semuanya mati, jadi belum ada yang terkirim
  assert.deepEqual(await jatuh('2026-11-23T02:00:00Z'), [])
  await ubah(`update pesan_wa set aktif = true where nama in ('Fulfillment pagi', 'Pengingat captain pagi', 'Fulfillment seharian')`)
  assert.deepEqual(await jatuh('2026-11-23T00:00:00Z'), [{ nama: 'Pengingat captain pagi', tanggal: '2026-11-23' }]) // 07.00 WIB
  assert.deepEqual(await jatuh('2026-11-23T02:00:00Z'), [{ nama: 'Fulfillment pagi', tanggal: '2026-11-23' }]) // 09.00
  assert.deepEqual(await jatuh('2026-11-23T02:29:00Z'), [{ nama: 'Fulfillment pagi', tanggal: '2026-11-23' }]) // 09.29: masih di jendela, cron yang terlambat tetap mengirim
  assert.deepEqual(await jatuh('2026-11-23T02:30:00Z'), []) // 09.30: jendela habis
  assert.deepEqual(await jatuh('2026-11-23T01:59:00Z'), []) // 08.59: belum waktunya
  assert.deepEqual(await jatuh('2026-11-23T09:00:00Z'), [{ nama: 'Fulfillment seharian', tanggal: '2026-11-23' }]) // 16.00
  // Middle masih mati
  assert.deepEqual(await jatuh('2026-11-23T06:00:00Z'), []) // 13.00
  // jam diubah dari Orca
  await ubah(`update pesan_wa set jam = '10:15' where nama = 'Fulfillment pagi'`)
  assert.deepEqual(await jatuh('2026-11-23T02:00:00Z'), [])
  assert.deepEqual(await jatuh('2026-11-23T03:15:00Z'), [{ nama: 'Fulfillment pagi', tanggal: '2026-11-23' }])
  // hari kirim: tanpa Senin
  await ubah(`update pesan_wa set hari = '{2,3,4,5,6,7}' where nama = 'Fulfillment pagi'`)
  assert.deepEqual(await jatuh('2026-11-23T03:15:00Z'), [])
  assert.deepEqual(await jatuh('2026-11-24T03:15:00Z'), [{ nama: 'Fulfillment pagi', tanggal: '2026-11-24' }]) // Selasa
  // dua pesan di jam yang sama sama-sama jatuh tempo
  await ubah(`update pesan_wa set jam = '10:15', hari = '{1,2,3,4,5,6,7}' where nama in ('Fulfillment pagi', 'Pengingat captain pagi')`)
  assert.equal((await jatuh('2026-11-23T03:15:00Z')).length, 2)
  // saklar utama mati: tidak ada yang jatuh tempo
  await ubah(`update pengaturan_wa set aktif = false where id = 1`)
  assert.deepEqual(await jatuh('2026-11-23T03:15:00Z'), [])
  await ubah(`update pengaturan_wa set aktif = true where id = 1; update pesan_wa set aktif = false`)
  // tidak bisa dipanggil lewat API
  await db.exec(`reset role; set role authenticated`)
  await assert.rejects(q(`select * from pesan_wa_jatuh_tempo()`), /permission denied/)
  await db.exec('reset role')
})

test('budget: kebutuhan rider per shift per DS (kuota khusus hari itu menang), hanya DS yang punya jadwal, satu pesan ke grup yang dipilih', async () => {
  await db.exec(`update ds set kuota_pagi = 2, kuota_tengah = 1, kuota_siang = 1 where id = '${GALAXY}'; update ds set kuota_pagi = 2, kuota_tengah = 0, kuota_siang = 1 where id = '${KEMBAR}'`)
  await db.exec(`insert into kuota_harian (ds_id, tanggal, kuota_pagi, kuota_siang, kuota_tengah) values ('${KEMBAR}', ${tgl(7)}, 5, 3, 0)`) // hari ke-7 Kembar punya kuota khusus
  const b = (await q(`select * from laporan_budget_wa(${tgl(7)}, 'https://orca.test', null, '120363555@g.us')`))
  assert.equal(b.length, 1)
  assert.equal(b[0].group_wa_id, '120363555@g.us')
  assert.ok(b[0].ds_namas.includes('Galaxy') && b[0].ds_namas.includes('Kembar'))
  assert.ok(b[0].pesan.startsWith('💰 *BUDGET KEBUTUHAN RIDER*'))
  assert.ok(b[0].pesan.includes('*Galaxy*' + String.fromCharCode(10) + '    Pagi 2 · Middle 1 · Siang 1 = 4'))
  assert.ok(b[0].pesan.includes('*Kembar*' + String.fromCharCode(10) + '    Pagi 5 · Siang 3 = 8')) // kuota hari itu, bukan bawaan DS
  assert.doesNotMatch(b[0].pesan, /Alam Sutera/) // tanpa jadwal hari itu
  // dibatasi ke DS tertentu
  const satu = (await q(`select * from laporan_budget_wa(${tgl(7)}, 'https://orca.test', array['${KEMBAR}']::uuid[], '120363555@g.us')`))[0]
  assert.deepEqual(satu.ds_namas, ['Kembar'])
  // hari tanpa jadwal sama sekali: tidak ada pesan
  assert.deepEqual(await q(`select * from laporan_budget_wa(${tgl(300)}, 'https://orca.test', null, '120363555@g.us')`), [])
  // tidak bisa dipanggil lewat API
  await db.exec(`reset role; set role authenticated`)
  await assert.rejects(q(`select * from laporan_budget_wa()`), /permission denied/)
  await db.exec('reset role')
})

// ───────── ringkasan mingguan dan bulanan (migrasi 0061) ─────────
test('ringkasan mingguan: budget rata-rata, fulfillment, rider baru dan churn dengan tanda naik/turun dibanding minggu sebelumnya', async () => {
  const [RD, R1, R2, R3, R4] = [id(50), id(51), id(52), id(53), id(54)]
  await db.exec(`
    insert into ds (id, nama, kuota_pagi, kuota_siang, group_wa_id) values ('${RD}', 'Ringkas', 2, 1, null);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${R1}', 'N1', 'Ring Satu', '${RD}', 'rider', null, 'aktif'), ('${R2}', 'N2', 'Ring Dua', '${RD}', 'rider', null, 'aktif'),
      ('${R3}', 'N3', 'Ring Tiga', '${RD}', 'rider', null, 'aktif'), ('${R4}', 'N4', 'Ring Empat', '${RD}', 'rider', null, 'aktif')`)
  // Senin minggu lalu (P) dan minggu sebelumnya (Q)
  const { p, q: qq } = (await q(`select (date_trunc('week', today_wib())::date - 7)::text as p, (date_trunc('week', today_wib())::date - 14)::text as q`))[0]
  const hari = (tgl, rider, shift, status) => db.exec(`
    insert into jadwal (tanggal, rider_id, shift, ds_id) values ('${tgl}', '${rider}', '${shift}', '${RD}');
    ${status ? `insert into actual_harian (tanggal, rider_id, ds_id, status) values ('${tgl}', '${rider}', '${RD}', '${status}')` : ''}`)
  // P: pagi 1 dari 2 (Ring Dua belum hadir), siang 1 dari 1  => 2 dari 3 = 67%
  await hari(p, R1, 'pagi', 'hadir'); await hari(p, R2, 'pagi', null); await hari(p, R3, 'siang', 'hadir')
  // Q: semua hadir => 3 dari 3 = 100%
  await hari(qq, R1, 'pagi', 'hadir'); await hari(qq, R2, 'pagi', 'hadir'); await hari(qq, R3, 'siang', 'hadir')
  // rider: satu bergabung dan satu berhenti (mengundurkan diri) di minggu P
  await db.exec(`
    insert into rider_peristiwa (rider_id, jenis, tanggal) values ('${R4}', 'bergabung', '${p}'::date + 1);
    insert into rider_peristiwa (rider_id, jenis, tanggal, kategori) values ('${R1}', 'berhenti', '${p}'::date + 2, 'mengundurkan_diri')`)
  const ringkas = async (periode = 'mingguan') => (await q(`select * from laporan_ringkasan_wa($1, today_wib(), 'https://orca.test', array['${RD}']::uuid[], '120363555@g.us')`, [periode]))[0]

  const m = await ringkas()
  assert.equal(m.group_wa_id, '120363555@g.us')
  assert.deepEqual(m.ds_namas, ['Ringkas'])
  assert.ok(m.pesan.startsWith('📊 *RINGKASAN MINGGUAN*\n'))
  assert.ok(m.pesan.includes('*Budget* (kebutuhan rider per hari, rata-rata)\n  Pagi 2 = sama · Siang 1 = sama\n  Total 3 = sama (+0,0%)'))
  assert.ok(m.pesan.includes('*Fulfillment rate*\n  67% ▼ -33 poin (sebelumnya 100%)\n  Pagi 50% · Siang 100%'))
  assert.ok(m.pesan.includes('  Baru 1 · Kembali 0 · Berhenti 1 ▲ +1\n  Bersih = 0'))
  assert.ok(m.pesan.includes('Berhenti: mengundurkan diri 1, diberhentikan 0, kontrak selesai 0'))
  assert.ok(m.pesan.includes('⚠️ *Perlu perhatian* (fulfillment di bawah 95%)\n  Ringkas · 67% ▼ -33 poin'))
  assert.ok(m.pesan.endsWith(`🔗 Detail lengkap:\nhttps://orca.test/?tab=rekap&tgl=${(await q(`select ('${p}'::date + 6)::text as t`))[0].t}`))
  assert.doesNotMatch(m.pesan, /Middle/) // DS tanpa Middle: tidak ditampilkan

  // Budget naik: foto harian untuk hari di minggu P (pagi 4) dipakai menggantikan kuota DS saat ini
  await db.exec(`insert into budget_snapshot (tanggal, ds_id, kuota_pagi, kuota_tengah, kuota_siang) values ('${p}', '${RD}', 4, 0, 1)`)
  const n = await ringkas()
  assert.ok(n.pesan.includes('  Pagi 4 ▲ +2 · Siang 1 = sama\n  Total 5 ▲ +2 (+66,7%)'))
  assert.ok(n.pesan.includes('  40% ▼ -60 poin (sebelumnya 100%)')) // 2 terpenuhi dari kebutuhan 5

  // Bulanan: bulan lalu tidak punya jadwal untuk DS ini, jadi tidak ada pesan; periode tidak dikenal ditolak
  assert.equal(await ringkas('bulanan'), undefined)
  await assert.rejects(ringkas('tahunan'), /Periode tidak dikenal/)
})

test('ringkasan bulanan: judul bulan, pembanding bulan sebelumnya, dan ditandai bila data rider berhenti belum lengkap', async () => {
  const RB = id(60), RR = id(61)
  await db.exec(`
    insert into ds (id, nama, kuota_pagi, kuota_siang, group_wa_id) values ('${RB}', 'Bulanan', 1, 1, null);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values ('${RR}', 'B1', 'Bulan Satu', '${RB}', 'rider', null, 'aktif')`)
  const { awal, akhir } = (await q(`select (date_trunc('month', today_wib()) - interval '1 month')::date::text as awal, (date_trunc('month', today_wib())::date - 1)::text as akhir`))[0]
  await db.exec(`
    insert into jadwal (tanggal, rider_id, shift, ds_id) values ('${awal}', '${RR}', 'pagi', '${RB}');
    insert into actual_harian (tanggal, rider_id, ds_id, status) values ('${awal}', '${RR}', '${RB}', 'hadir')`)
  const r = (await q(`select * from laporan_ringkasan_wa('bulanan', today_wib(), 'https://orca.test', array['${RB}']::uuid[], '120363555@g.us')`))[0]
  assert.match(r.pesan, /^📊 \*RINGKASAN BULANAN · [A-Z]+ \d{4}\*\ndibanding [A-Za-z]+ \d{4}\n/)
  assert.ok(r.pesan.includes('  Pagi 1 · Siang 1')) // tanpa pembanding: bulan sebelumnya tidak punya data, jadi tidak ada tanda naik/turun
  assert.ok(r.pesan.includes('  50%' + String.fromCharCode(10)) && !r.pesan.includes('sebelumnya')) // pagi hadir 1 dari 1, siang 0 dari 1
  assert.ok(r.pesan.includes('ℹ️ Data rider berhenti lengkap sejak')) // pencatatan berhenti baru dimulai setelah periode itu
  assert.ok(r.pesan.endsWith(`tgl=${akhir}`))
})

test('foto budget harian: dicatat dari kuota efektif, hanya menulis bila berubah, dan hanya Super-admin yang bisa membaca', async () => {
  const SB = id(70)
  await db.exec(`insert into ds (id, nama, kuota_pagi, kuota_siang, group_wa_id) values ('${SB}', 'Foto Budget', 3, 2, null)`)
  assert.ok((await q(`select catat_budget_snapshot() as n`))[0].n >= 1) // DS baru ini belum punya foto hari ini
  assert.equal((await q(`select catat_budget_snapshot() as n`))[0].n, 0) // tidak ada perubahan: tidak menulis
  await db.exec(`update ds set kuota_pagi = 5 where id = '${SB}'`)
  assert.equal((await q(`select catat_budget_snapshot() as n`))[0].n, 1)
  assert.deepEqual((await q(`select kuota_pagi, kuota_siang from budget_snapshot where ds_id = '${SB}' and tanggal = today_wib()`))[0], { kuota_pagi: 5, kuota_siang: 2 })
  // kuota khusus hari itu menang atas kuota bawaan DS
  await db.exec(`insert into kuota_harian (ds_id, tanggal, kuota_pagi, kuota_siang, kuota_tengah) values ('${SB}', today_wib(), 7, 2, 0)`)
  await q(`select catat_budget_snapshot()`)
  assert.equal((await q(`select kuota_pagi from budget_snapshot where ds_id = '${SB}' and tanggal = today_wib()`))[0].kuota_pagi, 7)
  // hanya Super-admin yang membaca; tidak bisa dipanggil lewat API
  assert.ok((await sebagaiSuper(() => q(`select * from budget_snapshot where ds_id = '${SB}'`))).length >= 1)
  await db.exec(`reset role; set role authenticated`)
  assert.deepEqual(await q(`select * from budget_snapshot`), [])
  await assert.rejects(q(`select catat_budget_snapshot()`), /permission denied/)
  await db.exec('reset role')
})

test('pesan terjadwal: ringkasan mingguan dan bulanan punya jadwal sendiri (bulanan memakai tanggal dalam bulan), dengan batasan data', async () => {
  const ins = (sql) => db.exec(sql)
  await ins(`insert into pesan_wa (nama, jenis, jam, hari, aktif) values ('Ringkasan mingguan', 'ringkasan_mingguan', '09:00', '{1}', true)`)
  await ins(`insert into pesan_wa (nama, jenis, jam, tanggal_bulan, aktif) values ('Ringkasan bulanan', 'ringkasan_bulanan', '09:00', 1, true)`)
  const jatuh = async (utc) => (await q(`select p.nama from pesan_wa_jatuh_tempo($1::timestamptz) j join pesan_wa p on p.id = j.id order by p.nama`, [utc])).map((x) => x.nama)
  // Senin 23 Nov 2026 jam 09.00 WIB: mingguan jatuh tempo, bulanan tidak (bukan tanggal 1)
  assert.deepEqual(await jatuh('2026-11-23T02:00:00Z'), ['Ringkasan mingguan'])
  // Selasa 24 Nov: tidak ada
  assert.deepEqual(await jatuh('2026-11-24T02:00:00Z'), [])
  // Selasa 1 Des 2026 jam 09.00: bulanan jatuh tempo walau bukan hari terpilih untuk mingguan
  assert.deepEqual(await jatuh('2026-12-01T02:00:00Z'), ['Ringkasan bulanan'])
  // batasan: bulanan wajib tanggal, tanggal hanya 1-28, mingguan tidak boleh punya tanggal bulan
  await assert.rejects(ins(`insert into pesan_wa (nama, jenis, jam) values ('x', 'ringkasan_bulanan', '09:00')`), /check constraint/i)
  await assert.rejects(ins(`insert into pesan_wa (nama, jenis, jam, tanggal_bulan) values ('x', 'ringkasan_bulanan', '09:00', 29)`), /check constraint/i)
  await assert.rejects(ins(`insert into pesan_wa (nama, jenis, jam, tanggal_bulan) values ('x', 'ringkasan_mingguan', '09:00', 1)`), /check constraint/i)
  await assert.rejects(ins(`insert into pesan_wa (nama, jenis, shift, jam) values ('x', 'ringkasan_mingguan', 'pagi', '09:00')`), /check constraint/i)
  await ins(`delete from pesan_wa where nama in ('Ringkasan mingguan', 'Ringkasan bulanan')`)
})

test('perapian 0063: satu pemformat tanggal untuk semua pesan, dan pesan berjam malam tetap terkirim', async () => {
  // satu pemformat "Senin, 23 Nov 2026" dipakai laporan, budget, dan ringkasan
  assert.equal((await q(`select wa_hari_tgl('2026-11-23') as t`))[0].t, 'Senin, 23 Nov 2026')
  assert.equal((await q(`select wa_hari_tgl('2026-12-06') as t`))[0].t, 'Minggu, 6 Des 2026')
  const b = (await q(`select * from laporan_budget_wa(${tgl(7)}, 'https://orca.test', null, '120363555@g.us')`))[0]
  assert.ok(b.pesan.includes((await q(`select wa_hari_tgl(${tgl(7)}) as t`))[0].t)) // budget memakai pemformat yang sama
  // pesan jam 23.50: jatuh tempo 23.50-00.00 (jendela terpotong tengah malam), tidak lagi hilang karena jam berputar
  await db.exec(`insert into pesan_wa (nama, jenis, jam, aktif) values ('Pesan malam', 'budget', '23:50', true)`)
  const jatuh = async (utc) => (await q(`select p.nama from pesan_wa_jatuh_tempo($1::timestamptz) j join pesan_wa p on p.id = j.id`, [utc])).map((x) => x.nama)
  assert.deepEqual(await jatuh('2026-11-23T16:50:00Z'), ['Pesan malam']) // 23.50 WIB
  assert.deepEqual(await jatuh('2026-11-23T16:59:00Z'), ['Pesan malam']) // 23.59 WIB
  assert.deepEqual(await jatuh('2026-11-23T16:49:00Z'), []) // 23.49: belum
  assert.deepEqual(await jatuh('2026-11-23T17:05:00Z'), []) // 00.05 hari berikutnya: sudah lewat, tidak ikut hari baru
  await db.exec(`delete from pesan_wa where nama = 'Pesan malam'`)
})

test('sumber BO (0074): pesan Fulfillment dari clock-in BO, Captain tetap bawaan, dan fungsi internal tertutup dari API', async () => {
  const n = 20 // hari yang sudah lewat: budget penuh, tanpa jadwal dan absensi Captain, jadi hanya clock-in BO yang bicara
  const masuk = (ds, hub, kode, jam) => db.exec(`insert into kehadiran_bo (hub, ds_id, kode_mtr, tanggal, masuk_lokal, zona, masuk_wib, sumber)
    values ('${hub}', '${ds}', '${kode}', ${tgl(n)}, '${jam}', 'WIB', (${tgl(n)} + '${jam}'::time)::timestamptz, 'api')`)
  await masuk(GALAXY, 'Hub Galaxy', 'M1', '05:50'); await masuk(GALAXY, 'Hub Galaxy', 'M2', '07:30'); await masuk(GALAXY, 'Hub Galaxy', 'M3', '13:59')
  await masuk(ALSUT, 'Hub Alsut', 'M5', '05:50')
  // budget hari itu dipastikan lewat kuota khusus, supaya tes tidak bergantung pada kuota DS yang diubah tes lain
  await db.exec(`insert into kuota_harian (ds_id, tanggal, kuota_pagi, kuota_siang, kuota_tengah) values ('${GALAXY}', ${tgl(n)}, 2, 1, 0), ('${ALSUT}', ${tgl(n)}, 1, 1, 0)`)
  const bo =async (sesi, ds = 'Galaxy') => (await q(`select * from laporan_wa_bo($1, ${tgl(n)}) where ds_nama = $2`, [sesi, ds]))[0]

  // pagi: budget 2, dua clock-in (satu tepat, satu telat)
  const pagi = await bo('laporan_pagi')
  assert.match(pagi.pesan, /\*Shift Pagi Fulfillment Update\*/)
  assert.match(pagi.pesan, /· Live dari Dash Attendance/)
  assert.match(pagi.pesan, /Terpenuhi: 2 dari 2 rider \(100%\)/)
  assert.match(pagi.pesan, /Clock-in BO: 2 · Tepat waktu: 1/)
  assert.deepEqual([pagi.n_terpenuhi, pagi.n_kebutuhan, pagi.n_belum], [2, 2, 0])
  // siang: rekap hari ini ikut, dan DS yang punya budget tapi belum ada clock-in tetap dilaporkan 0 dari budget
  const siang = await bo('laporan_siang')
  assert.match(siang.pesan, /Terpenuhi: 1 dari 1 rider \(100%\)/)
  assert.match(siang.pesan, /\*Rekap hari ini\*\nPagi: 2\/2 · Siang: 1\/1/)
  const alsutSiang = await bo('laporan_siang', 'Alam Sutera')
  assert.deepEqual([alsutSiang.n_terpenuhi, alsutSiang.n_kebutuhan], [0, 1])
  // seharian: jumlah semua shift
  const hari = await bo('laporan_hari')
  assert.deepEqual([hari.n_terpenuhi, hari.n_kebutuhan], [3, 3])
  assert.match(hari.pesan, /\*Daily Update Fulfillment\*/)
  // pengingat bukan laporan: tidak ada versi BO
  await assert.rejects(q(`select * from laporan_wa_bo('ingat_pagi', ${tgl(n)})`), /Sesi tidak dikenal/)

  // gabungan: judul menyebut Clock-in BO dan angka total dari dua DS; tanpa p_sumber tetap dari Captain (hari ini tanpa jadwal: tidak ada baris)
  const g = await q(`select * from laporan_wa_gabung('laporan_pagi', ${tgl(n)}, 'https://orca.test', null, '120363999@g.us', null, 'bo')`)
  assert.equal(g.length, 1)
  assert.match(g[0].pesan, /\*SHIFT PAGI FULFILLMENT UPDATE\*/)
  assert.match(g[0].pesan, /· Live dari Dash Attendance/)
  assert.match(g[0].pesan, /3 dari 3 \(100%\) · 2 DS/)
  assert.equal((await q(`select * from laporan_wa_gabung('laporan_pagi', ${tgl(n)}, 'https://orca.test', null, '120363999@g.us')`)).length, 0)
  // pengingat tetap dari Captain walau sumber BO, dan sumber yang tidak dikenal ditolak
  await q(`select * from laporan_wa_gabung('ingat_pagi', ${tgl(n)}, 'https://orca.test', null, null, null, 'bo')`)
  await assert.rejects(q(`select * from laporan_wa_gabung('laporan_pagi', ${tgl(n)}, 'https://orca.test', null, null, null, 'lain')`), /Sumber tidak dikenal/)

  // pesan terjadwal: sumber BO hanya untuk pesan Fulfillment
  await db.exec(`insert into pesan_wa (nama, jenis, shift, jam, sumber) values ('Fulfillment BO', 'fulfillment_shift', 'pagi', '09:00', 'bo')`)
  await assert.rejects(db.exec(`insert into pesan_wa (nama, jenis, shift, jam, sumber) values ('x', 'pengingat_captain', 'pagi', '07:00', 'bo')`), /check constraint/i)
  await assert.rejects(db.exec(`insert into pesan_wa (nama, jenis, jam, sumber) values ('x', 'budget', '09:00', 'bo')`), /check constraint/i)
  await assert.rejects(db.exec(`insert into pesan_wa (nama, jenis, shift, jam, sumber) values ('x', 'fulfillment_shift', 'pagi', '09:00', 'lain')`), /check constraint/i)
  await db.exec(`delete from pesan_wa where nama = 'Fulfillment BO'`)

  // fungsi internal tidak bisa dipanggil lewat API
  for (const peran of ['anon', 'authenticated']) {
    await db.exec(`reset role; set role ${peran}`)
    await assert.rejects(q(`select * from laporan_wa_bo('laporan_pagi')`), /permission denied/)
    await assert.rejects(q(`select * from laporan_wa_pilih('laporan_pagi', ${tgl(n)}, 'bo')`), /permission denied/)
    await assert.rejects(q(`select * from aktual_bo_semua(${tgl(n)}, ${tgl(n)})`), /permission denied/)
    await db.exec('reset role')
  }
})
