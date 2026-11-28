// Uji data order klien (migrasi 0079): simpan_order_klien, pencocokan toko lewat kode, aturan angka, unggah ulang + riwayat, hak akses.
// Database PGlite, semua data sintetis (tanpa nama rider).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const S = 'super@test.local', CG = 'cap-a@test.local', AA = 'arcon-a@test.local'
const K1 = id(901), K2 = id(902)
const DS_A = id(101), DS_B = id(102), DS_C = id(103), DS_D = id(104)
const q = async (sql, p) => (await db.query(sql, p)).rows
async function as(email, fn) {
  const claims = JSON.stringify(email ? { email } : {})
  await db.exec(`reset role; select set_config('request.jwt.claims', '${claims}', false); set role ${email ? 'authenticated' : 'anon'}`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
}
const hari = async (n) => (await q(`select (today_wib() - ${n})::text as d`))[0].d
const baris = async (o = {}) => ({ tanggal: await hari(3), kode_toko: 'T001', nama_toko: 'Toko A', kode_mtr: 'MTR001', selesai: '10', ontime: '9', late: '1', pod_sesuai: '8', pod_tidak: '2', ...o })
const simpan = (email, klien, rows, berkas = 'contoh.xlsx') => as(email, async () => (await q('select simpan_order_klien($1, $2::jsonb, $3, $4) as h', [klien, JSON.stringify(rows), berkas, 'abc123']))[0].h)
const semua = () => q('select tanggal::text, ds_id, kode_mtr, selesai, ontime, late, pod_sesuai, pod_tidak from order_klien order by tanggal, ds_id, kode_mtr')

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
    insert into klien (id, nama, target_ketepatan) values ('${K1}', 'Alfagift', 95), ('${K2}', 'Klien Lain', null);
    insert into ds (id, nama, kuota_pagi, kuota_siang, klien_id, kode_toko) values
      ('${DS_A}', 'DS A', 1, 1, '${K1}', 'T001'), ('${DS_B}', 'DS B', 1, 1, '${K1}', 'T002'),
      ('${DS_C}', 'DS C', 1, 1, '${K2}', 'T001'), ('${DS_D}', 'DS D', 1, 1, null, null);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${id(1)}', null, 'Super', null, 'super_admin', '${S}', 'aktif'),
      ('${id(10)}', 'MTR-CA', 'Captain A', '${DS_A}', 'captain', '${CG}', 'aktif'),
      ('${id(30)}', null, 'Arcon A', null, 'arcon', '${AA}', 'aktif');
    update ds set captain_id = '${id(10)}', arcon_id = '${id(30)}' where id = '${DS_A}';`)
})
after(() => db.close())

test('simpan perdana: baris tercatat per toko dan kode mitra, ringkasan benar, kode toko yang sama di klien lain tidak tertukar', async () => {
  const rows = [
    await baris(),
    await baris({ kode_mtr: 'MTR002', selesai: '20', ontime: '20', late: '0', pod_sesuai: '19', pod_tidak: '1' }),
    await baris({ kode_toko: 't002', nama_toko: 'Toko B', kode_mtr: 'mtr003' }), // huruf kecil dinormalkan
  ]
  const h = await simpan(S, K1, rows)
  assert.deepEqual([h.total, h.baru, h.ubah, h.sama, h.tolak, h.lewat], [3, 3, 0, 0, 0, 0])
  const isi = await semua()
  assert.equal(isi.length, 3)
  assert.deepEqual(isi.map((r) => [r.ds_id, r.kode_mtr]).sort(), [[DS_A, 'MTR001'], [DS_A, 'MTR002'], [DS_B, 'MTR003']].sort())
  // klien lain memakai kode T001 untuk DS C: tidak ikut ke DS A
  const h2 = await simpan(S, K2, [await baris({ kode_mtr: 'MTR900' })])
  assert.equal(h2.baru, 1)
  assert.equal((await q(`select count(*)::int as n from order_klien where ds_id = '${DS_C}'`))[0].n, 1)
  assert.equal((await q(`select count(*)::int as n from order_klien where ds_id = '${DS_A}'`))[0].n, 2)
  const u = (await q('select baris_total, baris_baru, berkas, sidik, oleh from unggahan_klien where klien_id = $1', [K1]))[0]
  assert.deepEqual([u.baris_total, u.baris_baru, u.berkas, u.sidik, u.oleh], [3, 3, 'contoh.xlsx', 'abc123', S])
})

test('toko yang kodenya belum terpasang dilewati dan dilaporkan, tidak disimpan', async () => {
  const sebelum = (await semua()).length
  const h = await simpan(S, K1, [
    await baris({ kode_toko: 'T777', nama_toko: 'Toko Baru', kode_mtr: 'MTR010' }),
    await baris({ kode_toko: 'T777', nama_toko: 'Toko Baru', kode_mtr: 'MTR011' }),
    await baris({ kode_toko: 'T001', kode_mtr: 'MTR012' }),
  ])
  assert.deepEqual([h.baru, h.lewat], [1, 2])
  assert.deepEqual(h.toko_dilewati, [{ kode_toko: 'T777', nama_toko: 'Toko Baru', baris: 2 }])
  assert.equal((await semua()).length, sebelum + 1)
  // DS yang belum dihubungkan ke klien mana pun tidak pernah menerima data
  assert.equal((await q(`select count(*)::int as n from order_klien where ds_id = '${DS_D}'`))[0].n, 0)
})

test('aturan angka dan tanggal diperiksa di database, tiap baris ditolak dengan alasan yang jelas', async () => {
  const sebelum = (await semua()).length
  const h = await simpan(S, K1, [
    await baris({ baris: '2', kode_mtr: 'X1', ontime: '5' }), // 5 + 1 <> 10
    await baris({ baris: '3', kode_mtr: 'X2', pod_sesuai: '1' }), // 1 + 2 <> 10
    await baris({ baris: '4', kode_mtr: 'X3', tanggal: '2026-02-31' }),
    await baris({ baris: '5', kode_mtr: 'X4', tanggal: await hari(-2) }), // masa depan
    await baris({ baris: '6', kode_mtr: 'X5', tanggal: await hari(500) }), // terlalu lama
    await baris({ baris: '7', kode_mtr: 'X6', selesai: '-3' }),
    await baris({ baris: '8', kode_mtr: 'X7', selesai: '1.5' }),
    await baris({ baris: '9', kode_mtr: '' }),
    await baris({ baris: '10', kode_toko: '' }),
    await baris({ baris: '11', kode_mtr: 'X8', selesai: '1000', ontime: '1000', late: '0', pod_sesuai: '1000', pod_tidak: '0' }),
    await baris({ baris: '12', kode_mtr: 'X9', selesai: '0', ontime: '0', late: '0', pod_sesuai: '0', pod_tidak: '0' }), // nol itu sah
  ])
  assert.deepEqual([h.tolak, h.baru], [10, 1])
  const alasan = Object.fromEntries(h.ditolak.map((x) => [x.baris, x.alasan]))
  assert.match(alasan[2], /Ontime \+ Late/)
  assert.match(alasan[3], /POD sesuai/)
  assert.match(alasan[4], /Tanggal tidak valid/)
  assert.match(alasan[5], /masa depan/)
  assert.match(alasan[6], /400 hari/)
  assert.match(alasan[7], /Angka tidak valid/)
  assert.match(alasan[8], /Angka tidak valid/)
  assert.match(alasan[9], /Kode mitra kosong/)
  assert.match(alasan[10], /Kode toko kosong/)
  assert.match(alasan[11], /lebih dari 999/)
  assert.equal((await semua()).length, sebelum + 1)
})

test('baris kembar dalam satu file: yang pertama dipakai, sisanya ditolak', async () => {
  const t = await hari(7)
  const h = await simpan(S, K1, [
    await baris({ tanggal: t, kode_mtr: 'KEMBAR', selesai: '4', ontime: '4', late: '0', pod_sesuai: '4', pod_tidak: '0' }),
    await baris({ tanggal: t, kode_mtr: 'KEMBAR', selesai: '9', ontime: '9', late: '0', pod_sesuai: '9', pod_tidak: '0' }),
  ])
  assert.deepEqual([h.baru, h.tolak], [1, 1])
  assert.match(h.ditolak[0].alasan, /kembar/)
  assert.equal((await q(`select selesai from order_klien where kode_mtr = 'KEMBAR'`))[0].selesai, 4)
})

test('unggah ulang: sama tidak berubah, nilai beda ditimpa dan nilai lama masuk riwayat', async () => {
  const t = await hari(9)
  const awal = await baris({ tanggal: t, kode_mtr: 'ULANG', selesai: '10', ontime: '9', late: '1', pod_sesuai: '8', pod_tidak: '2' })
  assert.equal((await simpan(S, K1, [awal])).baru, 1)
  const sama = await simpan(S, K1, [awal])
  assert.deepEqual([sama.baru, sama.ubah, sama.sama], [0, 0, 1])
  assert.equal((await q(`select count(*)::int as n from order_klien_riwayat where kode_mtr = 'ULANG'`))[0].n, 0)
  const koreksi = { ...awal, selesai: '12', ontime: '12', late: '0', pod_sesuai: '12', pod_tidak: '0' }
  const h = await simpan(S, K1, [koreksi])
  assert.deepEqual([h.baru, h.ubah, h.sama], [0, 1, 0])
  const kini = (await q(`select selesai, ontime, unggahan_id from order_klien where kode_mtr = 'ULANG'`))[0]
  assert.deepEqual([kini.selesai, kini.ontime, kini.unggahan_id], [12, 12, h.unggahan])
  const lama = await q(`select selesai_lama, ontime_lama, late_lama, pod_sesuai_lama, pod_tidak_lama, unggahan_id from order_klien_riwayat where kode_mtr = 'ULANG'`)
  assert.deepEqual(lama, [{ selesai_lama: 10, ontime_lama: 9, late_lama: 1, pod_sesuai_lama: 8, pod_tidak_lama: 2, unggahan_id: h.unggahan }])
})

test('bentuk data salah ditolak seluruhnya dan tidak meninggalkan jejak unggahan', async () => {
  const n = (await q('select count(*)::int as n from unggahan_klien'))[0].n
  const panggil = (klien, json) => as(S, () => q('select simpan_order_klien($1, $2::jsonb)', [klien, json]))
  await assert.rejects(panggil(K1, '[]'), /Tidak ada baris/)
  await assert.rejects(panggil(K1, '{"a":1}'), /daftar baris/)
  await assert.rejects(panggil(K1, '[1,2]'), /berupa objek/)
  await assert.rejects(panggil(id(999), '[{}]'), /Klien tidak ditemukan/)
  assert.equal((await q('select count(*)::int as n from unggahan_klien'))[0].n, n)
})

test('hak akses: hanya Super-admin yang boleh menulis dan membaca; Captain, Arcon, dan anon tidak', async () => {
  const rows = [await baris({ kode_mtr: 'GELAP' })]
  for (const e of [CG, AA]) await assert.rejects(simpan(e, K1, rows), /Hanya Super-admin/)
  await assert.rejects(simpan(null, K1, rows), /permission denied/)
  for (const e of [CG, AA]) {
    for (const t of ['order_klien', 'order_klien_riwayat', 'unggahan_klien', 'klien']) {
      assert.equal((await as(e, () => q(`select count(*)::int as n from ${t}`)))[0].n, 0, `${e} melihat ${t}`)
    }
    // tidak ada kebijakan tulis langsung pada tabel data
    await assert.rejects(as(e, () => q(`insert into order_klien (tanggal, ds_id, kode_mtr, selesai, ontime, late, pod_sesuai, pod_tidak) values (current_date, '${DS_A}', 'X', 0, 0, 0, 0, 0)`)), /row-level security/)
  }
  assert.ok((await as(S, () => q('select count(*)::int as n from order_klien')))[0].n > 0)
  assert.equal((await q(`select count(*)::int as n from order_klien where kode_mtr = 'GELAP'`))[0].n, 0)
})

test('Arcon boleh mengubah kuota DS-nya tetapi tidak boleh mengalihkan klien atau mengganti kode toko; Super-admin boleh, dan kode unik per klien', async () => {
  await as(AA, () => q(`update ds set kuota_pagi = 3 where id = '${DS_A}'`))
  assert.equal((await q(`select kuota_pagi from ds where id = '${DS_A}'`))[0].kuota_pagi, 3)
  await assert.rejects(as(AA, () => q(`update ds set kode_toko = 'T999' where id = '${DS_A}'`)), /Arcon hanya boleh/)
  await assert.rejects(as(AA, () => q(`update ds set klien_id = '${K2}' where id = '${DS_A}'`)), /Arcon hanya boleh/)
  await as(S, () => q(`update ds set kode_toko = 'T050', klien_id = '${K1}' where id = '${DS_D}'`))
  assert.deepEqual((await q(`select klien_id, kode_toko from ds where id = '${DS_D}'`))[0], { klien_id: K1, kode_toko: 'T050' })
  // kode toko dobel dalam klien yang sama ditolak; format kode wajib huruf besar tanpa spasi pinggir
  await assert.rejects(q(`update ds set kode_toko = 'T001' where id = '${DS_D}'`), /ds_kode_toko_uq|duplicate/)
  await assert.rejects(q(`update ds set kode_toko = 't050' where id = '${DS_D}'`), /check/)
})

test('unggahan sebesar file klien sungguhan (6.000 baris) selesai dalam satu panggilan dan unggah ulangnya tidak mengubah apa pun', async () => {
  const t = await hari(20)
  const rows = []
  for (let i = 0; i < 6000; i++) rows.push({ tanggal: t, kode_toko: i % 2 ? 'T001' : 'T002', kode_mtr: 'BESAR' + i, selesai: '10', ontime: '9', late: '1', pod_sesuai: '8', pod_tidak: '2' })
  const mulai = Date.now()
  const h = await simpan(S, K1, rows)
  assert.deepEqual([h.total, h.baru, h.tolak, h.lewat], [6000, 6000, 0, 0])
  assert.ok(Date.now() - mulai < 20000, 'terlalu lambat')
  const ulang = await simpan(S, K1, rows)
  assert.deepEqual([ulang.baru, ulang.ubah, ulang.sama], [0, 0, 6000])
})

test('tidak ada kolom nama rider di tabel data klien (privasi)', async () => {
  const kolom = await q(`select table_name, column_name from information_schema.columns where table_name in ('order_klien', 'order_klien_riwayat', 'unggahan_klien')`)
  assert.deepEqual(kolom.filter((k) => /nama|nik|hp|email/.test(k.column_name)), [])
})
