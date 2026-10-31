// Uji Fleet management (motor, servis, kerusakan, pindah DS) di Postgres (PGlite) dengan peran anon/authenticated dan JWT.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const S = 'super@test.local', CG = 'cap-galaxy@test.local', CA = 'cap-alsut@test.local', AA = 'arcon-a@test.local', AB = 'arcon-b@test.local'
const GALAXY = id(101), ALSUT = id(102), GOWA = id(103)
const [R_CG, R_CA, R_AA, R_AB, R_G, R_A] = [id(10), id(11), id(30), id(31), id(21), id(22)]
const [M1, M2, M3] = [id(201), id(202), id(203)]

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
const hariIni = async () => (await q('select today_wib()::text t'))[0].t
const motor = async (mid) => (await q('select kode_motor, ds_id, status, dipegang_oleh, servis_terakhir::text st, servis_berikutnya::text sb from motor where id = $1', [mid]))[0]
const kode = async () => (await q('select kode_motor from motor order by kode_motor')).map((r) => r.kode_motor)

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
      ('${R_AA}', null, 'Arcon A', null, 'arcon', '${AA}', 'aktif'),
      ('${R_AB}', null, 'Arcon B', null, 'arcon', '${AB}', 'aktif'),
      ('${R_G}', 'MTR021', 'Rider Galaxy', '${GALAXY}', 'rider', null, 'aktif'),
      ('${R_A}', 'MTR022', 'Rider Alsut', '${ALSUT}', 'rider', null, 'aktif');
    update ds set captain_id = '${R_CG}', arcon_id = '${R_AA}' where id = '${GALAXY}';
    update ds set captain_id = '${R_CA}', arcon_id = '${R_AA}' where id = '${ALSUT}';
    update ds set arcon_id = '${R_AB}' where id = '${GOWA}';
    insert into motor (id, kode_motor, ds_id) values ('${M1}', 'EV-001', '${GALAXY}'), ('${M2}', 'EV-002', '${ALSUT}'), ('${M3}', 'EV-003', '${GOWA}');`)
})
after(() => db.close())

test('Siapa melihat motor: Super-admin semua, Arcon DS yang dipegang, Captain DS-nya, anon tidak', async () => {
  await as(S, async () => assert.deepEqual(await kode(), ['EV-001', 'EV-002', 'EV-003']))
  await as(AA, async () => assert.deepEqual(await kode(), ['EV-001', 'EV-002'])) // Galaxy + Alam Sutera
  await as(AB, async () => assert.deepEqual(await kode(), ['EV-003']))
  await as(CG, async () => assert.deepEqual(await kode(), ['EV-001']))
  await as(CA, async () => assert.deepEqual(await kode(), ['EV-002']))
  await as(null, async () => await assert.rejects(q('select * from motor'), /permission denied/))
})

test('Kelola motor: Super-admin dan Arcon (DS-nya) boleh, Captain tidak; data dinormalisasi; DS tidak bisa diubah langsung', async () => {
  await as(AA, async () => {
    const r = (await q("insert into motor (kode_motor, ds_id, plat_nomor, no_rangka) values (' ev-004 ', $1, ' b  1234   xyz ', ' mh1abc ') returning id, kode_motor, plat_nomor, no_rangka, status", [GALAXY]))[0]
    assert.deepEqual([r.kode_motor, r.plat_nomor, r.no_rangka, r.status], ['EV-004', 'B 1234 XYZ', 'MH1ABC', 'di gudang'])
    await assert.rejects(q("insert into motor (kode_motor, ds_id) values ('EV-009', $1)", [GOWA]), /row-level security/) // DS yang tidak dipegang
    await assert.rejects(q("insert into motor (kode_motor, ds_id, plat_nomor) values ('EV-010', $1, 'b 1234 xyz')", [GALAXY]), /duplicate key/) // plat kembar
    // rider pemegang harus di DS yang sama; status dipakai diturunkan dari pemegang
    await assert.rejects(q('update motor set dipegang_oleh = $2 where id = $1', [M1, R_A]), /DS yang sama/)
    await q('update motor set dipegang_oleh = $2 where id = $1', [M1, R_G])
    assert.equal((await motor(M1)).status, 'dipakai')
    await assert.rejects(q('update motor set ds_id = $2 where id = $1', [M1, ALSUT]), /Pindah DS/) // harus lewat pindah_motor
    await q("update motor set interval_servis_hari = 90, merek = 'Polytron' where id = $1", [M1])
  })
  await as(S, async () => {
    await assert.rejects(q('update motor set ds_id = $2 where id = $1', [M3, GALAXY]), /Pindah DS/) // Super-admin pun lewat pindah_motor
    await q("update motor set catatan = 'oke' where id = $1", [M3])
  })
  await as(CG, async () => {
    await assert.rejects(q("insert into motor (kode_motor, ds_id) values ('EV-011', $1)", [GALAXY]), /row-level security/)
    assert.equal((await q("update motor set catatan = 'x' where id = $1 returning id", [M1])).length, 0) // tak bisa mengubah
  })
})

test('Servis: Super-admin/Arcon mencatat, Captain hanya melihat; asuransi = biaya 0; servis rutin memajukan jadwal', async () => {
  const hari = await hariIni()
  await as(AA, async () => {
    await q("insert into servis_motor (motor_id, tanggal, jenis, bengkel, biaya) values ($1, $2, 'Servis rutin', 'Bengkel A', 150000)", [M1, hari])
    const m = await motor(M1)
    assert.equal(m.st, hari)
    assert.equal(m.sb, (await q('select (today_wib() + 90)::text d'))[0].d) // tanggal servis + interval 90 hari
    assert.equal((await q('select diinput_oleh from servis_motor'))[0].diinput_oleh, R_AA)
    // jenis lain tidak menggeser jadwal rutin; servis rutin lama tidak memundurkan
    await q("insert into servis_motor (motor_id, tanggal, jenis) values ($1, $2, 'Ganti ban')", [M1, hari])
    await q("insert into servis_motor (motor_id, tanggal, jenis) values ($1, (today_wib() - 30), 'Servis rutin')", [M1])
    assert.deepEqual([(await motor(M1)).st, (await motor(M1)).sb], [m.st, m.sb])
    // asuransi menanggung → biaya wajib 0
    await q("insert into servis_motor (motor_id, tanggal, jenis, ditanggung_asuransi, biaya) values ($1, $2, 'Ganti baterai', true, 0)", [M1, hari])
    await assert.rejects(q("insert into servis_motor (motor_id, tanggal, jenis, ditanggung_asuransi, biaya) values ($1, $2, 'Ganti baterai', true, 5000)", [M1, hari]), /check constraint/)
    await assert.rejects(q("insert into servis_motor (motor_id, tanggal, jenis) values ($1, $2, 'Lainnya')", [M1, hari]), /check constraint/) // Lainnya wajib diisi
    await assert.rejects(q("insert into servis_motor (motor_id, tanggal, jenis, foto) values ($1, $2, 'Ganti ban', $3::text[])", [M1, hari, ['a', 'b', 'c', 'd', 'e']]), /check constraint/) // maks 4 foto
    await assert.rejects(q("insert into servis_motor (motor_id, tanggal, jenis) values ($1, $2, 'Ganti ban')", [M3, hari]), /row-level security/) // DS lain
  })
  await as(CG, async () => {
    assert.ok((await q('select * from servis_motor')).length >= 3) // Captain melihat servis motor DS-nya
    await assert.rejects(q("insert into servis_motor (motor_id, tanggal, jenis) values ($1, $2, 'Ganti ban')", [M1, hari]), /row-level security/)
  })
  await as(CA, async () => assert.equal((await q('select * from servis_motor')).length, 0)) // bukan motor DS-nya
})

test('Kerusakan: Captain melapor untuk motor DS-nya (tanpa biaya), Super-admin/Arcon memproses; status motor ikut', async () => {
  const lapor = (mid, extra = {}) => {
    const v = { pelapor: R_CG, status: 'dilaporkan', biaya: 0, asuransi: false, ...extra }
    return q("insert into kerusakan_motor (motor_id, jenis, keparahan, deskripsi, pelapor_id, status, biaya, ditanggung_asuransi) values ($1, 'Rem', 'sedang', 'rem blong', $2, $3, $4, $5) returning id", [mid, v.pelapor, v.status, v.biaya, v.asuransi])
  }
  let kid
  await as(CG, async () => {
    kid = (await lapor(M1))[0].id
    await assert.rejects(lapor(M2), /row-level security/) // motor DS lain
    await assert.rejects(lapor(M1, { biaya: 5000 }), /row-level security/) // Captain tak mengisi biaya
    await assert.rejects(lapor(M1, { status: 'diproses' }), /row-level security/)
    await assert.rejects(lapor(M1, { pelapor: R_CA }), /row-level security/) // harus atas namanya
    assert.equal((await q("update kerusakan_motor set status = 'selesai' where id = $1 returning id", [kid])).length, 0) // tak bisa mengubah laporan
    assert.equal((await q('select * from kerusakan_motor')).length, 1)
  })
  await as(CA, async () => assert.equal((await q('select * from kerusakan_motor')).length, 0))
  await as(AA, async () => {
    await assert.rejects(q('update kerusakan_motor set ditanggung_asuransi = true, biaya = 1000 where id = $1', [kid]), /check constraint/)
    await assert.rejects(q("insert into kerusakan_motor (motor_id, jenis, keparahan, deskripsi) values ($1, 'Lainnya', 'ringan', 'x')", [M1]), /check constraint/) // Lainnya wajib diisi
    await q("update kerusakan_motor set status = 'diproses', ditanggung_asuransi = true, biaya = 0, catatan_perbaikan = 'diklaim asuransi' where id = $1", [kid])
    assert.equal((await motor(M1)).status, 'perbaikan') // sedang diproses → motor dalam perbaikan
    await q("update kerusakan_motor set status = 'selesai', ditanggung_asuransi = false, biaya = 275000 where id = $1", [kid])
    const k = (await q('select status, tanggal_selesai::text ts, biaya from kerusakan_motor where id = $1', [kid]))[0]
    assert.deepEqual([k.status, k.ts, k.biaya], ['selesai', await hariIni(), 275000]) // tanggal selesai terisi otomatis
    assert.equal((await motor(M1)).status, 'dipakai') // kembali, karena masih dipegang rider
    // jenis 'Lainnya' dengan keterangan boleh
    await q("insert into kerusakan_motor (motor_id, jenis, jenis_lain, keparahan, deskripsi) values ($1, 'Lainnya', 'Kaca spion pecah', 'ringan', 'jatuh')", [M2])
  })
})

test('Pindah DS: hanya Super-admin atau Arcon yang memegang DS asal dan tujuan, dengan syarat dan tercatat', async () => {
  await as(CG, async () => await assert.rejects(q("select pindah_motor($1::uuid, $2::uuid, 'x')", [M1, ALSUT]), /Hanya Super-admin/))
  await as(null, async () => await assert.rejects(q("select pindah_motor($1::uuid, $2::uuid, 'x')", [M1, ALSUT]), /permission denied/))
  await as(AA, async () => {
    await assert.rejects(q("select pindah_motor($1::uuid, $2::uuid, 'x')", [M1, GOWA]), /Hanya Super-admin, atau Arcon/) // Gowa bukan miliknya
    await assert.rejects(q("select pindah_motor($1::uuid, $2::uuid, 'x')", [M3, ALSUT]), /Hanya Super-admin, atau Arcon/) // motor DS lain
    await assert.rejects(q("select pindah_motor($1::uuid, $2::uuid, '  ')", [M1, ALSUT]), /Alasan pemindahan wajib/)
    await assert.rejects(q("select pindah_motor($1::uuid, $2::uuid, 'x')", [M1, GALAXY]), /sudah berada/)
    // M2 punya laporan kerusakan yang belum selesai → tidak boleh dipindah
    await assert.rejects(q("select pindah_motor($1::uuid, $2::uuid, 'x')", [M2, GALAXY]), /belum selesai/)
    // M1 bersih → boleh; pemegang dilepas; tercatat
    await q("select pindah_motor($1::uuid, $2::uuid, 'DS Galaxy kelebihan motor')", [M1, ALSUT])
    const m = await motor(M1)
    assert.deepEqual([m.ds_id, m.dipegang_oleh, m.status], [ALSUT, null, 'di gudang'])
    const h = (await q('select dari_ds, ke_ds, alasan, oleh from perpindahan_motor'))[0]
    assert.deepEqual([h.dari_ds, h.ke_ds, h.alasan, h.oleh], [GALAXY, ALSUT, 'DS Galaxy kelebihan motor', R_AA])
    assert.equal((await q("select * from log_aktivitas where aksi = 'pindah motor'")).length, 1)
  })
  // setelah pindah: Captain Galaxy tak lagi melihat motor itu; Captain Alsut melihatnya beserta riwayat servis/kerusakannya
  await as(CG, async () => assert.deepEqual(await kode(), ['EV-004']))
  await as(CA, async () => {
    assert.deepEqual(await kode(), ['EV-001', 'EV-002'])
    assert.ok((await q('select * from servis_motor where motor_id = $1', [M1])).length >= 3)
    assert.equal((await q('select * from kerusakan_motor where motor_id = $1', [M1])).length, 1)
  })
  await as(S, async () => {
    await q("select pindah_motor($1::uuid, $2::uuid, 'Pemerataan armada')", [M3, GALAXY]) // Super-admin lintas DS
    assert.equal((await motor(M3)).ds_id, GALAXY)
    assert.equal((await q('select * from perpindahan_motor')).length, 2)
  })
  await as(AB, async () => {
    const r = await q('select dari_ds, ke_ds from perpindahan_motor') // hanya pemindahan yang menyangkut Gowa (keluar dari Gowa)
    assert.deepEqual(r.map((x) => [x.dari_ds, x.ke_ds]), [[GOWA, GALAXY]])
  })
})

test('Pengajuan servis: dibuat Super-admin/Arcon untuk semua motor di cakupan, selesai otomatis saat servis dicatat, jadi riwayat', async () => {
  const hari = await hariIni()
  const buat = (judul, jenis = 'Servis rutin', tenggat = null, ds = null) =>
    q('select buat_permintaan_servis($1, $2, $3::date, null, $4::uuid) id', [judul, jenis, tenggat, ds]).then((r) => r[0].id)
  const item = (pid) => q('select m.kode_motor, i.status, i.servis_id, i.selesai_pada::text sp from permintaan_servis_item i join motor m on m.id = i.motor_id where i.permintaan_id = $1 order by m.kode_motor', [pid])
  const statusReq = async (pid) => (await q('select status from permintaan_servis where id = $1', [pid]))[0].status
  const M4 = (await q("select id from motor where kode_motor = 'EV-004'"))[0].id
  let pid
  await as(CG, async () => await assert.rejects(buat('x'), /Hanya Super-admin atau Arcon/))
  await as(AB, async () => await assert.rejects(buat('Servis Oktober'), /Tidak ada motor/)) // Gowa tidak punya motor lagi
  await as(AA, async () => {
    await assert.rejects(buat('  '), /Judul pengajuan wajib/)
    await assert.rejects(buat('x', 'Servis rutin', '2000-01-01'), /masa lalu/)
    await assert.rejects(buat('x', 'Servis rutin', null, GOWA), /bukan milik Anda/)
    pid = await buat('Servis rutin Oktober', 'Servis rutin', hari)
    assert.deepEqual((await item(pid)).map((x) => [x.kode_motor, x.status]), [['EV-001', 'diminta'], ['EV-002', 'diminta'], ['EV-003', 'diminta'], ['EV-004', 'diminta']])
    assert.equal(await statusReq(pid), 'berjalan')
    const rs = (await q('select total, selesai, dilewati, menunggu from ringkasan_permintaan() where permintaan_id = $1', [pid]))[0]
    assert.deepEqual([rs.total, rs.selesai, rs.dilewati, rs.menunggu], [4, 0, 0, 4])
  })
  // siapa melihat: Captain hanya motor DS-nya, Arcon Gowa tidak melihat apa pun
  await as(CG, async () => {
    assert.deepEqual((await item(pid)).map((x) => x.kode_motor), ['EV-003', 'EV-004'])
    assert.equal((await q('select * from permintaan_servis')).length, 1)
    assert.equal((await q("update permintaan_servis_item set status = 'selesai' where permintaan_id = $1 returning id", [pid])).length, 0) // Captain tak bisa mengubah
  })
  await as(CA, async () => assert.deepEqual((await item(pid)).map((x) => x.kode_motor), ['EV-001', 'EV-002']))
  await as(AB, async () => assert.equal((await q('select * from permintaan_servis')).length, 0))
  await as(AA, async () => {
    // servis jenis lain tidak menyelesaikan; servis rutin menyelesaikan dan menautkan
    await q("insert into servis_motor (motor_id, tanggal, jenis) values ($1, $2, 'Ganti ban')", [M3, hari])
    assert.equal((await item(pid))[2].status, 'diminta')
    await q("insert into servis_motor (motor_id, tanggal, jenis, bengkel) values ($1, $2, 'Servis rutin', 'Bengkel A')", [M3, hari])
    const i3 = (await item(pid))[2]
    assert.deepEqual([i3.status, i3.sp], ['selesai', hari])
    assert.ok(i3.servis_id)
    // dilewati wajib alasan, dijadwalkan wajib tanggal, motor tidak bisa diganti
    await assert.rejects(q("update permintaan_servis_item set status = 'dilewati' where permintaan_id = $1 and motor_id = $2", [pid, M4]), /check constraint/)
    await assert.rejects(q("update permintaan_servis_item set status = 'dijadwalkan' where permintaan_id = $1 and motor_id = $2", [pid, M4]), /check constraint/)
    await q("update permintaan_servis_item set status = 'dijadwalkan', tanggal_jadwal = $3 where permintaan_id = $1 and motor_id = $2", [pid, M4, hari])
    await assert.rejects(q('update permintaan_servis_item set motor_id = $2 where permintaan_id = $1 and motor_id = $3', [pid, M3, M4]), /tidak bisa diganti/)
    assert.equal(await statusReq(pid), 'berjalan') // masih ada yang menunggu
    // sisa motor diservis → pengajuan selesai otomatis dan tersimpan sebagai riwayat
    for (const m of [M1, M2, M4]) await q("insert into servis_motor (motor_id, tanggal, jenis) values ($1, $2, 'Servis rutin')", [m, hari])
    assert.ok((await item(pid)).every((x) => x.status === 'selesai'))
    const h = (await q('select status, ditutup is not null tutup from permintaan_servis where id = $1', [pid]))[0]
    assert.deepEqual([h.status, h.tutup], ['selesai', true])
    // pengajuan per DS; item dilewati ikut menutup; dibuka lagi → berjalan
    const p2 = await buat('Servis rutin November', 'Servis rutin', null, GALAXY)
    assert.equal((await item(p2)).length, 2)
    await q("update permintaan_servis_item set status = 'dilewati', catatan = 'motor dijual' where permintaan_id = $1", [p2])
    assert.equal(await statusReq(p2), 'selesai')
    await q("update permintaan_servis_item set status = 'diminta' where permintaan_id = $1 and motor_id = $2", [p2, M3])
    assert.equal(await statusReq(p2), 'berjalan')
  })
  await as(S, async () => {
    const semua = await buat('Servis semua motor')
    assert.equal((await item(semua)).length, 4) // Super-admin: semua DS
    await assert.rejects(buat('x', 'Servis rutin', null, GOWA), /Tidak ada motor/)
    assert.equal((await q('select * from permintaan_servis')).length, 3)
  })
})

test('Pengajuan massal (motor dipilih + daftar part) oleh Arcon, dan servis mendesak oleh Captain', async () => {
  const M9 = id(204)
  await db.exec(`insert into motor (id, kode_motor, ds_id) values ('${M9}', 'EV-009', '${GOWA}')`)
  const ajukan = (motors, parts = [], judul = 'Servis rutin + ganti part') =>
    q("select buat_permintaan_servis($1, 'Servis rutin', null, null, null, $2::uuid[], $3::text[]) id", [judul, motors, parts]).then((r) => r[0].id)
  let pid
  await as(CG, async () => await assert.rejects(ajukan([M3]), /Hanya Super-admin atau Arcon/)) // Captain tidak mengajukan rutin
  await as(AA, async () => {
    await assert.rejects(ajukan([]), /Pilih minimal satu motor/)
    await assert.rejects(ajukan([M1, M9]), /bukan milik Anda/) // M9 ada di Gowa
    pid = await ajukan([M1, M3], ['Ganti ban', 'Ganti rem'])
    const it = await q('select m.kode_motor from permintaan_servis_item i join motor m on m.id = i.motor_id where i.permintaan_id = $1 order by 1', [pid])
    assert.deepEqual(it.map((x) => x.kode_motor), ['EV-001', 'EV-003']) // hanya motor yang dipilih
    assert.deepEqual((await q('select pekerjaan from permintaan_servis where id = $1', [pid]))[0].pekerjaan, ['Ganti ban', 'Ganti rem'])
    await q("insert into servis_motor (motor_id, tanggal, jenis, pekerjaan) values ($1, today_wib(), 'Servis rutin', $2::text[])", [M1, ['Ganti ban', 'Ganti rem']])
    const s = (await q('select pekerjaan from servis_motor where motor_id = $1 and cardinality(pekerjaan) > 0', [M1]))[0]
    assert.deepEqual(s.pekerjaan, ['Ganti ban', 'Ganti rem']) // part yang diganti tersimpan di catatan servis
  })
  await as(AB, async () => await assert.rejects(ajukan([M1]), /bukan milik Anda/)) // motor DS lain
  const mendesak = (motor, alasan = 'Ban belakang bocor, motor tidak bisa jalan') => q('select ajukan_servis_mendesak($1::uuid, $2) id', [motor, alasan]).then((r) => r[0].id)
  let urg
  await as(CG, async () => {
    await assert.rejects(mendesak(M1), /tidak berwenang/) // motor DS lain
    await assert.rejects(mendesak(M3, '  '), /Alasan servis mendesak wajib/)
    urg = await mendesak(M3)
    const h = (await q('select urgent, judul from permintaan_servis where id = $1', [urg]))[0]
    assert.deepEqual([h.urgent, h.judul], [true, 'Servis mendesak EV-003'])
    await assert.rejects(mendesak(M3), /sudah punya pengajuan servis mendesak/)
  })
  await as(CA, async () => assert.equal((await q('select * from permintaan_servis where id = $1', [urg])).length, 0)) // Captain DS lain tidak melihat
  await as(AA, async () => assert.equal((await q('select * from permintaan_servis where id = $1', [urg])).length, 1)) // Arcon DS-nya melihat
  await as(AB, async () => assert.equal((await q('select * from permintaan_servis where id = $1', [urg])).length, 0))
  await as(null, async () => await assert.rejects(mendesak(M3), /permission denied/))
})

test('Foto di Storage: nama berkas {motor_id}/..., akses mengikuti hak lihat motor, hapus hanya Super-admin dan Arcon', async () => {
  const boleh = (nama, hapus) => q('select armada_boleh($1, $2) b', [nama, hapus]).then((r) => r[0].b)
  await as(CA, async () => {
    assert.equal(await boleh(`${M2}/a.jpg`, false), true) // motor DS-nya
    assert.equal(await boleh(`${M2}/a.jpg`, true), false) // Captain tak boleh menghapus
    assert.equal(await boleh(`${M3}/a.jpg`, false), false) // motor DS lain (kini di Galaxy)
    assert.equal(await boleh('bukan-uuid/a.jpg', false), false)
  })
  await as(AA, async () => {
    assert.equal(await boleh(`${M2}/a.jpg`, true), true)
    assert.equal(await boleh(`${M3}/a.jpg`, true), true) // M3 kini di Galaxy, yang dipegang Arcon A
  })
  await as(AB, async () => assert.equal(await boleh(`${M3}/a.jpg`, false), false)) // Arcon B hanya memegang Gowa
})

test('Hapus motor dan pengajuan hanya Super-admin; riwayat ikut terhapus dan pengajuan induk menyesuaikan', async () => {
  const [X1, X2] = [id(291), id(292)]
  await db.exec(`insert into motor (id, kode_motor, ds_id) values ('${X1}', 'EV-X1', '${GALAXY}'), ('${X2}', 'EV-X2', '${GALAXY}')`)
  await q("insert into servis_motor (motor_id, tanggal, jenis) values ($1, today_wib(), 'Ganti ban')", [X1])
  const [{ id: P }] = await q("insert into permintaan_servis (judul, jenis) values ('Uji hapus', 'Servis rutin') returning id")
  await q('insert into permintaan_servis_item (permintaan_id, motor_id) values ($1, $2), ($1, $3)', [P, X1, X2])
  const hapus = (tabel, rid) => q(`delete from ${tabel} where id = $1 returning id`, [rid])

  const hapusMotor = (mid, alasan) => q('select hapus_motor($1, $2)', [mid, alasan])
  await as(AA, async () => await assert.rejects(hapusMotor(X1, 'salah plat'), /Hanya Super-admin/)) // Arcon boleh mengubah, tidak boleh menghapus
  await as(CG, async () => await assert.rejects(hapusMotor(X1, 'salah plat'), /Hanya Super-admin/))
  await as(S, async () => {
    assert.equal((await hapus('motor', X1)).length, 0) // jalan pintas lewat tabel ditutup
    await assert.rejects(hapusMotor(X1, '  '), /Alasan penghapusan wajib/)
    await hapusMotor(X1, 'Salah input plat')
    const [r] = await q("select kode_motor, alasan, jumlah_servis, ds_id, data->>'kode_motor' k from motor_dihapus where motor_id = $1", [X1])
    assert.deepEqual({ ...r }, { kode_motor: 'EV-X1', alasan: 'Salah input plat', jumlah_servis: 1, ds_id: GALAXY, k: 'EV-X1' })
  })
  await as(AA, async () => assert.equal((await q('select * from motor_dihapus')).length, 0)) // riwayat hanya untuk Super-admin
  assert.equal((await q('select * from servis_motor where motor_id = $1', [X1])).length, 0)
  assert.equal((await q('select * from permintaan_servis_item where permintaan_id = $1', [P])).length, 1)
  assert.equal((await q('select status from permintaan_servis where id = $1', [P]))[0].status, 'berjalan')

  await as(S, async () => await hapusMotor(X2, 'Duplikat')) // item terakhir hilang: pengajuan selesai
  assert.equal((await q('select status from permintaan_servis where id = $1', [P]))[0].status, 'selesai')

  const hapusPengajuan = (pid, alasan) => q('select hapus_permintaan($1, $2)', [pid, alasan])
  await as(AA, async () => await assert.rejects(hapusPengajuan(P, 'salah buat'), /Hanya Super-admin/))
  await as(CG, async () => await assert.rejects(hapusPengajuan(P, 'salah buat'), /Hanya Super-admin/))
  await as(S, async () => {
    assert.equal((await hapus('permintaan_servis', P)).length, 0) // jalan pintas lewat tabel ditutup
    await assert.rejects(hapusPengajuan(P, ' '), /Alasan penghapusan wajib/)
    await hapusPengajuan(P, 'Salah buat')
    const [r] = await q("select judul, alasan, jumlah_motor, jsonb_array_length(data->'item') n from permintaan_dihapus where permintaan_id = $1", [P])
    assert.deepEqual({ ...r }, { judul: 'Uji hapus', alasan: 'Salah buat', jumlah_motor: 0, n: 0 })
  })
  assert.equal((await q('select * from permintaan_servis where id = $1', [P])).length, 0)
  await as(AA, async () => assert.equal((await q('select * from permintaan_dihapus')).length, 0))
})
