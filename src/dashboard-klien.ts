// Rumus Dashboard Klien: murni, tanpa React/Supabase, supaya mudah diuji. Satu angka resmi per ukuran:
//   ketepatan antar = ontime ÷ pesanan selesai, POD sesuai = POD sesuai ÷ pesanan selesai, pesanan per rider per hari = selesai ÷ rider-hari.
// Hari tanpa unggahan tidak ada di data (bukan nol), jadi tidak pernah menurunkan rata-rata.

export type Hari = { tanggal: string; selesai: number; ontime: number; late: number; pod_sesuai: number; pod_tidak: number; rider_hari: number }
export type Angka = { selesai: number; ontime: number; late: number; podSesuai: number; podTidak: number; riderHari: number; hari: number }
export type Bo = { tanggal: string; kebutuhan: number; terpenuhi: number; hadir: number; tepat: number }

export function jumlah(baris: Hari[]): Angka {
  const a: Angka = { selesai: 0, ontime: 0, late: 0, podSesuai: 0, podTidak: 0, riderHari: 0, hari: baris.length }
  for (const b of baris) {
    a.selesai += Number(b.selesai); a.ontime += Number(b.ontime); a.late += Number(b.late)
    a.podSesuai += Number(b.pod_sesuai); a.podTidak += Number(b.pod_tidak); a.riderHari += Number(b.rider_hari)
  }
  return a
}

// Persentase tanpa pembulatan; null bila pembaginya nol (belum ada data, bukan 0%)
export const pct = (bagian: number, total: number): number | null => (total > 0 ? (bagian * 100) / total : null)
// 96,1% (satu desimal, koma Indonesia); null → –
export const teksPct = (p: number | null) => (p === null ? '–' : `${p.toFixed(1).replace('.', ',')}%`)
export const teksAngka = (n: number) => Math.round(n).toLocaleString('id-ID')
export const teksDesimal = (n: number | null) => (n === null ? '–' : n.toFixed(1).replace('.', ','))

// Selisih dibanding periode sebelumnya: persen perubahan untuk jumlah, poin untuk persentase. null bila salah satunya tidak ada.
export const perubahan = (kini: number, lalu: number): number | null => (lalu > 0 ? ((kini - lalu) * 100) / lalu : null)
export const poin = (kini: number | null, lalu: number | null): number | null => (kini === null || lalu === null ? null : kini - lalu)

const MS = 86400000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
export const hariAntara = (dari: string, sampai: string) => Math.round((Date.parse(sampai) - Date.parse(dari)) / MS) + 1
export const geser = (tgl: string, n: number) => iso(Date.parse(tgl) + n * MS)

// Periode pembanding: jumlah hari sama, tepat sebelum periode ini
export function periodeSebelum(dari: string, sampai: string): [string, string] {
  const n = hariAntara(dari, sampai)
  return [geser(dari, -n), geser(dari, -1)]
}

// Rentang bawaan: n hari terakhir yang berdata (berakhir di tanggal data terakhir), tidak lebih awal dari data pertama; 0 = semua data
export function rentangBawaan(awal: string, akhir: string, n: number): [string, string] {
  if (n <= 0) return [awal, akhir]
  const mulai = geser(akhir, -(n - 1))
  return [mulai < awal ? awal : mulai, akhir]
}

export type Tren = { tanggal: string; nilai: number | null }
// Deret ketepatan antar per hari untuk grafik: hanya hari yang ada unggahannya
export const trenKetepatan = (baris: Hari[]): Tren[] => baris.map((b) => ({ tanggal: b.tanggal, nilai: pct(Number(b.ontime), Number(b.selesai)) }))
export const trenFulfillment = (bo: Bo[]): Tren[] => bo.map((b) => ({ tanggal: b.tanggal, nilai: pct(Number(b.terpenuhi), Number(b.kebutuhan)) }))
export const trenMasuk = (bo: Bo[]): Tren[] => bo.map((b) => ({ tanggal: b.tanggal, nilai: pct(Number(b.tepat), Number(b.hadir)) }))
export function jumlahBo(bo: Bo[]) {
  return bo.reduce((a, b) => ({ kebutuhan: a.kebutuhan + Number(b.kebutuhan), terpenuhi: a.terpenuhi + Number(b.terpenuhi), hadir: a.hadir + Number(b.hadir), tepat: a.tepat + Number(b.tepat) }), { kebutuhan: 0, terpenuhi: 0, hadir: 0, tepat: 0 })
}
