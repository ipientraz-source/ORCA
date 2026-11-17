// Uji aturan PRD langsung di Postgres (PGlite): RLS per-DS, RPC, kunci periode, import, laporan.
// Meniru PostgREST: `set role` + klaim JWT (email). Jalankan: npm test
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const S = 'super@test.local', A = 'cap-a@test.local', B = 'cap-b@test.local'
const GALAXY = id(101), ALSUT = id(102)
const [CA, CB, R1, R2, R3, R4, R5] = [id(10), id(11), id(21), id(22), id(23), id(24), id(25)]

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
// potongan wajib dijawab untuk alpha/izin/sakit; bawaan di tes: Ya
// tanpa pengganti: alpha/izin/sakit wajib punya pengganti ATAU memilih "Tidak dapat pengganti"; bawaan di tes: bila tak ada backup, pilih "Tidak dapat pengganti"
const catat = (tgl, rider, status, backup = null, teks = null, potongan = ['alpha', 'izin', 'sakit'].includes(status) ? true : null, insentif = 0, tanpa = ['alpha', 'izin', 'sakit'].includes(status) && backup === null) =>
  q('select catat_actual($1::date, $2::uuid, $3::actual_status_t, $4::uuid, $5::text, $6::boolean, $7::int, $8::boolean)', [tgl, rider, status, backup, teks, potongan, insentif, tanpa])

