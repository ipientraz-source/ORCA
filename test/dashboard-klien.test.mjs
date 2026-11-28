// Uji bahan Dashboard Klien (migrasi 0080): total per hari dan per toko, rentang data, penyaringan toko, batas klien, dan hak akses. Data sintetis di PGlite.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const S = 'super@test.local', CG = 'cap-a@test.local', AA = 'arcon-a@test.local'
const K1 = id(901), K2 = id(902), K3 = id(903)
const DS_A = id(101), DS_B = id(102), DS_C = id(103)
const q = async (sql, p) => (await db.query(sql, p)).rows
async function as(email, fn) {
  const claims = JSON.stringify(email ? { email } : {})
  await db.exec(`reset role; select set_config('request.jwt.claims', '${claims}', false); set role ${email ? 'authenticated' : 'anon'}`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
}
const num = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v instanceof Date ? v.toISOString().slice(0, 10) : v])))
const D = (n) => `(today_wib() - ${n})`
const tgl = async (n) => (await q(`select ${D(n)}::text as t`))[0].t
const panggil = (email, fn, args) => as(email, async () => num(await q(`select * from ${fn}(${args})`)))
const harian = (email, klien, dari, sampai, ds = 'null') => panggil(email, 'dashboard_klien_harian', `'${klien}', ${D(dari)}, ${D(sampai)}, ${ds}`)

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
    insert into klien (id, nama) values ('${K1}', 'Klien Satu'), ('${K2}', 'Klien Dua'), ('${K3}', 'Klien Kosong');
    insert into ds (id, nama, kuota_pagi, kuota_siang, klien_id, kode_toko) values
      ('${DS_A}', 'DS A', 2, 2, '${K1}', 'T001'), ('${DS_B}', 'DS B', 1, 1, '${K1}', 'T002'), ('${DS_C}', 'DS C', 4, 4, '${K2}', 'T001');
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${id(1)}', null, 'Super', null, 'super_admin', '${S}', 'aktif'),
      ('${id(10)}', 'MTR-CA', 'Captain A', '${DS_A}', 'captain', '${CG}', 'aktif'),
      ('${id(30)}', null, 'Arcon A', null, 'arcon', '${AA}', 'aktif');
    update ds set captain_id = '${id(10)}', arcon_id = '${id(30)}' where id = '${DS_A}';
    insert into order_klien (tanggal, ds_id, kode_mtr, selesai, ontime, late, pod_sesuai, pod_tidak) values
      (${D(3)}, '${DS_A}', 'M1', 10, 9, 1, 8, 2),
      (${D(3)}, '${DS_A}', 'M2', 20, 20, 0, 19, 1),
      (${D(2)}, '${DS_A}', 'M1', 10, 10, 0, 10, 0),
      (${D(3)}, '${DS_B}', 'M3', 5, 4, 1, 5, 0),
      (${D(3)}, '${DS_C}', 'M9', 100, 50, 50, 50, 50);
    -- clock-in BO sintetis supaya aktual_bo menghitung ketiga DS hari itu (tanpa jadwal: shift dari jam masuk)
    insert into kehadiran_bo (hub, ds_id, kode_mtr, tanggal, masuk_lokal, zona, masuk_wib) values
      ('hub-a', '${DS_A}', 'M1', ${D(3)}, '06:00', 'WIB', (${D(3)})::timestamp + time '06:00'),
      ('hub-a', '${DS_A}', 'M2', ${D(3)}, '06:30', 'WIB', (${D(3)})::timestamp + time '06:30'),
      ('hub-b', '${DS_B}', 'M3', ${D(3)}, '15:30', 'WIB', (${D(3)})::timestamp + time '15:30'),
      ('hub-c', '${DS_C}', 'M9', ${D(3)}, '06:00', 'WIB', (${D(3)})::timestamp + time '06:00');`)
})
after(() => db.close())

test('total per hari hanya menghitung toko milik klien itu; hari tanpa unggahan tidak muncul', async () => {
  assert.deepEqual(await harian(S, K1, 5, 0), [
    { tanggal: await tgl(3), selesai: 35, ontime: 33, late: 2, pod_sesuai: 32, pod_tidak: 3, rider_hari: 3 },
    { tanggal: await tgl(2), selesai: 10, ontime: 10, late: 0, pod_sesuai: 10, pod_tidak: 0, rider_hari: 1 },
  ])
  const k2 = await harian(S, K2, 5, 0)
  assert.deepEqual([k2.length, k2[0].selesai, k2[0].rider_hari], [1, 100, 1]) // data Klien Dua tidak bercampur
  assert.deepEqual(await harian(S, K3, 5, 0), [])
})

test('rentang di luar data atau lebih dari 400 hari menghasilkan kosong; batas tanggal dihormati', async () => {
  assert.deepEqual(await harian(S, K1, 1, 0), []) // hari ini dan kemarin: belum ada unggahan
  assert.equal((await harian(S, K1, 3, 3)).length, 1)
  assert.deepEqual(await harian(S, K1, 500, 0), [])
  assert.deepEqual(await harian(S, K1, 0, 3), []) // terbalik
})

test('total per toko, dengan penyaringan toko; toko klien lain tidak bisa diselipkan lewat p_ds', async () => {
  const semua = await panggil(S, 'dashboard_klien_toko', `'${K1}', ${D(5)}, ${D(0)}, null`)
  assert.deepEqual(semua.map((t) => [t.ds_nama, t.kode_toko, t.selesai, t.rider_hari, t.hari]), [['DS A', 'T001', 40, 3, 2], ['DS B', 'T002', 5, 1, 1]])
  const satu = await panggil(S, 'dashboard_klien_toko', `'${K1}', ${D(5)}, ${D(0)}, array['${DS_B}']::uuid[]`)
  assert.deepEqual(satu.map((t) => t.ds_nama), ['DS B'])
  assert.deepEqual(await panggil(S, 'dashboard_klien_toko', `'${K1}', ${D(5)}, ${D(0)}, array['${DS_C}']::uuid[]`), [])
  assert.deepEqual(await harian(S, K1, 5, 0, `array['${DS_C}']::uuid[]`), [])
  assert.equal((await harian(S, K1, 5, 0, `array['${DS_B}']::uuid[]`))[0].selesai, 5)
})

test('rentang data klien: awal, akhir, jumlah hari berdata; kosong bila belum ada unggahan', async () => {
  const r = await panggil(S, 'dashboard_klien_rentang', `'${K1}'`)
  assert.equal(r.length, 1)
  assert.deepEqual([r[0].awal, r[0].akhir, r[0].hari], [await tgl(3), await tgl(2), 2])
  assert.deepEqual(await panggil(S, 'dashboard_klien_rentang', `'${K3}'`), [])
})

test('angka Dash (clock-in BO) sama dengan aktual_bo, hanya untuk toko klien itu', async () => {
  const oracle = async (dsIds) => num(await q(`select sum(kebutuhan) as kebutuhan, sum(terpenuhi) as terpenuhi, sum(hadir) as hadir, sum(tepat) as tepat from aktual_bo(${D(3)}, ${D(3)}) where ds_id = any(array[${dsIds.map((d) => `'${d}'`).join(',')}]::uuid[])`))
  const bo = (klien) => panggil(S, 'dashboard_klien_bo', `'${klien}', ${D(3)}, ${D(3)}, null`)
  const k1 = await bo(K1), k2 = await bo(K2)
  assert.equal(k1.length, 1)
  const ambil = (r) => ({ kebutuhan: r.kebutuhan, terpenuhi: r.terpenuhi, hadir: r.hadir, tepat: r.tepat })
  assert.deepEqual(ambil(k1[0]), (await as(S, () => oracle([DS_A, DS_B])))[0])
  assert.deepEqual(ambil(k2[0]), (await as(S, () => oracle([DS_C])))[0])
  assert.ok(k1[0].kebutuhan > 0 && k2[0].kebutuhan > 0 && k1[0].kebutuhan !== k2[0].kebutuhan)
})

test('hak akses: Captain dan Arcon tidak mendapat apa pun, anon ditolak', async () => {
  for (const e of [CG, AA]) {
    assert.deepEqual(await harian(e, K1, 5, 0), [])
    assert.deepEqual(await panggil(e, 'dashboard_klien_toko', `'${K1}', ${D(5)}, ${D(0)}, null`), [])
    assert.deepEqual(await panggil(e, 'dashboard_klien_rentang', `'${K1}'`), [])
    assert.deepEqual(await panggil(e, 'dashboard_klien_bo', `'${K1}', ${D(3)}, ${D(3)}, null`), [])
  }
  await assert.rejects(as(null, () => q(`select * from dashboard_klien_rentang('${K1}')`)), /permission denied/)
})

// ───────── detail order (migrasi 0081) ─────────
const detail = (email, fn, args) => panggil(email, fn, args)
const rider = (klien, dari, sampai, { ds = 'null', cari = 'null', limit = 50, offset = 0 } = {}) =>
  detail(email0, 'dashboard_klien_detail_rider', `'${klien}', ${D(dari)}, ${D(sampai)}, ${ds}, ${cari}, ${limit}, ${offset}`)
const email0 = S

test('detail per rider: urut tanggal terbaru, total seluruh baris di tiap halaman, dan paginasi tidak menggandakan atau melewatkan baris', async () => {
  const semua = await rider(K1, 5, 0)
  assert.deepEqual(semua.map((r) => [r.tanggal, r.ds_nama, r.kode_mtr, r.selesai]), [
    [await tgl(2), 'DS A', 'M1', 10],
    [await tgl(3), 'DS A', 'M1', 10],
    [await tgl(3), 'DS A', 'M2', 20],
    [await tgl(3), 'DS B', 'M3', 5],
  ])
  assert.ok(semua.every((r) => r.total === 4))
  const h1 = await rider(K1, 5, 0, { limit: 3, offset: 0 }), h2 = await rider(K1, 5, 0, { limit: 3, offset: 3 })
  assert.deepEqual([h1.length, h2.length, h1[0].total, h2[0].total], [3, 1, 4, 4])
  assert.deepEqual([...h1, ...h2].map((r) => r.kode_mtr + r.tanggal), semua.map((r) => r.kode_mtr + r.tanggal))
  assert.deepEqual(await rider(K1, 5, 0, { offset: 10 }), [])
  assert.equal((await rider(K1, 5, 0, { limit: 0 })).length, 1) // batas bawah 1
  assert.equal((await rider(K1, 5, 0, { limit: 99999 })).length, 4) // batas atas 200
})

test('detail per rider: cari kode mitra (huruf besar-kecil tak berpengaruh, karakter khusus bukan pola), saring toko, dan data klien lain tidak bercampur', async () => {
  assert.deepEqual((await rider(K1, 5, 0, { cari: `'m1'` })).map((r) => r.kode_mtr), ['M1', 'M1'])
  assert.deepEqual((await rider(K1, 5, 0, { cari: `'  m3 '` })).map((r) => r.kode_mtr), ['M3'])
  assert.deepEqual(await rider(K1, 5, 0, { cari: `'%'` }), []) // % bukan "semua"
  assert.deepEqual(await rider(K1, 5, 0, { cari: `'_'` }), [])
  assert.equal((await rider(K1, 5, 0, { cari: `''` })).length, 4)
  assert.deepEqual((await rider(K1, 5, 0, { ds: `array['${DS_B}']::uuid[]` })).map((r) => r.kode_mtr), ['M3'])
  assert.deepEqual(await rider(K1, 5, 0, { ds: `array['${DS_C}']::uuid[]` }), [])
  assert.deepEqual((await rider(K2, 5, 0)).map((r) => r.kode_mtr), ['M9'])
  assert.deepEqual(await rider(K1, 500, 0), []) // lebih dari 400 hari
})

test('detail per hari: satu baris per tanggal dan toko, dengan jumlah rider, total, dan paginasi', async () => {
  const h = (limit, offset) => panggil(S, 'dashboard_klien_detail_hari', `'${K1}', ${D(5)}, ${D(0)}, null, ${limit}, ${offset}`)
  const semua = await h(50, 0)
  assert.deepEqual(semua.map((r) => [r.tanggal, r.ds_nama, r.selesai, r.rider, r.total]), [
    [await tgl(2), 'DS A', 10, 1, 3], [await tgl(3), 'DS A', 30, 2, 3], [await tgl(3), 'DS B', 5, 1, 3],
  ])
  assert.deepEqual((await h(2, 2)).map((r) => r.ds_nama), ['DS B'])
})

test('detail order: Captain, Arcon, dan anon tidak mendapat apa pun', async () => {
  for (const e of [CG, AA]) {
    assert.deepEqual(await panggil(e, 'dashboard_klien_detail_rider', `'${K1}', ${D(5)}, ${D(0)}, null, null, 50, 0`), [])
    assert.deepEqual(await panggil(e, 'dashboard_klien_detail_hari', `'${K1}', ${D(5)}, ${D(0)}, null, 50, 0`), [])
  }
  await assert.rejects(as(null, () => q(`select * from dashboard_klien_detail_hari('${K1}', ${D(5)}, ${D(0)})`)), /permission denied/)
})
