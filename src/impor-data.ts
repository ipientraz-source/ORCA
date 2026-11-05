// Impor data baku (templat Excel Dash ORCA): murni, tanpa import React/Supabase, supaya mudah diuji.
// Satu mesin dipakai dua jalur: impor CSV (banyak baris) dan input manual (satu baris) → aturan duplikat PASTI sama.
// Aturan duplikat: data yang sudah ada TIDAK PERNAH dihapus atau ditimpa; baris yang dobel (dengan data lama atau dengan baris
// lain di file yang sama) dilewati dan dilaporkan, bukan ditambahkan lagi. Impor ulang file yang sama = tidak menambah apa pun.
import { cocokDs, normDs, normPlat, tahunDariVin } from './impor.ts'

export type Row = Record<string, string>
export type StatusBaris = 'siap' | 'duplikat' | 'salah'
export type Hasil = { baris: number; nilai: Row; status: StatusBaris; alasan: string; data: Record<string, unknown> | null }
export type Kol = { kunci: string; judul: string; alias?: string[]; wajib?: boolean; opsi?: string[]; tipe?: 'teks' | 'tanggal' | 'angka'; contoh: string; bantuan?: string }
export type Jenis = 'rider' | 'motor' | 'kandidat' | 'ds' | 'servis' | 'kerusakan'

// Data yang sudah ada di sistem, dimuat UI sebelum memeriksa
export type Ctx = {
  ds: { id: string; nama: string }[]
  riders: { id: string; kode_mtr: string | null; nama: string; no_hp: string | null; peran: string; status: string }[]
  kandidat: { nama: string; no_hp: string | null }[]
  motors: { id: string; kode_motor: string; plat_nomor: string | null; no_rangka: string | null }[]
  servis: { motor_id: string; tanggal: string; jenis: string; jenis_lain: string | null }[]
  rusak: { motor_id: string; tanggal: string; jenis: string; deskripsi: string }[]
  jenisServis: string[]
  jenisRusak: string[]
  wajibDs?: boolean // Arcon: rider baru harus langsung masuk ke salah satu DS yang dipegang
}
export const ctxKosong = (): Ctx => ({ ds: [], riders: [], kandidat: [], motors: [], servis: [], rusak: [], jenisServis: [], jenisRusak: [] })

export const SUMBER = ['Referral rider', 'Walk-in', 'Grup WhatsApp', 'Media sosial', 'Job board', 'Lainnya']
const STATUS_KANDIDAT = ['baru', 'dihubungi', 'interview', 'training', 'diterima', 'ditolak']
const KEPARAHAN = ['ringan', 'sedang', 'berat']
const STATUS_RUSAK = ['dilaporkan', 'diproses', 'selesai']

// ───────── pembantu ─────────
export const kecil = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const rapi = (s: string) => s.replace(/\s+/g, ' ').trim()
const sama = (a: string, b: string) => kecil(a) === kecil(b)
const dalam = (daftar: string[], v: string) => daftar.find((x) => sama(x, v)) ?? null

// "+62 812-3456" → "0812..." supaya nomor yang sama dengan penulisan beda terbaca dobel
export function normHp(s: string): string {
  const d = s.replace(/[^0-9]/g, '')
  return d.startsWith('62') ? '0' + d.slice(2) : d
}

