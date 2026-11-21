// Aturan laporan order rider, dipisah dari index.ts supaya bisa dites tanpa Deno (lihat test/laporan-order.test.mjs).
// Semua fungsi murni: mengembalikan pesan kesalahan (bahasa Indonesia) atau null kalau valid.

export const MAKS_FOTO = 10
export const MAKS_BYTE = 2 * 1024 * 1024 // sama dengan batas bucket order-ss
export const HARI_MUNDUR = 7
export const TIPE_FOTO = ['image/jpeg', 'image/png', 'image/webp']

export const geserHari = (d: string, n: number) => {
  const t = new Date(d + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

export const hariIniWib = (sekarang = Date.now()) => new Date(sekarang + 7 * 3600 * 1000).toISOString().slice(0, 10)

export function cekTanggal(tanggal: unknown, hariIni: string): string | null {
  if (typeof tanggal !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal) || Number.isNaN(Date.parse(tanggal + 'T00:00:00Z'))) return 'Tanggal tidak valid'
  if (tanggal > hariIni) return 'Tidak bisa melapor untuk tanggal mendatang'
  if (tanggal < geserHari(hariIni, -HARI_MUNDUR)) return `Laporan hanya bisa diisi sampai ${HARI_MUNDUR} hari ke belakang`
  return null
}

export function cekIsi(jumlah: unknown, catatan: unknown, jumlahFoto: number): string | null {
  if (typeof jumlah !== 'number' || !Number.isInteger(jumlah) || jumlah < 0 || jumlah > 999) return 'Jumlah order harus bilangan bulat 0 sampai 999'
  if (catatan != null && (typeof catatan !== 'string' || catatan.length > 500)) return 'Catatan maksimal 500 karakter'
  if (jumlahFoto > MAKS_FOTO) return `Maksimal ${MAKS_FOTO} foto per hari`
  if (jumlah > 0 && jumlahFoto === 0) return 'Unggah minimal satu screenshot order sebagai bukti'
  return null
}

export function cekBerkas(f: { type: string; size: number }): string | null {
  if (!TIPE_FOTO.includes(f.type)) return 'Foto harus berformat JPEG, PNG, atau WebP'
  if (f.size > MAKS_BYTE) return 'Ukuran satu foto maksimal 2 MB'
  if (f.size === 0) return 'Foto kosong'
  return null
}

export const pathFoto = (riderId: string, tanggal: string, uuid: string) => `${riderId}/${tanggal}/${uuid}.jpg`

// Alamat foto yang boleh dipertahankan: harus milik rider ini di tanggal ini (mencegah merujuk foto rider lain)
export const fotoMilik = (path: unknown, riderId: string, tanggal: string) =>
  typeof path === 'string' && path.startsWith(`${riderId}/${tanggal}/`) && !path.includes('..') && !path.slice(riderId.length + tanggal.length + 2).includes('/')
