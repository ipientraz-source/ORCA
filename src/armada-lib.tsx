// Bagian bersama Fleet management: tipe data, daftar pilihan, lencana, unggah foto (dikecilkan di browser, disimpan di Storage).
import { useEffect, useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { sb, today, toast } from './lib'

export type Motor = {
  id: string; kode_motor: string; ds_id: string | null; dipegang_oleh: string | null; kelengkapan: string | null
  status: 'dipakai' | 'di gudang' | 'perbaikan'; plat_nomor: string | null; merek: string | null; model: string | null
  tahun: number | null; warna: string | null; no_rangka: string | null; no_mesin: string | null; tanggal_beli: string | null
  interval_servis_hari: number | null; servis_terakhir: string | null; servis_berikutnya: string | null; catatan: string | null
}
export type Servis = {
  id: string; motor_id: string; tanggal: string; jenis: string; jenis_lain: string | null; bengkel: string | null; kilometer: number | null
  biaya: number; ditanggung_asuransi: boolean; catatan: string | null; foto: string[]; pekerjaan: string[]
}
export type Rusak = {
  id: string; motor_id: string; tanggal: string; jenis: string; jenis_lain: string | null; keparahan: 'ringan' | 'sedang' | 'berat'
  deskripsi: string; pelapor_id: string | null; status: 'dilaporkan' | 'diproses' | 'selesai'; biaya: number
  ditanggung_asuransi: boolean; tanggal_selesai: string | null; catatan_perbaikan: string | null; foto: string[]
}
export type MotorDihapus = { id: string; motor_id: string; kode_motor: string; plat_nomor: string | null; ds_id: string | null; alasan: string; jumlah_servis: number; jumlah_kerusakan: number; dihapus_oleh: string | null; waktu: string }
export type Pindah = { id: string; motor_id: string; dari_ds: string | null; ke_ds: string | null; alasan: string; waktu: string }

export type Permintaan = {
  id: string; judul: string; jenis: string; tenggat: string | null; catatan: string | null; status: 'berjalan' | 'selesai'
  dibuat_oleh: string | null; dibuat: string; ditutup: string | null; pekerjaan: string[]; urgent: boolean
}
export type ItemServis = {
  id: string; permintaan_id: string; motor_id: string; status: 'diminta' | 'dijadwalkan' | 'selesai' | 'dilewati'
  tanggal_jadwal: string | null; servis_id: string | null; selesai_pada: string | null; catatan: string | null
}
export type RingkasanPermintaan = { permintaan_id: string; total: number; selesai: number; dilewati: number; menunggu: number }

export const JENIS_SERVIS = ['Servis rutin', 'Ganti baterai', 'Ganti ban', 'Ganti rem', 'Cek kelistrikan', 'Lainnya']
export const JENIS_RUSAK = ['Ban bocor / pecah', 'Rem', 'Baterai', 'Charger / konektor', 'Motor penggerak (hub)', 'Kontroler', 'Lampu / kelistrikan', 'Bodi / jatuh / tabrakan', 'Spion', 'Kunci / kontak', 'Suspensi', 'Lainnya']
export const MAKS_FOTO = 4
export const PART_SERVIS = ['Ban depan', 'Ban belakang', 'Kampas rem', 'Minyak rem', 'Oli gardan', 'Baterai', 'Lampu / kelistrikan', 'Suspensi', 'Spion', 'Kunci / kontak']

export const BadgeUrgent = () => <span className="badge bg-danger font-bold text-white">URGENT</span>

// Daftar part yang diganti: kotak centang untuk part umum + isian bebas (pisahkan dengan koma) untuk part lain
export function PilihPart({ value, ubah }: { value: string[]; ubah: (v: string[]) => void }) {
  const [lain, setLain] = useState(() => value.filter((p) => !PART_SERVIS.includes(p)).join(', '))
  const tukar = (p: string) => ubah(value.includes(p) ? value.filter((x) => x !== p) : [...value, p])
  const ketik = (t: string) => {
    setLain(t)
    ubah([...value.filter((x) => PART_SERVIS.includes(x)), ...t.split(',').map((x) => x.trim()).filter(Boolean)])
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {PART_SERVIS.map((p) => (
          <label key={p} className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={value.includes(p)} onChange={() => tukar(p)} />{p}</label>
        ))}
      </div>
      <input className="inp w-full max-w-md" placeholder="Part lain (pisahkan dengan koma)" value={lain} onChange={(e) => ketik(e.target.value)} />
    </div>
  )
}

export const rupiah = (n: number) => `Rp ${Number(n).toLocaleString('id-ID')}`
export const angka = (s: string) => parseInt(s.replace(/\D/g, ''), 10) || 0
export const tgl = (d: string | null) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '–')
export const selisihHari = (a: string, b: string) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5)
export const namaJenis = (x: { jenis: string; jenis_lain: string | null }) => (x.jenis === 'Lainnya' && x.jenis_lain ? x.jenis_lain : x.jenis)

