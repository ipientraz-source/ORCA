// Uji akun klien (migrasi 0082): identitas terpisah dari riders, ISOLASI (klien tidak boleh melihat apa pun selain datanya),
// fungsi baca bagi klien, unggah mandiri dengan kunci koreksi dan penahanan perubahan besar, dan keputusan Super-admin. Data sintetis di PGlite.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const S = 'super@test.local', CG = 'cap-a@test.local', AA = 'arcon-a@test.local'
const KL1 = 'klien1@test.local', KL2 = 'klien2@test.local', KOFF = 'off@test.local'
const K1 = id(901), K2 = id(902)
const DS_A = id(101), DS_B = id(102), DS_C = id(103), DS_X = id(104)
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
const baris = async (o = {}) => ({ tanggal: await tgl(3), kode_toko: 'T001', nama_toko: 'Toko A', kode_mtr: 'M1', selesai: '10', ontime: '9', late: '1', pod_sesuai: '8', pod_tidak: '2', ...o })
const angka = (sel, lt = 0) => ({ selesai: String(sel), ontime: String(sel - lt), late: String(lt), pod_sesuai: String(sel), pod_tidak: '0' })
const simpan = (email, klien, rows) => as(email, async () => (await q('select simpan_order_klien($1, $2::jsonb, $3, $4) as h', [klien, JSON.stringify(rows), 'x.csv', 'abc']))[0].h)
const nilai = async (kode, hari) => (await q(`select selesai from order_klien where kode_mtr = $1 and tanggal = ${D(hari)}`, [kode]))[0]?.selesai

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
    insert into klien (id, nama, target_ketepatan) values ('${K1}', 'Klien Satu', 95), ('${K2}', 'Klien Dua', null);
    insert into ds (id, nama, kuota_pagi, kuota_siang, klien_id, kode_toko) values
      ('${DS_A}', 'DS A', 2, 2, '${K1}', 'T001'), ('${DS_B}', 'DS B', 1, 1, '${K1}', 'T002'),
      ('${DS_C}', 'DS C', 4, 4, '${K2}', 'T001'), ('${DS_X}', 'DS X', 1, 1, null, null);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${id(1)}', null, 'Super', null, 'super_admin', '${S}', 'aktif'),
      ('${id(10)}', 'MTR-CA', 'Captain A', '${DS_A}', 'captain', '${CG}', 'aktif'),
      ('${id(30)}', null, 'Arcon A', null, 'arcon', '${AA}', 'aktif'),
      ('${id(40)}', 'MTR040', 'Rider Satu', '${DS_A}', 'rider', null, 'aktif');
    update ds set captain_id = '${id(10)}', arcon_id = '${id(30)}' where id = '${DS_A}';
    insert into akun_klien (email, klien_id, nama, aktif) values
      ('${KL1}', '${K1}', 'Tim Satu', true), ('${KL2}', '${K2}', 'Tim Dua', true), ('${KOFF}', '${K1}', 'Tim Off', false);
    insert into order_klien (tanggal, ds_id, kode_mtr, selesai, ontime, late, pod_sesuai, pod_tidak) values
      (${D(3)}, '${DS_A}', 'M1', 10, 9, 1, 8, 2), (${D(3)}, '${DS_A}', 'M2', 20, 20, 0, 19, 1),
      (${D(3)}, '${DS_B}', 'M3', 5, 4, 1, 5, 0), (${D(3)}, '${DS_C}', 'M9', 100, 50, 50, 50, 50);
    -- data internal supaya uji isolasi bermakna (klien tidak boleh melihat satu baris pun)
    insert into jadwal (tanggal, rider_id, shift, ds_id) values (${D(1)}, '${id(40)}', 'pagi', '${DS_A}');
    insert into kehadiran_bo (hub, ds_id, kode_mtr, tanggal, masuk_lokal, zona, masuk_wib) values
      ('hub-a', '${DS_A}', 'MTR040', ${D(1)}, '06:00', 'WIB', (${D(1)})::timestamp + time '06:00'),
      ('hub-b', '${DS_B}', 'MTR041', ${D(1)}, '15:30', 'WIB', (${D(1)})::timestamp + time '15:30'),
      ('hub-c', '${DS_C}', 'MTR042', ${D(1)}, '06:00', 'WIB', (${D(1)})::timestamp + time '06:00');`)
})
after(() => db.close())

test('akun klien: email dinormalkan, unik, dan tidak boleh sama dengan orang di riders (dua arah); klien tidak bisa mengubah akunnya', async () => {
  await q(`insert into akun_klien (email, klien_id, nama) values ('  Klien3@Test.LOCAL ', '${K1}', 'Tim Tiga')`)
  assert.equal((await q(`select email from akun_klien where nama = 'Tim Tiga'`))[0].email, 'klien3@test.local')
  await assert.rejects(q(`insert into akun_klien (email, klien_id) values ('klien3@test.local', '${K2}')`), /duplicate|unique/i)
  await assert.rejects(q(`insert into akun_klien (email, klien_id) values ('${CG}', '${K1}')`), /sudah dipakai orang di ORCA/)
  await assert.rejects(q(`insert into akun_klien (email, klien_id) values ('bukan-email', '${K1}')`), /check/i)
  await assert.rejects(q(`insert into riders (nama, peran, email) values ('Arcon Baru', 'arcon', '${KL1}')`), /sudah dipakai akun klien/)
  await assert.rejects(q(`update riders set email = upper('${KL2}') where id = '${id(30)}'`), /sudah dipakai akun klien/)
  // klien: tidak ada hak tulis pada akun (insert ditolak, update tidak mengenai baris mana pun)
  await assert.rejects(as(KL1, () => q(`insert into akun_klien (email, klien_id) values ('x@test.local', '${K1}')`)), /row-level security/)
  await as(KL1, () => q(`update akun_klien set klien_id = '${K2}', aktif = true where email = '${KL1}'`))
  assert.equal((await q(`select klien_id from akun_klien where email = '${KL1}'`))[0].klien_id, K1)
  // Super-admin boleh; Captain dan Arcon tidak melihat daftar akun
  assert.equal((await as(S, () => q('select count(*)::int as n from akun_klien')))[0].n >= 4, true)
  for (const e of [CG, AA]) assert.equal((await as(e, () => q('select count(*)::int as n from akun_klien')))[0].n, 0)
  assert.deepEqual((await as(KL1, () => q('select email from akun_klien'))).map((r) => r.email), [KL1]) // klien hanya melihat akunnya sendiri
})

test('klien_saya: klien aktif mendapat kliennya; akun nonaktif, Captain, Super-admin, dan anon tidak', async () => {
  const saya = (e) => as(e, async () => (await q('select klien_saya() as k'))[0].k)
  assert.equal(await saya(KL1), K1)
  assert.equal(await saya(KL2), K2)
  for (const e of [KOFF, CG, AA, S]) assert.equal(await saya(e), null, e)
  await assert.rejects(as(null, () => q('select klien_saya()')), /permission denied/)
})

test('ISOLASI: klien tidak melihat satu baris pun di tabel mana pun selain datanya sendiri; tiap tabel berpengaman baris (RLS)', async () => {
  const tabel = (await q(`select c.relname as t, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`))
  const tanpaRls = tabel.filter((x) => !x.rls).map((x) => x.t)
  assert.deepEqual(tanpaRls, [], `tabel tanpa RLS: ${tanpaRls.join(', ')}`)
  // yang diizinkan terbaca klien Satu dan jumlah barisnya: akunnya, kliennya, order DS-nya (DS A dan B), unggahan miliknya
  const boleh = { akun_klien: 1, klien: 1, order_klien: 3, unggahan_klien: 0 }
  const bocor = []
  for (const { t } of tabel) {
    const ada = (await q(`select count(*)::int as n from ${t}`))[0].n
    const lihat = (await as(KL1, () => q(`select count(*)::int as n from ${t}`)))[0].n
    const harus = t in boleh ? boleh[t] : 0
    if (lihat !== harus) bocor.push(`${t}: klien melihat ${lihat} dari ${ada}, seharusnya ${harus}`)
  }
  assert.deepEqual(bocor, [])
  // akun klien nonaktif tidak melihat apa pun, termasuk datanya sendiri
  for (const { t } of tabel) {
    const n = (await as(KOFF, () => q(`select count(*)::int as n from ${t}`)))[0].n
    assert.equal(t === 'akun_klien' ? 1 : 0, n, `${t} untuk akun nonaktif`)
  }
})

test('ISOLASI fungsi: fungsi definer yang hanya bisa dipanggil setelah login harus memeriksa identitas (langsung atau lewat fungsi pemeriksa)', async () => {
  const semua = await q(`select p.proname, p.prosrc, p.prorettype::regtype::text as ret,
                                has_function_privilege('authenticated', p.oid, 'execute') as login, has_function_privilege('anon', p.oid, 'execute') as anon
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef order by 1`)
  const periksa = /is_super|my_peran|\bme\(\)|is_admin|my_ds|klien_saya|ds_klien_saya|auth\.jwt|boleh_/i
  const langsung = new Set(semua.filter((x) => periksa.test(x.prosrc)).map((x) => x.proname)) // fungsi pemeriksa, termasuk yang dicabut dari pengguna login
  const lewatPemeriksa = (x) => [...langsung].some((n) => n !== x.proname && new RegExp(`\\b${n}\\s*\\(`).test(x.prosrc))
  // Dikecualikan dengan alasan: fungsi pemicu tidak bisa dipanggil lewat API; yang bisa dipanggil tanpa login (anon) memang publik untuk aplikasi rider
  // (kode MTR sebagai kunci), jadi klien tidak mendapat apa pun yang tidak dimiliki pengunjung biasa.
  const dikecualikan = { kpi_valid_sejak: 'hanya mengembalikan satu tanggal awal data peristiwa' }
  const terbuka = semua.filter((x) => x.login && !x.anon && x.ret !== 'trigger' && !periksa.test(x.prosrc) && !lewatPemeriksa(x) && !(x.proname in dikecualikan)).map((x) => x.proname)
  assert.deepEqual(terbuka, [], `fungsi definer tanpa pemeriksaan identitas: ${terbuka.join(', ')}`)
})

test('fungsi baca untuk klien: hanya kliennya, hanya tokonya; p_klien atau p_ds milik klien lain menghasilkan kosong', async () => {
  const harian = (e, k, ds = 'null') => panggil(e, 'dashboard_klien_harian', `'${k}', ${D(5)}, ${D(0)}, ${ds}`)
  const a = await harian(KL1, K1)
  assert.deepEqual([a.length, a[0].selesai, a[0].rider_hari], [1, 35, 3]) // DS A (M1+M2) dan DS B (M3)
  assert.deepEqual(await harian(KL1, K2), []) // klien lain
  assert.deepEqual(await harian(KL1, K1, `array['${DS_C}']::uuid[]`), []) // DS klien lain lewat p_ds
  assert.equal((await harian(KL1, K1, `array['${DS_B}']::uuid[]`))[0].selesai, 5)
  assert.equal((await harian(KL2, K2))[0].selesai, 100)
  assert.deepEqual(await harian(KOFF, K1), [])
  const toko = (e, k) => panggil(e, 'toko_klien', `'${k}'`)
  assert.deepEqual((await toko(KL1, K1)).map((t) => [t.nama, t.kode_toko]), [['DS A', 'T001'], ['DS B', 'T002']])
  assert.deepEqual(await toko(KL1, K2), [])
  assert.deepEqual(await toko(KOFF, K1), [])
  assert.deepEqual((await toko(AA, K1)).map((t) => t.nama), ['DS A']) // Arcon A hanya DS A
  assert.deepEqual(await toko(CG, K1), []) // Captain tidak
  const det = await panggil(KL1, 'dashboard_klien_detail_rider', `'${K1}', ${D(5)}, ${D(0)}, null, null, 50, 0`)
  assert.deepEqual([det.length, det[0].total], [3, 3])
  assert.deepEqual(await panggil(KL1, 'dashboard_klien_detail_rider', `'${K2}', ${D(5)}, ${D(0)}, null, null, 50, 0`), [])
  assert.deepEqual(await panggil(KL1, 'dashboard_klien_detail_hari', `'${K2}', ${D(5)}, ${D(0)}, null, 50, 0`), [])
  const r = await panggil(KL1, 'dashboard_klien_rentang', `'${K1}'`)
  assert.deepEqual([r.length, r[0].hari], [1, 1])
  assert.deepEqual(await panggil(KL1, 'dashboard_klien_rentang', `'${K2}'`), [])
  // klien tidak bisa membaca tabel ds langsung, dan tidak bisa memanggil aktual_bo yang mentah (Super-admin dan Arcon saja)
  assert.equal((await as(KL1, () => q('select count(*)::int as n from ds')))[0].n, 0)
  assert.deepEqual(await panggil(KL1, 'aktual_bo', `${D(1)}, ${D(1)}`), [])
})

test('Data Dash (clock-in BO) untuk klien: angka harian sama dengan aktual_bo, hanya untuk tokonya; klien lain, nonaktif, dan Captain kosong', async () => {
  const oracle = async (ids) => num(await as(S, () => q(`select sum(kebutuhan) as kebutuhan, sum(terpenuhi) as terpenuhi, sum(hadir) as hadir, sum(tepat) as tepat
    from aktual_bo(${D(1)}, ${D(1)}) where ds_id = any(array[${ids.map((i) => `'${i}'`).join(',')}]::uuid[])`)))[0]
  const bo = (e, k, ds = 'null') => panggil(e, 'dashboard_klien_bo', `'${k}', ${D(1)}, ${D(1)}, ${ds}`)
  const ambil = (r) => ({ kebutuhan: r.kebutuhan, terpenuhi: r.terpenuhi, hadir: r.hadir, tepat: r.tepat })
  const k1 = await bo(KL1, K1), k2 = await bo(KL2, K2)
  assert.equal(k1.length, 1)
  assert.deepEqual(ambil(k1[0]), await oracle([DS_A, DS_B])) // DS A dan DS B (toko klien Satu), tanpa DS C
  assert.deepEqual(ambil(k2[0]), await oracle([DS_C]))
  assert.ok(k1[0].hadir === 2 && k2[0].hadir === 1 && k1[0].kebutuhan !== k2[0].kebutuhan) // dua klien tidak bercampur
  assert.deepEqual(ambil((await bo(KL1, K1, `array['${DS_B}']::uuid[]`))[0]), await oracle([DS_B])) // penyaring toko
  assert.deepEqual(await bo(KL1, K2), []) // klien lain
  assert.deepEqual(await bo(KL1, K1, `array['${DS_C}']::uuid[]`), []) // toko klien lain lewat p_ds
  assert.deepEqual(await bo(KOFF, K1), []) // akun nonaktif
  assert.deepEqual(await bo(CG, K1), []) // Captain
  assert.deepEqual(ambil((await bo(AA, K1))[0]), await oracle([DS_A])) // Arcon A hanya DS A
  assert.deepEqual(await bo(AA, K2), [])
  // hanya empat kolom agregat: tidak ada kolom internal (captain, tanpa_orca, per rider)
  assert.deepEqual(Object.keys(k1[0]).sort(), ['hadir', 'kebutuhan', 'tanggal', 'tepat', 'terpenuhi'])
})

test('unggah mandiri: hanya untuk klien sendiri; akun nonaktif, Captain, Arcon, dan klien lain ditolak; kode toko dibaca dalam lingkup klien', async () => {
  await assert.rejects(simpan(KL1, K2, [await baris()]), /Hanya Super-admin atau akun klien/)
  await assert.rejects(simpan(KOFF, K1, [await baris()]), /Hanya Super-admin atau akun klien/)
  for (const e of [CG, AA]) await assert.rejects(simpan(e, K1, [await baris()]), /Hanya Super-admin atau akun klien/)
  await assert.rejects(simpan(null, K1, [await baris()]), /permission denied/)
  const h = await simpan(KL1, K1, [await baris({ kode_mtr: 'KB1', ...angka(7) }), await baris({ kode_toko: 'T999', kode_mtr: 'KB2' })])
  assert.deepEqual([h.baru, h.lewat, h.tolak, h.tahan], [1, 1, 0, 0])
  // T001 milik klien Dua mengarah ke DS C, bukan DS A
  await simpan(KL2, K2, [await baris({ kode_mtr: 'KC1', ...angka(6) })])
  assert.equal((await q(`select ds_id from order_klien where kode_mtr = 'KC1'`))[0].ds_id, DS_C)
  assert.equal((await q(`select ds_id from order_klien where kode_mtr = 'KB1'`))[0].ds_id, DS_A)
  // klien melihat riwayat unggahannya sendiri saja
  const mine = await as(KL1, () => q('select klien_id from unggahan_klien'))
  assert.ok(mine.length >= 1 && mine.every((r) => r.klien_id === K1))
})

test('kunci koreksi: bulan yang lewat tanggal 5 bulan berikutnya terkunci untuk klien (sama dilewati, beda ditolak); Super-admin tidak terkena', async () => {
  const lama = await baris({ tanggal: await tgl(70), kode_mtr: 'KUNCI', ...angka(10) })
  assert.equal((await simpan(S, K1, [lama])).baru, 1)
  const sama = await simpan(KL1, K1, [lama])
  assert.deepEqual([sama.sama, sama.tolak, sama.ubah], [1, 0, 0])
  const ubah = await simpan(KL1, K1, [{ ...lama, ...angka(12) }])
  assert.deepEqual([ubah.tolak, ubah.ubah], [1, 0])
  assert.match(ubah.ditolak[0].alasan, /terkunci/)
  const baru = await simpan(KL1, K1, [{ ...lama, kode_mtr: 'KUNCI2' }])
  assert.equal(baru.tolak, 1) // baris baru pada tanggal terkunci juga ditolak
  assert.equal(await nilai('KUNCI', 70), 10)
  assert.equal((await simpan(S, K1, [{ ...lama, ...angka(12) }])).ubah, 1) // Super-admin boleh
  assert.equal(await nilai('KUNCI', 70), 12)
  // hari yang masih terbuka tidak terkunci
  assert.equal((await simpan(KL1, K1, [await baris({ kode_mtr: 'TERBUKA', ...angka(5) })])).baru, 1)
})

test('tahan perubahan besar: lebih dari 10 persen dan sedikitnya 5 pesanan ditahan; yang kecil langsung dipakai; unggah ulang menggantikan yang menunggu', async () => {
  // M2 hari -3 bernilai 20: 20 -> 30 (selisih 10, 50 persen) ditahan
  const m2 = (n) => baris({ kode_mtr: 'M2', ...angka(n) })
  const h = await simpan(KL1, K1, [await m2(30)])
  assert.deepEqual([h.tahan, h.ubah, h.baru, h.sama], [1, 0, 0, 0])
  assert.equal(await nilai('M2', 3), 20) // data lama tetap berlaku
  let t = await as(S, () => q(`select selesai, lama_selesai, status from order_klien_tahan where kode_mtr = 'M2'`))
  assert.deepEqual(t.map((r) => [r.selesai, r.lama_selesai, r.status]), [[30, 20, 'menunggu']])
  // unggah ulang yang masih ditahan menggantikan, bukan menambah
  await simpan(KL1, K1, [await m2(40)])
  t = await as(S, () => q(`select selesai from order_klien_tahan where kode_mtr = 'M2' and status = 'menunggu'`))
  assert.deepEqual(t.map((r) => r.selesai), [40])
  // perubahan kecil (selisih 2) dan 8 persen dari 100 (di bawah batas) langsung dipakai
  assert.equal((await simpan(KL1, K1, [await baris({ kode_mtr: 'M1', ...angka(12, 1) })])).ubah, 1)
  await simpan(S, K1, [await baris({ tanggal: await tgl(4), kode_mtr: 'BIG', ...angka(100) })])
  assert.equal((await simpan(KL1, K1, [await baris({ tanggal: await tgl(4), kode_mtr: 'BIG', ...angka(108) })])).ubah, 1)
  const besar = await simpan(KL1, K1, [await baris({ tanggal: await tgl(4), kode_mtr: 'BIG', ...angka(120) })]) // 12 dari 108 = 11 persen
  assert.deepEqual([besar.tahan, besar.ubah], [1, 0])
  assert.equal(await nilai('BIG', 4), 108)
  // Super-admin tidak ditahan
  assert.equal((await simpan(S, K1, [await baris({ kode_mtr: 'M3', kode_toko: 'T002', ...angka(50) })])).ubah, 1)
  assert.equal(await nilai('M3', 3), 50)
})

test('keputusan penahanan: hanya Super-admin; setuju memakai angka baru dan mencatat riwayat, tolak menjaga data lama; tidak bisa diputuskan dua kali', async () => {
  const menunggu = async (kode) => (await as(S, () => q(`select id from order_klien_tahan where kode_mtr = $1 and status = 'menunggu'`, [kode])))[0].id
  const idM2 = await menunggu('M2'), idBig = await menunggu('BIG')
  // klien tidak membaca daftar tahanan dan tidak bisa memutuskan; Captain dan Arcon juga tidak
  assert.equal((await as(KL1, () => q('select count(*)::int as n from order_klien_tahan')))[0].n, 0)
  for (const e of [KL1, CG, AA]) await assert.rejects(as(e, () => q('select putuskan_tahan($1, true)', [idM2])), /Hanya Super-admin/)
  await assert.rejects(as(null, () => q('select putuskan_tahan($1, true)', [idM2])), /permission denied/)
  await as(S, () => q('select putuskan_tahan($1, true)', [idM2]))
  assert.equal(await nilai('M2', 3), 40)
  const rw = await q(`select selesai_lama from order_klien_riwayat where kode_mtr = 'M2' order by id desc limit 1`)
  assert.equal(rw[0].selesai_lama, 20)
  await as(S, () => q('select putuskan_tahan($1, false)', [idBig]))
  assert.equal(await nilai('BIG', 4), 108)
  const st = await as(S, () => q(`select kode_mtr, status, oleh from order_klien_tahan where id in ($1, $2) order by kode_mtr`, [idM2, idBig]))
  assert.deepEqual(st.map((r) => [r.kode_mtr, r.status, r.oleh]), [['BIG', 'ditolak', S], ['M2', 'disetujui', S]])
  await assert.rejects(as(S, () => q('select putuskan_tahan($1, false)', [idM2])), /sudah diputuskan/)
  await assert.rejects(as(S, () => q('select putuskan_tahan($1, true)', [id(999)])), /tidak ditemukan/)
})

test('batas 30 unggahan per jam untuk klien; Super-admin tidak dibatasi', async () => {
  await q(`insert into unggahan_klien (klien_id, oleh) select '${K1}', 'x' from generate_series(1, 30)`)
  await assert.rejects(simpan(KL1, K1, [await baris({ kode_mtr: 'LIMIT', ...angka(3) })]), /Terlalu banyak unggahan/)
  assert.equal((await simpan(KL2, K2, [await baris({ kode_mtr: 'KC2', ...angka(3) })])).baru, 1) // klien lain tidak ikut terhitung
  assert.equal((await simpan(S, K1, [await baris({ kode_mtr: 'LIMIT', ...angka(3) })])).baru, 1)
})
