// Uji tukar shift dua arah (migrasi 0044): yang pagi jadi siang, yang siang jadi pagi. Database PGlite.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const GALAXY = id(101)
const [P, P2, S, S2, EXTRA] = [id(21), id(22), id(23), id(24), id(25)]
const q = async (sql, p) => (await db.query(sql, p)).rows
const tgl = (n) => `today_wib() - ${n}`

const sebagaiSuper = async (fn) => {
  await db.exec(`reset role; select set_config('request.jwt.claims', '{"email":"super@test.local"}', false); set role authenticated`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
}
const catat = (n, rider, status, backup = null) =>
  sebagaiSuper(() => q(`select catat_actual(${tgl(n)}, $1, $2, $3, null, null, 0, false)`, [rider, status, backup]))
const hapus = (n, rider) => sebagaiSuper(() => q(`select hapus_actual(${tgl(n)}, $1)`, [rider]))
const absen = (n, rider) => q(`select status, backup_untuk_id from actual_harian where tanggal = ${tgl(n)} and rider_id = $1 order by status`, [rider])
const jadwal = (n, rider, shift) => db.exec(`insert into jadwal (tanggal, rider_id, shift, ds_id) values (${tgl(n)}, '${rider}', '${shift}', '${GALAXY}')`)
const laporan = async (n) => {
  const r = await sebagaiSuper(() => q(`select * from laporan_rider(${tgl(n)}, ${tgl(n)})`))
  const d = (await sebagaiSuper(() => q(`select * from laporan_ds(${tgl(n)}, ${tgl(n)})`))).find((x) => x.ds_nama === 'Galaxy')
  const f = (await sebagaiSuper(() => q(`select * from laporan_fulfillment(${tgl(n)}, ${tgl(n)})`))).find((x) => x.ds_nama === 'Galaxy')
  return { rider: (rid) => r.find((x) => x.rider_id === rid), ds: d, ful: f }
}

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
    insert into ds (id, nama, kuota_pagi, kuota_siang) values ('${GALAXY}', 'Galaxy', 1, 1);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${id(1)}', null, 'Super', null, 'super_admin', 'super@test.local', 'aktif'),
      ('${P}', 'M1', 'Pagi Satu', '${GALAXY}', 'rider', null, 'aktif'), ('${P2}', 'M2', 'Pagi Dua', '${GALAXY}', 'rider', null, 'aktif'),
      ('${S}', 'M3', 'Siang Satu', '${GALAXY}', 'rider', null, 'aktif'), ('${S2}', 'M4', 'Siang Dua', '${GALAXY}', 'rider', null, 'aktif'),
      ('${EXTRA}', 'M5', 'Tanpa Jadwal', '${GALAXY}', 'rider', null, 'aktif');`)
})
after(() => db.close())

test('tukar dua arah: pagi jadi siang, siang jadi pagi. Keduanya berstatus tukar, saling menunjuk, tanpa pengganti', async () => {
  await jadwal(1, P, 'pagi'); await jadwal(1, S, 'siang')
  await catat(1, P, 'tukar', S)
  assert.deepEqual(await absen(1, P), [{ status: 'tukar', backup_untuk_id: S }])
  assert.deepEqual(await absen(1, S), [{ status: 'tukar', backup_untuk_id: P }])
})

test('laporan tukar dua arah: keduanya terisi, tidak ada pengganti, Fulfillment menghitung di shift yang dikerjakan', async () => {
  const l = await laporan(1)
  for (const rid of [P, S]) assert.deepEqual([l.rider(rid).dijadwalkan, l.rider(rid).tukar, l.rider(rid).pengganti, l.rider(rid).belum_diisi], [1, 1, 0, 0])
  assert.deepEqual([l.ds.dijadwalkan, l.ds.terisi, l.ds.pengganti, l.ds.belum_diisi], [2, 2, 0, 0])
  assert.deepEqual([l.ful.terpenuhi_pagi, l.ful.terpenuhi_siang, l.ful.terpenuhi_lain], [1, 1, 0]) // S mengerjakan pagi, P mengerjakan siang
})

test('tukar dua rider di shift yang sama ditolak', async () => {
  await jadwal(2, P, 'pagi'); await jadwal(2, P2, 'pagi')
  await assert.rejects(catat(2, P, 'tukar', P2), /shift yang berbeda/)
})

test('tukar dengan rekan tanpa jadwal tetap seperti dulu: rekan jadi pengganti', async () => {
  await jadwal(3, P, 'pagi')
  await catat(3, P, 'tukar', EXTRA)
  assert.deepEqual(await absen(3, P), [{ status: 'tukar', backup_untuk_id: EXTRA }])
  assert.deepEqual(await absen(3, EXTRA), [{ status: 'pengganti', backup_untuk_id: P }])
})

test('klik Hadir pada salah satu pihak melepas pasangannya (pasangan kembali belum diabsen), tanpa hitungan dobel', async () => {
  await jadwal(4, P, 'pagi'); await jadwal(4, S, 'siang')
  await catat(4, P, 'tukar', S)
  await catat(4, S, 'hadir')
  assert.deepEqual(await absen(4, S), [{ status: 'hadir', backup_untuk_id: null }])
  assert.deepEqual(await absen(4, P), [])
  const l = await laporan(4)
  assert.deepEqual([l.rider(S).hadir, l.rider(S).pengganti, l.rider(S).tukar], [1, 0, 0])
  assert.deepEqual([l.ds.dijadwalkan, l.ds.terisi, l.ds.belum_diisi], [2, 1, 1]) // P belum diabsen lagi
})

test('Batalkan pada salah satu pihak menghapus pasangannya juga', async () => {
  await jadwal(5, P, 'pagi'); await jadwal(5, S, 'siang')
  await catat(5, P, 'tukar', S)
  await hapus(5, P)
  assert.deepEqual(await absen(5, P), [])
  assert.deepEqual(await absen(5, S), [])
})

test('mengganti rekan tukar melepas rekan lama dan memasang rekan baru', async () => {
  await jadwal(6, P, 'pagi'); await jadwal(6, S, 'siang'); await jadwal(6, S2, 'siang')
  await catat(6, P, 'tukar', S)
  await catat(6, P, 'tukar', S2)
  assert.deepEqual(await absen(6, S), [])
  assert.deepEqual(await absen(6, S2), [{ status: 'tukar', backup_untuk_id: P }])
  assert.deepEqual(await absen(6, P), [{ status: 'tukar', backup_untuk_id: S2 }])
})

test('rekan yang sudah bertukar dengan orang lain dipasangkan ulang tanpa meninggalkan pasangan yang menggantung', async () => {
  await jadwal(7, P, 'pagi'); await jadwal(7, P2, 'pagi'); await jadwal(7, S, 'siang')
  await catat(7, P, 'tukar', S)
  await catat(7, P2, 'tukar', S) // S diambil P2
  assert.deepEqual(await absen(7, P), []) // P kehilangan pasangannya, kembali belum diabsen
  assert.deepEqual(await absen(7, S), [{ status: 'tukar', backup_untuk_id: P2 }])
  assert.deepEqual(await absen(7, P2), [{ status: 'tukar', backup_untuk_id: S }])
})

test('data tukar lama (satu arah): rekan tetap terhitung terisi, dan klik Hadir menimpa isian pengganti lamanya', async () => {
  await jadwal(8, P, 'pagi'); await jadwal(8, S, 'siang')
  // bentuk lama: A tukar tanpa rekan, B pengganti untuk A
  await db.exec(`insert into actual_harian (tanggal, rider_id, ds_id, status) values (${tgl(8)}, '${P}', '${GALAXY}', 'tukar');
    insert into actual_harian (tanggal, rider_id, ds_id, status, backup_untuk_id) values (${tgl(8)}, '${S}', '${GALAXY}', 'pengganti', '${P}')`)
  let l = await laporan(8)
  assert.deepEqual([l.rider(S).dijadwalkan, l.rider(S).belum_diisi, l.rider(S).pengganti], [1, 0, 1]) // bukan "belum diabsen"
  assert.deepEqual([l.ds.terisi, l.ds.belum_diisi], [2, 0])
  await catat(8, S, 'hadir')
  assert.deepEqual(await absen(8, S), [{ status: 'hadir', backup_untuk_id: null }]) // tidak jadi dua isian
  l = await laporan(8)
  assert.deepEqual([l.rider(S).hadir, l.rider(S).pengganti], [1, 0])
})
