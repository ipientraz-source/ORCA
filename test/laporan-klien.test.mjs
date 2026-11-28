// Uji bahan Laporan Performance bulanan (src/laporan-klien.ts): rentang bulan, pembanding, dan angka/catatan laporan. Data sintetis, hasil dihitung tangan.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { daftarBulan, namaBulan, rentangBulan, rentangBulanLalu, susunLaporan, teksRentang } from '../src/laporan-klien.ts'

const hari = (tanggal, selesai, ontime, podSesuai, riderHari = 2) => ({ tanggal, selesai, ontime, late: selesai - ontime, pod_sesuai: podSesuai, pod_tidak: selesai - podSesuai, rider_hari: riderHari })
const toko = (nama, selesai, ontime, podSesuai, hariData) => ({ ds_id: nama, ds_nama: nama, kode_toko: nama.slice(0, 2).toUpperCase(), selesai, ontime, late: selesai - ontime, pod_sesuai: podSesuai, pod_tidak: selesai - podSesuai, rider_hari: 3, hari: hariData })

test('daftar bulan: terbaru di depan, melewati pergantian tahun', () => {
  assert.deepEqual(daftarBulan('2026-11-01', '2026-11-22'), ['2026-11'])
  assert.deepEqual(daftarBulan('2026-10-15', '2027-01-03'), ['2027-01', '2026-12', '2026-11', '2026-10'])
  assert.equal(namaBulan('2026-11'), 'November 2026')
})

test('rentang bulan dipotong ke data yang ada; pembanding memakai nomor hari yang sama', () => {
  assert.deepEqual(rentangBulan('2026-11', '2026-10-20', '2026-11-22'), ['2026-11-01', '2026-11-22'])
  assert.deepEqual(rentangBulan('2026-10', '2026-10-20', '2026-11-22'), ['2026-10-20', '2026-10-31'])
  assert.deepEqual(rentangBulanLalu('2026-11', '2026-11-01', '2026-11-22'), ['2026-10-01', '2026-10-22'])
  // Maret sampai tanggal 31 dibanding Februari: dipotong ke akhir Februari, bukan meluber ke Maret
  assert.deepEqual(rentangBulanLalu('2027-03', '2027-03-01', '2027-03-31'), ['2027-02-01', '2027-02-28'])
  assert.deepEqual(rentangBulanLalu('2027-01', '2027-01-01', '2027-01-10'), ['2026-12-01', '2026-12-10'])
  assert.equal(teksRentang('2026-11-01', '2026-11-22'), '1–22 November 2026')
  assert.equal(teksRentang('2026-11-05', '2026-11-05'), '5 November 2026')
})

test('angka laporan memakai rumus resmi dan hari tanpa data tidak dihitung', () => {
  const l = susunLaporan({
    hari: [hari('2026-11-01', 100, 90, 70), hari('2026-11-02', 100, 98, 80)],
    lalu: [hari('2026-10-01', 200, 160, 120, 4)],
    toko: [toko('Alfa', 150, 140, 120, 2), toko('Beta', 50, 48, 30, 1)],
    bo: [], target: 95, totalToko: 3,
  })
  assert.equal(l.a.selesai, 200)
  assert.equal(l.kete, 94) // 188 ÷ 200
  assert.equal(l.pod, 75) // 150 ÷ 200
  assert.equal(l.keteLalu, 80)
  assert.equal(l.perRider, 50) // 200 ÷ 4 rider-hari
  assert.equal(l.ubahSelesai, 0)
  assert.equal(l.hariDiAtas, 1) // hanya 2 Nov (98%) yang >= 95
  assert.deepEqual(l.hariTerendah, { tanggal: '2026-11-01', kete: 90 })
  assert.deepEqual(l.hariTertinggi, { tanggal: '2026-11-02', kete: 98 })
  assert.equal(l.tokoDiBawah, 1) // Alfa 93,3%; Beta 96%
  assert.equal(l.tokoBerdata, 2)
  assert.equal(l.totalToko, 3)
  assert.equal(l.tokoLengkap, 1) // hanya Alfa berdata di kedua hari
  assert.equal(l.bo.ada, false)
})

test('tanpa data bulan lalu dan tanpa target: tidak ada perbandingan dan tidak ada kalimat target', () => {
  const l = susunLaporan({ hari: [hari('2026-11-01', 100, 90, 70)], lalu: [], toko: [toko('Alfa', 100, 90, 70, 1)], bo: [], target: null, totalToko: 1 })
  assert.equal(l.b, null)
  assert.equal(l.keteLalu, null)
  assert.equal(l.ubahSelesai, null)
  assert.equal(l.hariDiAtas, null)
  assert.equal(l.tokoDiBawah, null)
  assert.ok(!l.catatan.some((c) => /target|bulan lalu/.test(c)), l.catatan.join(' | '))
})

test('peringkat toko: toko kecil tidak diperingkat, 8 terbesar + Lainnya dijumlahkan', () => {
  const banyak = Array.from({ length: 10 }, (_, n) => toko(`T${n}`, 1000 - n * 10, 900 - n * 10, 800 - n * 10, 5))
  const l = susunLaporan({ hari: [hari('2026-11-01', 100, 90, 70)], lalu: [], toko: [...banyak, toko('Kecil', 10, 1, 1, 1)], bo: [], target: 95, totalToko: 11 })
  assert.ok(!l.terendah.some((t) => t.nama === 'Kecil'), 'toko < 50 pesanan tidak diperingkat')
  assert.equal(l.terbesar.length, 8)
  assert.equal(l.lainnya?.nama, 'Lainnya (3 toko)')
  const sisa = [...banyak, toko('Kecil', 10, 1, 1, 1)].sort((x, y) => y.selesai - x.selesai).slice(8)
  assert.equal(l.lainnya?.selesai, sisa.reduce((s, t) => s + t.selesai, 0))
  assert.equal(l.terbesar.reduce((s, t) => s + t.selesai, 0) + (l.lainnya?.selesai ?? 0), banyak.reduce((s, t) => s + t.selesai, 10))
})

test('catatan: POD rendah ditandai area perbaikan, dan hanya angka yang disebut', () => {
  const l = susunLaporan({ hari: [hari('2026-11-01', 100, 98, 60)], lalu: [hari('2026-10-01', 100, 90, 60)], toko: [toko('Alfa', 100, 98, 60, 1)], bo: [{ tanggal: '2026-11-01', kebutuhan: 10, terpenuhi: 8, hadir: 8, tepat: 6 }], target: 95, totalToko: 1 })
  const semua = l.catatan.join(' | ')
  assert.match(semua, /di atas target/)
  assert.match(semua, /naik 8,0 poin/) // 98 vs 90
  assert.match(semua, /POD sesuai 60,0%.*area perbaikan terbesar/)
  assert.equal(l.bo.ada, true)
  assert.equal(l.bo.fulf, 80)
  assert.equal(l.bo.masuk, 75)
})
