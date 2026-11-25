// Uji fulfillment aktual dan tepat waktu dari clock-in BO (migrasi 0065): penentuan shift, toleransi, budget, batas akses. Database PGlite.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const [SUPER, CAP, ARC, ARC2] = [id(1), id(2), id(3), id(4)]
const [DSA, DSB, DSC, DSD] = [id(101), id(102), id(103), id(104)]
const HUB_A = 'Dark Store Alfagift - Alfa - Bandung'
const HUB_B = 'Dark Store Alfagift - Beta - Makassar'
const TGL = '2026-11-20'
const rid = (n) => id(200 + n)
const kode = (n) => 'MTR000000' + n
const q = async (sql, p) => (await db.query(sql, p)).rows

const sebagai = async (email, fn) => {
  await db.exec(`reset role; select set_config('request.jwt.claims', '{"email":"${email}"}', false); set role authenticated`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
}
const sebagaiSuper = (fn) => sebagai('super@test.local', fn)
// jam masuk lokal "HH:MM" pada tanggal t di hub; masuk_wib hanya untuk keunikan baris
const masuk = (hub, dsId, kodeMtr, jam, t = TGL, zona = 'WIB') =>
  q(`insert into kehadiran_bo (hub, ds_id, kode_mtr, tanggal, masuk_lokal, zona, masuk_wib, sumber)
     values ($1, $2, $3, $4::date, $5::time, $6, ($4::date + $5::time)::timestamptz, 'api')`, [hub, dsId, kodeMtr, t, jam, zona])
const aktual = (dari = TGL, sampai = TGL) => sebagaiSuper(() => q(`select * from aktual_bo($1, $2)`, [dari, sampai]))

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
    insert into ds (id, nama, hub_bo, kuota_pagi, kuota_tengah, kuota_siang) values
      ('${DSA}', '${HUB_A}', '${HUB_A}', 3, 1, 2),
      ('${DSB}', '${HUB_B}', '${HUB_B}', 0, 0, 0),
      ('${DSC}', 'DS TANPA JADWAL', null, 4, 0, 4),
      ('${DSD}', 'DS JADWAL SAJA', null, 2, 0, 2);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${SUPER}', null, 'Super', null, 'super_admin', 'super@test.local', 'aktif'),
      ('${CAP}', null, 'Cap', '${DSA}', 'captain', 'cap@test.local', 'aktif'),
      ('${ARC}', null, 'Arcon Satu', null, 'arcon', 'arc@test.local', 'aktif'),
      ('${ARC2}', null, 'Arcon Dua', null, 'arcon', 'arc2@test.local', 'aktif');
    update ds set arcon_id = '${ARC}' where id = '${DSA}';`)
  for (let n = 1; n <= 9; n++) {
    await q(`insert into riders (id, kode_mtr, nama, ds_id, peran, status) values ($1, $2, $3, $4, 'rider', 'aktif')`, [rid(n), kode(n), 'Rider ' + n, DSA])
  }
  await db.exec(`
    -- terjadwal di DS Alfa: R1 dan R2 pagi, R3 siang. Selain itu tidak terjadwal.
    insert into jadwal (tanggal, rider_id, shift, ds_id) values
      ('${TGL}', '${rid(1)}', 'pagi', '${DSA}'), ('${TGL}', '${rid(2)}', 'pagi', '${DSA}'), ('${TGL}', '${rid(3)}', 'siang', '${DSA}'),
      ('2026-11-22', '${rid(1)}', 'pagi', '${DSD}');
    -- absensi captain: R1 dan R2 hadir, R3 alpha
    insert into actual_harian (tanggal, rider_id, ds_id, status) values
      ('${TGL}', '${rid(1)}', '${DSA}', 'hadir'), ('${TGL}', '${rid(2)}', '${DSA}', 'hadir'), ('${TGL}', '${rid(3)}', '${DSA}', 'alpha')`)
  // clock-in BO di hub Alfa, tanggal TGL
  await masuk(HUB_A, DSA, kode(1), '05:58')
  await masuk(HUB_A, DSA, kode(1), '07:30') // clock-in kedua rider yang sama: hanya yang paling awal dihitung
  await masuk(HUB_A, DSA, kode(2), '06:02') // tepat di batas jam mulai + toleransi 2 menit
  await masuk(HUB_A, DSA, kode(3), '13:00') // terjadwal shift siang dan masuk wajar (1 jam sebelum mulai): shift mengikuti jadwal, bukan jam masuk (jam 13:00 akan jadi siang juga)
  await masuk(HUB_A, DSA, kode(5), '06:03') // tidak terjadwal, pagi, telat
  await masuk(HUB_A, DSA, kode(6), '08:55') // batas pagi
  await masuk(HUB_A, DSA, kode(7), '08:56') // Middle (sebelum jam mulai Middle, jadi tepat waktu)
  await masuk(HUB_A, DSA, kode(8), '11:59') // batas Middle, telat
  await masuk(HUB_A, DSA, kode(9), '12:00') // siang
  await masuk(HUB_A, DSA, 'MTR0000999', '06:00') // kode mitra belum terdaftar di Orca
  // hub Beta (WITA), budget belum diisi: tetap tampil dengan kebutuhan 0
  await masuk(HUB_B, DSB, 'MTR0000888', '13:50', TGL, 'WITA')
})
after(() => db.close())

test('shift: terjadwal mengikuti jadwal, tidak terjadwal dari jam masuk; satu rider dihitung sekali; tepat waktu = jam mulai + 2 menit', async () => {
  const a = (await aktual()).find((x) => x.ds_id === DSA)
  assert.deepEqual({ p: [a.b_pagi, a.h_pagi, a.t_pagi], t: [a.b_tengah, a.h_tengah, a.t_tengah], s: [a.b_siang, a.h_siang, a.t_siang] },
    { p: [3, 5, 3], t: [1, 2, 1], s: [2, 2, 2] })
  // pagi: R1, R2, R5, R6, kode belum terdaftar (hadir 5; tepat R1, R2, kode belum terdaftar). Middle: R7 tepat, R8 telat. Siang: R3 (jadwal) dan R9.
  assert.equal(a.hadir, 9)
  assert.equal(a.tepat, 6)
})

test('shift satu clock-in: laporan Captain dulu, lalu jadwal bila wajar (paling awal 2 jam sebelum mulai), selain itu jam masuk', async () => {
  const T = '2026-11-24'
  await q(`insert into jadwal (tanggal, rider_id, shift, ds_id) values ($1, $2, 'siang', $6), ($1, $3, 'siang', $6), ($1, $4, 'siang', $6), ($1, $5, 'siang', $6)`,
    [T, rid(1), rid(2), rid(5), rid(8), DSA])
  // R1 terjadwal siang tapi masuk 06:07 dan belum dilaporkan Captain: terlalu awal untuk siang, jadi dibaca Pagi
  await masuk(HUB_A, DSA, kode(1), '06:07', T)
  // R2 terjadwal siang, masuk 06:15, tetapi Captain mencatat hadir: laporan Captain menang, jadi Siang
  await masuk(HUB_A, DSA, kode(2), '06:15', T)
  await q(`insert into actual_harian (tanggal, rider_id, ds_id, status) values ($1, $2, $3, 'hadir')`, [T, rid(2), DSA])
  // R5 terjadwal siang, masuk 12:30 (1,5 jam sebelum mulai), belum dilaporkan: jadwal wajar, Siang
  await masuk(HUB_A, DSA, kode(5), '12:30', T)
  // R7 tidak terjadwal, masuk 06:05, Captain mencatat pengganti untuk R8 yang terjadwal siang: mengisi shift Siang
  await masuk(HUB_A, DSA, kode(7), '06:05', T)
  await q(`insert into actual_harian (tanggal, rider_id, ds_id, status, backup_untuk_id) values ($1, $2, $3, 'pengganti', $4)`, [T, rid(7), DSA, rid(8)])
  const a = (await aktual(T, T)).find((x) => x.ds_id === DSA)
  assert.deepEqual({ pagi: a.h_pagi, tengah: a.h_tengah, siang: a.h_siang }, { pagi: 1, tengah: 0, siang: 3 })
})

test('jadwal hanya dipakai bila clock-in tidak melewati batas shift: rider terjadwal Pagi yang masuk sore dibaca dari jam, bukan Pagi', async () => {
  const T = '2026-11-19'
  await q(`insert into jadwal (tanggal, rider_id, shift, ds_id) values ($1, $2, 'pagi', $5), ($1, $3, 'pagi', $5), ($1, $4, 'pagi', $5)`, [T, rid(1), rid(2), rid(5), DSA])
  await masuk(HUB_A, DSA, kode(1), '15:00', T) // terjadwal Pagi, masuk sore: Siang (dulu terbaca Pagi sehingga Pagi melebihi budget)
  await masuk(HUB_A, DSA, kode(2), '08:50', T) // terjadwal Pagi, masuk sebelum batas Pagi (08:55): tetap Pagi
  await masuk(HUB_A, DSA, kode(5), '09:10', T) // terjadwal Pagi, masuk melewati batas Pagi: dibaca dari jam, Middle
  const a = (await aktual(T, T)).find((x) => x.ds_id === DSA)
  assert.deepEqual({ pagi: a.h_pagi, tengah: a.h_tengah, siang: a.h_siang }, { pagi: 1, tengah: 1, siang: 1 })
})

test('fulfillment aktual: terpenuhi per shift dibatasi budget, kelebihan rider tidak menambah', async () => {
  const a = (await aktual()).find((x) => x.ds_id === DSA)
  assert.equal(a.kebutuhan, 6) // 3 + 1 + 2
  assert.equal(a.terpenuhi, 6) // min(5,3) + min(2,1) + min(2,2)
})

test('versi captain berdampingan dan rider yang belum terdaftar di Orca', async () => {
  const a = (await aktual()).find((x) => x.ds_id === DSA)
  assert.equal(a.captain, 2) // R1 dan R2 hadir menurut captain, R3 alpha
  assert.equal(a.diabsen, 3) // tiga isian absensi (hadir, hadir, alpha): Captain sudah mengisi
  assert.equal(a.tanpa_orca, 1)
})

test('DS tanpa budget tetap tampil (kebutuhan 0); DS tanpa jadwal dan tanpa clock-in tidak dihitung; DS berjadwal tanpa clock-in tampil dengan 0 hadir', async () => {
  const hari = await aktual()
  const b = hari.find((x) => x.ds_id === DSB)
  assert.deepEqual({ kebutuhan: b.kebutuhan, terpenuhi: b.terpenuhi, hadir: b.hadir, siang: [b.h_siang, b.t_siang] }, { kebutuhan: 0, terpenuhi: 0, hadir: 1, siang: [1, 1] }) // 13:50 WITA <= 14:02
  assert.equal(b.diabsen, 0) // Captain belum mengisi apa pun: layar menulis "belum diabsen", bukan 0 hadir
  assert.ok(!hari.some((x) => x.ds_id === DSC || x.ds_id === DSD))
  const d = (await aktual('2026-11-22', '2026-11-22')).find((x) => x.ds_id === DSD)
  assert.deepEqual({ kebutuhan: d.kebutuhan, terpenuhi: d.terpenuhi, hadir: d.hadir }, { kebutuhan: 4, terpenuhi: 0, hadir: 0 })
})

test('budget harian khusus menggantikan kuota DS', async () => {
  await q(`insert into kuota_harian (ds_id, tanggal, kuota_pagi, kuota_siang, kuota_tengah) values ($1, '2026-11-21', 1, 0, 0)`, [DSA])
  await masuk(HUB_A, DSA, kode(1), '06:00', '2026-11-21')
  await masuk(HUB_A, DSA, kode(2), '06:01', '2026-11-21')
  const a = (await aktual('2026-11-21', '2026-11-21')).find((x) => x.ds_id === DSA)
  assert.deepEqual({ kebutuhan: a.kebutuhan, terpenuhi: a.terpenuhi, hadir: a.hadir, tepat: a.tepat }, { kebutuhan: 1, terpenuhi: 1, hadir: 2, tepat: 2 })
})

test('toleransi dan batas shift mengikuti pengaturan_kehadiran', async () => {
  await q(`update pengaturan_kehadiran set toleransi_menit = 5, batas_pagi = '08:50' where id = 1`)
  try {
    const a = (await aktual()).find((x) => x.ds_id === DSA)
    // R5 06:03 kini tepat; R6 08:55 melewati batas pagi baru sehingga masuk Middle (tepat, sebelum 10:05)
    assert.deepEqual({ p: [a.h_pagi, a.t_pagi], t: [a.h_tengah, a.t_tengah] }, { p: [4, 4], t: [3, 2] })
  } finally { await q(`update pengaturan_kehadiran set toleransi_menit = 2, batas_pagi = '08:55' where id = 1`) }
})

test('rider dua shift (long shift): dibaca per mitra dan per shift, clock-in ulang singkat dan shift yang sama diabaikan', async () => {
  const T = '2026-11-23'
  await q(`insert into jadwal (tanggal, rider_id, shift, ds_id) values ($1, $2, 'pagi', $4), ($1, $3, 'siang', $4)`, [T, rid(1), rid(3), DSA])
  // R1 terjadwal pagi: 05:58 lalu 14:00 = pagi dan siang, dua-duanya tepat waktu
  await masuk(HUB_A, DSA, kode(1), '05:58', T); await masuk(HUB_A, DSA, kode(1), '14:00', T)
  // R2 tidak terjadwal: 06:00 lalu 06:01 = clock-in ulang, hanya satu kali pagi
  await masuk(HUB_A, DSA, kode(2), '06:00', T); await masuk(HUB_A, DSA, kode(2), '06:01', T)
  // R3 terjadwal siang tetapi clock-in 05:30 dan 14:05: dua kali clock-in, jadi dibaca dari jam (pagi tepat, siang telat), bukan dari jadwal
  await masuk(HUB_A, DSA, kode(3), '05:30', T); await masuk(HUB_A, DSA, kode(3), '14:05', T)
  // R4: 13:52 lalu 23:34, dua-duanya siang = satu kali siang (clock-in paling awal, tepat)
  await masuk(HUB_A, DSA, kode(4), '13:52', T); await masuk(HUB_A, DSA, kode(4), '23:34', T)
  // R5: 08:39 lalu 13:49 = pagi (telat) dan siang (tepat)
  await masuk(HUB_A, DSA, kode(5), '08:39', T); await masuk(HUB_A, DSA, kode(5), '13:49', T)
  // R6: 14:00 lalu 14:06 = clock-in ulang, satu kali siang
  await masuk(HUB_A, DSA, kode(6), '14:00', T); await masuk(HUB_A, DSA, kode(6), '14:06', T)
  // mitra yang belum terdaftar di Orca, dua shift: dihitung di kedua shift tetapi satu rider di "belum terdaftar"
  await masuk(HUB_A, DSA, 'MTR0000999', '06:00', T); await masuk(HUB_A, DSA, 'MTR0000999', '14:00', T)
  const a = (await aktual(T, T)).find((x) => x.ds_id === DSA)
  // pagi: R1, R2, R3, R5, mitra baru = 5 (tepat: R1, R2, R3, mitra baru = 4). Siang: R1, R3, R4, R5, R6, mitra baru = 6 (tepat: R1, R4, R5, R6, mitra baru = 5)
  assert.deepEqual({ p: [a.h_pagi, a.t_pagi], t: [a.h_tengah, a.t_tengah], s: [a.h_siang, a.t_siang] }, { p: [5, 4], t: [0, 0], s: [6, 5] })
  assert.equal(a.hadir, 11)
  assert.equal(a.tepat, 9)
  assert.equal(a.tanpa_orca, 1) // satu rider, walau clock-in di dua shift
  assert.equal(a.terpenuhi, 5) // min(5,3) + min(0,1) + min(6,2): kelebihan rider tidak menambah
})

test('total per hari untuk tren dijumlahkan dari data per DS', async () => {
  const h = await sebagaiSuper(() => q(`select * from aktual_bo_harian($1, $2)`, [TGL, '2026-11-23']))
  const hari = h.find((x) => String(x.tanggal.toISOString?.() ?? x.tanggal).startsWith(TGL))
  const per = await aktual()
  assert.equal(hari.kebutuhan, per.reduce((s, x) => s + x.kebutuhan, 0))
  assert.equal(hari.terpenuhi, per.reduce((s, x) => s + x.terpenuhi, 0))
  assert.equal(hari.hadir, per.reduce((s, x) => s + x.hadir, 0))
  assert.equal(hari.tepat, per.reduce((s, x) => s + x.tepat, 0))
  assert.equal(hari.ds_aktif, per.length)
  assert.equal(h.length, 4) // 20, 21, 22, dan 23 November: tiap hari ada data
})

test('hari yang belum terjadi dan rentang terlalu panjang tidak menghasilkan baris', async () => {
  assert.deepEqual(await aktual('2099-01-01', '2099-01-02'), [])
  assert.deepEqual(await aktual('2026-01-01', '2026-11-20'), [])
})

test('hari berjalan: budget shift yang belum mulai tidak dihitung; hari lampau selalu penuh', async () => {
  // Pagi sudah mulai (00:00); Middle dan Siang belum (23:59). Berlaku untuk hari ini saja.
  await q(`update pengaturan_kehadiran set mulai_pagi = '00:00', mulai_tengah = '23:59', mulai_siang = '23:59' where id = 1`)
  const hariIni = (await q(`select to_char(today_wib(), 'YYYY-MM-DD') as d`))[0].d
  try {
    await masuk(HUB_A, DSA, kode(1), '05:50', hariIni)
    const a = (await aktual(hariIni, hariIni)).find((x) => x.ds_id === DSA)
    assert.deepEqual({ b: [a.b_pagi, a.b_tengah, a.b_siang], kebutuhan: a.kebutuhan, terpenuhi: a.terpenuhi }, { b: [3, 0, 0], kebutuhan: 3, terpenuhi: 1 })
    const lampau = (await aktual()).find((x) => x.ds_id === DSA)
    assert.equal(lampau.kebutuhan, 6) // TGL sudah lewat: Pagi 3 + Middle 1 + Siang 2, tidak terpengaruh jam mulai
  } finally {
    await q(`update pengaturan_kehadiran set mulai_pagi = '06:00', mulai_tengah = '10:00', mulai_siang = '14:00' where id = 1`)
  }
})

test('akses: Super-admin semua DS, Arcon hanya DS yang dipegangnya, captain dan Arcon tanpa DS tidak melihat apa pun, anon ditolak', async () => {
  const arc = await sebagai('arc@test.local', () => q(`select distinct ds_id from aktual_bo($1, $1)`, [TGL]))
  assert.deepEqual(arc.map((x) => x.ds_id), [DSA])
  assert.ok((await aktual()).length >= 2)
  assert.deepEqual(await sebagai('arc2@test.local', () => q(`select * from aktual_bo($1, $1)`, [TGL])), [])
  assert.deepEqual(await sebagai('cap@test.local', () => q(`select * from aktual_bo($1, $1)`, [TGL])), [])
  assert.deepEqual(await sebagai('cap@test.local', () => q(`select * from aktual_bo_harian($1, $1)`, [TGL])), [])
  await db.exec(`reset role; set role anon`)
  await assert.rejects(q(`select * from aktual_bo($1, $1)`, [TGL]), /permission denied/)
  await db.exec('reset role')
})
