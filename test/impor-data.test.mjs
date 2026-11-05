// Uji mesin impor data baku (src/impor-data.ts): pembacaan templat, pemeriksaan, dan aturan duplikat (tidak menghapus, tidak dobel).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bacaTabel, periksa, ctxKosong, normHp, tanggalIso, templatCsv, KOLOM } from '../src/impor-data.ts'

const ctx = () => ({
  ...ctxKosong(),
  ds: [{ id: 'd1', nama: 'DS GALAXY' }, { id: 'd2', nama: 'DS CIHAMPELAS' }],
  riders: [
    { id: 'r1', kode_mtr: 'MTR1', nama: 'Ada', no_hp: '081200000001', peran: 'rider', status: 'aktif' },
    { id: 'r2', kode_mtr: 'MTR2', nama: 'Cap', no_hp: null, peran: 'captain', status: 'aktif' },
  ],
  kandidat: [{ nama: 'Sudah Ada', no_hp: '+62 812-3333-4444' }, { nama: 'Tanpa Hp', no_hp: null }],
  motors: [{ id: 'm1', kode_motor: 'B 4672 SWN', plat_nomor: 'B 4672 SWN', no_rangka: 'MH2AEB1H4SJ002956' }],
  servis: [{ motor_id: 'm1', tanggal: '2026-09-20', jenis: 'Servis rutin', jenis_lain: null }],
  rusak: [{ motor_id: 'm1', tanggal: '2026-10-12', jenis: 'Rem', deskripsi: 'Rem depan blong' }],
  jenisServis: ['Servis rutin', 'Ganti baterai', 'Lainnya'],
  jenisRusak: ['Rem', 'Baterai', 'Lainnya'],
})
const jalan = (jenis, tabel, c = ctx()) => {
  const { baris, galat } = bacaTabel(tabel, jenis)
  assert.equal(galat, '')
  return periksa(jenis, baris, c)
}
const st = (h) => h.map((x) => x.status)

test('pembantu: HP, tanggal', () => {
  assert.equal(normHp('+62 812-3333-4444'), normHp('0812 3333 4444'))
  assert.equal(normHp('+6281200000001'), normHp('081200000001'))
  assert.equal(tanggalIso('2026-11-02'), '2026-11-02')
  assert.equal(tanggalIso('2/11/2026'), '2026-11-02')
  assert.equal(tanggalIso('2026-02-30'), null)
  assert.equal(tanggalIso('abc'), null)
})

test('templat: judul kolom hasil templatCsv terbaca kembali tanpa galat untuk semua jenis', () => {
  for (const j of Object.keys(KOLOM)) {
    const { galat, baris } = bacaTabel(templatCsv(j), j)
    assert.equal(galat, '', j)
    assert.equal(baris.length, 1, j)
  }
})

test('bacaTabel: kolom wajib hilang → galat jelas; baris kosong dibuang; nomor baris = baris Excel', () => {
  assert.match(bacaTabel([['Nama'], ['x']], 'rider').galat, /Kode MTR/)
  const { baris } = bacaTabel([['Kode MTR', 'Nama'], ['', ''], ['MTR9', 'Z']], 'rider')
  assert.equal(baris.length, 1)
  assert.equal(baris[0].baris, 3)
})

test('rider: kode sudah ada = duplikat (tidak ditimpa), kode baru siap, dobel di file = duplikat kedua, DS salah/nonaktif = salah', () => {
  const h = jalan('rider', [['Kode MTR', 'Nama', 'No HP', 'DS', 'Status'], ['mtr1', 'Nama Lain', '', 'DS GALAXY', ''], ['MTR9', 'Baru', '0812', 'Galaxy', 'aktif'], ['MTR9', 'Baru Lagi', '', '', ''], ['MTR8', 'X', '', 'DS TIDAKADA', ''], ['MTR7', 'Y', '', '', 'nonaktif']])
  assert.deepEqual(st(h), ['duplikat', 'siap', 'duplikat', 'salah', 'salah'])
  assert.equal(h[1].data.ds_id, 'd1')
})

test('motor: plat/VIN sudah ada = duplikat; model dan status terbaca; status salah = salah', () => {
  const h = jalan('motor', [['DS Location', 'License Plate', 'VIN', 'Model', 'Status Motor'],
    ['DS GALAXY', 'B4672SWN', '', '', ''], ['DS GALAXY', 'D 1 AB', 'MH2AEB1H4SJ002956', '', ''], ['DS GALAXY', 'D 2 AB', '', 'Fox R', 'return'],
    ['DS GALAXY', 'D 3 AB', '', '', 'rusak'], ['DS GALAXY', 'D 2 AB', '', '', ''], ['Dark Store Alfagift - Cihampelas', 'D 4 AB', '', 'Fox R', '']])
  assert.deepEqual(st(h), ['duplikat', 'duplikat', 'siap', 'salah', 'duplikat', 'siap'])
  assert.equal(h[2].data.status_unit, 'return')
  assert.equal(h[2].data.model, 'Fox R')
  assert.equal(h[5].data.status_unit, 'active')
  assert.equal(h[5].data.ds_id, 'd2')
})

