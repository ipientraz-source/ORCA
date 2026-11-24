// Bentuk data fulfillment aktual dan tepat waktu dari clock-in BO (RPC aktual_bo dan aktual_bo_harian, migrasi 0065) dan pembantu tampilannya.
// Aturan perhitungannya ada di database, supaya laporan WhatsApp nanti memakai angka yang sama persis dengan layar.
export type AktualBo = {
  tanggal: string; ds_id: string; ds_nama: string
  kebutuhan: number; terpenuhi: number; hadir: number; tepat: number; captain: number; tanpa_orca: number
  b_pagi: number; h_pagi: number; t_pagi: number; b_tengah: number; h_tengah: number; t_tengah: number; b_siang: number; h_siang: number; t_siang: number
}
export type AktualBoHari = { tanggal: string; kebutuhan: number; terpenuhi: number; hadir: number; tepat: number; tanpa_orca: number; ds_aktif: number }

// Persen bulat, atau null bila pembaginya 0 (belum ada data yang bisa dinilai)
export const persenBo = (bagian: number, total: number) => (total > 0 ? Math.round((100 * bagian) / total) : null)
export const teksPersen = (p: number | null) => (p === null ? '–' : p + '%')