const GAYA_STATUS = { dipakai: 'bg-primary-soft text-primary-soft-foreground', 'di gudang': 'bg-muted text-foreground/80', perbaikan: 'bg-warning-soft text-warning' }
export const BadgeStatus = ({ s }: { s: Motor['status'] }) => <span className={`badge capitalize ${GAYA_STATUS[s]}`}>{s}</span>

const GAYA_RUSAK = { dilaporkan: 'bg-danger-soft text-danger', diproses: 'bg-warning-soft text-warning', selesai: 'bg-success-soft text-success' }
export const BadgeRusak = ({ s }: { s: Rusak['status'] }) => <span className={`badge capitalize ${GAYA_RUSAK[s]}`}>{s}</span>
export const BadgeParah = ({ s }: { s: Rusak['keparahan'] }) => (
  <span className={`badge capitalize ${s === 'berat' ? 'bg-danger-soft text-danger' : s === 'sedang' ? 'bg-warning-soft text-warning' : 'bg-muted text-foreground/80'}`}>{s}</span>
)

const GAYA_ITEM = { diminta: 'bg-warning-soft text-warning', dijadwalkan: 'bg-primary-soft text-primary-soft-foreground', selesai: 'bg-success-soft text-success', dilewati: 'bg-muted text-foreground/80' }
export const BadgeItem = ({ s }: { s: ItemServis['status'] }) => <span className={`badge capitalize ${GAYA_ITEM[s]}`}>{s}</span>

// Tenggat pengajuan: lewat = merah, 3 hari ke depan = kuning
export function Tenggat({ d }: { d: string | null }) {
  if (!d) return <span className="text-muted-foreground">Tanpa tenggat</span>
  const sisa = selisihHari(d, today())
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {tgl(d)}
      {sisa < 0 && <span className="badge bg-danger-soft text-danger">Lewat {-sisa} hari</span>}
      {sisa >= 0 && sisa <= 3 && <span className="badge bg-warning-soft text-warning">{sisa === 0 ? 'Hari ini' : `${sisa} hari lagi`}</span>}
    </span>
  )
}

// Jadwal servis berikutnya: terlambat = merah, 7 hari ke depan = kuning
export function ServisBerikutnya({ m }: { m: Motor }) {
  if (!m.servis_berikutnya) return <span className="text-muted-foreground">Belum diatur</span>
  const sisa = selisihHari(m.servis_berikutnya, today())
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {tgl(m.servis_berikutnya)}
      {sisa < 0 && <span className="badge bg-danger-soft text-danger">Terlambat {-sisa} hari</span>}
      {sisa >= 0 && sisa <= 7 && <span className="badge bg-warning-soft text-warning">{sisa === 0 ? 'Hari ini' : `${sisa} hari lagi`}</span>}
    </span>
  )
}

