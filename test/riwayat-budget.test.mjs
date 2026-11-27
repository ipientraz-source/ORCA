// Uji riwayat budget (migrasi 0076): budget tiap DS tiap hari dipulihkan mundur dari log perubahan, DS baru, kuota khusus, foto harian,
// ringkasan per DS, daftar perubahan, pencatatan lama → baru di simpan_kuota, dan batas akses. Database PGlite.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const [SUPER, CAP, ARC] = [id(1), id(2), id(3)]
const [DSA, DSB, DSC] = [id(101), id(102), id(103)]
const q = async (sql, p) => (await db.query(sql, p)).rows
const hari = (n) => `(today_wib() - ${n})`
// tanggal WIB n hari dari hari ini (negatif = lampau), sebagai YYYY-MM-DD
const tglWib = (n) => new Date(Date.now() + n * 864e5 + 7 * 3600e3).toISOString().slice(0, 10)

const sebagai = async (email, fn) => {
  await db.exec(`reset role; select set_config('request.jwt.claims', '{"email":"${email}"}', false); set role authenticated`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
}
const sebagaiSuper = (fn) => sebagai('super@test.local', fn)
const sebagaiArcon = (fn) => sebagai('arc@test.local', fn)
// catatan perubahan terstruktur n hari lalu pukul 10.00 WIB (seperti yang ditulis trigger riwayat)
const catat = (jenis, ds, n, perubahan, pelaku = SUPER) =>
  q(`insert into log_aktivitas (captain_id, aksi, detail, jenis, tabel, ds_id, perubahan, waktu)
     values ($1, $2, 'uji', $3, 'ds', $4, $5::jsonb, ((today_wib() - $6::int) + time '10:00') at time zone 'Asia/Jakarta')`,
    [pelaku, jenis === 'tambah' ? 'tambah DS' : 'ubah DS', jenis, ds, perubahan ? JSON.stringify(perubahan) : null, n])
const ubah = (ds, n, perubahan) => catat('ubah', ds, n, perubahan)
const k = (kolom, lama, baru) => ({ kolom: 'kuota_' + kolom, lama: String(lama), baru: String(baru) })
const nilai = async (n, ds) => (await q(`select pagi, tengah, siang from budget_harian_dasar(${hari(n)}, ${hari(n)}, null) where ds_id = $1`, [ds]))[0]

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
    insert into ds (id, nama, kuota_pagi, kuota_tengah, kuota_siang) values
      ('${DSA}', 'DS A', 8, 0, 4), ('${DSB}', 'DS B', 5, 0, 3), ('${DSC}', 'DS C', 6, 0, 2);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${SUPER}', null, 'Super', null, 'super_admin', 'super@test.local', 'aktif'),
      ('${CAP}', null, 'Cap', '${DSB}', 'captain', 'cap@test.local', 'aktif'),
      ('${ARC}', null, 'Arcon Satu', null, 'arcon', 'arc@test.local', 'aktif');
    update ds set arcon_id = '${ARC}' where id = '${DSA}';
    delete from log_aktivitas;`) // buang catatan otomatis dari penyiapan: riwayat di bawah diatur sendiri
  // DS A: 12 hari lalu pagi 4→6 dan siang 2→3; 3 hari lalu pagi 6→8 dan siang 3→4
  await ubah(DSA, 12, [k('pagi', 4, 6), k('siang', 2, 3)])
  await ubah(DSA, 3, [k('pagi', 6, 8), k('siang', 3, 4)])
  // DS B: 8 hari lalu pagi 7→5 (penurunan)
  await ubah(DSB, 8, [k('pagi', 7, 5)])
  // DS C: dibuat 5 hari lalu dengan budget 0 (seperti DS dari BO), 4 hari lalu diisi pagi 0→6 dan siang 0→2
  await catat('tambah', DSC, 5, null)
  await ubah(DSC, 4, [k('pagi', 0, 6), k('siang', 0, 2)])
})
after(() => db.close())

test('pemulihan mundur: nilai akhir hari D = nilai lama dari perubahan pertama sesudah D, atau nilai sekarang', async () => {
  // DS A (sekarang 8/0/4)
  assert.deepEqual(await nilai(14, DSA), { pagi: 4, tengah: 0, siang: 2 }) // sebelum perubahan pertama
  assert.deepEqual(await nilai(13, DSA), { pagi: 4, tengah: 0, siang: 2 })
  assert.deepEqual(await nilai(12, DSA), { pagi: 6, tengah: 0, siang: 3 }) // hari perubahan: nilai akhir hari itu
  assert.deepEqual(await nilai(5, DSA), { pagi: 6, tengah: 0, siang: 3 })
  assert.deepEqual(await nilai(3, DSA), { pagi: 8, tengah: 0, siang: 4 })
  assert.deepEqual(await nilai(0, DSA), { pagi: 8, tengah: 0, siang: 4 })
  // DS B turun 7 → 5 pada hari ke-8
  assert.equal((await nilai(9, DSB)).pagi, 7)
  assert.equal((await nilai(8, DSB)).pagi, 5)
  assert.equal((await nilai(1, DSB)).pagi, 5)
})

test('DS baru dihitung mulai hari dibuatnya (budget awal 0 sampai diisi), sebelumnya tidak ada', async () => {
  assert.equal(await nilai(6, DSC), undefined)
  assert.deepEqual(await nilai(5, DSC), { pagi: 0, tengah: 0, siang: 0 })
  assert.deepEqual(await nilai(4, DSC), { pagi: 6, tengah: 0, siang: 2 })
})

test('total harian: dijumlahkan semua DS, jumlah DS berbudget, dan rentang tak valid tidak menghasilkan baris', async () => {
  const t = await sebagaiSuper(() => q(`select * from budget_trend_harian(${hari(14)}, ${hari(0)})`))
  assert.equal(t.length, 15)
  assert.deepEqual([t[0].pagi, t[0].siang, t[0].jml_ds], [4 + 7, 2 + 3, 2]) // 14 hari lalu: A 4/2 + B 7/3, C belum ada
  const h4 = t[14 - 4]
  assert.deepEqual([h4.pagi, h4.siang, h4.jml_ds], [6 + 5 + 6, 3 + 3 + 2, 3]) // 4 hari lalu: A 6/3, B 5/3, C 6/2
  const h5 = t[14 - 5]
  assert.equal(h5.jml_ds, 2) // C dibuat hari itu tetapi budget masih 0: tidak dihitung sebagai DS berbudget
  assert.equal((await sebagaiSuper(() => q(`select * from budget_trend_harian(${hari(500)}, ${hari(0)})`))).length, 0)
})

test('kuota khusus hari itu dan foto harian menang atas hasil pemulihan', async () => {
  await db.exec(`insert into kuota_harian (ds_id, tanggal, kuota_pagi, kuota_siang, kuota_tengah) values ('${DSA}', ${hari(1)}, 20, 9, 0)`)
  await db.exec(`insert into budget_snapshot (tanggal, ds_id, kuota_pagi, kuota_tengah, kuota_siang) values (${hari(2)}, '${DSB}', 99, 0, 77)`)
  assert.deepEqual(await nilai(1, DSA), { pagi: 20, tengah: 0, siang: 9 })
  assert.deepEqual(await nilai(2, DSB), { pagi: 99, tengah: 0, siang: 77 })
  await db.exec(`delete from kuota_harian where ds_id = '${DSA}'; delete from budget_snapshot where ds_id = '${DSB}'`)
  assert.deepEqual(await nilai(1, DSA), { pagi: 8, tengah: 0, siang: 4 })
})

test('ringkasan per DS: awal, akhir, DS baru, dan jumlah perubahan', async () => {
  const r = await sebagaiSuper(() => q(`select * from budget_trend_ds(${hari(14)}, ${hari(0)})`))
  const per = Object.fromEntries(r.map((x) => [x.ds_nama, x]))
  assert.deepEqual([per['DS A'].awal_pagi, per['DS A'].awal_siang, per['DS A'].akhir_pagi, per['DS A'].akhir_siang, per['DS A'].jml_perubahan], [4, 2, 8, 4, 4])
  assert.equal(per['DS A'].lahir, null)
  assert.deepEqual([per['DS B'].awal_pagi, per['DS B'].akhir_pagi, per['DS B'].jml_perubahan], [7, 5, 1]) // turun
  assert.equal(per['DS C'].awal_pagi, null) // belum ada di awal periode
  assert.ok(per['DS C'].lahir)
  assert.deepEqual([per['DS C'].akhir_pagi, per['DS C'].akhir_siang, per['DS C'].jml_perubahan], [6, 2, 2])
})

test('daftar perubahan: nilai lama → baru, pelaku, urut terbaru dulu, dan dibatasi rentang waktu', async () => {
  const p = await sebagaiSuper(() => q(`select * from budget_trend_perubahan(${hari(14)}, ${hari(0)})`))
  assert.equal(p.length, 7)
  assert.ok(p.every((x) => x.oleh === 'Super' && x.jenis === 'bawaan' && x.tanggal === null))
  assert.deepEqual([p[0].ds_nama, p[0].lama < p[0].baru], ['DS A', true]) // yang terbaru: DS A 3 hari lalu, naik
  const b = p.find((x) => x.ds_nama === 'DS B')
  assert.deepEqual([b.shift, b.lama, b.baru], ['pagi', 7, 5])
  assert.equal((await sebagaiSuper(() => q(`select * from budget_trend_perubahan(${hari(2)}, ${hari(0)})`))).length, 0)
})

test('simpan_kuota mencatat nilai lama → baru per hari dan shift, tanpa mengubah teks Activity Log', async () => {
  const besok = tglWib(1), lusa = tglWib(2)
  const rows = (pagi) => JSON.stringify([
    { tanggal: besok, pagi, siang: 4, tengah: 0, cadangan: 0 },
    { tanggal: lusa, pagi: 8, siang: 4, tengah: 0, cadangan: 0 },
  ])
  await sebagaiSuper(() => q(`select simpan_kuota($1, $2::date, $3::date, $4::jsonb)`, [DSA, besok, lusa, rows(10)]))
  let log = (await q(`select detail, perubahan, ds_id from log_aktivitas where aksi = 'ubah kuota' order by waktu desc limit 1`))[0]
  assert.match(log.detail, /^DS A: .* s\/d .*, 1 hari berbeda dari bawaan$/)
  assert.deepEqual(log.perubahan, [{ kolom: 'kuota_pagi', tanggal: besok, lama: '8', baru: '10' }])
  assert.equal(log.ds_id, DSA)
  const p = await sebagaiSuper(() => q(`select * from budget_trend_perubahan(${hari(0)}, ${hari(0)}) where jenis = 'harian'`))
  assert.deepEqual([p.length, p[0].ds_nama, p[0].shift, p[0].lama, p[0].baru], [1, 'DS A', 'pagi', 8, 10])
  assert.equal(p[0].tanggal.toISOString().slice(0, 10), besok) // kolom date dikembalikan PGlite sebagai Date (tengah malam UTC)
  // dikembalikan: lama = kuota khusus yang ada (10), baru = bawaan (8)
  await sebagaiSuper(() => q(`select simpan_kuota($1, $2::date, $3::date, $4::jsonb)`, [DSA, besok, lusa, rows(8)]))
  log = (await q(`select perubahan from log_aktivitas where aksi = 'ubah kuota' order by waktu desc limit 1`))[0]
  assert.deepEqual(log.perubahan, [{ kolom: 'kuota_pagi', tanggal: besok, lama: '10', baru: '8' }])
  // tanpa perubahan: perubahan kosong (null), bukan daftar kosong
  await sebagaiSuper(() => q(`select simpan_kuota($1, $2::date, $3::date, $4::jsonb)`, [DSA, besok, lusa, rows(8)]))
  assert.equal((await q(`select perubahan from log_aktivitas where aksi = 'ubah kuota' order by waktu desc limit 1`))[0].perubahan, null)
})

test('akses: Arcon hanya DS yang dipegang, Captain dan lainnya kosong, anon dan fungsi internal tertutup', async () => {
  const t = await sebagaiArcon(() => q(`select * from budget_trend_harian(${hari(14)}, ${hari(0)})`))
  assert.deepEqual([t[0].pagi, t[0].siang, t[0].jml_ds], [4, 2, 1]) // hanya DS A
  const d = await sebagaiArcon(() => q(`select * from budget_trend_ds(${hari(14)}, ${hari(0)})`))
  assert.deepEqual(d.map((x) => x.ds_nama), ['DS A'])
  const p = await sebagaiArcon(() => q(`select * from budget_trend_perubahan(${hari(14)}, ${hari(0)})`))
  assert.ok(p.length > 0 && p.every((x) => x.ds_nama === 'DS A'))
  // Captain: tidak melihat apa pun
  for (const fn of ['budget_trend_harian', 'budget_trend_ds', 'budget_trend_perubahan'])
    assert.equal((await sebagai('cap@test.local', () => q(`select * from ${fn}(${hari(14)}, ${hari(0)})`))).length, 0)
  // anon ditolak; fungsi internal tidak bisa dipanggil lewat API
  await db.exec(`reset role; set role anon`)
  await assert.rejects(q(`select * from budget_trend_harian(${hari(14)}, ${hari(0)})`), /permission denied/)
  await db.exec(`reset role; set role authenticated`)
  await assert.rejects(q(`select * from budget_harian_dasar(${hari(14)}, ${hari(0)}, null)`), /permission denied/)
  await assert.rejects(q(`select * from budget_perubahan_dasar(${hari(14)}, ${hari(0)}, null)`), /permission denied/)
  await db.exec('reset role')
})
