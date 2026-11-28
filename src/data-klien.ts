// Data klien (unggahan kinerja antar): murni, tanpa React/Supabase, supaya mudah diuji.
// Dari tabel mentah file klien (.xlsx atau .csv) diambil HANYA kolom yang dibutuhkan database. Kolom Nama rider dipakai di browser untuk
// pencocokan mitra, lalu dibuang: tidak ada nama atau data pribadi lain yang dikirim ke server (database juga tidak punya kolom untuknya).
import { tanggalIso } from './impor-data.ts'

export type BarisKlien = {
  baris: number // nomor baris di file (judul kolom = baris 1), supaya pesan penolakan database bisa ditelusuri di Excel
  tanggal: string; kode_toko: string; nama_toko: string; kode_mtr: string
  selesai: string; ontime: string; late: string; pod_sesuai: string; pod_tidak: string
}
export type MitraFile = { kode_mtr: string; nama: string; toko: string[] } // nama hanya hidup di browser
export type HasilBaca = { baris: BarisKlien[]; mitra: MitraFile[]; galat: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
// kunci → nama kolom yang diterima (sudah dinormalkan). wajib: harus ada di file
const KOLOM: { kunci: keyof Omit<BarisKlien, 'baris'> | 'nama'; judul: string; alias: string[]; wajib: boolean }[] = [
  { kunci: 'tanggal', judul: 'Tgl Periode', alias: ['tgl periode', 'tanggal', 'tgl'], wajib: true },
  { kunci: 'kode_mtr', judul: 'Nik', alias: ['nik', 'kode mitra', 'kode mtr'], wajib: true },
  { kunci: 'nama', judul: 'Nama', alias: ['nama', 'nama mitra'], wajib: false },
  { kunci: 'kode_toko', judul: 'Kode Toko', alias: ['kode toko'], wajib: true },
  { kunci: 'nama_toko', judul: 'Nama Toko', alias: ['nama toko'], wajib: false },
  { kunci: 'selesai', judul: 'Pesanan Selesai', alias: ['pesanan selesai'], wajib: true },
  { kunci: 'ontime', judul: 'Ontime', alias: ['ontime', 'on time'], wajib: true },
  { kunci: 'late', judul: 'Late', alias: ['late'], wajib: true },
  { kunci: 'pod_sesuai', judul: 'Pod Sesuai', alias: ['pod sesuai'], wajib: true },
  { kunci: 'pod_tidak', judul: 'Pod Tidak Sesuai', alias: ['pod tidak sesuai'], wajib: true },
]

// Nomor seri tanggal Excel (mis. 46327) → yyyy-mm-dd. Selain itu: yyyy-mm-dd atau dd/mm/yyyy. Yang tidak dikenali dikembalikan apa adanya
// supaya database menolaknya dengan alasan yang jelas.
export function tanggalDariSel(s: string): string {
  const t = s.trim()
  if (/^\d{5}(\.\d+)?$/.test(t)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(parseFloat(t)) * 86400000).toISOString().slice(0, 10)
  return tanggalIso(t.slice(0, 10)) ?? tanggalIso(t) ?? t
}
const angka = (s: string) => s.trim().replace(/^(\d+)\.0+$/, '$1')

export function bacaTabelKlien(tabel: string[][]): HasilBaca {
  let kop = -1
  let peta: Partial<Record<(typeof KOLOM)[number]['kunci'], number>> = {}
  for (let i = 0; i < Math.min(tabel.length, 15) && kop < 0; i++) {
    const ada: typeof peta = {}
    ;(tabel[i] ?? []).forEach((c, j) => {
      const k = KOLOM.find((x) => x.alias.includes(norm(c ?? '')))
      if (k && ada[k.kunci] === undefined) ada[k.kunci] = j
    })
    if (KOLOM.filter((k) => k.wajib).every((k) => ada[k.kunci] !== undefined)) { kop = i; peta = ada }
  }
  if (kop < 0) {
    const perlu = KOLOM.filter((k) => k.wajib).map((k) => k.judul).join(', ')
    return { baris: [], mitra: [], galat: `Judul kolom tidak dikenali. Berkas harus punya kolom: ${perlu}.` }
  }
  const ambil = (r: string[], k: keyof typeof peta) => (peta[k] === undefined ? '' : (r[peta[k] as number] ?? '').toString().trim())
  const baris: BarisKlien[] = []
  const mitra = new Map<string, MitraFile>()
  for (let i = kop + 1; i < tabel.length; i++) {
    const r = tabel[i] ?? []
    const b: BarisKlien = {
      baris: i + 1,
      tanggal: tanggalDariSel(ambil(r, 'tanggal')), kode_toko: ambil(r, 'kode_toko'), nama_toko: ambil(r, 'nama_toko'), kode_mtr: ambil(r, 'kode_mtr'),
      selesai: angka(ambil(r, 'selesai')), ontime: angka(ambil(r, 'ontime')), late: angka(ambil(r, 'late')), pod_sesuai: angka(ambil(r, 'pod_sesuai')), pod_tidak: angka(ambil(r, 'pod_tidak')),
    }
    if (!b.tanggal && !b.kode_mtr && !b.kode_toko && !b.selesai) continue // baris kosong di ujung sheet
    baris.push(b)
    const kode = b.kode_mtr.toUpperCase()
    if (kode) {
      const m = mitra.get(kode) ?? { kode_mtr: kode, nama: ambil(r, 'nama'), toko: [] }
      const toko = b.kode_toko.toUpperCase()
      if (toko && !m.toko.includes(toko)) m.toko.push(toko)
      mitra.set(kode, m)
    }
  }
  return { baris, mitra: [...mitra.values()], galat: baris.length ? '' : 'Tidak ada baris data di berkas ini.' }
}

export type Ringkasan = { jumlah: number; awal: string; akhir: string; toko: { kode: string; nama: string; baris: number }[] }
export function ringkas(baris: BarisKlien[]): Ringkasan {
  const tgl = baris.map((b) => b.tanggal).filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t)).sort()
  const toko = new Map<string, { kode: string; nama: string; baris: number }>()
  for (const b of baris) {
    const kode = b.kode_toko.toUpperCase()
    if (!kode) continue
    const t = toko.get(kode) ?? { kode, nama: b.nama_toko, baris: 0 }
    t.baris++
    toko.set(kode, t)
  }
  return { jumlah: baris.length, awal: tgl[0] ?? '', akhir: tgl[tgl.length - 1] ?? '', toko: [...toko.values()].sort((a, b) => a.kode.localeCompare(b.kode)) }
}

