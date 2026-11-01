// Uji riwayat aktivitas: trigger mencatat tambah/ubah/hapus (siapa, kapan, nilai lama → baru) dan RLS membatasi siapa yang boleh membaca.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const S = 'super@test.local', CG = 'cap-galaxy@test.local', CA = 'cap-alsut@test.local', AA = 'arcon-a@test.local', AB = 'arcon-b@test.local'
const GALAXY = id(101), ALSUT = id(102), GOWA = id(103)
const [R_CG, R_CA, R_CW, R_AA, R_AB, R_G] = [id(10), id(11), id(12), id(30), id(31), id(21)]

const q = async (sql, p) => (await db.query(sql, p)).rows
async function as(email, fn) {
  const claims = JSON.stringify(email ? { email } : {})
  await db.exec(`reset role; select set_config('request.jwt.claims', '${claims}', false); set role ${email ? 'authenticated' : 'anon'}`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`)
  }
}
const detail = async () => (await q('select detail from log_aktivitas order by detail')).map((r) => r.detail)

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
    insert into ds (id, nama, kuota_pagi, kuota_siang) values ('${GALAXY}', 'Galaxy', 1, 1), ('${ALSUT}', 'Alam Sutera', 1, 1), ('${GOWA}', 'Gowa', 1, 1);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${id(1)}', null, 'Super', null, 'super_admin', '${S}', 'aktif'),
      ('${R_CG}', 'MTR-CG', 'Captain Galaxy', '${GALAXY}', 'captain', '${CG}', 'aktif'),
      ('${R_CA}', 'MTR-CA', 'Captain Alsut', '${ALSUT}', 'captain', '${CA}', 'aktif'),
      ('${R_CW}', 'MTR-CW', 'Captain Gowa', '${GOWA}', 'captain', 'cap-gowa@test.local', 'aktif'),
      ('${R_AA}', null, 'Arcon A', null, 'arcon', '${AA}', 'aktif'),
      ('${R_AB}', null, 'Arcon B', null, 'arcon', '${AB}', 'aktif'),
      ('${R_G}', 'MTR021', 'Rider Galaxy', '${GALAXY}', 'rider', null, 'aktif'),
      ('${id(24)}', 'MTR024', 'Rider Bebas', null, 'rider', null, 'aktif');
    update ds set captain_id = '${R_CG}', arcon_id = '${R_AA}' where id = '${GALAXY}';
    update ds set captain_id = '${R_CA}', arcon_id = '${R_AA}' where id = '${ALSUT}';
    update ds set captain_id = '${R_CW}', arcon_id = '${R_AB}' where id = '${GOWA}';
    insert into actual_harian (tanggal, rider_id, ds_id, status) values (today_wib(), '${R_G}', '${GALAXY}', 'hadir');`)
})
beforeEach(() => db.exec('delete from log_aktivitas'))
after(() => db.close())

test('Ubah data tercatat lengkap: siapa, kapan, apa, nilai lama → baru, dan DS-nya', async () => {
  await as(S, () => q('update ds set kuota_siang = 2 where id = $1', [GALAXY]))
  const [l] = await q("select * from log_aktivitas where aksi = 'ubah DS'")
  assert.equal(l.detail, 'Galaxy: kuota siang 1 → 2')
  assert.equal(l.captain_id, id(1)) // pelaku = yang sedang login
  assert.equal(l.ds_id, GALAXY)
  assert.equal(l.jenis, 'ubah')
  assert.deepEqual(l.perubahan, [{ kolom: 'kuota_siang', lama: '1', baru: '2' }])
  assert.ok(l.waktu instanceof Date && Math.abs(Date.now() - l.waktu.getTime()) < 60_000) // tanggal dan jam terisi otomatis
})

test('Id diganti nama yang terbaca; simpan ulang tanpa perubahan tidak tercatat', async () => {
  await db.exec(`update actual_harian set jam_input = now() where rider_id = '${R_G}'`) // hanya kolom teknis
  assert.equal((await q('select * from log_aktivitas')).length, 0)
  await db.exec(`update actual_harian set status = 'alpha', backup_untuk_id = '${R_CG}' where rider_id = '${R_G}'`)
  const [l] = await q("select * from log_aktivitas where aksi = 'ubah absensi'")
  assert.match(l.detail, /^Rider Galaxy · \d{4}-\d{2}-\d{2}: status hadir → alpha, backup untuk id \(kosong\) → Captain Galaxy$/)
  assert.equal(l.ds_id, GALAXY)
})

test('Satu perintah yang mengubah banyak baris jadi SATU catatan ringkasan', async () => {
  await db.exec(`insert into riders (nama, kode_mtr, ds_id) select 'Rider Impor ' || g, 'MTR9' || g, '${GALAXY}' from generate_series(1, 5) g`)
  const l = await q("select * from log_aktivitas where aksi = 'tambah rider'")
  assert.equal(l.length, 1)
  assert.match(l[0].detail, /^5 data, mis\. Rider Impor/)
  assert.equal(l[0].objek_id, null) // bukan satu objek
})

test('Hapus tercatat, dan tetap terbaca walau barisnya sudah tidak ada', async () => {
  await db.exec(`delete from riders where id = '${id(24)}'`)
  const [l] = await q("select * from log_aktivitas where aksi = 'hapus rider'")
  assert.equal(l.detail, 'Rider Bebas')
  assert.equal(l.jenis, 'hapus')
})

test('Penghapusan motor tidak dicatat dua kali: fungsi hapus_motor sudah mencatat dengan alasan', async () => {
  await db.exec(`insert into motor (id, kode_motor, ds_id) values ('${id(500)}', 'EV-X', '${GALAXY}')`)
  assert.equal((await q("select * from log_aktivitas where aksi = 'tambah motor'")).length, 1)
  await as(S, () => q("select hapus_motor($1, 'salah input')", [id(500)]))
  assert.equal((await q("select * from log_aktivitas where jenis = 'hapus' and tabel = 'motor'")).length, 0)
  assert.equal((await q("select * from log_aktivitas where aksi = 'hapus motor'")).length, 1) // catatan dari fungsinya
})

test('Hak lihat: Super-admin semua; Arcon dan Captain hanya DS yang dipegang', async () => {
  await as(S, async () => {
    await q('update ds set kuota_pagi = 5 where id = $1', [GALAXY])
    await q('update ds set kuota_pagi = 5 where id = $1', [GOWA])
  })
  await as(S, async () => assert.deepEqual(await detail(), ['Galaxy: kuota pagi 1 → 5', 'Gowa: kuota pagi 1 → 5']))
  await as(AA, async () => assert.deepEqual(await detail(), ['Galaxy: kuota pagi 1 → 5'])) // Arcon A: Galaxy + Alam Sutera
  await as(AB, async () => assert.deepEqual(await detail(), ['Gowa: kuota pagi 1 → 5']))
  await as(CG, async () => assert.deepEqual(await detail(), ['Galaxy: kuota pagi 1 → 5']))
  await as(CA, async () => assert.deepEqual(await detail(), [])) // Captain Alam Sutera tidak melihat DS lain
})

test('Catatan tidak bisa diubah atau dihapus dari aplikasi', async () => {
  await as(S, () => q('update ds set kuota_pagi = 6 where id = $1', [GALAXY]))
  await as(S, async () => {
    assert.equal((await db.query('delete from log_aktivitas')).affectedRows, 0)
    assert.equal((await db.query("update log_aktivitas set detail = 'x'")).affectedRows, 0)
  })
  assert.equal((await q('select * from log_aktivitas')).length, 1)
})