// Kolom rupiah: hanya angka, maksimal 9 digit
export function InputRupiah({ nilai, ubah, disabled }: { nilai: string; ubah: (v: string) => void; disabled?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      Rp
      <input className="inp w-36" inputMode="numeric" placeholder="0" disabled={disabled} value={nilai} onChange={(e) => ubah(e.target.value.replace(/\D/g, '').slice(0, 9))} />
    </span>
  )
}

// Foto dikecilkan dulu di browser (sisi terpanjang 1280 px, JPEG): 4–6 MB dari kamera jadi sekitar 200 KB
async function kecilkan(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const skala = Math.min(1, 1280 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * skala)
  c.height = Math.round(bmp.height * skala)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Foto gagal diproses'))), 'image/jpeg', 0.8))
}

const pesanFoto = (m: string) => (/bucket not found|not found/i.test(m) ? 'Penyimpanan foto belum aktif. Jalankan migrasi SQL terbaru di Supabase.' : /size|too large|payload/i.test(m) ? 'Ukuran foto terlalu besar.' : `Foto gagal diunggah: ${m}`)

// Daftar foto dari Storage (bucket privat) lewat tautan sementara
export function FotoGaleri({ paths, kecil }: { paths: string[]; kecil?: boolean }) {
  const [url, setUrl] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!paths.length) return
    let batal = false
    sb.storage.from('armada').createSignedUrls(paths, 3600).then(({ data }) => {
      if (!batal && data) setUrl(Object.fromEntries(data.filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl as string])))
    })
    return () => {
      batal = true
    }
  }, [paths.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!paths.length) return null
  const ukuran = kecil ? 'size-14' : 'size-24'
  return (
    <div className="flex flex-wrap gap-2">
      {paths.map((p) =>
        url[p] ? (
          <a key={p} href={url[p]} target="_blank" rel="noreferrer" title="Buka foto"><img src={url[p]} alt="Foto" className={`${ukuran} rounded-lg border border-border object-cover`} /></a>
        ) : (
          <span key={p} className={`${ukuran} animate-pulse rounded-lg bg-muted`} />
        ),
      )}
    </div>
  )
}

// Pilih dan unggah foto (maks MAKS_FOTO). Berkas disimpan di Storage: {motor_id}/{uuid}.jpg; yang masuk database hanya alamatnya.
export function FotoPicker({ motorId, value, ubah }: { motorId: string; value: string[]; ubah: (v: string[]) => void }) {
  const [sibuk, setSibuk] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const sisa = MAKS_FOTO - value.length

  async function pilih(files: FileList | null) {
    if (!files?.length) return
    const daftar = [...files].slice(0, sisa)
    if (files.length > sisa) toast(`Maksimal ${MAKS_FOTO} foto per catatan.`)
    setSibuk(true)
    const baru: string[] = []
    for (const f of daftar) {
      try {
        const blob = await kecilkan(f)
        const path = `${motorId}/${crypto.randomUUID()}.jpg`
        const { error } = await sb.storage.from('armada').upload(path, blob, { contentType: 'image/jpeg' })
        if (error) throw new Error(error.message)
        baru.push(path)
      } catch (e) {
        toast(pesanFoto((e as Error).message))
        break
      }
    }
    if (baru.length) ubah([...value, ...baru])
    setSibuk(false)
    if (input.current) input.current.value = ''
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {value.map((p) => (
          <span key={p} className="relative">
            <FotoGaleri paths={[p]} kecil />
            <button type="button" aria-label="Hapus foto" onClick={() => ubah(value.filter((x) => x !== p))} className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background"><X size={12} /></button>
          </span>
        ))}
        {sisa > 0 && (
          <button type="button" className="btn2" disabled={sibuk} onClick={() => input.current?.click()}>
            <ImagePlus size={14} />{sibuk ? 'Mengunggah…' : 'Tambah foto'}
          </button>
        )}
        <span className="text-xs text-muted-foreground">{value.length}/{MAKS_FOTO} foto. Dikecilkan otomatis sebelum diunggah.</span>
      </div>
      <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => pilih(e.target.files)} />
    </div>
  )
}
