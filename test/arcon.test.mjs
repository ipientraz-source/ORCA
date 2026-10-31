// Uji peran Arcon: atasan Captain yang memegang beberapa DS (RLS + RPC), di Postgres (PGlite).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const S = 'super@test.local', CG = 'cap-galaxy@test.local', AA = 'arcon-a@test.local', AB = 'arcon-b@test.local'
const GALAXY = id(101), ALSUT = id(102), GOWA = id(103)
const [R_CG, R_CA, R_CW, R_AA, R_AB, R_G, R_A, R_W] = [id(10), id(11), id(12), id(30), id(31), id(21), id(22), id(23)]

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
const nama = async () => (await q('select nama from riders order by nama')).map((r) => r.nama)

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
      ('${R_CA}', 'MTR-CA', 'Captain Alsut', '${ALSUT}', 'captain', 'cap-alsut@test.local', 'aktif'),
      ('${R_CW}', 'MTR-CW', 'Captain Gowa', '${GOWA}', 'captain', 'cap-gowa@test.local', 'aktif'),
      ('${R_AA}', null, 'Arcon A', null, 'arcon', '${AA}', 'aktif'),
      ('${R_AB}', null, 'Arcon B', null, 'arcon', '${AB}', 'aktif'),
      ('${R_G}', 'MTR021', 'Rider Galaxy', '${GALAXY}', 'rider', null, 'aktif'),
      ('${R_A}', 'MTR022', 'Rider Alsut', '${ALSUT}', 'rider', null, 'aktif'),
      ('${R_W}', 'MTR023', 'Rider Gowa', '${GOWA}', 'rider', null, 'aktif'),
      ('${id(24)}', 'MTR024', 'Rider Bebas', null, 'rider', null, 'aktif');
    update ds set captain_id = '${R_CG}', arcon_id = '${R_AA}' where id = '${GALAXY}';
    update ds set captain_id = '${R_CA}', arcon_id = '${R_AA}' where id = '${ALSUT}';
    update ds set captain_id = '${R_CW}', arcon_id = '${R_AB}' where id = '${GOWA}';
    insert into jadwal (tanggal, rider_id, shift, ds_id) values
      (today_wib(), '${R_G}', 'pagi', '${GALAXY}'), (today_wib(), '${R_A}', 'pagi', '${ALSUT}'), (today_wib(), '${R_W}', 'pagi', '${GOWA}');
    insert into actual_harian (tanggal, rider_id, ds_id, status) values
      (today_wib(), '${R_G}', '${GALAXY}', 'hadir'), (today_wib(), '${R_A}', '${ALSUT}', 'hadir'), (today_wib(), '${R_W}', '${GOWA}', 'hadir');`)
})
after(() => db.close())

test('Arcon A memegang 2 DS: melihat Galaxy + Alam Sutera, TIDAK melihat Gowa', async () => {
  await as(AA, async () => {
    assert.deepEqual(await nama(), ['Arcon A', 'Captain Alsut', 'Captain Galaxy', 'Rider Alsut', 'Rider Galaxy'])
    assert.equal((await q('select * from jadwal')).length, 2)
    assert.equal((await q('select * from actual_harian')).length, 2)
    assert.equal((await q('select * from jadwal where ds_id = $1', [GOWA])).length, 0)
    const lap = await q('select ds_nama from laporan_ds(today_wib(), today_wib())')
    assert.deepEqual(lap.map((x) => x.ds_nama), ['Alam Sutera', 'Galaxy'])
    assert.equal((await q('select * from laporan_rider(today_wib(), today_wib())')).length, 2)
  })
})

test('Arcon B memegang 1 DS: hanya Gowa. Captain tetap hanya DS-nya sendiri', async () => {
  await as(AB, async () => {
    assert.deepEqual(await nama(), ['Arcon B', 'Captain Gowa', 'Rider Gowa'])
    assert.deepEqual((await q('select ds_nama from laporan_ds(today_wib(), today_wib())')).map((x) => x.ds_nama), ['Gowa'])
  })
  await as(CG, async () => {
    assert.deepEqual(await nama(), ['Captain Galaxy', 'Rider Galaxy']) // tidak ikut melihat Alsut walau satu Arcon
  })
})

test('Status Arcon dan Captain hanya bisa diubah Super-admin; Captain tetap bisa mengubah status rider DS-nya', async () => {
  const ubah = (rid, st) => q('update riders set status = $2 where id = $1 returning id', [rid, st])
  await as(CG, async () => {
    await assert.rejects(ubah(R_CG, 'nonaktif'), /Hanya Super-admin yang boleh mengubah status Arcon dan Captain/) // dirinya sendiri
    assert.equal((await ubah(R_G, 'nonaktif')).length, 1) // rider DS-nya: boleh
    assert.equal((await ubah(R_G, 'aktif')).length, 1)
    assert.equal((await ubah(R_CA, 'nonaktif')).length, 0) // Captain DS lain: tak terlihat, tak terubah
  })
  await as(AA, async () => {
    await assert.rejects(ubah(R_CG, 'nonaktif'), /Hanya Super-admin yang boleh mengubah status Arcon dan Captain/) // Captain di DS yang dipegang: tetap hanya Super-admin
    assert.equal((await ubah(R_G, 'nonaktif')).length, 1) // rider di DS yang dipegang: boleh dinonaktifkan Arcon (mis. sudah tidak jalan)
    assert.equal((await ubah(R_G, 'aktif')).length, 1) // dan diaktifkan lagi
    assert.equal((await ubah(R_W, 'nonaktif')).length, 0) // rider di DS yang tidak dipegang: tak terlihat, tak terubah
    await assert.rejects(q("update riders set nama = 'x' where id = $1", [R_G]), /hanya boleh mengubah status rider/) // data lain tetap tidak boleh
  })
  await as(S, async () => {
    assert.equal((await ubah(R_CG, 'nonaktif')).length, 1)
    assert.equal((await ubah(R_CG, 'aktif')).length, 1)
    assert.equal((await ubah(R_AB, 'nonaktif')).length, 1)
    assert.equal((await ubah(R_AB, 'aktif')).length, 1)
  })
  assert.equal((await q("select count(*)::int n from riders where status = 'nonaktif'"))[0].n, 0)
})

test('Daftar jadwal semua DS: Super-admin melihat semua, Arcon hanya DS yang dipegang, Captain/rider/anon ditolak', async () => {
  const daftar = () => q("select ds_nama, rider, shift, libur_kunci from ringkasan_jadwal(today_wib() - 7, today_wib() + 7) order by ds_nama")
  await as(S, async () => {
    const r = await daftar()
    assert.deepEqual(r.map((x) => x.ds_nama), ['Alam Sutera', 'Galaxy', 'Gowa'])
    assert.deepEqual(r.map((x) => [x.rider, x.shift, x.libur_kunci]), [[1, 1, 0], [1, 1, 0], [1, 1, 0]])
  })
  await as(AA, async () => assert.deepEqual((await daftar()).map((x) => x.ds_nama), ['Alam Sutera', 'Galaxy'])) // Gowa bukan miliknya
  await as(AB, async () => assert.deepEqual((await daftar()).map((x) => x.ds_nama), ['Gowa']))
  await as(CG, async () => {
    await assert.rejects(daftar(), /Hanya Super-admin dan Arcon/)
    const j = await q('select distinct ds_id from jadwal') // Captain hanya membaca jadwal DS yang dia pegang
    assert.deepEqual(j.map((x) => x.ds_id), [GALAXY])
  })
  await as(null, async () => await assert.rejects(daftar(), /permission denied|Hanya Super-admin dan Arcon/))
  await as(S, async () => await assert.rejects(q('select * from ringkasan_jadwal(today_wib(), today_wib() - 1)'), /Rentang tanggal tidak valid/))
})

test('Arcon hanya memantau: tidak bisa menyusun jadwal, mengisi absensi, tarik rider, atau menulis langsung', async () => {
  await as(AA, async () => {
    await assert.rejects(q("select catat_actual(today_wib(), $1::uuid, 'hadir')", [R_G]), /Hanya Captain/)
    await assert.rejects(q('select simpan_jadwal($1::uuid, today_wib(), today_wib(), $2::jsonb)', [GOWA, '[]']), /Arcon yang memegangnya/) // DS yang tidak dipegang
    await assert.rejects(q('select tarik_rider($1::uuid)', [id(24)]), /Hanya Captain/)
    await assert.rejects(q("insert into actual_harian (tanggal, rider_id, ds_id, status) values (today_wib(), $1, $2, 'alpha')", [R_G, GALAXY]), /row-level security/)
    await assert.rejects(q("update riders set ds_id = null where id = $1", [R_G]), /hanya boleh mengubah status rider/) // memindahkan rider tetap bukan hak Arcon
    await assert.rejects(q("update ds set nama = 'X' where id = $1", [GALAXY]), /hanya boleh mengubah kebutuhan rider/) // nama DS tetap bukan hak Arcon
    await assert.rejects(q("select pilih_arcon($1::uuid, $2::uuid)", [GOWA, R_AA]), /Hanya Super-admin/)
    await assert.rejects(q('select lepas_arcon($1::uuid)', [GALAXY]), /Hanya Super-admin/)
  })
})

test('Arcon bisa mengunci absensi mingguan DS yang dipegang, bukan DS lain', async () => {
  const d = (await q(`select (date_trunc('week', today_wib()) - interval '7 days')::date::text w`))[0]
  await as(CG, () => q("select catat_actual($1::date, $2::uuid, 'hadir')", [d.w, R_G])) // Captain mengisi minggu lalu
  await as(AA, async () => {
    await assert.rejects(q('select kunci_periode($1::uuid, $2::date)', [GOWA, d.w]), /Tidak berwenang/)
    await q('select kunci_periode($1::uuid, $2::date)', [GALAXY, d.w])
    await q('select kunci_periode($1::uuid, $2::date)', [ALSUT, d.w]) // DS kedua milik Arcon yang sama
  })
  await as(CG, async () => {
    await assert.rejects(q("select catat_actual($1::date, $2::uuid, 'alpha', null, null, true, 0, true)", [d.w, R_G]), /sudah dikunci/)
  })
})

test('Super-admin bisa menyusun jadwal DS mana pun (tercatat di log); Arcon hanya DS yang dipegang; Captain DS lain tetap tidak bisa', async () => {
  const tgl = (await q('select today_wib()::text t'))[0].t
  const baris = JSON.stringify([{ tanggal: tgl, rider_id: R_G, shift: 'siang' }])
  await as(S, async () => {
    const n = await q('select simpan_jadwal($1::uuid, today_wib(), today_wib(), $2::jsonb) n', [GALAXY, baris])
    assert.equal(n[0].n, 1)
    assert.equal((await q('select shift from jadwal where rider_id = $1 and tanggal = $2', [R_G, tgl]))[0].shift, 'siang')
    // DS lain juga boleh, dan jejaknya atas nama Super-admin
    await q('select simpan_jadwal($1::uuid, today_wib(), today_wib(), $2::jsonb)', [GOWA, JSON.stringify([{ tanggal: tgl, rider_id: R_W, shift: 'siang' }])])
    const log = await q("select captain_id, detail from log_aktivitas where aksi = 'ubah jadwal' and captain_id = $1", [id(1)])
    assert.equal(log.length, 2)
    assert.match(log[0].detail, /Galaxy|Gowa/)
    // validasi tetap berlaku: rider DS lain ditolak
    await assert.rejects(q('select simpan_jadwal($1::uuid, today_wib(), today_wib(), $2::jsonb)', [GALAXY, JSON.stringify([{ tanggal: tgl, rider_id: R_W, shift: 'pagi' }])]), /bukan anggota DS/)
  })
  await as(AA, async () => {
    assert.equal((await q('select simpan_jadwal($1::uuid, today_wib(), today_wib(), $2::jsonb) n', [GALAXY, baris]))[0].n, 1) // Arcon boleh menyusun jadwal DS yang dipegang
    await assert.rejects(q('select simpan_jadwal($1::uuid, today_wib(), today_wib(), $2::jsonb)', [GOWA, JSON.stringify([{ tanggal: tgl, rider_id: R_W, shift: 'pagi' }])]), /Arcon yang memegangnya/) // bukan DS lain
  })
  await as(AB, async () => {
    await assert.rejects(q('select simpan_jadwal($1::uuid, today_wib(), today_wib(), $2::jsonb)', [GALAXY, baris]), /Arcon yang memegangnya/) // Arcon DS lain
  })
  await as(CG, async () => {
    await assert.rejects(q('select simpan_jadwal($1::uuid, today_wib(), today_wib(), $2::jsonb)', [GOWA, JSON.stringify([{ tanggal: tgl, rider_id: R_W, shift: 'pagi' }])]), /Arcon yang memegangnya/)
    await q('select simpan_jadwal($1::uuid, today_wib(), today_wib(), $2::jsonb)', [GALAXY, baris]) // DS sendiri tetap boleh
  })
})

test('Super-admin akses penuh absensi: isi, koreksi, hapus di DS mana pun; kunci tetap menolak sampai dibuka Super-admin', async () => {
  const w = (await q(`select (date_trunc('week', today_wib()) - interval '7 days')::date::text w`))[0].w
  await as(S, async () => {
    await q("select catat_actual($1::date, $2::uuid, 'alpha', null, 'dadakan', true, 0, true)", [w, R_W]) // rider Gowa, tanpa jadi Captain Gowa
    const a = (await q('select ds_id, diinput_oleh, status from actual_harian where rider_id = $1 and tanggal = $2', [R_W, w]))[0]
    assert.deepEqual([a.ds_id, a.diinput_oleh, a.status], [GOWA, id(1), 'alpha']) // DS diturunkan dari rider; jejak atas nama Super-admin
    await q("select catat_actual($1::date, $2::uuid, 'hadir')", [w, R_W]) // koreksi
    assert.equal((await q('select status from actual_harian where rider_id = $1 and tanggal = $2', [R_W, w]))[0].status, 'hadir')
    await assert.rejects(q("select catat_actual(today_wib(), $1::uuid, 'hadir')", [id(24)]), /belum punya DS/) // rider tanpa DS: pesan jelas
    // kunci periode tetap berlaku untuk siapa pun, termasuk Super-admin
    await q('select kunci_periode($1::uuid, $2::date)', [GOWA, w])
    await assert.rejects(q("select catat_actual($1::date, $2::uuid, 'alpha', null, null, true, 0, true)", [w, R_W]), /sudah dikunci/)
    // Super-admin membuka kunci → koreksi boleh lagi, dan pembukaan tercatat
    await q('select buka_kunci($1::uuid, $2::date)', [GOWA, w])
    await assert.rejects(q('select buka_kunci($1::uuid, $2::date)', [GOWA, w]), /tidak sedang dikunci/)
    await q("select catat_actual($1::date, $2::uuid, 'izin', null, 'ke dokter', false, 0, true)", [w, R_W])
    const b = (await q('select status, periode_terkunci from actual_harian where rider_id = $1 and tanggal = $2', [R_W, w]))[0]
    assert.deepEqual([b.status, b.periode_terkunci], ['izin', false])
    await q('select hapus_actual($1::date, $2::uuid)', [w, R_W])
    assert.equal((await q('select * from actual_harian where rider_id = $1 and tanggal = $2', [R_W, w])).length, 0)
    assert.equal((await q("select * from log_aktivitas where aksi = 'buka kunci' and captain_id = $1", [id(1)])).length, 1)
  })
  await as(AA, async () => {
    await assert.rejects(q('select buka_kunci($1::uuid, $2::date)', [GALAXY, w]), /Hanya Super-admin/) // Arcon boleh mengunci, bukan membuka
    await assert.rejects(q("select catat_actual($1::date, $2::uuid, 'hadir')", [w, R_G]), /Hanya Captain/)
    await assert.rejects(q('select hapus_actual($1::date, $2::uuid)', [w, R_G]), /Hanya Captain/)
  })
  await as(CG, async () => {
    await assert.rejects(q('select buka_kunci($1::uuid, $2::date)', [GALAXY, w]), /Hanya Super-admin/)
    await assert.rejects(q("select catat_actual($1::date, $2::uuid, 'hadir')", [w, R_W]), /bukan anggota DS Anda/) // rider DS lain
  })
})

test('Kuota per hari mengikuti permintaan client: Captain DS-nya, Arcon yang memegang, dan Super-admin boleh mengatur', async () => {
  const d = (await q(`select (date_trunc('week', today_wib()) + interval '7 days')::date::text sen, (date_trunc('week', today_wib()) + interval '12 days')::date::text sab`))[0]
  const rows = JSON.stringify([
    { tanggal: d.sen, pagi: 1, siang: 1, cadangan: 0 }, // sama dengan bawaan Galaxy (1+1): tidak disimpan
    { tanggal: d.sab, pagi: 5, siang: 3, cadangan: 1 }, // Sabtu ramai: kebutuhan client lebih besar + 1 cadangan
  ])
  const atur = (ds, r = rows) => q('select simpan_kuota($1::uuid, $2::date, $3::date, $4::jsonb) n', [ds, d.sen, d.sab, r])
  await as(CG, async () => {
    assert.equal((await atur(GALAXY))[0].n, 1) // hanya yang berbeda dari bawaan
    const t = await q('select tanggal::text, kuota_pagi, kuota_siang, cadangan from kuota_harian')
    assert.deepEqual(t.map((x) => [x.tanggal, x.kuota_pagi, x.kuota_siang, x.cadangan]), [[d.sab, 5, 3, 1]])
    // simpan ulang menimpa rentang itu
    assert.equal((await atur(GALAXY, JSON.stringify([{ tanggal: d.sab, pagi: 6, siang: 2, cadangan: 0 }])))[0].n, 1)
    assert.equal((await q('select kuota_pagi from kuota_harian'))[0].kuota_pagi, 6)
    await assert.rejects(atur(GOWA), /Arcon yang memegangnya/) // DS lain
    await assert.rejects(atur(GALAXY, JSON.stringify([{ tanggal: d.sab, pagi: -1, siang: 1 }])), /tidak valid/)
    await assert.rejects(atur(GALAXY, JSON.stringify([{ tanggal: '2000-01-01', pagi: 2, siang: 1 }])), /tidak valid/)
    await assert.rejects(atur(GALAXY, JSON.stringify([{ tanggal: d.sab, pagi: 2, siang: 1, cadangan: -2 }])), /tidak valid/)
    await assert.rejects(atur(GALAXY, JSON.stringify([{ tanggal: d.sab, pagi: 9999, siang: 1 }])), /check constraint|kuota_pagi/) // batas wajar di database
    assert.equal((await q('select * from kuota_harian where ds_id = $1', [GOWA])).length, 0) // CG tak melihat DS lain
    await assert.rejects(q('insert into kuota_harian (ds_id, tanggal, kuota_pagi, kuota_siang) values ($1, $2, 1, 1)', [GALAXY, d.sen]), /row-level security/) // tulis langsung ditutup
  })
  await as(AA, async () => {
    assert.equal((await q('select * from kuota_harian')).length, 1) // Arcon melihat kuota DS yang dipegang
    assert.equal((await atur(GALAXY, JSON.stringify([{ tanggal: d.sab, pagi: 5, siang: 3, cadangan: 1 }])))[0].n, 1) // dan boleh mengatur kebutuhan harian DS yang dipegang
  })
  await as(AB, async () => {
    assert.equal((await q('select * from kuota_harian')).length, 0) // Arcon Gowa tak melihat kuota Galaxy
    await assert.rejects(atur(GALAXY), /Arcon yang memegangnya/) // dan tak bisa mengubahnya
  })
  await as(S, async () => {
    await atur(GOWA, JSON.stringify([{ tanggal: d.sab, pagi: 4, siang: 2, cadangan: 0 }]))
    assert.equal((await q('select * from kuota_harian')).length, 2) // Super-admin: semua DS
    assert.ok((await q("select * from log_aktivitas where aksi = 'ubah kuota' and captain_id = $1", [id(1)])).length >= 1)
  })
  await as(null, async () => {
    await assert.rejects(q('select * from kuota_harian'), /permission denied/)
    await assert.rejects(atur(GALAXY), /permission denied/)
  })
})

test('Arcon mengatur kebutuhan rider (kuota) dan menunjuk Captain hanya di DS yang dipegang, dari rider DS itu sendiri', async () => {
  await as(AA, async () => {
    // kuota DS yang dipegang: boleh; nama, Captain, Arcon, grup WA: tidak
    assert.equal((await q('update ds set kuota_pagi = 4, kuota_siang = 3 where id = $1 returning id', [GALAXY])).length, 1)
    await assert.rejects(q("update ds set nama = 'Baru' where id = $1", [GALAXY]), /hanya boleh mengubah kebutuhan rider/)
    await assert.rejects(q('update ds set captain_id = $2 where id = $1', [GALAXY, R_A]), /hanya boleh mengubah kebutuhan rider/)
    // DS yang tidak dipegang: tak terlihat dan tak terubah
    assert.equal((await q('update ds set kuota_pagi = 7 where id = $1 returning id', [GOWA])).length, 0)
    // tunjuk Captain di DS yang dipegang, dari rider DS itu: Captain lama kembali jadi rider
    await q('select tunjuk_captain($1::uuid, $2::uuid, $3)', [ALSUT, R_A, 'captain-baru@test.local'])
    assert.equal((await q('select captain_id from ds where id = $1', [ALSUT]))[0].captain_id, R_A)
    assert.deepEqual((await q('select id, peran from riders where id in ($1, $2) order by id', [R_CA, R_A])).map((r) => r.peran), ['rider', 'captain'])
    // rider dari DS lain tidak bisa dipakai; DS yang tidak dipegang ditolak
    await assert.rejects(q('select tunjuk_captain($1::uuid, $2::uuid, $3)', [GALAXY, R_W, 'x@test.local']), /Arcon hanya bisa memilih Captain dari rider DS itu sendiri/)
    await assert.rejects(q('select tunjuk_captain($1::uuid, $2::uuid, $3)', [GOWA, R_W, 'x@test.local']), /Arcon yang memegang DS ini/)
  })
  await as(CG, () => assert.rejects(q('select tunjuk_captain($1::uuid, $2::uuid, $3)', [GALAXY, R_G, 'x@test.local']), /Hanya Super-admin/)) // Captain tetap tidak bisa
  // kembalikan keadaan awal untuk tes berikutnya
  await as(S, async () => {
    await q('select tunjuk_captain($1::uuid, $2::uuid, $3)', [ALSUT, R_CA, 'cap-alsut@test.local'])
    await q('update ds set kuota_pagi = 1, kuota_siang = 1 where id = $1', [GALAXY])
  })
  assert.equal((await q('select captain_id from ds where id = $1', [ALSUT]))[0].captain_id, R_CA)
})

test('Super-admin memilih Arcon di DS: Arcon bukan rider (tim khusus), satu Arcon banyak DS, Arcon lama tetap Arcon', async () => {
  await as(S, async () => {
    // hanya orang berperan Arcon yang bisa dipilih: rider, Captain, dan Super-admin ditolak
    await assert.rejects(q('select pilih_arcon($1::uuid, $2::uuid)', [GALAXY, R_CG]), /Arcon tidak ditemukan/)
    await assert.rejects(q('select pilih_arcon($1::uuid, $2::uuid)', [GALAXY, R_G]), /Arcon tidak ditemukan/)
    await assert.rejects(q('select pilih_arcon($1::uuid, $2::uuid)', [GALAXY, id(1)]), /Arcon tidak ditemukan/)
    await assert.rejects(q("select tunjuk_captain($1::uuid, $2::uuid, 'x@y.z')", [ALSUT, R_AA]), /Rider tidak ditemukan/) // Arcon tak bisa jadi Captain
    // Arcon baru dibuat langsung sebagai pengguna Arcon (bukan dari rider), lalu dipilih
    const baru = (await q("insert into riders (nama, email, peran) values ('Arcon Baru', ' Arcon-C@Test.Local ', 'arcon') returning id, email, kode_mtr"))[0]
    assert.equal(baru.email, 'arcon-c@test.local')
    assert.equal(baru.kode_mtr, null) // tanpa Kode MTR: bukan rider
    await q('select pilih_arcon($1::uuid, $2::uuid)', [GALAXY, baru.id])
    // Gowa dipindah ke Arcon A (kini memegang 3 DS) → Arcon B kehilangan DS terakhirnya tapi tetap Arcon
    await q('select pilih_arcon($1::uuid, $2::uuid)', [GOWA, R_AA])
    assert.equal((await q('select count(*)::int n from ds where arcon_id = $1', [R_AA]))[0].n, 2)
    assert.equal((await q('select peran from riders where id = $1', [R_AB]))[0].peran, 'arcon')
    await q('select pilih_arcon($1::uuid, $2::uuid)', [GALAXY, R_AA]) // kembalikan Galaxy ke Arcon A
    assert.equal((await q('select count(*)::int n from ds where arcon_id = $1', [R_AA]))[0].n, 3)
    // Arcon nonaktif tidak bisa dipilih
    await q("update riders set status = 'nonaktif' where id = $1", [baru.id])
    await assert.rejects(q('select pilih_arcon($1::uuid, $2::uuid)', [ALSUT, baru.id]), /Arcon tidak ditemukan atau nonaktif/)
  })
  await as(AA, async () => {
    assert.ok((await nama()).includes('Rider Gowa')) // sekarang ikut memantau Gowa
  })
  await as(AB, async () => {
    assert.deepEqual(await nama(), ['Arcon B']) // tak memegang DS: tidak melihat rider/Captain, hanya dirinya
    assert.equal((await q('select * from jadwal')).length, 0)
  })
})

test('Super-admin menaikkan Captain jadi Arcon: email dan riwayat tetap, DS dilepas, kursi Captain kosong; hanya Captain yang bisa dinaikkan', async () => {
  const [DU, CU, RU] = [id(150), id(151), id(152)]
  await db.exec(`
    insert into ds (id, nama, kuota_pagi, kuota_siang) values ('${DU}', 'DS Uji Naik', 1, 1);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${CU}', 'MTR-CU', 'Captain Uji', '${DU}', 'captain', 'cap-uji@test.local', 'aktif'),
      ('${RU}', 'MTR-RU', 'Rider Uji', '${DU}', 'rider', null, 'aktif');
    update ds set captain_id = '${CU}' where id = '${DU}';`)
  await as(AA, async () => await assert.rejects(q('select jadikan_arcon($1)', [CU]), /Hanya Super-admin/))
  await as('cap-uji@test.local', async () => await assert.rejects(q('select jadikan_arcon($1)', [CU]), /Hanya Super-admin/))
  await as(S, async () => {
    await assert.rejects(q('select jadikan_arcon($1)', [RU]), /Hanya Captain/) // rider biasa tidak
    await assert.rejects(q('select jadikan_arcon($1)', [R_AA]), /Hanya Captain/) // yang sudah Arcon tidak
    assert.equal((await q('select jadikan_arcon($1) n', [CU]))[0].n, 1)
  })
  const [r] = await q('select peran, ds_id, email, status from riders where id = $1', [CU])
  assert.deepEqual({ ...r }, { peran: 'arcon', ds_id: null, email: 'cap-uji@test.local', status: 'aktif' })
  assert.equal((await q('select captain_id from ds where id = $1', [DU]))[0].captain_id, null)
  await as(S, async () => await q('select pilih_arcon($1, $2)', [DU, CU])) // langsung bisa dipilih sebagai Arcon DS
  await as('cap-uji@test.local', async () => assert.deepEqual(await nama(), ['Captain Uji', 'Rider Uji'])) // kini melihat DS-nya sebagai Arcon
})

test('Melepas Arcon dari semua DS menutup aksesnya tapi orangnya tetap Arcon; anon tak bisa memanggil', async () => {
  await as(S, async () => {
    await q('select lepas_arcon($1::uuid)', [GOWA])
    await q('select lepas_arcon($1::uuid)', [GALAXY])
    await q('select lepas_arcon($1::uuid)', [ALSUT])
    assert.equal((await q('select peran from riders where id = $1', [R_AA]))[0].peran, 'arcon') // tidak diturunkan jadi rider
    assert.equal((await q('select count(*)::int n from ds where arcon_id = $1', [R_AA]))[0].n, 0)
  })
  await as(AA, async () => {
    assert.deepEqual(await nama(), ['Arcon A']) // tanpa DS: tak melihat apa pun selain dirinya
    assert.equal((await q('select * from jadwal')).length, 0)
  })
  await as(null, async () => {
    await assert.rejects(q('select pilih_arcon($1::uuid, $2::uuid)', [GOWA, R_AA]), /permission denied/)
  })
})
