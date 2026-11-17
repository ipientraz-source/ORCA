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
const konf = (n, rider, ya = true) => sebagaiSuper(() => q(`select konfirmasi_tukar(${tgl(n)}, $1, $2)`, [rider, ya]))
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

test('laporan tukar dua arah: sebelum dikonfirmasi dihitung belum diisi (migrasi 0050), sesudahnya keduanya terisi dan Fulfillment menghitung di shift yang dikerjakan', async () => {
  let l = await laporan(1)
  for (const rid of [P, S]) assert.deepEqual([l.rider(rid).dijadwalkan, l.rider(rid).tukar, l.rider(rid).belum_diisi, l.rider(rid).shift_kerja], [1, 1, 1, 0])
  assert.deepEqual([l.ds.terisi, l.ds.belum_diisi], [0, 2])
  assert.deepEqual([l.ful.terpenuhi_pagi, l.ful.terpenuhi_siang, l.ful.terpenuhi_lain], [0, 0, 0])
  await konf(1, S) // S dikonfirmasi hadir di shift barunya (pagi); P belum
  l = await laporan(1)
  assert.deepEqual([l.rider(S).belum_diisi, l.rider(S).shift_kerja, l.rider(P).belum_diisi, l.rider(P).shift_kerja], [0, 1, 1, 0])
  assert.deepEqual([l.ful.terpenuhi_pagi, l.ful.terpenuhi_siang], [1, 0])
  await konf(1, P)
  l = await laporan(1)
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

test('rider yang sudah bertukar shift boleh lanjut menutup shift lain, dengan shift yang DIKERJAKAN sebagai pembanding', async () => {
  // S (jadwal siang) bertukar dengan P (jadwal pagi): S mengerjakan pagi, P mengerjakan siang
  await jadwal(9, P, 'pagi'); await jadwal(9, S, 'siang'); await jadwal(9, S2, 'siang'); await jadwal(9, P2, 'pagi')
  await catat(9, S, 'tukar', P)
  const alpha = (n, rider, backup) => sebagaiSuper(() => q(`select catat_actual(${tgl(n)}, $1, 'alpha', $2, null, true, 0, false)`, [rider, backup]))
  // P2 (pagi) alpha: S sudah mengerjakan pagi, jadi tidak boleh menutup pagi lagi (padahal jadwal aslinya siang)
  await assert.rejects(alpha(9, P2, S), /shift yang sama/)
  // S2 (siang) alpha: S mengerjakan pagi, boleh lanjut menutup siang (padahal jadwal aslinya juga siang)
  await alpha(9, S2, S)
  assert.deepEqual(await absen(9, S), [{ status: 'tukar', backup_untuk_id: P }, { status: 'pengganti', backup_untuk_id: S2 }])
  await konf(9, S)
  const l = await laporan(9)
  assert.deepEqual([l.rider(S).dijadwalkan, l.rider(S).tukar, l.rider(S).pengganti, l.rider(S).belum_diisi], [1, 1, 1, 0]) // jadwal tidak dobel
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

// ───────── konfirmasi kehadiran rider hasil tukar (migrasi 0050) ─────────
const dikonfirmasi = async (n, rider) => (await q(`select tukar_dikonfirmasi k from actual_harian where tanggal = ${tgl(n)} and rider_id = $1 and status = 'tukar'`, [rider]))[0]?.k

test('tukar dua arah baru: kedua rider belum dikonfirmasi; konfirmasi bisa dibatalkan', async () => {
  await jadwal(10, P, 'pagi'); await jadwal(10, S, 'siang')
  await catat(10, P, 'tukar', S)
  assert.deepEqual([await dikonfirmasi(10, P), await dikonfirmasi(10, S)], [false, false])
  await konf(10, P)
  assert.deepEqual([await dikonfirmasi(10, P), await dikonfirmasi(10, S)], [true, false]) // per rider, tidak ikut pasangannya
  await konf(10, P, false)
  assert.equal(await dikonfirmasi(10, P), false)
  assert.deepEqual(await absen(10, P), [{ status: 'tukar', backup_untuk_id: S }]) // tukarnya tetap, tidak terhapus
})

test('konfirmasi hanya untuk rider yang sedang bertukar dan hanya di DS sendiri', async () => {
  await jadwal(11, P, 'pagi')
  await catat(11, P, 'hadir')
  await assert.rejects(konf(11, P), /tidak sedang bertukar/)
  await assert.rejects(konf(11, EXTRA), /tidak sedang bertukar/)
})

test('tukar dengan rekan tanpa jadwal dan data tukar lama tidak butuh konfirmasi (bawaan terkonfirmasi)', async () => {
  await jadwal(12, P, 'pagi')
  await catat(12, P, 'tukar', EXTRA)
  assert.equal(await dikonfirmasi(12, P), true)
  await db.exec(`insert into actual_harian (tanggal, rider_id, ds_id, status) values (${tgl(13)}, '${S}', '${GALAXY}', 'tukar')`)
  assert.equal(await dikonfirmasi(13, S), true)
})

test('X (pagi) tukar dengan Y (siang), Y dikonfirmasi pagi, X tidak masuk siang: Tidak hadir melepas tukar dan pengganti dipilih bebas', async () => {
  await jadwal(14, P, 'pagi'); await jadwal(14, S, 'siang')
  await catat(14, P, 'tukar', S)
  await konf(14, S) // S hadir di pagi
  await sebagaiSuper(() => q(`select catat_actual(${tgl(14)}, $1, 'alpha', $2, null, true, 0, false)`, [P, EXTRA])) // P tidak masuk, EXTRA menggantikan
  assert.deepEqual(await absen(14, P), [{ status: 'alpha', backup_untuk_id: null }])
  assert.deepEqual(await absen(14, EXTRA), [{ status: 'pengganti', backup_untuk_id: P }])
  assert.deepEqual(await absen(14, S), []) // tukar batal, S kembali belum diabsen untuk shift sendirinya
  await catat(14, S, 'hadir')
  const l = await laporan(14)
  assert.deepEqual([l.ful.terpenuhi_pagi, l.ful.terpenuhi_siang, l.ful.terpenuhi_lain], [1, 1, 0])
  assert.deepEqual([l.rider(P).alpha, l.rider(P).potongan, l.rider(S).belum_diisi], [1, 1, 0])
})
