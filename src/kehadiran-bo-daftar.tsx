// Daftar clock-in BO per rider: rentang tanggal, cari nama/kode mitra, filter DS, shift, dan tepat waktu, serta unduh CSV.
// Datanya langsung dari tabel kehadiran_bo (Super-admin semua DS, Arcon hanya DS yang dipegangnya, dibatasi database).
// Shift dan tepat waktu di sini dibaca dari JAM MASUK memakai jam di "Jam shift dan tepat waktu"; Dashboard BO bisa berbeda
// untuk rider terjadwal/tukar karena memakai jadwal dan laporan Captain.
import { useMemo, useState } from 'react'
import { Download, Search } from 'lucide-react'
import { sb, today, addDays, tanggal, useRows, Err, Kosong, Select, usePage, Pagination, toCsv, download } from './lib'

type Atur = { mulai_pagi: string; mulai_tengah: string; mulai_siang: string; toleransi_menit: number; batas_pagi: string; batas_tengah: string }
type Baris = { id: string; ds_id: string | null; hub: string; kode_mtr: string; tanggal: string; masuk_lokal: string; zona: 'WIB' | 'WITA' | 'WIT'; keluar_wib: string | null }
type Ds = { id: string; nama: string }
type Rider = { kode_mtr: string | null; nama: string }
type Shift = 'pagi' | 'tengah' | 'siang'

const UKURAN = 1000 // batas baris per permintaan database
const MAKS_HARI = 92
const NAMA_SHIFT: Record<Shift, string> = { pagi: 'Pagi', tengah: 'Middle', siang: 'Siang' }
const ZONA: Record<string, string> = { WIB: 'Asia/Jakarta', WITA: 'Asia/Makassar', WIT: 'Asia/Jayapura' }
const RENTANG = [
  { value: '1', label: 'Hari ini' },
  { value: '7', label: '7 hari terakhir' },
  { value: '30', label: '30 hari terakhir' },
  { value: '90', label: '3 bulan terakhir' },
  { value: 'bebas', label: 'Pilih tanggal sendiri' },
]

// Ambil semua baris (database membatasi 1000 per permintaan): halaman pertama sekaligus jumlahnya, sisanya serentak
async function ambilSemua<T>(halaman: (dari: number, sampai: number) => PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>) {
  const awal = await halaman(0, UKURAN - 1)
  if (awal.error) return { data: [] as T[], error: awal.error }
  const baris = (awal.data ?? []) as T[]
  const total = awal.count ?? baris.length
  const sisa = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(total / UKURAN) - 1) }, (_, i) => halaman((i + 1) * UKURAN, (i + 2) * UKURAN - 1)))
  const gagal = sisa.find((r) => r.error)
  if (gagal) return { data: [] as T[], error: gagal.error }
  return { data: baris.concat(...sisa.map((r) => (r.data ?? []) as T[])), error: null }
}

const jam = (t: string) => t.slice(0, 5)
const keluarLokal = (iso: string, zona: string, tglMasuk: string) => {
  const d = new Date(iso)
  const tz = ZONA[zona] ?? ZONA.WIB
  const hhmm = d.toLocaleTimeString('id-ID', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':')
  const tgl = d.toLocaleDateString('en-CA', { timeZone: tz })
  return tgl === tglMasuk ? hhmm : `${tanggal(tgl)} ${hhmm}`
}

