// Uji laporan order harian rider (migrasi 0055): hak baca (RLS), tidak bisa ditulis langsung, batasan data, hak foto, pembersihan 90 hari,
// dan aturan validasi Edge Function (validasi.ts). Database PGlite.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const S = 'super@test.local', CG = 'cap-galaxy@test.local', CW = 'cap-gowa@test.local', AA = 'arcon-a@test.local', RG = 'orang-asing@test.local'
const GALAXY = id(101), GOWA = id(103)
const [R_CG, R_CW, R_AA, R_G, R_W] = [id(10), id(12), id(30), id(21), id(23)]
const q = async (sql, p) => (await db.query(sql, p)).rows
async function as(email, fn) {
  const claims = JSON.stringify(email ? { email } : {})
  await db.exec(`reset role; select set_config('request.jwt.claims', '${claims}', false); set role ${email ? 'authenticated' : 'anon'}`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
}
const foto = (rider, n, i = 1) => `${rider}/${n}/${id(900 + i)}.jpg`

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
    insert into ds (id, nama, kuota_pagi, kuota_siang) values ('${GALAXY}', 'Galaxy', 1, 1), ('${GOWA}', 'Gowa', 1, 1);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${id(1)}', null, 'Super', null, 'super_admin', '${S}', 'aktif'),
      ('${R_CG}', 'MTR-CG', 'Captain Galaxy', '${GALAXY}', 'captain', '${CG}', 'aktif'),
      ('${R_CW}', 'MTR-CW', 'Captain Gowa', '${GOWA}', 'captain', '${CW}', 'aktif'),
      ('${R_AA}', null, 'Arcon A', null, 'arcon', '${AA}', 'aktif'),
      ('${R_G}', 'MTR021', 'Rider Galaxy', '${GALAXY}', 'rider', null, 'aktif'),
      ('${R_W}', 'MTR023', 'Rider Gowa', '${GOWA}', 'rider', null, 'aktif');
    update ds set captain_id = '${R_CG}', arcon_id = '${R_AA}' where id = '${GALAXY}';
    update ds set captain_id = '${R_CW}' where id = '${GOWA}';
    insert into laporan_order (tanggal, rider_id, ds_id, jumlah_order, catatan, foto) values
      (today_wib(), '${R_G}', '${GALAXY}', 12, 'ramai', array['${foto(R_G, 'x')}']),
      (today_wib(), '${R_W}', '${GOWA}', 7, null, array['${foto(R_W, 'x')}']),
      (today_wib() - 100, '${R_G}', '${GALAXY}', 5, null, array['${foto(R_G, 'lama', 2)}', '${foto(R_G, 'lama', 3)}']),
      (today_wib() - 100, '${R_W}', '${GOWA}', 0, null, '{}');`)
})
after(() => db.close())

const jml = () => q('select jumlah_order from laporan_order order by tanggal desc, jumlah_order').then((r) => r.map((x) => x.jumlah_order))

test('hak baca: Super-admin semua, Captain dan Arcon hanya DS yang dipegang, akun tak dikenal (mis. rider) dan anon tidak melihat apa pun', async () => {
  await as(S, async () => assert.deepEqual(await jml(), [7, 12, 0, 5]))
  await as(CG, async () => assert.deepEqual(await jml(), [12, 5])) // hanya Galaxy
  await as(CW, async () => assert.deepEqual(await jml(), [7, 0])) // hanya Gowa
  await as(AA, async () => assert.deepEqual(await jml(), [12, 5])) // Arcon A memegang Galaxy
  await as(RG, async () => assert.deepEqual(await jml(), [])) // rider tidak punya akun: ia membaca lewat Edge Function, bukan API
  await as(null, async () => await assert.rejects(jml(), /permission denied/))
})

test('tidak bisa ditulis langsung lewat API oleh siapa pun (rider menulis lewat Edge Function)', async () => {
  const baru = `insert into laporan_order (tanggal, rider_id, ds_id, jumlah_order) values (today_wib() - 3, '${R_G}', '${GALAXY}', 4)`
  for (const e of [S, CG, AA, RG]) await as(e, async () => await assert.rejects(q(baru), /row-level security/))
  await as(CG, async () => {
    assert.equal((await q("update laporan_order set jumlah_order = 99 where rider_id = $1 returning id", [R_G])).length, 0)
    assert.equal((await q('delete from laporan_order where rider_id = $1 returning id', [R_G])).length, 0)
  })
  assert.deepEqual(await jml(), [7, 12, 0, 5]) // tidak berubah
})

test('batasan data: jumlah 0 sampai 999, catatan maksimal 500, foto maksimal 10, satu laporan per rider per hari', async () => {
  const tambah = (n, jumlah, catatan = null, fotos = '{}') =>
    q(`insert into laporan_order (tanggal, rider_id, ds_id, jumlah_order, catatan, foto) values (today_wib() - ${n}, $1, $2, $3, $4, $5)`, [R_G, GALAXY, jumlah, catatan, fotos])
  await assert.rejects(tambah(10, -1), /violates check/)
  await assert.rejects(tambah(10, 1000), /violates check/)
  await assert.rejects(tambah(10, 5, 'x'.repeat(501)), /violates check/)
  await assert.rejects(tambah(10, 5, null, `{${Array.from({ length: 11 }, (_, i) => `a${i}`).join(',')}}`), /violates check/)
  await tambah(10, 999, 'x'.repeat(500), `{${Array.from({ length: 10 }, (_, i) => `a${i}`).join(',')}}`) // batas atas masih boleh
  await assert.rejects(tambah(10, 3), /duplicate key/) // tanggal dan rider yang sama
  await q('delete from laporan_order where tanggal = today_wib() - 10')
})

test('hak foto: Super-admin, Captain dan Arcon DS rider itu boleh melihat; DS lain, rider, anon, dan alamat tidak valid tidak', async () => {
  const boleh = (nama) => q('select order_foto_boleh($1) b', [nama]).then((r) => r[0].b)
  await as(S, async () => assert.equal(await boleh(foto(R_W, 'x')), true))
  await as(CG, async () => {
    assert.equal(await boleh(foto(R_G, 'x')), true)
    assert.equal(await boleh(foto(R_W, 'x')), false) // rider Gowa
    assert.equal(await boleh('bukan-uuid/x/y.jpg'), false)
    assert.equal(await boleh(''), false)
  })
  await as(AA, async () => { assert.equal(await boleh(foto(R_G, 'x')), true); assert.equal(await boleh(foto(R_W, 'x')), false) })
  await as(RG, async () => assert.equal(await boleh(foto(R_G, 'x')), false)) // rider tidak membaca lewat Storage
  await as(null, async () => await assert.rejects(boleh(foto(R_G, 'x')), /permission denied/))
})

test('pembersihan: hanya laporan lebih dari 90 hari yang punya foto, dan hanya bisa dipanggil server (service role)', async () => {
  await as(S, async () => await assert.rejects(q('select * from foto_order_kedaluwarsa()'), /permission denied/))
  await as(CG, async () => await assert.rejects(q('select kosongkan_foto_order($1::uuid[])', [[id(1)]]), /permission denied/))
  const k = await q('select * from foto_order_kedaluwarsa(90)') // pemanggil: superuser database, seperti service role
  assert.equal(k.length, 1) // yang 100 hari dan berfoto; yang 100 hari tanpa foto dan yang hari ini tidak ikut
  assert.equal(k[0].foto.length, 2)
  assert.equal((await q('select * from foto_order_kedaluwarsa(200)')).length, 0) // belum ada yang lebih tua dari 200 hari
  assert.equal((await q('select kosongkan_foto_order($1::uuid[]) n', [[k[0].id]]))[0].n, 1)
  assert.equal((await q('select * from foto_order_kedaluwarsa(90)')).length, 0)
  assert.equal((await q("select jumlah_order from laporan_order where id = $1", [k[0].id]))[0].jumlah_order, 5) // angka laporan tetap
})

test('validasi.ts: tanggal, isi laporan, berkas, dan kepemilikan foto', async () => {
  const v = await import('../supabase/functions/laporan-order-rider/validasi.ts')
  const hari = '2026-11-21'
  assert.equal(v.cekTanggal('2026-11-21', hari), null)
  assert.equal(v.cekTanggal('2026-11-14', hari), null) // 7 hari ke belakang masih boleh
  assert.match(v.cekTanggal('2026-11-13', hari), /7 hari/)
  assert.match(v.cekTanggal('2026-11-22', hari), /mendatang/)
  assert.match(v.cekTanggal('21-11-2026', hari), /tidak valid/)
  assert.match(v.cekTanggal('2026-02-31x', hari), /tidak valid/)
  assert.equal(v.cekIsi(0, null, 0), null) // tidak bawa order: tanpa foto boleh
  assert.equal(v.cekIsi(15, 'ramai', 3), null)
  assert.match(v.cekIsi(15, null, 0), /minimal satu screenshot/)
  assert.match(v.cekIsi(1000, null, 1), /0 sampai 999/)
  assert.match(v.cekIsi(-1, null, 1), /0 sampai 999/)
  assert.match(v.cekIsi(1.5, null, 1), /bilangan bulat/)
  assert.match(v.cekIsi('12', null, 1), /bilangan bulat/)
  assert.match(v.cekIsi(5, 'x'.repeat(501), 1), /500 karakter/)
  assert.match(v.cekIsi(5, null, 11), /Maksimal 10 foto/)
  assert.equal(v.cekBerkas({ type: 'image/jpeg', size: 200_000 }), null)
  assert.match(v.cekBerkas({ type: 'application/pdf', size: 1000 }), /JPEG/)
  assert.match(v.cekBerkas({ type: 'image/png', size: 3 * 1024 * 1024 }), /2 MB/)
  assert.match(v.cekBerkas({ type: 'image/png', size: 0 }), /kosong/)
  assert.equal(v.geserHari('2026-03-01', -1), '2026-02-28')
  const p = v.pathFoto(R_G, hari, id(5))
  assert.equal(v.fotoMilik(p, R_G, hari), true)
  assert.equal(v.fotoMilik(p, R_W, hari), false) // foto rider lain
  assert.equal(v.fotoMilik(p, R_G, '2026-11-20'), false) // tanggal lain
  assert.equal(v.fotoMilik(`${R_G}/${hari}/../${R_W}/a.jpg`, R_G, hari), false)
  assert.equal(v.fotoMilik(`${R_G}/${hari}/sub/a.jpg`, R_G, hari), false)
  assert.equal(v.fotoMilik(null, R_G, hari), false)
  assert.equal(v.hariIniWib(Date.parse('2026-11-21T20:00:00Z')), '2026-11-22') // sudah lewat tengah malam WIB
})