// yyyy-mm-dd atau dd/mm/yyyy (atau dd-mm-yyyy) → yyyy-mm-dd; null bila bukan tanggal nyata
export function tanggalIso(s: string): string | null {
  const t = s.trim()
  let y: number, m: number, d: number
  let a = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (a) [y, m, d] = [+a[1], +a[2], +a[3]]
  else if ((a = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) [d, m, y] = [+a[1], +a[2], +a[3]]
  else return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 2015) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
const bulat = (s: string): number | null => {
  const t = s.replace(/[.\s]/g, '').replace(/^Rp/i, '')
  return /^\d+$/.test(t) ? parseInt(t, 10) : null
}
const ya = (s: string) => ['ya', 'y', 'yes', 'true', '1'].includes(kecil(s))

// ───────── definisi kolom (sama dengan judul kolom di templat Excel) ─────────
export const KOLOM: Record<Jenis, Kol[]> = {
  rider: [
    { kunci: 'kode_mtr', judul: 'Kode MTR', alias: ['kode mtr', 'employee id', 'kode mitra', 'id', 'mtr'], wajib: true, contoh: 'MTR0099001' },
    { kunci: 'nama', judul: 'Nama', alias: ['nama', 'full name', 'name', 'nama lengkap'], wajib: true, contoh: 'Contoh Rider Satu' },
    { kunci: 'no_hp', judul: 'No HP', alias: ['no hp', 'phone', 'telepon', 'hp', 'no wa', 'whatsapp'], contoh: '081200000001' },
    { kunci: 'ds', judul: 'DS', alias: ['ds', 'nama ds', 'depot'], contoh: 'DS GALAXY', bantuan: 'Nama DS persis seperti di Kelola DS' },
    { kunci: 'status', judul: 'Status', opsi: ['aktif'], contoh: 'aktif', bantuan: 'Hanya aktif. Rider berhenti dicatat lewat Data Rider (butuh tanggal dan alasan).' },
  ],
  motor: [
    { kunci: 'ds', judul: 'DS Location', alias: ['ds location', 'lokasi', 'lokasi ds', 'ds', 'nama ds', 'dark store'], wajib: true, contoh: 'DS GALAXY' },
    { kunci: 'plat', judul: 'License Plate', alias: ['license plate', 'plat', 'plat nomor', 'nopol', 'no polisi', 'nomor polisi'], wajib: true, contoh: 'B 4672 SWN' },
    { kunci: 'vin', judul: 'VIN', alias: ['vin', 'no rangka', 'nomor rangka', 'chassis'], contoh: 'MH2AEB1H4SJ002956' },
    { kunci: 'model', judul: 'Model', alias: ['model', 'tipe'], contoh: 'Fox R' },
    { kunci: 'status_unit', judul: 'Status Motor', alias: ['status motor', 'status', 'status unit'], opsi: ['active', 'return'], contoh: 'active', bantuan: 'active = masih dipakai, return = sudah dikembalikan. Kosong = active.' },
  ],
  kandidat: [
    { kunci: 'nama', judul: 'Nama', alias: ['nama', 'nama lengkap'], wajib: true, contoh: 'Budi Santoso' },
    { kunci: 'no_hp', judul: 'No HP', alias: ['no hp', 'hp', 'telepon', 'no wa', 'whatsapp'], contoh: '081234567890', bantuan: 'Kunci pengecek dobel' },
    { kunci: 'ds', judul: 'DS Tujuan', alias: ['ds tujuan', 'ds', 'nama ds'], contoh: 'DS GALAXY' },
    { kunci: 'sumber', judul: 'Sumber', alias: ['sumber'], opsi: SUMBER, contoh: 'Walk-in' },
    { kunci: 'perujuk', judul: 'Kode MTR Perujuk', alias: ['kode mtr perujuk', 'perujuk', 'referral'], contoh: 'MTR0021037', bantuan: 'Wajib bila Sumber = Referral rider' },
    { kunci: 'status', judul: 'Status', alias: ['status'], opsi: STATUS_KANDIDAT.filter((s) => s !== 'diterima'), contoh: 'baru', bantuan: 'Kosong = baru. "Diterima" tidak bisa diimpor: pakai tombol "Terima jadi rider" di Rekrutmen.' },
    { kunci: 'masuk', judul: 'Tanggal Masuk', alias: ['tanggal masuk', 'tgl masuk'], tipe: 'tanggal', contoh: '2026-10-28' },
    { kunci: 'alasan', judul: 'Alasan Ditolak', alias: ['alasan ditolak', 'alasan'], contoh: '', bantuan: 'Wajib bila Status = ditolak' },
    { kunci: 'catatan', judul: 'Catatan', alias: ['catatan'], contoh: '' },
  ],
  ds: [
    { kunci: 'nama', judul: 'Nama DS', alias: ['nama ds', 'ds', 'nama'], wajib: true, contoh: 'DS HAYAM WURUK' },
    { kunci: 'pagi', judul: 'Kuota Pagi', alias: ['kuota pagi'], wajib: true, tipe: 'angka', contoh: '3' },
    { kunci: 'siang', judul: 'Kuota Siang', alias: ['kuota siang'], wajib: true, tipe: 'angka', contoh: '3' },
    { kunci: 'grup', judul: 'ID Grup WhatsApp', alias: ['id grup whatsapp', 'grup wa', 'id grup'], contoh: '' },
  ],
  servis: [
    { kunci: 'plat', judul: 'Plat Motor', alias: ['plat motor', 'plat', 'license plate', 'nopol'], wajib: true, contoh: 'B 4672 SWN', bantuan: 'Motor harus sudah ada di sistem' },
    { kunci: 'tanggal', judul: 'Tanggal', alias: ['tanggal', 'tgl'], wajib: true, tipe: 'tanggal', contoh: '2026-09-20' },
    { kunci: 'jenis', judul: 'Jenis', alias: ['jenis'], wajib: true, contoh: 'Servis rutin' },
    { kunci: 'jenis_lain', judul: 'Jenis Lain', alias: ['jenis lain'], contoh: '', bantuan: 'Wajib bila Jenis = Lainnya' },
    { kunci: 'bengkel', judul: 'Bengkel', alias: ['bengkel'], contoh: 'Bengkel Resmi' },
    { kunci: 'km', judul: 'Kilometer', alias: ['kilometer', 'km'], tipe: 'angka', contoh: '3150' },
    { kunci: 'biaya', judul: 'Biaya', alias: ['biaya'], tipe: 'angka', contoh: '175000' },
    { kunci: 'asuransi', judul: 'Ditanggung Asuransi', alias: ['ditanggung asuransi', 'asuransi'], opsi: ['Ya', 'Tidak'], contoh: 'Tidak', bantuan: 'Bila Ya, Biaya harus 0' },
    { kunci: 'catatan', judul: 'Catatan', alias: ['catatan'], contoh: '' },
  ],
  kerusakan: [
    { kunci: 'plat', judul: 'Plat Motor', alias: ['plat motor', 'plat', 'license plate', 'nopol'], wajib: true, contoh: 'B 4672 SWN', bantuan: 'Motor harus sudah ada di sistem' },
    { kunci: 'tanggal', judul: 'Tanggal', alias: ['tanggal', 'tgl'], wajib: true, tipe: 'tanggal', contoh: '2026-10-12' },
    { kunci: 'jenis', judul: 'Jenis', alias: ['jenis'], wajib: true, contoh: 'Rem' },
    { kunci: 'jenis_lain', judul: 'Jenis Lain', alias: ['jenis lain'], contoh: '', bantuan: 'Wajib bila Jenis = Lainnya' },
    { kunci: 'keparahan', judul: 'Keparahan', alias: ['keparahan'], wajib: true, opsi: KEPARAHAN, contoh: 'sedang' },
    { kunci: 'deskripsi', judul: 'Deskripsi', alias: ['deskripsi'], wajib: true, contoh: 'Rem depan terasa blong' },
    { kunci: 'status', judul: 'Status', alias: ['status'], opsi: STATUS_RUSAK, contoh: 'dilaporkan', bantuan: 'Kosong = dilaporkan' },
    { kunci: 'biaya', judul: 'Biaya', alias: ['biaya'], tipe: 'angka', contoh: '0' },
    { kunci: 'asuransi', judul: 'Ditanggung Asuransi', alias: ['ditanggung asuransi', 'asuransi'], opsi: ['Ya', 'Tidak'], contoh: 'Tidak' },
    { kunci: 'selesai', judul: 'Tanggal Selesai', alias: ['tanggal selesai'], tipe: 'tanggal', contoh: '', bantuan: 'Wajib bila Status = selesai' },
    { kunci: 'perbaikan', judul: 'Catatan Perbaikan', alias: ['catatan perbaikan'], contoh: '' },
  ],
}
export const TABEL: Record<Jenis, string> = { rider: 'riders', motor: 'motor', kandidat: 'kandidat', ds: 'ds', servis: 'servis_motor', kerusakan: 'kerusakan_motor' }
export const NAMA: Record<Jenis, string> = { rider: 'Rider', motor: 'Motor', kandidat: 'Kandidat', ds: 'DS', servis: 'Servis Motor', kerusakan: 'Kerusakan Motor' }

// Tabel CSV → baris bernama kunci. Baris yang seluruhnya kosong dibuang. Nomor baris = nomor baris di Excel (judul = 1).
export function bacaTabel(tabel: string[][], jenis: Jenis): { baris: { baris: number; nilai: Row }[]; galat: string; diabaikan: string[] } {
  const [h = [], ...isi] = tabel
  const kolom = KOLOM[jenis]
  const idx = new Map<string, number>()
  for (const k of kolom) {
    const i = h.findIndex((x) => [k.judul, ...(k.alias ?? [])].some((a) => kecil(a) === kecil(x)))
    if (i >= 0) idx.set(k.kunci, i)
  }
  const hilang = kolom.filter((k) => k.wajib && !idx.has(k.kunci)).map((k) => k.judul)
  const diabaikan = h.filter((x, i) => x.trim() && ![...idx.values()].includes(i)).map((x) => x.trim())
  if (hilang.length) return { baris: [], diabaikan, galat: `Kolom wajib tidak ditemukan di baris judul: ${hilang.join(', ')}. Pakai templat CSV dari tombol "Unduh templat CSV" dan jangan ubah nama kolomnya.` }
  const baris = isi
    .map((c, i) => ({ baris: i + 2, nilai: Object.fromEntries(kolom.map((k) => [k.kunci, rapi(c[idx.get(k.kunci) ?? -1] ?? '')])) as Row }))
    .filter((b) => Object.values(b.nilai).some(Boolean))
  return { baris, galat: '', diabaikan }
}

// ───────── pemeriksa per jenis ─────────
type Cek = { status: StatusBaris; alasan: string; data?: Record<string, unknown> }
const salah = (alasan: string): Cek => ({ status: 'salah', alasan })
const dobel = (alasan: string): Cek => ({ status: 'duplikat', alasan })
const siap = (data: Record<string, unknown>): Cek => ({ status: 'siap', alasan: '', data })

function dsPersis(ctx: Ctx, nama: string) {
  const n = normDs(nama)
  return n ? ctx.ds.find((d) => normDs(d.nama) === n) ?? null : null
}

function cekRider(v: Row, ctx: Ctx, pakai: Set<string>): Cek {
  const kode = v.kode_mtr.toUpperCase().replace(/\s+/g, '')
  if (!kode || !v.nama) return salah('Kode MTR dan Nama wajib diisi')
  if (v.status && !sama(v.status, 'aktif')) return salah('Status hanya boleh aktif. Rider berhenti dicatat lewat Data Rider.')
  let ds: string | null = null
  if (ctx.wajibDs && !v.ds) return salah(`DS wajib diisi (kolom bernama "DS"), pilih salah satu: ${ctx.ds.map((d) => d.nama).join(', ')}`)
  if (v.ds) {
    const d = dsPersis(ctx, v.ds)
    if (!d) return salah(ctx.wajibDs ? `DS "${v.ds}" tidak ada di DS yang Anda pegang (${ctx.ds.map((d) => d.nama).join(', ')}). Bila ini DS baru, minta Super-admin membuatnya dulu di Kelola DS` : `DS "${v.ds}" belum ada. Buat dulu di Kelola DS atau impor sheet DS.`)
    ds = d.id
  }
  if (ctx.riders.some((r) => (r.kode_mtr ?? '').toUpperCase() === kode)) return dobel('Kode MTR sudah terdaftar')
  if (pakai.has('k:' + kode)) return dobel('Kode MTR dobel di file')
  pakai.add('k:' + kode)
  return siap({ kode_mtr: kode, nama: v.nama, no_hp: v.no_hp || null, ds_id: ds })
}

function cekMotor(v: Row, ctx: Ctx, pakai: Set<string>): Cek {
  const plat = normPlat(v.plat)
  const vin = v.vin.toUpperCase().replace(/\s+/g, '')
  if (!plat) return salah('Plat nomor wajib diisi')
  if (!v.ds) return salah('DS Location wajib diisi')
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return salah('VIN harus 17 karakter (tanpa huruf I, O, Q)')
  const status = v.status_unit ? dalam(['active', 'return'], v.status_unit) : 'active'
  if (!status) return salah('Status Motor harus active atau return')
  const ds = cocokDs(v.ds, ctx.ds.map((d) => d.nama))
  if (!ds) return salah(`DS "${v.ds}" belum ada. Buat dulu di Kelola DS atau impor sheet DS.`)
  if (ctx.motors.some((m) => (m.plat_nomor ?? '').toUpperCase() === plat || m.kode_motor.toUpperCase() === plat)) return dobel('Plat sudah terdaftar')
  if (vin && ctx.motors.some((m) => (m.no_rangka ?? '').toUpperCase() === vin)) return dobel('VIN sudah terdaftar')
  if (pakai.has('p:' + plat)) return dobel('Plat dobel di file')
  if (vin && pakai.has('v:' + vin)) return dobel('VIN dobel di file')
  pakai.add('p:' + plat)
  if (vin) pakai.add('v:' + vin)
  return siap({ kode_motor: plat, ds_id: ctx.ds.find((d) => d.nama === ds)?.id, plat_nomor: plat, no_rangka: vin || null, model: v.model || null, tahun: tahunDariVin(vin), status_unit: status })
}

function cekKandidat(v: Row, ctx: Ctx, pakai: Set<string>): Cek {
  if (!v.nama) return salah('Nama wajib diisi')
  const status = v.status ? dalam(STATUS_KANDIDAT, v.status) : 'baru'
  if (!status) return salah('Status tidak dikenal (baru, dihubungi, interview, training, ditolak)')
  if (status === 'diterima') return salah('Status Diterima tidak bisa diimpor. Tambahkan ke Rider, lalu pakai "Terima jadi rider" di Rekrutmen.')
  if (status === 'ditolak' && !v.alasan) return salah('Status ditolak: Alasan Ditolak wajib diisi')
  const sumber = v.sumber ? dalam(SUMBER, v.sumber) ?? 'Lainnya' : null
  let perujuk: string | null = null
  if (sumber === 'Referral rider') {
    if (!v.perujuk) return salah('Sumber Referral rider: Kode MTR Perujuk wajib diisi')
    const r = ctx.riders.find((x) => (x.kode_mtr ?? '').toUpperCase() === v.perujuk.toUpperCase() && x.status === 'aktif' && ['rider', 'captain'].includes(x.peran))
    if (!r) return salah(`Perujuk ${v.perujuk} tidak ditemukan sebagai rider/Captain aktif`)
    perujuk = r.id
  }
  let ds: string | null = null
  if (v.ds) {
    const d = dsPersis(ctx, v.ds)
    if (!d) return salah(`DS "${v.ds}" belum ada`)
    ds = d.id
  }
  let masuk: string | null = null
  if (v.masuk && !(masuk = tanggalIso(v.masuk))) return salah('Tanggal Masuk tidak valid (pakai yyyy-mm-dd)')
  const hp = normHp(v.no_hp)
  // Kunci dobel: nomor HP (juga terhadap rider yang sudah ada); tanpa HP, nama yang sama
  if (hp) {
    if (ctx.kandidat.some((k) => normHp(k.no_hp ?? '') === hp)) return dobel('No HP sudah ada di daftar kandidat')
    if (ctx.riders.some((r) => normHp(r.no_hp ?? '') === hp)) return dobel('No HP ini sudah terdaftar sebagai rider')
    if (pakai.has('h:' + hp)) return dobel('No HP dobel di file')
    pakai.add('h:' + hp)
  } else {
    const n = kecil(v.nama)
    if (ctx.kandidat.some((k) => kecil(k.nama) === n)) return dobel('Tanpa No HP, nama yang sama sudah ada di daftar kandidat')
    if (pakai.has('n:' + n)) return dobel('Nama dobel di file (tanpa No HP)')
    pakai.add('n:' + n)
  }
  return siap({ nama: v.nama, no_hp: v.no_hp || null, sumber, perujuk_id: perujuk, ds_id: ds, status, alasan_tolak: status === 'ditolak' ? v.alasan : null, catatan: v.catatan || null, ...(masuk ? { dibuat: `${masuk}T00:00:00+07:00` } : {}) })
}

function cekDs(v: Row, ctx: Ctx, pakai: Set<string>): Cek {
  if (!v.nama) return salah('Nama DS wajib diisi')
  const pagi = bulat(v.pagi), siang = bulat(v.siang)
  if (pagi === null || siang === null || pagi > 500 || siang > 500) return salah('Kuota Pagi dan Kuota Siang wajib angka bulat 0 sampai 500')
  const n = normDs(v.nama)
  if (!n) return salah('Nama DS tidak valid')
  if (ctx.ds.some((d) => normDs(d.nama) === n)) return dobel('DS sudah ada')
  if (pakai.has('d:' + n)) return dobel('Nama DS dobel di file')
  pakai.add('d:' + n)
  return siap({ nama: v.nama.toUpperCase(), kuota_pagi: pagi, kuota_siang: siang, group_wa_id: v.grup || null })
}

function cariMotor(ctx: Ctx, plat: string) {
  const p = normPlat(plat)
  return ctx.motors.find((m) => (m.plat_nomor ?? '').toUpperCase() === p || m.kode_motor.toUpperCase() === p) ?? null
}

function cekServis(v: Row, ctx: Ctx, pakai: Set<string>): Cek {
  if (!v.plat || !v.tanggal || !v.jenis) return salah('Plat Motor, Tanggal, dan Jenis wajib diisi')
  const tgl = tanggalIso(v.tanggal)
  if (!tgl) return salah('Tanggal tidak valid (pakai yyyy-mm-dd)')
  const jenis = dalam(ctx.jenisServis, v.jenis)
  if (!jenis) return salah(`Jenis tidak dikenal. Pilihan: ${ctx.jenisServis.join(', ')}`)
  if (jenis === 'Lainnya' && !v.jenis_lain) return salah('Jenis Lainnya: Jenis Lain wajib diisi')
  const m = cariMotor(ctx, v.plat)
  if (!m) return salah(`Motor ${normPlat(v.plat)} belum terdaftar. Impor sheet Motor dulu.`)
  const biaya = v.biaya ? bulat(v.biaya) : 0
  const km = v.km ? bulat(v.km) : null
  if (biaya === null || (v.km && km === null)) return salah('Biaya dan Kilometer harus angka bulat')
  const asuransi = ya(v.asuransi)
  if (asuransi && biaya > 0) return salah('Ditanggung asuransi: Biaya harus 0')
  const lain = jenis === 'Lainnya' ? kecil(v.jenis_lain) : ''
  if (ctx.servis.some((s) => s.motor_id === m.id && s.tanggal === tgl && s.jenis === jenis && kecil(s.jenis_lain ?? '') === lain)) return dobel('Servis dengan motor, tanggal, dan jenis yang sama sudah tercatat')
  const kunci = `s:${m.id}|${tgl}|${jenis}|${lain}`
  if (pakai.has(kunci)) return dobel('Servis yang sama dobel di file')
  pakai.add(kunci)
  return siap({ motor_id: m.id, tanggal: tgl, jenis, jenis_lain: jenis === 'Lainnya' ? v.jenis_lain : null, bengkel: v.bengkel || null, kilometer: km, biaya, ditanggung_asuransi: asuransi, catatan: v.catatan || null })
}

function cekRusak(v: Row, ctx: Ctx, pakai: Set<string>): Cek {
  if (!v.plat || !v.tanggal || !v.jenis || !v.keparahan || !v.deskripsi) return salah('Plat Motor, Tanggal, Jenis, Keparahan, dan Deskripsi wajib diisi')
  const tgl = tanggalIso(v.tanggal)
  if (!tgl) return salah('Tanggal tidak valid (pakai yyyy-mm-dd)')
  const jenis = dalam(ctx.jenisRusak, v.jenis)
  if (!jenis) return salah(`Jenis tidak dikenal. Pilihan: ${ctx.jenisRusak.join(', ')}`)
  if (jenis === 'Lainnya' && !v.jenis_lain) return salah('Jenis Lainnya: Jenis Lain wajib diisi')
  const parah = dalam(KEPARAHAN, v.keparahan)
  if (!parah) return salah('Keparahan harus ringan, sedang, atau berat')
  const status = v.status ? dalam(STATUS_RUSAK, v.status) : 'dilaporkan'
  if (!status) return salah('Status harus dilaporkan, diproses, atau selesai')
  let selesai: string | null = null
  if (v.selesai && !(selesai = tanggalIso(v.selesai))) return salah('Tanggal Selesai tidak valid (pakai yyyy-mm-dd)')
  if (status === 'selesai' && !selesai) return salah('Status selesai: Tanggal Selesai wajib diisi')
  const m = cariMotor(ctx, v.plat)
  if (!m) return salah(`Motor ${normPlat(v.plat)} belum terdaftar. Impor sheet Motor dulu.`)
  const biaya = v.biaya ? bulat(v.biaya) : 0
  if (biaya === null) return salah('Biaya harus angka bulat')
  const asuransi = ya(v.asuransi)
  if (asuransi && biaya > 0) return salah('Ditanggung asuransi: Biaya harus 0')
  const desk = kecil(v.deskripsi)
  if (ctx.rusak.some((r) => r.motor_id === m.id && r.tanggal === tgl && r.jenis === jenis && kecil(r.deskripsi) === desk)) return dobel('Laporan kerusakan yang sama sudah tercatat')
  const kunci = `r:${m.id}|${tgl}|${jenis}|${desk}`
  if (pakai.has(kunci)) return dobel('Laporan yang sama dobel di file')
  pakai.add(kunci)
  return siap({ motor_id: m.id, tanggal: tgl, jenis, jenis_lain: jenis === 'Lainnya' ? v.jenis_lain : null, keparahan: parah, deskripsi: v.deskripsi, status, biaya, ditanggung_asuransi: asuransi, tanggal_selesai: selesai, catatan_perbaikan: v.perbaikan || null })
}

const PEMERIKSA: Record<Jenis, (v: Row, ctx: Ctx, pakai: Set<string>) => Cek> = { rider: cekRider, motor: cekMotor, kandidat: cekKandidat, ds: cekDs, servis: cekServis, kerusakan: cekRusak }

// Periksa banyak baris sekaligus. Baris yang dobel di dalam file ditandai mulai kemunculan kedua; kemunculan pertama tetap siap.
// Baris contoh bawaan templat yang lupa dihapus: jangan sampai masuk sebagai data sungguhan
export const barisContoh = (jenis: Jenis, v: Row) => KOLOM[jenis].every((k) => !k.contoh || (v[k.kunci] ?? '').trim() === k.contoh)

export function periksa(jenis: Jenis, baris: { baris: number; nilai: Row }[], ctx: Ctx): Hasil[] {
  const pakai = new Set<string>()
  return baris.map((b) => {
    const c = barisContoh(jenis, b.nilai) ? salah('Ini baris contoh dari templat. Hapus baris ini atau ganti dengan data asli') : PEMERIKSA[jenis](b.nilai, ctx, pakai)
    return { baris: b.baris, nilai: b.nilai, status: c.status, alasan: c.alasan, data: c.data ?? null }
  })
}

// Templat CSV kosong: judul kolom + satu baris contoh (data fiktif)
export const templatCsv = (jenis: Jenis): string[][] => [KOLOM[jenis].map((k) => k.judul), KOLOM[jenis].map((k) => k.contoh)]
