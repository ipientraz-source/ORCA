// Uji pembaca berkas klien: .xlsx (zip dirakit di sini, data sintetis), pemetaan kolom, tanggal serial Excel, pembuangan nama, pencocokan mitra.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync, crc32 } from 'node:zlib'
import { bacaXlsx } from '../src/xlsx-baca.ts'
import { bacaTabelKlien, cocokkanMitra, ringkas, sarankanDs, tanggalDariSel } from '../src/data-klien.ts'

// ───────── perakit xlsx minimal ─────────
function zip(berkas) {
  const lokal = [], pusat = []
  let pos = 0
  for (const [nama, isi] of Object.entries(berkas)) {
    const n = Buffer.from(nama), mentah = Buffer.from(isi), data = deflateRawSync(mentah), crc = crc32(mentah)
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(mentah.length, 22); h.writeUInt16LE(n.length, 26)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(mentah.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(pos, 42)
    lokal.push(h, n, data); pusat.push(c, n)
    pos += 30 + n.length + data.length
  }
  const tengah = Buffer.concat(pusat), akhir = Buffer.alloc(22)
  akhir.writeUInt32LE(0x06054b50, 0); akhir.writeUInt16LE(pusat.length / 2, 8); akhir.writeUInt16LE(pusat.length / 2, 10); akhir.writeUInt32LE(tengah.length, 12); akhir.writeUInt32LE(pos, 16)
  const semua = Buffer.concat([...lokal, tengah, akhir])
  return semua.buffer.slice(semua.byteOffset, semua.byteOffset + semua.length)
}
const sel = (ref, v) => (typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v.replace(/&/g, '&amp;')}</t></is></c>`)
const lembar = (baris) => `<?xml version="1.0"?><worksheet><sheetData>${baris.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => (v === '' ? '' : sel(String.fromCharCode(65 + j) + (i + 1), v))).join('')}</row>`).join('')}</sheetData></worksheet>`
const xlsx = (sheets) => zip({
  'xl/workbook.xml': `<workbook xmlns:r="x"><sheets>${sheets.map((s, i) => `<sheet name="${s.nama}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': `<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  ...Object.fromEntries(sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, lembar(s.baris)])),
  'xl/sharedStrings.xml': '<sst><si><t>unused</t></si></sst>',
})

const KOP = ['Tgl Periode', 'Nik', 'Nama', 'Jabatan', 'Company', 'Kode Toko', 'Nama Toko', 'Kode Cabang', 'Pending Pengiriman', 'Dalam Pengiriman', 'Pesanan Selesai', 'Ontime', 'Late', '%Ontime', '%Late', 'Pod Sesuai', 'Pod Tidak Sesuai']
const rider = (tgl, nik, nama, toko, namaToko, [sel, on, lt, ps, pt]) => [tgl, nik, nama, 'Driver', 'PT X', toko, namaToko, 'QZ01', 0, 0, sel, on, lt, 0.9, 0.1, ps, pt]

test('xlsx: memilih sheet "data" (bukan yang pertama), angka tetap angka, entitas XML didekode, kolom dibatasi', async () => {
  const buf = xlsx([
    { nama: 'rekap', baris: [['bukan', 'data']] },
    { nama: 'Data', baris: [KOP, rider(46327, 'MTR001', 'Andi & Budi', 'T001', 'DS A', [10, 9, 1, 8, 2])] },
  ])
  const t = await bacaXlsx(buf, { sheet: 'data', maxKolom: 17 })
  assert.equal(t.length, 2)
  assert.equal(t[0][0], 'Tgl Periode')
  assert.deepEqual([t[1][0], t[1][1], t[1][2], t[1][10]], ['46327', 'MTR001', 'Andi & Budi', '10'])
  assert.equal((await bacaXlsx(buf, { maxKolom: 3 }))[0].length, 2) // tanpa nama sheet: sheet pertama; kolom dipotong
  await assert.rejects(bacaXlsx(new ArrayBuffer(10)), /zip|xlsx/i)
})

test('tanggal serial Excel dan penulisan tanggal lain dibaca benar; yang aneh dikembalikan apa adanya untuk ditolak database', () => {
  assert.equal(tanggalDariSel('46327'), '2026-11-01')
  assert.equal(tanggalDariSel('46327.0'), '2026-11-01')
  assert.equal(tanggalDariSel('2026-11-22'), '2026-11-22')
  assert.equal(tanggalDariSel('2026-11-22 00:00:00'), '2026-11-22')
  assert.equal(tanggalDariSel('22/11/2026'), '2026-11-22')
  assert.equal(tanggalDariSel('kemarin'), 'kemarin')
})