test('kandidat: HP sama (format beda) dengan kandidat atau rider = duplikat; tanpa HP pakai nama; diterima & ditolak tanpa alasan = salah', () => {
  const h = jalan('kandidat', [['Nama', 'No HP', 'DS Tujuan', 'Sumber', 'Kode MTR Perujuk', 'Status', 'Tanggal Masuk', 'Alasan Ditolak'],
    ['Orang A', '0812-3333-4444', '', '', '', '', '', ''],
    ['Orang B', '+6281200000001', '', '', '', '', '', ''],
    ['Tanpa HP', '', '', '', '', '', '', ''],
    ['Orang C', '0899', '', 'Referral rider', '', '', '', ''],
    ['Orang D', '0898', '', 'Referral rider', 'MTR2', 'interview', '28/10/2026', ''],
    ['Orang E', '0897', '', '', '', 'diterima', '', ''],
    ['Orang F', '0896', '', '', '', 'ditolak', '', ''],
    ['Orang G', '0895', '', 'Walk-in', '', 'ditolak', '', 'Tidak lolos tes'],
    ['Orang H', '0895', '', '', '', '', '', '']])
  assert.deepEqual(st(h), ['duplikat', 'duplikat', 'duplikat', 'salah', 'siap', 'salah', 'salah', 'siap', 'duplikat'])
  assert.equal(h[4].data.perujuk_id, 'r2')
  assert.equal(h[4].data.dibuat, '2026-10-28T00:00:00+07:00')
})

test('ds: nama sama (walau tanpa awalan DS / beda huruf) = duplikat; kuota harus angka', () => {
  const h = jalan('ds', [['Nama DS', 'Kuota Pagi', 'Kuota Siang', 'ID Grup WhatsApp'], ['Galaxy', '3', '3', ''], ['DS HAYAM WURUK', '3', '2', ''], ['DS Hayam Wuruk', '1', '1', ''], ['DS BARU', 'x', '1', ''], ['DS LAGI', '2', '2', 'g@g.us']])
  assert.deepEqual(st(h), ['duplikat', 'siap', 'duplikat', 'salah', 'siap'])
  assert.equal(h[1].data.nama, 'DS HAYAM WURUK')
})

test('servis: motor harus ada, servis sama (motor+tanggal+jenis) = duplikat, asuransi dengan biaya = salah', () => {
  const h = jalan('servis', [['Plat Motor', 'Tanggal', 'Jenis', 'Jenis Lain', 'Biaya', 'Ditanggung Asuransi'],
    ['B 4672 SWN', '2026-09-20', 'Servis rutin', '', '', ''],
    ['B 4672 SWN', '2026-10-01', 'Servis rutin', '', '175000', 'Tidak'],
    ['B 4672 SWN', '2026-10-01', 'servis rutin', '', '175000', ''],
    ['Z 1 ZZ', '2026-10-01', 'Servis rutin', '', '', ''],
    ['B 4672 SWN', '2026-10-02', 'Ganti baterai', '', '5', 'Ya'],
    ['B 4672 SWN', '2026-10-02', 'Lainnya', '', '', ''],
    ['B 4672 SWN', '2026-10-02', 'Ngawur', '', '', '']])
  assert.deepEqual(st(h), ['duplikat', 'siap', 'duplikat', 'salah', 'salah', 'salah', 'salah'])
  assert.equal(h[1].data.biaya, 175000)
})

test('kerusakan: laporan sama = duplikat; selesai wajib tanggal selesai; status dan keparahan dicek', () => {
  const h = jalan('kerusakan', [['Plat Motor', 'Tanggal', 'Jenis', 'Keparahan', 'Deskripsi', 'Status', 'Tanggal Selesai'],
    ['B 4672 SWN', '2026-10-12', 'Rem', 'sedang', 'Rem depan  blong', '', ''],
    ['B 4672 SWN', '2026-10-29', 'Baterai', 'berat', 'Tidak mengisi', 'diproses', ''],
    ['B 4672 SWN', '2026-10-30', 'Baterai', 'berat', 'Rusak', 'selesai', ''],
    ['B 4672 SWN', '2026-10-30', 'Baterai', 'parah', 'Rusak', '', '']])
  assert.deepEqual(st(h), ['duplikat', 'siap', 'salah', 'salah'])
})

test('impor ulang berkas yang sama: semua baris yang tadi siap menjadi duplikat (tidak menambah apa pun)', () => {
  const tabel = [['Kode MTR', 'Nama'], ['MTR50', 'A'], ['MTR51', 'B']]
  const c = ctx()
  const h1 = jalan('rider', tabel, c)
  assert.deepEqual(st(h1), ['siap', 'siap'])
  c.riders.push(...h1.map((x) => ({ id: x.data.kode_mtr, kode_mtr: x.data.kode_mtr, nama: x.data.nama, no_hp: null, peran: 'rider', status: 'aktif' })))
  assert.deepEqual(st(jalan('rider', tabel, c)), ['duplikat', 'duplikat'])
})

test('baris contoh bawaan templat ditolak, tidak masuk sebagai data', () => {
  const t = templatCsv('rider')
  const h = jalan('rider', [t[0], t[1], ['MTR50', 'Asli']])
  assert.deepEqual(st(h), ['salah', 'siap'])
})

test('arcon (wajibDs): DS kosong dipakai bila hanya pegang satu DS; bila lebih, ditolak dengan daftar DS', () => {
  const tabel = [['Kode MTR', 'Nama', 'DS'], ['MTR60', 'A', ''], ['MTR61', 'B', 'DS LAIN']]
  const satu = { ...ctx(), wajibDs: true, ds: [{ id: 'd1', nama: 'DS GALAXY' }] }
  const h = jalan('rider', tabel, satu)
  assert.deepEqual(st(h), ['siap', 'salah'])
  assert.equal(h[0].data.ds_id, 'd1')
  const dua = { ...satu, ds: [...satu.ds, { id: 'd2', nama: 'DS GOWA' }] }
  const h2 = jalan('rider', [tabel[0], tabel[1]], dua)
  assert.equal(h2[0].status, 'salah')
  assert.match(h2[0].alasan, /DS GALAXY, DS GOWA/)
})