export function DaftarClockin({ ds }: { ds: Ds[] }) {
  const hariIni = today()
  const [rentang, setRentang] = useState('7')
  const [dari, setDari] = useState(addDays(hariIni, -6))
  const [sampai, setSampai] = useState(hariIni)
  const [q, setQ] = useState('')
  const [fDs, setFDs] = useState('')
  const [fShift, setFShift] = useState('')
  const [fTepat, setFTepat] = useState('')

  const bebas = rentang === 'bebas'
  const [d1, d2] = bebas ? [dari, sampai] : [addDays(hariIni, 1 - Number(rentang)), hariIni]
  const salahRentang = bebas && (!d1 || !d2 || d1 > d2 || (new Date(d2).getTime() - new Date(d1).getTime()) / 864e5 >= MAKS_HARI)

  const p = useRows<Atur>(() => sb.from('pengaturan_kehadiran').select('mulai_pagi,mulai_tengah,mulai_siang,toleransi_menit,batas_pagi,batas_tengah').eq('id', 1), [])
  const data = useRows<Baris>(
    () => salahRentang
      ? Promise.resolve({ data: [], error: null })
      : ambilSemua<Baris>((a, b) => sb.from('kehadiran_bo').select('id,ds_id,hub,kode_mtr,tanggal,masuk_lokal,zona,keluar_wib', { count: 'exact' })
          .gte('tanggal', d1).lte('tanggal', d2).order('tanggal', { ascending: false }).order('masuk_lokal', { ascending: false }).order('id').range(a, b)),
    [d1, d2, salahRentang],
  )
  const rid = useRows<Rider>(() => ambilSemua<Rider>((a, b) => sb.from('riders').select('kode_mtr,nama', { count: 'exact' }).not('kode_mtr', 'is', null).order('id').range(a, b)), [])

  const atur = p.rows[0]
  const namaDs = useMemo(() => new Map(ds.map((d) => [d.id, d.nama])), [ds])
  const namaRider = useMemo(() => new Map(rid.rows.map((r) => [r.kode_mtr as string, r.nama])), [rid.rows])

  const semua = useMemo(() => {
    if (!atur) return []
    const mulai: Record<Shift, string> = { pagi: atur.mulai_pagi, tengah: atur.mulai_tengah, siang: atur.mulai_siang }
    const menit = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
    return data.rows.map((r) => {
      const m = jam(r.masuk_lokal)
      const shift: Shift = m <= atur.batas_pagi ? 'pagi' : m <= atur.batas_tengah ? 'tengah' : 'siang'
      return {
        ...r,
        ds_nama: (r.ds_id && namaDs.get(r.ds_id)) || r.hub,
        nama: namaRider.get(r.kode_mtr) ?? '',
        shift,
        tepat: menit(m) <= menit(mulai[shift]) + atur.toleransi_menit,
      }
    })
  }, [data.rows, atur, namaDs, namaRider])

  const kata = q.trim().toLowerCase()
  const baris = useMemo(() => semua.filter((r) =>
    (!fDs || r.ds_id === fDs) && (!fShift || r.shift === fShift) && (!fTepat || (fTepat === 'tepat') === r.tepat)
    && (!kata || r.nama.toLowerCase().includes(kata) || r.kode_mtr.toLowerCase().includes(kata))), [semua, fDs, fShift, fTepat, kata])
  const pg = usePage(baris, [d1, d2, q, fDs, fShift, fTepat])

  const dsOpsi = useMemo(() => {
    const ada = new Set(semua.map((r) => r.ds_id))
    return [{ value: '', label: 'Semua DS' }, ...ds.filter((d) => ada.has(d.id)).map((d) => ({ value: d.id, label: d.nama }))]
  }, [semua, ds])

  const unduh = () => download(`clockin-bo_${d1}_${d2}.csv`, toCsv(baris.map((r) => ({
    tanggal: r.tanggal, ds: r.ds_nama, nama: r.nama, kode_mitra: r.kode_mtr, clock_in: jam(r.masuk_lokal), clock_out: r.keluar_wib ? keluarLokal(r.keluar_wib, r.zona, r.tanggal) : '',
    zona: r.zona, shift: NAMA_SHIFT[r.shift], status: r.tepat ? 'Tepat waktu' : 'Telat',
  }))))

  return (
    <div className="card !mb-0">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <b className="flex-1">Daftar clock-in per rider</b>
        <button className="btn2 inline-flex items-center gap-2" disabled={!baris.length} onClick={unduh}><Download size={14} />Unduh CSV</button>
      </div>
      <Err msg={data.err || p.err || rid.err} />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div><span className="mb-1 block text-xs text-muted-foreground">Rentang</span><Select className="w-48" value={rentang} onChange={setRentang} opsi={RENTANG} /></div>
        {bebas && (
          <>
            <div><span className="mb-1 block text-xs text-muted-foreground">Dari</span><input type="date" className="inp !w-40" value={dari} max={hariIni} onChange={(e) => setDari(e.target.value)} /></div>
            <div><span className="mb-1 block text-xs text-muted-foreground">Sampai</span><input type="date" className="inp !w-40" value={sampai} max={hariIni} onChange={(e) => setSampai(e.target.value)} /></div>
          </>
        )}
        <div className="relative min-w-56 flex-1">
          <span className="mb-1 block text-xs text-muted-foreground">Cari</span>
          <Search size={14} className="pointer-events-none absolute bottom-3 left-2.5 text-muted-foreground" />
          <input className="inp w-full !pl-8" placeholder="Nama atau kode mitra" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div><span className="mb-1 block text-xs text-muted-foreground">DS</span><Select className="w-64" value={fDs} onChange={setFDs} opsi={dsOpsi} cari /></div>
        <div><span className="mb-1 block text-xs text-muted-foreground">Shift</span>
          <Select className="w-36" value={fShift} onChange={setFShift} opsi={[{ value: '', label: 'Semua shift' }, ...(['pagi', 'tengah', 'siang'] as Shift[]).map((s) => ({ value: s, label: NAMA_SHIFT[s] }))]} /></div>
        <div><span className="mb-1 block text-xs text-muted-foreground">Status</span>
          <Select className="w-40" value={fTepat} onChange={setFTepat} opsi={[{ value: '', label: 'Semua status' }, { value: 'tepat', label: 'Tepat waktu' }, { value: 'telat', label: 'Telat' }]} /></div>
      </div>
      {salahRentang && <p className="mb-3 text-sm text-danger">Rentang tanggal tidak valid. Tanggal awal tidak boleh setelah tanggal akhir, dan paling lama {MAKS_HARI} hari.</p>}
      {!baris.length ? (
        <Kosong teks={semua.length ? 'Tidak ada clock-in yang cocok dengan filter' : 'Belum ada clock-in BO di rentang ini'} hint={semua.length ? 'Ubah kata cari atau filter di atas.' : 'Pilih rentang lain, atau tarik data lewat Sinkron sekarang di atas.'} />
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            {baris.length.toLocaleString('id-ID')} clock-in · {tanggal(d1)} s/d {tanggal(d2)}{baris.length !== semua.length ? ` · disaring dari ${semua.length.toLocaleString('id-ID')}` : ''}
          </p>
          <div className="overflow-x-auto">
            <table className="tbl w-full text-sm">
              <thead><tr><th>Nama</th><th>DS</th><th>Tanggal</th><th>Clock-in</th><th>Clock-out</th><th>Shift</th><th>Status</th></tr></thead>
              <tbody>
                {pg.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.nama || <span className="text-muted-foreground">belum ada di Orca</span>}<span className="block text-xs text-muted-foreground">{r.kode_mtr}</span></td>
                    <td>{r.ds_nama}</td>
                    <td className="whitespace-nowrap">{tanggal(r.tanggal)}</td>
                    <td className="whitespace-nowrap">{jam(r.masuk_lokal)} <span className="text-xs text-muted-foreground">{r.zona}</span></td>
                    <td className="whitespace-nowrap">{r.keluar_wib ? keluarLokal(r.keluar_wib, r.zona, r.tanggal) : <span className="text-muted-foreground">–</span>}</td>
                    <td>{NAMA_SHIFT[r.shift]}</td>
                    <td className={r.tepat ? 'text-success' : 'text-danger'}>{r.tepat ? 'Tepat waktu' : 'Telat'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3"><Pagination {...pg} /></div>
          <p className="mt-2 text-xs text-muted-foreground">Shift dan status dibaca dari jam masuk memakai jam shift di bawah. Di Dashboard BO, rider terjadwal atau tukar shift bisa terbaca lain karena memakai jadwal dan laporan Captain.</p>
        </>
      )}
    </div>
  )
}
