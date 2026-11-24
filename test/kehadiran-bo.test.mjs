// Uji impor kehadiran backoffice (migrasi 0062): pencocokan hub ke DS, DS baru otomatis, impor idempoten, dan hak akses. Database PGlite.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const [SUPER, CAP, ARC, ARC2, R1, R2] = [id(1), id(2), id(3), id(4), id(11), id(12)]
const [CIHAM, LOMBOK, BERSAMA] = [id(101), id(102), id(103)]
const q = async (sql, p) => (await db.query(sql, p)).rows
const HUB_C = 'Dark Store Alfagift - Cihampelas - Bandung'
const HUB_L = 'Dark Store Alfagift - Lombok - Mataram'
const HUB_B = 'Toko Sapa Alfagift - Baru - Denpasar'

const sebagai = async (email, fn) => {
  await db.exec(`reset role; select set_config('request.jwt.claims', '{"email":"${email}"}', false); set role authenticated`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
}
const sebagaiSuper = (fn) => sebagai('super@test.local', fn)
const baris = (hub, kode, tanggal, masuk, zona, masukWib, keluarWib = null) => ({ hub, kode_mtr: kode, tanggal, masuk_lokal: masuk, zona, masuk_wib: masukWib, keluar_wib: keluarWib })
const impor = (b, peta = {}) => sebagaiSuper(() => q(`select impor_kehadiran_bo($1::jsonb, $2::jsonb) as r`, [JSON.stringify(b), JSON.stringify(peta)])).then((x) => x[0].r)

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
    insert into ds (id, nama, kuota_pagi, kuota_siang) values ('${CIHAM}', 'DS CIHAMPELAS', 8, 8), ('${LOMBOK}', 'Dark Store Alfagift - Lombok - Mataram', 5, 5), ('${BERSAMA}', 'DS GALAXY', 6, 6);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${SUPER}', null, 'Super', null, 'super_admin', 'super@test.local', 'aktif'),
      ('${CAP}', null, 'Cap', '${CIHAM}', 'captain', 'cap@test.local', 'aktif'),
      ('${R1}', 'MTR0000001', 'Rider Satu', '${CIHAM}', 'rider', null, 'aktif'),
      ('${R2}', 'MTR0000002', 'Rider Dua', '${CIHAM}', 'rider', null, 'aktif'),
      ('${ARC}', null, 'Arcon Satu', null, 'arcon', 'arc@test.local', 'aktif'),
      ('${ARC2}', null, 'Arcon Dua', null, 'arcon', 'arc2@test.local', 'aktif');
    update ds set arcon_id = '${ARC}' where id = '${CIHAM}'`)
})
after(() => db.close())

test('impor: hub dipasangkan ke DS yang ada (nama mengikuti BO), DS bernama persis dicocokkan otomatis, hub baru membuat DS baru berkuota 0', async () => {
  const b = [
    baris(HUB_C, 'MTR0000001', '2026-11-20', '05:53', 'WIB', '2026-11-19T22:53:00Z', '2026-11-20T08:00:00Z'),
    baris(HUB_C, 'MTR0000002', '2026-11-20', '06:09', 'WIB', '2026-11-19T23:09:00Z'),
    baris(HUB_L, 'MTR0000099', '2026-11-20', '05:50', 'WITA', '2026-11-19T21:50:00Z'),
    baris(HUB_B, 'MTR0000098', '2026-11-20', '13:48', 'WITA', '2026-11-20T05:48:00Z'),
  ]
  const hasil = await impor(b, { [HUB_C]: CIHAM })
  assert.deepEqual(hasil, { hub: 3, ds_dibuat: 1, ds_dipasang: 2, baris_baru: 4, baris_diperbarui: 0, rider_baru: 0 })
  // DS lama dipasangkan dan namanya mengikuti BO; identitas (id, kuota, captain) tetap
  const c = (await q(`select nama, hub_bo, kuota_pagi from ds where id = '${CIHAM}'`))[0]
  assert.deepEqual(c, { nama: HUB_C, hub_bo: HUB_C, kuota_pagi: 8 })
  // yang namanya persis sama: hanya diberi kunci hub, kuota tetap
  assert.deepEqual((await q(`select hub_bo, kuota_pagi from ds where id = '${LOMBOK}'`))[0], { hub_bo: HUB_L, kuota_pagi: 5 })
  // hub baru: DS dibuat otomatis, budget 0 (diisi manual di Orca)
  const baru = (await q(`select nama, hub_bo, kuota_pagi, kuota_siang, kuota_tengah from ds where hub_bo = $1`, [HUB_B]))[0]
  assert.deepEqual(baru, { nama: HUB_B, hub_bo: HUB_B, kuota_pagi: 0, kuota_siang: 0, kuota_tengah: 0 })
  // baris tersimpan dengan DS yang benar, jam lokal dan zona
  const k = await q(`select k.kode_mtr, k.masuk_lokal::text as lokal, k.zona, d.nama from kehadiran_bo k join ds d on d.id = k.ds_id where k.kode_mtr = 'MTR0000001'`)
  assert.deepEqual(k, [{ kode_mtr: 'MTR0000001', lokal: '05:53:00', zona: 'WIB', nama: HUB_C }])
})

test('impor bisa diulang: baris yang sama tidak ganda, hanya jam keluar yang diperbarui; kode mitra dirapikan', async () => {
  const b = [
    baris(HUB_C, 'MTR0000001', '2026-11-20', '05:53', 'WIB', '2026-11-19T22:53:00Z', '2026-11-20T08:00:00Z'),
    baris(HUB_C, 'MTR0000002', '2026-11-20', '06:09', 'WIB', '2026-11-19T23:09:00Z'),
  ]
  assert.deepEqual(await impor(b), { hub: 1, ds_dibuat: 0, ds_dipasang: 0, baris_baru: 0, baris_diperbarui: 0, rider_baru: 0 }) // persis sama: tidak ada perubahan
  b[1].keluar_wib = '2026-11-20T09:30:00Z' // clock-out baru terisi
  assert.deepEqual(await impor(b), { hub: 1, ds_dibuat: 0, ds_dipasang: 0, baris_baru: 0, baris_diperbarui: 1, rider_baru: 0 })
  assert.equal((await q(`select count(*)::int as n from kehadiran_bo where hub = $1`, [HUB_C]))[0].n, 2)
  // kode mitra huruf kecil dan berspasi dirapikan menjadi satu baris yang sama
  await impor([baris(HUB_C, '  mtr0000001 ', '2026-11-20', '05:53', 'WIB', '2026-11-19T22:53:00Z', '2026-11-20T08:00:00Z')])
  assert.equal((await q(`select count(*)::int as n from kehadiran_bo where kode_mtr = 'MTR0000001'`))[0].n, 1)
})

test('ringkasan per DS: rider unik yang clock-in, serta berapa yang belum terdaftar di Orca', async () => {
  const r = await sebagaiSuper(() => q(`select * from aktual_bo('2026-11-20', '2026-11-20') where ds_nama = $1`, [HUB_L]))
  assert.deepEqual(r.map((x) => ({ hadir: x.hadir, tanpa_orca: x.tanpa_orca })), [{ hadir: 1, tanpa_orca: 1 }]) // MTR0000099 belum ada di Orca
  const c = await sebagaiSuper(() => q(`select * from aktual_bo('2026-11-20', '2026-11-20') where ds_nama = $1`, [HUB_C]))
  assert.deepEqual(c.map((x) => ({ hadir: x.hadir, tanpa_orca: x.tanpa_orca })), [{ hadir: 2, tanpa_orca: 0 }])
})

test('hanya Super-admin: impor dan ringkasan ditolak untuk captain dan anon, data tidak terbaca selain Super-admin', async () => {
  const b = [baris(HUB_C, 'MTR0000003', '2026-11-21', '05:50', 'WIB', '2026-11-20T22:50:00Z')]
  await assert.rejects(sebagai('cap@test.local', () => q(`select impor_kehadiran_bo($1::jsonb) as r`, [JSON.stringify(b)])), /Hanya Super-admin/)
  await db.exec(`reset role; set role anon`)
  await assert.rejects(q(`select impor_kehadiran_bo('[]'::jsonb)`), /permission denied/)
  await db.exec('reset role')
  assert.deepEqual(await sebagai('cap@test.local', () => q(`select * from kehadiran_bo`)), [])
  assert.deepEqual(await sebagai('cap@test.local', () => q(`select * from aktual_bo('2026-11-01', '2026-11-30')`)), [])
  assert.ok((await sebagaiSuper(() => q(`select * from kehadiran_bo`))).length >= 4)
})

test('pasangan hub yang tidak valid ditolak (DS sudah terhubung ke hub lain atau tidak ada)', async () => {
  const hub = 'Dark Store Alfagift - Hub Lain - Kota'
  const b = [baris(hub, 'MTR0000001', '2026-11-20', '05:53', 'WIB', '2026-11-19T22:53:00Z')]
  await assert.rejects(impor(b, { [hub]: CIHAM }), /sudah terhubung/) // CIHAM sudah terhubung ke hub Cihampelas
  await assert.rejects(impor(b, { [hub]: id(999) }), /tidak ditemukan/)
  await assert.rejects(sebagaiSuper(() => q(`select impor_kehadiran_bo('{}'::jsonb)`)), /array/)
})

test('pengaturan jam shift: bawaan sesuai keputusan, hanya Super-admin, dan batasan data dijaga', async () => {
  const p = (await sebagaiSuper(() => q(`select * from pengaturan_kehadiran where id = 1`)))[0]
  assert.deepEqual({ a: p.mulai_pagi, b: p.mulai_tengah, c: p.mulai_siang, d: p.toleransi_menit, e: p.batas_pagi, f: p.batas_tengah },
    { a: '06:00', b: '10:00', c: '14:00', d: 2, e: '08:55', f: '11:59' })
  assert.deepEqual(await sebagai('cap@test.local', () => q(`select * from pengaturan_kehadiran`)), [])
  assert.deepEqual(await sebagai('cap@test.local', () => q(`update pengaturan_kehadiran set toleransi_menit = 10 returning id`)), [])
  const ubah = (sql) => sebagaiSuper(() => q(sql))
  await assert.rejects(ubah(`update pengaturan_kehadiran set mulai_pagi = '6:00'`), /check constraint/i)
  await assert.rejects(ubah(`update pengaturan_kehadiran set batas_pagi = '25:00'`), /check constraint/i)
  await assert.rejects(ubah(`update pengaturan_kehadiran set toleransi_menit = 61`), /check constraint/i)
  await assert.rejects(ubah(`insert into pengaturan_kehadiran (id) values (2)`), /check constraint|row-level security/i) // hanya satu baris, dan tanpa izin menambah
  assert.equal((await ubah(`update pengaturan_kehadiran set toleransi_menit = 3 returning toleransi_menit`))[0].toleransi_menit, 3)
  await ubah(`update pengaturan_kehadiran set toleransi_menit = 2`)
})

test('Arcon: hanya melihat clock-in DS yang dipegangnya, boleh membaca jam shift, tapi tidak bisa mengimpor atau mengubahnya', async () => {
  const arc = (fn) => sebagai('arc@test.local', fn)
  // ARC memegang DS Cihampelas saja (hub lain milik DS yang tidak dipegangnya)
  assert.deepEqual((await arc(() => q(`select distinct hub from kehadiran_bo order by hub`))).map((x) => x.hub), [HUB_C])
  const r = await arc(() => q(`select * from aktual_bo('2026-11-01', '2026-11-30')`))
  assert.deepEqual([...new Set(r.map((x) => x.ds_nama))], [HUB_C])
  assert.ok(r.every((x) => x.ds_id === CIHAM))
  // Super-admin tetap melihat semua hub
  assert.ok((await sebagaiSuper(() => q(`select distinct hub from kehadiran_bo`))).length >= 3)
  // Arcon tanpa DS tidak melihat apa pun
  assert.deepEqual(await sebagai('arc2@test.local', () => q(`select * from kehadiran_bo`)), [])
  assert.deepEqual(await sebagai('arc2@test.local', () => q(`select * from aktual_bo('2026-11-01', '2026-11-30')`)), [])
  // impor tetap khusus Super-admin
  const b = [baris(HUB_C, 'MTR0000005', '2026-11-22', '05:50', 'WIB', '2026-11-21T22:50:00Z')]
  await assert.rejects(arc(() => q(`select impor_kehadiran_bo($1::jsonb) as r`, [JSON.stringify(b)])), /Hanya Super-admin/)
  // jam shift: Arcon boleh membaca, tidak bisa mengubah
  assert.equal((await arc(() => q(`select * from pengaturan_kehadiran`))).length, 1)
  assert.deepEqual(await arc(() => q(`update pengaturan_kehadiran set toleransi_menit = 30 returning id`)), [])
  assert.equal((await q(`select toleransi_menit from pengaturan_kehadiran`))[0].toleransi_menit, 2)
})

test('impor merapikan nama hub di database (spasi ganda dan tepi), jadi CSV dan API tidak membuat DS kembar', async () => {
  const sebelum = (await q(`select count(*)::int as n from ds`))[0].n
  // nama hub yang sama tetapi dengan spasi berlebih: harus jatuh ke DS Cihampelas yang sudah terhubung, bukan DS baru
  const hasil = await impor([baris('  Dark Store Alfagift  -  Cihampelas - Bandung ', 'MTR0000006', '2026-11-22', '05:55', 'WIB', '2026-11-21T22:55:00Z')])
  assert.deepEqual(hasil, { hub: 1, ds_dibuat: 0, ds_dipasang: 0, baris_baru: 1, baris_diperbarui: 0, rider_baru: 0 })
  assert.equal((await q(`select count(*)::int as n from ds`))[0].n, sebelum)
  assert.equal((await q(`select hub from kehadiran_bo where kode_mtr = 'MTR0000006'`))[0].hub, HUB_C) // tersimpan dengan nama yang sudah dirapikan
  // peta pasangan juga dirapikan: kunci dengan spasi berlebih tetap dikenali
  const hubBaru = 'Toko Sapa Alfagift - Peta - Denpasar'
  const r = await impor([baris(hubBaru, 'MTR0000007', '2026-11-22', '05:50', 'WITA', '2026-11-21T21:50:00Z')], { ['  Toko Sapa Alfagift  -  Peta - Denpasar ']: BERSAMA })
  assert.deepEqual(r, { hub: 1, ds_dibuat: 0, ds_dipasang: 1, baris_baru: 1, baris_diperbarui: 0, rider_baru: 0 })
  assert.equal((await q(`select nama from ds where id = '${BERSAMA}'`))[0].nama, hubBaru) // DS Galaxy dipasangkan dan namanya mengikuti BO
})

test('sinkron API (0064): Edge Function (service_role) boleh impor, baris bersumber api, dan catatan sinkron terakhir tersimpan', async () => {
  const b = [baris(HUB_C, 'MTR0000008', '2026-11-24', '06:01', 'WIB', '2026-11-23T23:01:00Z')]
  const sebagaiFungsi = async (fn) => {
    await db.exec(`reset role; select set_config('request.jwt.claims', '{"role":"service_role"}', false)`)
    try { return await fn() } finally { await db.exec(`select set_config('request.jwt.claims', '', false)`) }
  }
  const r = (await sebagaiFungsi(() => q(`select impor_kehadiran_bo($1::jsonb) as r`, [JSON.stringify(b)])))[0].r
  assert.deepEqual(r, { hub: 1, ds_dibuat: 0, ds_dipasang: 0, baris_baru: 1, baris_diperbarui: 0, rider_baru: 0 })
  assert.equal((await q(`select sumber from kehadiran_bo where kode_mtr = 'MTR0000008'`))[0].sumber, 'api')
  // diulang: tidak ganda (tahan jam clock-in yang sama dari tarikan berikutnya)
  const ulang = (await sebagaiFungsi(() => q(`select impor_kehadiran_bo($1::jsonb) as r`, [JSON.stringify(b)])))[0].r
  assert.deepEqual(ulang, { hub: 1, ds_dibuat: 0, ds_dipasang: 0, baris_baru: 0, baris_diperbarui: 0, rider_baru: 0 })
  // pemanggil tanpa jwt Super-admin dan bukan service_role tetap ditolak
  await assert.rejects(sebagai('cap@test.local', () => q(`select impor_kehadiran_bo($1::jsonb) as r`, [JSON.stringify(b)])), /Hanya Super-admin/)
  // catatan sinkron terakhir: diisi Edge Function, dibatasi nilainya, dan terbaca Super-admin
  await q(`update pengaturan_kehadiran set sinkron_terakhir = now(), sinkron_status = 'berhasil', sinkron_pesan = '1 baris' where id = 1`)
  await assert.rejects(q(`update pengaturan_kehadiran set sinkron_status = 'entah' where id = 1`), /check constraint/i)
  assert.equal((await sebagaiSuper(() => q(`select sinkron_status from pengaturan_kehadiran`)))[0].sinkron_status, 'berhasil')
})

test('rider otomatis (0068): mitra yang belum ada di Orca ditambahkan aktif di DS hub clock-in terbarunya, yang sudah ada tidak diubah, tanpa nama dilewati', async () => {
  const r = (hub, kodeMtr, nama, masukWib) => ({ ...baris(hub, kodeMtr, '2026-11-23', '05:50', 'WIB', masukWib), nama })
  const sebelum = (await q(`select count(*)::int as n from riders`))[0].n
  const hasil = await impor([
    r(HUB_C, 'MTR0000501', 'Budi Baru', '2026-11-22T22:50:00Z'),
    r(HUB_L, 'MTR0000502', '  Sari   Dua ', '2026-11-22T22:51:00Z'),
    r(HUB_C, 'MTR0000001', 'Nama Beda', '2026-11-22T22:52:00Z'),          // sudah ada di Orca: tidak diubah
    r(HUB_C, 'MTR0000503', '', '2026-11-22T22:53:00Z'),                   // tanpa nama: dilewati
    r(HUB_C, 'MTR0000504', 'Dua Hub', '2026-11-22T22:54:00Z'),
    r(HUB_L, 'MTR0000504', 'Dua Hub', '2026-11-22T23:30:00Z'),            // clock-in terbaru di Lombok: rider masuk DS itu
  ])
  assert.equal(hasil.rider_baru, 3)
  const baru = await q(`select kode_mtr, nama, status::text as status, peran::text as peran, ds_id from riders where kode_mtr in ('MTR0000501', 'MTR0000502', 'MTR0000503', 'MTR0000504') order by kode_mtr`)
  assert.deepEqual(baru, [
    { kode_mtr: 'MTR0000501', nama: 'Budi Baru', status: 'aktif', peran: 'rider', ds_id: CIHAM },
    { kode_mtr: 'MTR0000502', nama: 'Sari Dua', status: 'aktif', peran: 'rider', ds_id: LOMBOK },
    { kode_mtr: 'MTR0000504', nama: 'Dua Hub', status: 'aktif', peran: 'rider', ds_id: LOMBOK },
  ])
  assert.equal((await q(`select nama from riders where kode_mtr = 'MTR0000001'`))[0].nama, 'Rider Satu')
  assert.equal((await q(`select count(*)::int as n from riders`))[0].n, sebelum + 3)
  // dicatat bergabung sebelum pencatatan (tanggal kosong), bukan rekrutan hari ini
  const ev = await q(`select e.tanggal from rider_peristiwa e join riders r on r.id = e.rider_id where r.kode_mtr = 'MTR0000501' and e.jenis = 'bergabung'`)
  assert.deepEqual(ev, [{ tanggal: null }])
  // diulang (juga dengan kode huruf kecil): tidak menambah dobel
  const ulang = await impor([r(HUB_C, ' mtr0000501 ', 'Budi Baru', '2026-11-22T23:40:00Z')])
  assert.equal(ulang.rider_baru, 0)
  assert.equal((await q(`select count(*)::int as n from riders where upper(kode_mtr) = 'MTR0000501'`))[0].n, 1)
})

test('nomor HP dari BO (0069): hanya mengisi yang kosong, nomor dirapikan, kode huruf kecil dikenali, yang tidak valid dilewati, dan khusus Super-admin atau Edge Function', async () => {
  // rider uji: R1 dan R2 kosong, rider baru P1 punya nomor, P2 nomornya hanya spasi
  await q(`insert into riders (id, kode_mtr, nama, ds_id, peran, status, no_hp) values
    ('${id(301)}', 'MTR0000601', 'HP Satu', '${CIHAM}', 'rider', 'aktif', null),
    ('${id(302)}', 'MTR0000602', 'HP Dua', '${CIHAM}', 'rider', 'aktif', ''),
    ('${id(303)}', 'MTR0000603', 'HP Ada', '${CIHAM}', 'rider', 'aktif', '6281200000001'),
    ('${id(304)}', 'MTR0000604', 'HP Spasi', '${CIHAM}', 'rider', 'aktif', '  '),
    ('${id(305)}', 'MTR0000605', 'HP Salah', '${CIHAM}', 'rider', 'aktif', null),
    ('${id(306)}', 'MTR0000606', 'HP Nonaktif', '${CIHAM}', 'rider', 'nonaktif', null)`)
  const jalan = (baris) => sebagaiSuper(() => q(`select isi_no_hp_bo($1::jsonb) as r`, [JSON.stringify(baris)])).then((x) => x[0].r)
  const hasil = await jalan([
    { kode: 'MTR0000601', hp: '0812-3456-7801' },        // 08... menjadi 62...
    { kode: ' mtr0000602 ', hp: '+62 812 3456 7802' },   // huruf kecil dan spasi di kode, +62 di nomor
    { kode: 'MTR0000603', hp: '081299999999' },          // sudah punya nomor: tidak ditimpa
    { kode: 'MTR0000604', hp: '812345678' },             // 8... menjadi 62...
    { kode: 'MTR0000605', hp: '123' },                   // terlalu pendek: dilewati
    { kode: 'MTR0000606', hp: '081234567806' },          // nonaktif: tetap diisi (data lengkap), bukan kandidat aktif
    { kode: 'MTR0000999', hp: '081234567899' },          // tidak ada di Orca: diabaikan
  ])
  assert.equal(hasil.terisi, 4) // 601, 602, 604, 606
  const nomor = Object.fromEntries((await q(`select kode_mtr, no_hp from riders where kode_mtr like 'MTR000060%' order by kode_mtr`)).map((r) => [r.kode_mtr, r.no_hp]))
  assert.deepEqual(nomor, {
    MTR0000601: '6281234567801', MTR0000602: '6281234567802', MTR0000603: '6281200000001',
    MTR0000604: '62812345678', MTR0000605: null, MTR0000606: '6281234567806',
  })
  // diulang: tidak ada lagi yang kosong untuk diisi
  assert.equal((await jalan([{ kode: 'MTR0000601', hp: '085500000000' }])).terisi, 0)
  assert.equal((await q(`select no_hp from riders where kode_mtr = 'MTR0000601'`))[0].no_hp, '6281234567801')
  // captain ditolak, anon ditolak
  await assert.rejects(sebagai('cap@test.local', () => q(`select isi_no_hp_bo('[]'::jsonb)`)), /Hanya Super-admin/)
  await db.exec('reset role; set role anon')
  await assert.rejects(q(`select isi_no_hp_bo('[]'::jsonb)`), /permission denied/)
  await db.exec('reset role')
  // Edge Function (service_role) boleh
  await db.exec(`reset role; select set_config('request.jwt.claims', '{"role":"service_role"}', false)`)
  try { assert.equal((await q(`select isi_no_hp_bo('[]'::jsonb) as r`))[0].r.terisi, 0) } finally { await db.exec(`select set_config('request.jwt.claims', '', false)`) }})
