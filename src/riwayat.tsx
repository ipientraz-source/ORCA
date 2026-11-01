// Riwayat: semua aktivitas (tambah / ubah / hapus) lengkap dengan tanggal, jam, dan pelakunya.
// Super-admin melihat semua DS; Captain dan Arcon hanya DS yang dipegang (dibatasi di database lewat RLS).
import { useState } from 'react'
import { Search } from 'lucide-react'
import { addDays, Err, Kosong, Pagination, Select, sb, today, usePage, useRows, type Ds } from './lib'

type Baris = { id: string; waktu: string; aksi: string; detail: string | null; jenis: 'tambah' | 'ubah' | 'hapus' | null; ds_id: string | null; pelaku_nama: string | null; captain: { nama: string } | null }

const JENIS = [{ value: '', label: 'Semua jenis' }, { value: 'tambah', label: 'Tambah' }, { value: 'ubah', label: 'Ubah' }, { value: 'hapus', label: 'Hapus' }]
const GAYA = { tambah: 'bg-success-soft text-success', ubah: 'bg-primary-soft text-primary-soft-foreground', hapus: 'bg-danger-soft text-danger' }
const BATAS = 2000

const tglWib = (w: string) => new Date(w).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric' })
const jamWib = (w: string) => new Date(w).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false })

export function Riwayat() {
  const [dari, setDari] = useState(addDays(today(), -6))
  const [sampai, setSampai] = useState(today())
  const [fds, setFds] = useState('')
  const [fj, setFj] = useState('')
  const [q, setQ] = useState('')
  const dsl = useRows<Ds>(() => sb.from('ds').select('*').order('nama'), [])
  const log = useRows<Baris>(() => {
    let r = sb.from('log_aktivitas').select('id,waktu,aksi,detail,jenis,ds_id,pelaku_nama,captain:riders!log_aktivitas_captain_id_fkey(nama)')
      .gte('waktu', `${dari}T00:00:00+07:00`).lte('waktu', `${sampai}T23:59:59.999+07:00`)
    if (fds) r = r.eq('ds_id', fds)
    if (fj) r = r.eq('jenis', fj)
    return r.order('waktu', { ascending: false }).limit(BATAS)
  }, [dari, sampai, fds, fj])
  const dsNama = (id: string | null) => dsl.rows.find((d) => d.id === id)?.nama
  const tampil = log.rows.filter((x) => `${x.aksi} ${x.detail ?? ''} ${x.captain?.nama ?? x.pelaku_nama ?? 'Sistem'} ${dsNama(x.ds_id) ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  const pg = usePage(tampil, [dari, sampai, fds, fj, q])

  return (
    <div>
      <Err msg={log.err || dsl.err} />
      <div className="card !p-3 flex flex-wrap items-end gap-3">
        <div><label className="lbl">Dari</label><input type="date" className="inp" value={dari} max={sampai} onChange={(e) => e.target.value && setDari(e.target.value)} /></div>
        <div><label className="lbl">Sampai</label><input type="date" className="inp" value={sampai} min={dari} max={today()} onChange={(e) => e.target.value && setSampai(e.target.value)} /></div>
        {dsl.rows.length > 1 && (
          <div className="w-56"><label className="lbl">DS</label><Select value={fds} onChange={setFds} opsi={[{ value: '', label: 'Semua DS' }, ...dsl.rows.map((d) => ({ value: d.id, label: d.nama }))]} /></div>
        )}
        <div className="w-40"><label className="lbl">Jenis</label><Select value={fj} onChange={setFj} opsi={JENIS} /></div>
        <div className="relative ml-auto min-w-52 max-w-full flex-1 sm:max-w-xs">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="inp w-full !pl-9" placeholder="Cari pelaku, aksi, atau detail" aria-label="Cari riwayat" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-sm text-muted-foreground">
          <b className="text-foreground">{tampil.length.toLocaleString('id-ID')}</b> aktivitas
          {log.rows.length >= BATAS && <span className="badge bg-warning-soft text-warning">Menampilkan {BATAS.toLocaleString('id-ID')} terbaru, persempit tanggal untuk melihat yang lebih lama</span>}
          <span className="ml-auto text-xs">Waktu dalam WIB</span>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Waktu</th><th>Pelaku</th><th>Aktivitas</th><th>Detail</th><th>DS</th></tr></thead>
            <tbody>
              {pg.rows.map((x) => (
                <tr key={x.id} className="align-top">
                  <td className="whitespace-nowrap">
                    <div className="font-medium">{tglWib(x.waktu)}</div>
                    <div className="font-mono text-xs text-muted-foreground">{jamWib(x.waktu)}</div>
                  </td>
                  <td className="whitespace-nowrap">{x.captain?.nama ?? x.pelaku_nama ?? <span className="text-muted-foreground">Sistem</span>}</td>
                  <td className="whitespace-nowrap">
                    {x.jenis ? <span className={`badge ${GAYA[x.jenis]}`}>{x.aksi}</span> : <span className="badge bg-muted text-foreground/80">{x.aksi}</span>}
                  </td>
                  <td className="min-w-64">{x.detail ?? '–'}</td>
                  <td className="whitespace-nowrap text-muted-foreground">{dsNama(x.ds_id) ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!tampil.length && <Kosong teks={log.rows.length ? 'Tidak ada aktivitas yang cocok.' : 'Belum ada aktivitas pada rentang tanggal ini.'} />}
        <div className="p-4"><Pagination {...pg} /></div>
      </div>
    </div>
  )
}