// ───────── pencocokan mitra: urutan Nama → Kode MTR → Pitstop (penempatan) ─────────
export type RiderOrca = { kode_mtr: string | null; nama: string; ds_id: string | null }
export type StatusMitra = 'cocok' | 'kode_beda' | 'nama_beda' | 'ambigu' | 'belum'
export type CocokMitra = { kode_mtr: string; toko: string[]; status: StatusMitra; pitstop: 'sama' | 'beda' | '' }

const namaNorm = (s: string) => s.toLowerCase().replace(/[^a-z ]+/g, ' ').split(' ').filter(Boolean).join(' ')

// 1. Nama: ada rider ORCA bernama sama? Jika kodenya juga sama → cocok. Jika kodenya beda atau kosong di ORCA → kode_beda (kode salah satu pihak perlu diperbaiki).
//    Beberapa rider ORCA bernama sama dan tak ada yang berkode sama → ambigu.
// 2. Kode MTR: tak ada nama yang cocok, tetapi kodenya ada di ORCA → nama_beda (nama salah ketik, atau kode dipakai orang lain).
// 3. Pitstop: untuk kode_beda dan nama_beda, apakah rider ORCA itu bertugas di DS toko yang tercatat di file ('sama') atau di DS lain ('beda').
//    Tidak ada yang cocok sama sekali → belum (belum terdaftar di ORCA).
export function cocokkanMitra(mitra: MitraFile[], orca: RiderOrca[], dsPerToko: Map<string, string>): CocokMitra[] {
  const perNama = new Map<string, RiderOrca[]>()
  const perKode = new Map<string, RiderOrca>()
  for (const r of orca) {
    const n = namaNorm(r.nama)
    if (n) perNama.set(n, [...(perNama.get(n) ?? []), r])
    if (r.kode_mtr) perKode.set(r.kode_mtr.trim().toUpperCase(), r)
  }
  const pitstop = (r: RiderOrca, toko: string[]): 'sama' | 'beda' | '' => {
    const ds = toko.map((t) => dsPerToko.get(t)).filter(Boolean)
    if (!ds.length || !r.ds_id) return ''
    return ds.includes(r.ds_id) ? 'sama' : 'beda'
  }
  return mitra.map((m) => {
    const dasar = { kode_mtr: m.kode_mtr, toko: m.toko }
    const calon = perNama.get(namaNorm(m.nama)) ?? []
    if (calon.length) {
      const sama = calon.find((r) => (r.kode_mtr ?? '').trim().toUpperCase() === m.kode_mtr)
      if (sama) return { ...dasar, status: 'cocok', pitstop: '' }
      if (calon.length === 1) return { ...dasar, status: 'kode_beda', pitstop: pitstop(calon[0], m.toko) }
      return { ...dasar, status: 'ambigu', pitstop: '' }
    }
    const lewatKode = perKode.get(m.kode_mtr)
    if (lewatKode) return { ...dasar, status: 'nama_beda', pitstop: pitstop(lewatKode, m.toko) }
    return { ...dasar, status: 'belum', pitstop: '' }
  })
}

// Saran DS untuk kode toko yang belum terpasang: nama toko di file memuat atau dimuat nama DS (tanpa awalan "DS"). Hanya saran, dipasang manual.
const namaToko = (s: string) => norm(s).replace(/^(ds|dark store) /, '').replace(/^alfagift /, '')
export function sarankanDs<T extends { id: string; nama: string }>(nama: string, daftar: T[]): T[] {
  const n = namaToko(nama)
  if (!n) return []
  return daftar.filter((d) => {
    const x = namaToko(d.nama)
    return x.includes(n) || n.includes(x)
  })
}