before(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.jwt() to anon, authenticated;`)
  for (const f of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'))
  await db.exec('grant select, insert, update, delete on all tables in schema public to authenticated') // default privilege Supabase
  await db.exec(`
    insert into ds (id, nama, kuota_pagi, kuota_siang) values ('${GALAXY}', 'Galaxy', 2, 1), ('${ALSUT}', 'Alam Sutera', 1, 1);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${id(1)}', null, 'Super', null, 'super_admin', '${S}', 'aktif'),
      ('${CA}', 'MTR-CA', 'Captain A', '${GALAXY}', 'captain', '${A}', 'aktif'),
      ('${CB}', 'MTR-CB', 'Captain B', '${ALSUT}', 'captain', '${B}', 'aktif'),
      ('${R1}', 'MTR001', 'Rider 1', '${GALAXY}', 'rider', null, 'aktif'),
      ('${R2}', 'MTR002', 'Rider 2', '${GALAXY}', 'rider', null, 'aktif'),
      ('${R3}', 'MTR003', 'Rider 3', '${ALSUT}', 'rider', null, 'aktif'),
      ('${R4}', 'MTR004', 'Rider 4', null, 'rider', null, 'aktif'),
      ('${R5}', 'MTR005', 'Rider 5', '${GALAXY}', 'rider', null, 'nonaktif');
    update ds set captain_id = '${CA}' where id = '${GALAXY}';
    update ds set captain_id = '${CB}' where id = '${ALSUT}';
    insert into jadwal (tanggal, rider_id, shift, ds_id) values (today_wib(), '${R3}', 'pagi', '${ALSUT}');
    insert into actual_harian (tanggal, rider_id, ds_id, status) values (today_wib(), '${R3}', '${ALSUT}', 'hadir');`)
})
after(() => db.close())

test('anon: tabel dan RPC admin tertutup, hanya jadwal_rider terbuka', async () => {
  await as(null, async () => {
    await assert.rejects(q('select * from riders'), /permission denied/)
    await assert.rejects(q('select * from actual_harian'), /permission denied/)
    await assert.rejects(q("select * from import_riders('[]')"), /permission denied/)
    await assert.rejects(q("select * from cari_rider('a')"), /permission denied/)
    await assert.rejects(q("select tarik_rider('" + R4 + "')"), /permission denied/)
    assert.equal((await q("select * from jadwal_rider('NOPE')")).length, 0)
  })
})

test('Captain A hanya melihat DS-nya (riders, jadwal, actual) — tidak melihat DS B', async () => {
  await as(A, async () => {
    const nama = (await q('select nama from riders order by nama')).map((r) => r.nama)
    assert.deepEqual(nama, ['Captain A', 'Rider 1', 'Rider 2', 'Rider 5'])
    assert.equal((await q('select * from jadwal where ds_id = $1', [ALSUT])).length, 0)
    assert.equal((await q('select * from actual_harian where ds_id = $1', [ALSUT])).length, 0)
    assert.equal((await q('select * from laporan_ds(today_wib(), today_wib())')).length, 1)
  })
  await as(B, async () => {
    assert.deepEqual((await q('select nama from riders order by nama')).map((r) => r.nama), ['Captain B', 'Rider 3'])
  })
})

test('Captain A tidak bisa menulis ke DS B maupun tabel secara langsung', async () => {
  await as(A, async () => {
    await assert.rejects(q('select simpan_jadwal($1::uuid, today_wib(), today_wib(), $2::jsonb)', [ALSUT, '[]']), /Hanya Captain DS ini/)
    await assert.rejects(catat('2026-01-01', R3, 'hadir'), /bukan anggota DS Anda/)
    await assert.rejects(q("insert into actual_harian (tanggal, rider_id, ds_id, status) values (today_wib(), $1, $2, 'hadir')", [R1, GALAXY]), /row-level security/)
    await assert.rejects(q("insert into jadwal (tanggal, rider_id, shift, ds_id) values (today_wib(), $1, 'pagi', $2)", [R1, GALAXY]), /row-level security/)
    await assert.rejects(q("update riders set nama = 'x' where id = $1", [R1]), /hanya boleh mengubah status/)
    await assert.rejects(q("update riders set peran = 'super_admin' where id = $1", [CA]), /hanya boleh mengubah status/)
    assert.equal((await q("update riders set status = 'nonaktif' where id = $1 returning id", [R3])).length, 0) // DS lain: 0 baris
    assert.equal((await q("update riders set status = 'nonaktif' where id = $1 returning id", [R1])).length, 1) // DS sendiri: boleh
    await q("update riders set status = 'aktif' where id = $1", [R1])
    assert.equal((await q('update ds set kuota_pagi = 9 where id = $1 returning id', [GALAXY])).length, 0)
    await assert.rejects(q("insert into ds (nama) values ('Hantu')"), /row-level security/)
    await assert.rejects(q("select tunjuk_captain($1::uuid, $2::uuid, 'x@y.z')", [GALAXY, R1]), /Hanya Super-admin/)
    await assert.rejects(q("select * from import_riders('[]')"), /Hanya Super-admin/)
  })
  await as(B, async () => {
    await assert.rejects(catat('2026-01-01', R1, 'hadir'), /bukan anggota DS Anda/) // B tak bisa mencatat rider Galaxy
  })
})

test('Captain menyusun jadwal DS-nya (ganti-per-DS) + validasi rider/rentang', async () => {
  await as(A, async () => {
    const rows = JSON.stringify([
      { tanggal: (await q('select today_wib()::text t'))[0].t, rider_id: R1, shift: 'pagi' },
      { tanggal: (await q('select today_wib()::text t'))[0].t, rider_id: R2, shift: 'siang' },
      { tanggal: (await q('select (today_wib()+1)::text t'))[0].t, rider_id: R1, shift: 'pagi' },
    ])
    const n = await q('select simpan_jadwal($1::uuid, today_wib(), today_wib()+6, $2::jsonb) n', [GALAXY, rows])
    assert.equal(n[0].n, 3)
    // simpan ulang dengan 1 baris → rentang ditimpa utuh
    await q('select simpan_jadwal($1::uuid, today_wib(), today_wib()+6, $2::jsonb)', [GALAXY, JSON.stringify([JSON.parse(rows)[0], JSON.parse(rows)[1]])])
    assert.equal((await q('select * from jadwal where ds_id = $1', [GALAXY])).length, 2)
    await q('select simpan_jadwal($1::uuid, today_wib(), today_wib()+6, $2::jsonb)', [GALAXY, rows])
    const bad = JSON.stringify([{ tanggal: JSON.parse(rows)[0].tanggal, rider_id: R3, shift: 'pagi' }]) // rider DS lain
    await assert.rejects(q('select simpan_jadwal($1::uuid, today_wib(), today_wib()+6, $2::jsonb)', [GALAXY, bad]), /bukan anggota DS/)
    const out = JSON.stringify([{ tanggal: '2000-01-01', rider_id: R1, shift: 'pagi' }]) // di luar rentang
    await assert.rejects(q('select simpan_jadwal($1::uuid, today_wib(), today_wib()+6, $2::jsonb)', [GALAXY, out]), /di luar rentang/)
    await assert.rejects(q('select simpan_jadwal($1::uuid, today_wib(), today_wib()+90, $2::jsonb)', [GALAXY, '[]']), /Rentang/)
    assert.equal((await q("select * from log_aktivitas where aksi = 'ubah jadwal'")).length, 3) // jejak tiap simpan
  })
})

test('jadwal_rider (login Kode MTR): hanya jadwal miliknya, nonaktif/ngawur kosong', async () => {
  await as(null, async () => {
    const r = await q("select * from jadwal_rider('  mtr001 ')")
    assert.equal(r.length, 2)
    assert.ok(r.every((x) => x.ds_nama === 'Galaxy' && x.nama === 'Rider 1'))
    assert.equal((await q("select * from jadwal_rider('MTR005')")).length, 0) // nonaktif
    assert.equal((await q("select * from jadwal_rider('MTR999')")).length, 0)
  })
})

test('Daily report: backup ter-link satu paket, validasi alasan, tanggal mendatang', async () => {
  const today = (await q('select today_wib()::text t'))[0].t
  await db.exec(`delete from jadwal where rider_id in ('${R2}', '${R4}')`) // calon pengganti tidak boleh yang dijadwalkan masuk hari itu
  await as(A, async () => {
    await catat(today, R1, 'alpha', R2, 'dadakan')
    const rows = await q('select rider_id, status, backup_untuk_id, diinput_oleh, penjelasan from actual_harian where ds_id = $1 and tanggal = $2 order by status', [GALAXY, today])
    assert.deepEqual(rows.map((r) => [r.rider_id, r.status, r.backup_untuk_id]), [[R1, 'alpha', null], [R2, 'pengganti', R1]])
    assert.ok(rows.every((r) => r.diinput_oleh === CA)) // jejak siapa yang input
    assert.equal((await q('select jam_input from actual_harian where rider_id = $1', [R1]))[0].jam_input instanceof Date, true)
    await catat(today, R1, 'izin', null, 'ke rumah sakit') // ubah → paket backup lama hilang
    assert.equal((await q('select * from actual_harian where rider_id = $1 and tanggal = $2', [R2, today])).length, 0)
    await assert.rejects(catat(today, R1, 'tukar'), /wajib memilih rekan/)
    await assert.rejects(catat(today, R1, 'hadir', R2), /Rider pengganti hanya untuk/)
    await assert.rejects(catat(today, R1, 'alpha', R3), /Backup\/rekan harus rider lain di DS Anda/)
    await assert.rejects(catat((await q('select (today_wib()+1)::text t'))[0].t, R1, 'hadir'), /mendatang/)
    await catat(today, R1, 'tukar', R2) // tukar sah dengan R2
    assert.equal((await q("select status from actual_harian where rider_id = $1 and tanggal = $2", [R2, today]))[0].status, 'pengganti')
    await catat(today, R1, 'hadir')
    await catat(today, R2, 'pengganti', null) // pengganti tanpa dijadwalkan (mandiri)
    await q('select hapus_actual($1::date, $2::uuid)', [today, R2])
    assert.equal((await q('select * from actual_harian where rider_id = $1 and tanggal = $2', [R2, today])).length, 0)
  })
})

test('Potongan (Ya/Tidak) untuk alpha/izin/sakit dan insentif nominal bebas untuk pengganti; masuk laporan', async () => {
  const today = (await q('select today_wib()::text t'))[0].t
  const baris = (rid) => q('select status, potongan, insentif from actual_harian where rider_id = $1 and tanggal = $2', [rid, today])
  await as(A, async () => {
    // potongan wajib dijawab untuk alpha / izin / sakit
    await assert.rejects(q("select catat_actual($1::date, $2::uuid, 'alpha')", [today, R1]), /kena potongan/)
    await assert.rejects(q("select catat_actual($1::date, $2::uuid, 'sakit')", [today, R1]), /kena potongan/)
    // Alpha + pengganti + insentif: potongan di rider yang absen, insentif di baris pengganti
    await catat(today, R1, 'alpha', R2, 'dadakan', true, 75000)
    assert.deepEqual(await baris(R1), [{ status: 'alpha', potongan: true, insentif: 0 }])
    assert.deepEqual(await baris(R2), [{ status: 'pengganti', potongan: null, insentif: 75000 }])
    const lap = await q('select rider_id, potongan, insentif::int from laporan_rider(today_wib(), today_wib())')
    assert.equal(lap.find((x) => x.rider_id === R1).potongan, 1)
    assert.equal(lap.find((x) => x.rider_id === R2).insentif, 75000)
    // insentif hanya untuk pengganti; tidak boleh negatif
    await assert.rejects(catat(today, R1, 'izin', null, 'x', false, 1000), /Insentif hanya untuk rider pengganti/)
    await assert.rejects(catat(today, R1, 'alpha', null, 'x', true, 1000), /Insentif hanya untuk rider pengganti/) // tanpa pengganti
    await assert.rejects(catat(today, R1, 'tukar', R2, 'x', null, 1000), /Insentif hanya untuk rider pengganti/)
    await assert.rejects(catat(today, R1, 'alpha', R2, 'x', true, -5), /tidak boleh negatif/)
    // izin tanpa potongan; ganti ke izin menghapus pengganti beserta insentifnya
    await catat(today, R1, 'izin', null, 'ke dokter', false)
    assert.deepEqual(await baris(R1), [{ status: 'izin', potongan: false, insentif: 0 }])
    assert.equal((await baris(R2)).length, 0)
    // potongan diabaikan untuk status lain (hadir)
    await catat(today, R1, 'hadir', null, null, true)
    assert.deepEqual(await baris(R1), [{ status: 'hadir', potongan: null, insentif: 0 }])
    // pengganti mandiri dengan insentif berbeda-beda
    await catat(today, R2, 'pengganti', null, null, null, 20000)
    assert.equal((await baris(R2))[0].insentif, 20000)
    await catat(today, R2, 'pengganti', null, null, null, 0)
    assert.equal((await baris(R2))[0].insentif, 0)
    await q('select hapus_actual($1::date, $2::uuid)', [today, R2])
  })
  await as(S, async () => {
    await catat(today, R1, 'alpha', R2, null, false, 50000) // Super-admin juga boleh mengisi
    assert.deepEqual(await baris(R2), [{ status: 'pengganti', potongan: null, insentif: 50000 }])
    await catat(today, R1, 'hadir') // kembalikan keadaan awal
    await q('select hapus_actual($1::date, $2::uuid)', [today, R2])
  })
})

test('Captain menarik rider: 1 rider 1 DS, tercatat, Captain lama dinotifikasi', async () => {
  await as(A, async () => {
    await q('select tarik_rider($1::uuid)', [R3]) // dari DS B
    await assert.rejects(q('select tarik_rider($1::uuid)', [R3]), /sudah di DS Anda/)
    await q('select tarik_rider($1::uuid)', [R4]) // dari kolam bebas
    assert.equal((await q('select count(*)::int n from riders where ds_id = $1 and id in ($2, $3)', [GALAXY, R3, R4]))[0].n, 2)
    assert.equal((await q('select * from notifikasi')).length, 0) // notif bukan untuk A
    assert.equal((await q("select * from log_aktivitas where aksi = 'tarik rider'")).length, 2)
  })
  const p = await q('select dari_ds, ke_ds, ditarik_oleh from perpindahan_rider order by waktu, ke_ds')
  assert.equal(p.length, 2)
  assert.ok(p.some((x) => x.dari_ds === ALSUT && x.ke_ds === GALAXY && x.ditarik_oleh === CA))
  assert.ok(p.some((x) => x.dari_ds === null && x.ke_ds === GALAXY))
  await as(B, async () => {
    const n = await q('select pesan from notifikasi')
    assert.equal(n.length, 1) // hanya tarikan dari DS B yang memberi notif
    assert.match(n[0].pesan, /Rider 3.*Alam Sutera|Rider 3.*dari DS Anda/)
    assert.equal((await q('select * from riders where id = $1', [R3])).length, 0) // B tak lagi melihat R3
    assert.equal((await q("update notifikasi set dibaca = true returning id")).length, 1)
  })
})

test('Super-admin: import CSV gabung via Kode MTR, DS tak dikenal ditandai error, yang tak ada di file dibiarkan', async () => {
  await as(S, async () => {
    const rows = [
      { baris: 2, kode_mtr: 'mtr001', nama: 'Rider 1 Baru', no_hp: '0811', ds: 'galaxy', status: '' },
      { baris: 3, kode_mtr: 'MTR100', nama: 'Rider Baru', no_hp: '', ds: 'Alam Sutera', status: 'aktif' },
      { baris: 14, kode_mtr: 'MTR101', nama: 'Salah DS', no_hp: '', ds: 'Galaxi', status: '' },
      { baris: 15, kode_mtr: '', nama: 'Tanpa kode', no_hp: '', ds: '', status: '' },
      { baris: 16, kode_mtr: 'MTR102', nama: 'Status ngawur', no_hp: '', ds: '', status: 'libur' },
    ]
    const res = (await q('select import_riders($1::jsonb) r', [JSON.stringify(rows)]))[0].r
    assert.equal(res.inserted, 1)
    assert.equal(res.updated, 1)
    assert.deepEqual(res.errors.map((e) => e.baris), [14, 15, 16])
    assert.match(res.errors[0].pesan, /DS 'Galaxi' tidak ditemukan/)
    assert.equal((await q('select count(*)::int n from ds'))[0].n, 2) // tidak membuat DS baru
    assert.equal((await q("select count(*)::int n from riders where kode_mtr = 'MTR101'"))[0].n, 0)
    assert.equal((await q("select nama from riders where kode_mtr = 'MTR002'"))[0].nama, 'Rider 2') // tak ada di file → utuh
    const r1 = (await q("select nama, no_hp, status from riders where kode_mtr = 'MTR001'"))[0]
    assert.deepEqual([r1.nama, r1.no_hp, r1.status], ['Rider 1 Baru', '0811', 'aktif'])
    // import ulang yang sama → idempotent (tidak menggandakan)
    const again = (await q('select import_riders($1::jsonb) r', [JSON.stringify(rows.slice(0, 2))]))[0].r
    assert.deepEqual([again.inserted, again.updated], [0, 2])
    assert.equal((await q('select count(*)::int n from riders'))[0].n, 9)
  })
})

test('Kunci periode Senin–Minggu: minggu berjalan ditolak, minggu lalu terkunci permanen', async () => {
  const d = (await q(`select (date_trunc('week', today_wib()))::date::text m, (date_trunc('week', today_wib()) - interval '7 days')::date::text w,
                      (date_trunc('week', today_wib()) - interval '6 days')::date::text t`))[0]
  await as(A, async () => {
    await catat(d.w, R1, 'hadir')
    await assert.rejects(q('select kunci_periode($1::uuid, $2::date)', [GALAXY, d.m]), /belum selesai/)
    await assert.rejects(q('select kunci_periode($1::uuid, $2::date)', [GALAXY, d.t]), /Senin/)
    await assert.rejects(q('select kunci_periode($1::uuid, $2::date)', [ALSUT, d.w]), /Tidak berwenang/)
    await q('select kunci_periode($1::uuid, $2::date)', [GALAXY, d.w])
    assert.equal((await q('select periode_terkunci from actual_harian where rider_id = $1 and tanggal = $2', [R1, d.w]))[0].periode_terkunci, true)
    await assert.rejects(catat(d.w, R1, 'alpha'), /sudah dikunci/)
    await assert.rejects(catat(d.t, R2, 'hadir'), /sudah dikunci/) // hari lain di minggu yang sama
    await assert.rejects(q('select hapus_actual($1::date, $2::uuid)', [d.w, R1]), /sudah dikunci/)
  })
  await assert.rejects(q('update actual_harian set status = $1 where rider_id = $2', ['alpha', R1]), /sudah dikunci/) // trigger berlaku untuk siapa pun
})

test('Pengganti wajib: alpha/izin/sakit pilih pengganti ATAU "Tidak dapat pengganti"; pengganti tidak boleh yang dijadwalkan atau sudah punya absensi', async () => {
  const t = '2025-01-06', t2 = '2025-01-07'
  await db.exec(`insert into jadwal (tanggal, rider_id, shift, ds_id) values ('${t}', '${R1}', 'pagi', '${GALAXY}')`)
  const baris = (rid, tgl = t) => q('select status, potongan, insentif, tanpa_pengganti, backup_untuk_id from actual_harian where rider_id = $1 and tanggal = $2', [rid, tgl])
  await as(A, async () => {
    // tanpa memilih apa pun: ditolak untuk ketiga alasan
    for (const st of ['alpha', 'izin', 'sakit']) await assert.rejects(catat(t, R1, st, null, null, true, 0, false), /Pilih rider pengganti, atau pilih/)
    // memilih pengganti sekaligus "tidak dapat pengganti": ditolak; tanda itu hanya untuk yang tidak hadir
    await assert.rejects(catat(t, R1, 'alpha', R2, null, true, 0, true), /tidak keduanya/)
    await assert.rejects(catat(t, R1, 'hadir', null, null, null, 0, true), /hanya untuk alpha, izin, sakit, atau tukar libur/)
    // izin dengan pengganti + insentif: baris pengganti terbentuk, insentif ikut pengganti
    await catat(t, R1, 'izin', R2, 'ke dokter', false, 40000)
    assert.deepEqual(await baris(R1), [{ status: 'izin', potongan: false, insentif: 0, tanpa_pengganti: false, backup_untuk_id: null }])
    assert.deepEqual(await baris(R2), [{ status: 'pengganti', potongan: null, insentif: 40000, tanpa_pengganti: false, backup_untuk_id: R1 }])
    // ganti ke "Tidak dapat pengganti": baris pengganti lama hilang, tanda tersimpan
    await catat(t, R1, 'sakit', null, 'tidak ada rider yang bisa menggantikan', false)
    assert.deepEqual(await baris(R1), [{ status: 'sakit', potongan: false, insentif: 0, tanpa_pengganti: true, backup_untuk_id: null }])
    assert.equal((await baris(R2)).length, 0)
  })
  // pengganti yang dijadwalkan di shift YANG SAMA ditolak (shift lain boleh sebagai long shift, diuji di test/long-shift.test.mjs)
  await db.exec(`insert into jadwal (tanggal, rider_id, shift, ds_id) values ('${t}', '${R2}', 'pagi', '${GALAXY}')`)
  await as(A, async () => {
    await assert.rejects(catat(t, R1, 'alpha', R2, null, true), /shift yang sama/)
    // pengganti yang sudah punya absensi lain hari itu ditolak (absensinya tidak boleh tertimpa diam-diam)
    await catat(t2, R2, 'hadir')
    await assert.rejects(catat(t2, R1, 'alpha', R2, null, true), /sudah punya absensi/)
    assert.equal((await baris(R2, t2))[0].status, 'hadir')
  })
})

test('Laporan: kepatuhan, belum diisi, hari kosong; Captain hanya DS-nya', async () => {
  const today = (await q('select today_wib()::text t'))[0].t
  const yesterday = (await q('select (today_wib()-1)::text t'))[0].t
  // tes pengganti di atas mengosongkan jadwal R2 hari ini supaya bisa jadi pengganti; kembalikan seperti semula
  await db.exec(`insert into jadwal (tanggal, rider_id, shift, ds_id) values ('${today}', '${R2}', 'siang', '${GALAXY}') on conflict do nothing`)
  await db.exec(`insert into jadwal (tanggal, rider_id, shift, ds_id) values ('${yesterday}', '${R2}', 'pagi', '${GALAXY}')`)
  await as(S, async () => {
    // Galaxy hari ini: jadwal R1 pagi + R2 siang; actual R1 'hadir' saja
    let g = (await q('select * from laporan_ds($1::date, $1::date)', [today])).find((x) => x.ds_nama === 'Galaxy')
    assert.deepEqual([g.dijadwalkan, g.terisi, g.patuh, g.belum_diisi, g.hari_belum_isi], [2, 1, 1, 1, 0])
    // kemarin: ada jadwal, actual kosong sama sekali → DS ditandai "hari belum isi"
    g = (await q('select * from laporan_ds($1::date, $1::date)', [yesterday])).find((x) => x.ds_nama === 'Galaxy')
    assert.deepEqual([g.dijadwalkan, g.belum_diisi, g.hari_belum_isi], [1, 1, 1])
    assert.equal((await q('select * from laporan_ds($1::date, $1::date)', [today])).length, 2)
    const r = (await q('select * from laporan_rider($1::date, $2::date)', [yesterday, today])).find((x) => x.nama === 'Rider 1 Baru')
    assert.deepEqual([r.dijadwalkan, r.hadir, r.alpha], [1, 1, 0])
  })
  await as(A, async () => {
    const rows = await q('select * from laporan_ds($1::date, $1::date)', [today])
    assert.deepEqual(rows.map((x) => x.ds_nama), ['Galaxy'])
    assert.ok((await q('select * from laporan_rider($1::date, $1::date)', [today])).every((x) => x.ds_nama === 'Galaxy'))
  })
})

test('cari_rider: lintas DS untuk menarik, tapi Kode MTR (kunci login) tidak bocor', async () => {
  await as(B, async () => {
    const r = await q("select * from cari_rider('rider')")
    assert.ok(r.length >= 3)
    assert.ok(r.some((x) => x.ds_nama === 'Galaxy')) // luas: melihat rider DS lain
    assert.ok(r.every((x) => !('kode_mtr' in x)))
    assert.ok(r.every((x) => x.nama !== 'Captain A')) // hanya rider
  })
})

test('Super-admin: tunjuk Captain atomik; Captain lama kehilangan wewenang', async () => {
  await as(S, async () => {
    assert.ok((await q('select * from riders')).length >= 9) // lihat semua
    await assert.rejects(q("select tunjuk_captain($1::uuid, $2::uuid, 'x@y.z')", [ALSUT, CA]), /sudah menjadi Captain DS lain/)
    await assert.rejects(q("select tunjuk_captain($1::uuid, $2::uuid, 'x@y.z')", [GALAXY, id(1)]), /Super-admin tidak bisa/)
    await q("select tunjuk_captain($1::uuid, $2::uuid, ' New-Cap@Test.Local ')", [GALAXY, R2])
    const ds = (await q('select captain_id from ds where id = $1', [GALAXY]))[0]
    assert.equal(ds.captain_id, R2)
    assert.equal((await q('select peran, email from riders where id = $1', [CA]))[0].peran, 'rider') // Captain lama diturunkan
    assert.equal((await q('select email from riders where id = $1', [R2]))[0].email, 'new-cap@test.local') // dinormalisasi
  })
  await as('new-cap@test.local', async () => {
    assert.ok((await q('select * from riders')).every((r) => r.ds_id === GALAXY || r.id === R2))
    await q('select simpan_jadwal($1::uuid, today_wib(), today_wib(), $2::jsonb)', [GALAXY, '[]'])
  })
  await as(A, async () => {
    assert.equal((await q('select * from riders')).length, 0) // sudah bukan Captain
    await assert.rejects(q('select simpan_jadwal($1::uuid, today_wib(), today_wib(), $2::jsonb)', [GALAXY, '[]']), /Hanya Captain DS ini/)
    await assert.rejects(catat('2026-01-01', R1, 'hadir'), /Hanya Captain/)
  })
})