test('tabel klien: judul dicari di beberapa baris awal, nomor baris mengikuti Excel, nama rider dibuang dari muatan', async () => {
  const buf = xlsx([{ nama: 'data', baris: [
    ['Laporan Kinerja November'], KOP,
    rider(46327, 'mtr001', 'Siti Rahma', 't001', 'DS A', [44, 42, 2, 25, 19]),
    rider(46328, 'MTR001', 'Siti Rahma', 'T002', 'DS B', [10, 9, 1, 8, 2]),
    [], // baris kosong di ujung
  ] }])
  const h = bacaTabelKlien(await bacaXlsx(buf, { sheet: 'data', maxKolom: 17 }))
  assert.equal(h.galat, '')
  assert.deepEqual(h.baris.map((b) => b.baris), [3, 4])
  assert.deepEqual(h.baris[0], { baris: 3, tanggal: '2026-11-01', kode_toko: 't001', nama_toko: 'DS A', kode_mtr: 'mtr001', selesai: '44', ontime: '42', late: '2', pod_sesuai: '25', pod_tidak: '19' })
  assert.ok(!JSON.stringify(h.baris).includes('Siti'), 'nama rider tidak boleh ada di muatan')
  assert.deepEqual(h.mitra, [{ kode_mtr: 'MTR001', nama: 'Siti Rahma', toko: ['T001', 'T002'] }]) // nama hanya untuk pencocokan di browser
  const r = ringkas(h.baris)
  assert.deepEqual([r.jumlah, r.awal, r.akhir], [2, '2026-11-01', '2026-11-02'])
  assert.deepEqual(r.toko.map((t) => [t.kode, t.baris]), [['T001', 1], ['T002', 1]])
})

test('tabel tanpa kolom wajib ditolak dengan pesan yang menyebut kolom yang dibutuhkan; berkas tanpa isi juga', () => {
  assert.match(bacaTabelKlien([['a', 'b'], ['1', '2']]).galat, /Judul kolom tidak dikenali.*Kode Toko/)
  assert.match(bacaTabelKlien([KOP]).galat, /Tidak ada baris data/)
})

test('pencocokan mitra: nama dulu, lalu kode MTR, lalu pitstop', () => {
  const orca = [
    { kode_mtr: 'MTR001', nama: 'Siti Rahma', ds_id: 'A' }, // cocok penuh
    { kode_mtr: 'MTR777', nama: 'Budi Santoso', ds_id: 'A' }, // nama sama, kode beda di file
    { kode_mtr: null, nama: 'Dedi Kurnia', ds_id: 'B' }, // nama sama, kode kosong di ORCA
    { kode_mtr: 'MTR100', nama: 'Eko Putra', ds_id: 'A' }, { kode_mtr: 'MTR101', nama: 'Eko Putra', ds_id: 'B' }, // nama kembar
    { kode_mtr: 'MTR300', nama: 'Fajar Nugroho', ds_id: 'B' }, // kode sama, nama beda
  ]
  const dsPerToko = new Map([['T001', 'A'], ['T002', 'B']])
  const mitra = [
    { kode_mtr: 'MTR001', nama: 'SITI  rahma', toko: ['T001'] },
    { kode_mtr: 'MTR888', nama: 'Budi Santoso', toko: ['T001'] },
    { kode_mtr: 'MTR889', nama: 'Dedi Kurnia', toko: ['T001'] },
    { kode_mtr: 'MTR555', nama: 'Eko Putra', toko: ['T001'] },
    { kode_mtr: 'MTR300', nama: 'Fajar N.', toko: ['T002'] },
    { kode_mtr: 'MTR301', nama: 'Fajar N.', toko: ['T001'] }, // kode tak dikenal dan nama tak dikenal
  ]
  const h = cocokkanMitra(mitra, orca, dsPerToko)
  assert.deepEqual(h.map((x) => [x.status, x.pitstop]), [['cocok', ''], ['kode_beda', 'sama'], ['kode_beda', 'beda'], ['ambigu', ''], ['nama_beda', 'sama'], ['belum', '']])
})

test('saran DS untuk toko yang belum terpasang: cocok sebagian nama, tanpa awalan DS', () => {
  const ds = [{ id: '1', nama: 'Dark Store Alfagift - Pemurus - Banjarmasin' }, { id: '2', nama: 'Dark Store Alfagift - Gatsu - Denpasar' }]
  assert.deepEqual(sarankanDs('DS PEMURUS', ds).map((d) => d.id), ['1'])
  assert.deepEqual(sarankanDs('GATSU', ds).map((d) => d.id), ['2'])
  assert.deepEqual(sarankanDs('', ds), [])
  assert.deepEqual(sarankanDs('Tak Dikenal', ds), [])
})
