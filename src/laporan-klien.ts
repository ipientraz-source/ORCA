// Bahan Laporan Performance bulanan klien: murni (tanpa React/Supabase) supaya bisa diuji. Semua angka memakai rumus resmi dari dashboard-klien.ts
// (ketepatan antar = ontime ÷ selesai, POD sesuai = POD sesuai ÷ selesai). Hari tanpa unggahan tidak ada di data, jadi tidak pernah dihitung 0%.
import { jumlah, jumlahBo, pct, perubahan, poin, teksAngka, teksPct, type Angka, type Bo, type Hari } from './dashboard-klien.ts'

export type BarisToko = { ds_id: string; ds_nama: string; kode_toko: string | null; selesai: number; ontime: number; late: number; pod_sesuai: number; pod_tidak: number; rider_hari: number; hari: number }
export type TokoLap = { nama: string; kode: string | null; selesai: number; ontime: number; late: number; podSesuai: number; hari: number; kete: number | null; pod: number | null }

const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const MIN_PESANAN_PERINGKAT = 50 // toko dengan pesanan lebih sedikit tidak diperingkat: persentasenya terlalu goyah

// Target ditulis tanpa ",0" (95% bukan 95,0%) bila bulat
export const teksTarget = (t: number) => teksPct(t).replace(',0%', '%')
export const namaBulan =(bulan: string) => `${NAMA_BULAN[Number(bulan.slice(5, 7)) - 1]} ${bulan.slice(0, 4)}`
const hariDalamBulan = (bulan: string) => new Date(Date.UTC(Number(bulan.slice(0, 4)), Number(bulan.slice(5, 7)), 0)).getUTCDate()
const bulanSebelum = (bulan: string) => {
  const t = new Date(Date.UTC(Number(bulan.slice(0, 4)), Number(bulan.slice(5, 7)) - 2, 1))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`
}

// Daftar bulan (YYYY-MM) dari tanggal data pertama sampai terakhir, terbaru di depan
export function daftarBulan(awal: string, akhir: string): string[] {
  const hasil: string[] = []
  for (let b = akhir.slice(0, 7); b >= awal.slice(0, 7); b = bulanSebelum(b)) hasil.push(b)
  return hasil
}

// Rentang tanggal satu bulan, dipotong ke data yang ada (bulan berjalan berakhir di data terakhir)
export function rentangBulan(bulan: string, awal: string, akhir: string): [string, string] {
  const dari = `${bulan}-01`, sampai = `${bulan}-${String(hariDalamBulan(bulan)).padStart(2, '0')}`
  return [dari < awal ? awal : dari, sampai > akhir ? akhir : sampai]
}

// Pembanding: bulan sebelumnya dengan nomor hari yang sama (bulan berjalan sampai tanggal 22 dibanding tanggal 1–22 bulan lalu, bukan sebulan penuh)
export function rentangBulanLalu(bulan: string, dari: string, sampai: string): [string, string] {
  const lalu = bulanSebelum(bulan), maks = hariDalamBulan(lalu)
  const hari = (t: string) => Math.min(Number(t.slice(8, 10)), maks)
  return [`${lalu}-${String(hari(dari)).padStart(2, '0')}`, `${lalu}-${String(hari(sampai)).padStart(2, '0')}`]
}

// "1–22 November 2026" untuk hari-hari dalam satu bulan; di luar itu ditulis apa adanya
export function teksRentang(dari: string, sampai: string): string {
  const bulan = dari.slice(0, 7)
  if (bulan !== sampai.slice(0, 7)) return `${dari} – ${sampai}`
  const d = Number(dari.slice(8, 10)), s = Number(sampai.slice(8, 10))
  return `${d === s ? d : `${d}–${s}`} ${namaBulan(bulan)}`
}

const keTokoLap = (t: BarisToko): TokoLap => {
  const selesai = Number(t.selesai)
  return { nama: t.ds_nama, kode: t.kode_toko, selesai, ontime: Number(t.ontime), late: Number(t.late), podSesuai: Number(t.pod_sesuai), hari: Number(t.hari), kete: pct(Number(t.ontime), selesai), pod: pct(Number(t.pod_sesuai), selesai) }
}

export type Laporan = {
  a: Angka; b: Angka | null
  kete: number | null; keteLalu: number | null; pod: number | null; podLalu: number | null
  perRider: number | null; perRiderLalu: number | null; ubahSelesai: number | null
  harian: { tanggal: string; selesai: number; kete: number | null }[]
  hariDiAtas: number | null; hariTerendah: { tanggal: string; kete: number } | null; hariTertinggi: { tanggal: string; kete: number } | null
  tokoDiBawah: number | null; terendah: TokoLap[]; terbesar: TokoLap[]; lainnya: TokoLap | null
  tokoBerdata: number; tokoLengkap: number; totalToko: number
  bo: { ada: boolean; fulf: number | null; masuk: number | null; terpenuhi: number; kebutuhan: number; tepat: number; hadir: number }
  catatan: string[]
}

export function susunLaporan(i: { hari: Hari[]; lalu: Hari[]; toko: BarisToko[]; bo: Bo[]; target: number | null; totalToko: number }): Laporan {
  const a = jumlah(i.hari), b = i.lalu.length ? jumlah(i.lalu) : null
  const kete = pct(a.ontime, a.selesai), pod = pct(a.podSesuai, a.selesai)
  const keteLalu = b ? pct(b.ontime, b.selesai) : null, podLalu = b ? pct(b.podSesuai, b.selesai) : null
  const perRider = a.riderHari ? a.selesai / a.riderHari : null
  const perRiderLalu = b && b.riderHari ? b.selesai / b.riderHari : null
  const harian = i.hari.map((h) => ({ tanggal: h.tanggal, selesai: Number(h.selesai), kete: pct(Number(h.ontime), Number(h.selesai)) }))
  const berKete = harian.filter((h): h is { tanggal: string; selesai: number; kete: number } => h.kete !== null)
  const terendahHari = berKete.length ? berKete.reduce((m, h) => (h.kete < m.kete ? h : m)) : null
  const tertinggiHari = berKete.length ? berKete.reduce((m, h) => (h.kete > m.kete ? h : m)) : null
  const target = i.target
  const hariDiAtas = target === null ? null : berKete.filter((h) => h.kete >= target).length

  const toko = i.toko.map(keTokoLap).filter((t) => t.selesai > 0)
  const tokoDiBawah = target === null ? null : toko.filter((t) => t.kete !== null && t.kete < target).length
  const terendah = toko.filter((t) => t.selesai >= MIN_PESANAN_PERINGKAT && t.kete !== null).sort((x, y) => (x.kete as number) - (y.kete as number)).slice(0, 8)
  const urut = [...toko].sort((x, y) => y.selesai - x.selesai)
  const terbesar = urut.slice(0, 8), sisa = urut.slice(8)
  const lainnya: TokoLap | null = sisa.length ? (() => {
    const s = sisa.reduce((m, t) => ({ selesai: m.selesai + t.selesai, ontime: m.ontime + t.ontime, late: m.late + t.late, podSesuai: m.podSesuai + t.podSesuai }), { selesai: 0, ontime: 0, late: 0, podSesuai: 0 })
    return { nama: `Lainnya (${sisa.length} toko)`, kode: null, ...s, hari: 0, kete: pct(s.ontime, s.selesai), pod: pct(s.podSesuai, s.selesai) }
  })() : null
  const tokoLengkap = toko.filter((t) => t.hari === a.hari).length

  const jb = jumlahBo(i.bo)
  const bo = { ada: i.bo.length > 0, fulf: pct(jb.terpenuhi, jb.kebutuhan), masuk: pct(jb.tepat, jb.hadir), terpenuhi: jb.terpenuhi, kebutuhan: jb.kebutuhan, tepat: jb.tepat, hadir: jb.hadir }

  // Catatan otomatis: hanya kalimat yang bisa dibuktikan angkanya; tidak ada tebakan penyebab
  const catatan: string[] = []
  if (kete !== null && target !== null) {
    catatan.push(kete >= target
      ? `Ketepatan antar ${teksPct(kete)} berada ${teksPct(kete - target).replace('%', '')} poin di atas target ${teksTarget(target)}.`
      : `Ketepatan antar ${teksPct(kete)} berada ${teksPct(target - kete).replace('%', '')} poin di bawah target ${teksTarget(target)}.`)
  }
  const dKete = poin(kete, keteLalu)
  if (dKete !== null && Math.abs(dKete) >= 0.05) catatan.push(`Dibanding bulan lalu, ketepatan antar ${dKete > 0 ? 'naik' : 'turun'} ${teksPct(Math.abs(dKete)).replace('%', '')} poin.`)
  if (tokoDiBawah !== null && tokoDiBawah > 0) catatan.push(`${tokoDiBawah} dari ${toko.length} toko berada di bawah target ketepatan antar.`)
  if (pod !== null && pod < 90) catatan.push(`POD sesuai ${teksPct(pod)}: ${teksAngka(a.podTidak)} pesanan belum memenuhi ketentuan bukti serah terima. Ini area perbaikan terbesar.`)
  else if (pod !== null) catatan.push(`POD sesuai ${teksPct(pod)}.`)
  if (toko.length && tokoLengkap < toko.length) catatan.push(`${tokoLengkap} dari ${toko.length} toko punya data ${a.hari} hari penuh; sisanya tidak melapor di semua hari, jadi angkanya dibaca sebagai bagian dari hari yang ada datanya.`)

  return {
    a, b, kete, keteLalu, pod, podLalu, perRider, perRiderLalu, ubahSelesai: b ? perubahan(a.selesai, b.selesai) : null,
    harian, hariDiAtas, hariTerendah: terendahHari && { tanggal: terendahHari.tanggal, kete: terendahHari.kete }, hariTertinggi: tertinggiHari && { tanggal: tertinggiHari.tanggal, kete: tertinggiHari.kete },
    tokoDiBawah, terendah, terbesar, lainnya, tokoBerdata: toko.length, tokoLengkap, totalToko: i.totalToko, bo, catatan,
  }
}
