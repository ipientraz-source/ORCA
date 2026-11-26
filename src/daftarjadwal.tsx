// Schedule Archive: jadwal tersimpan semua DS, satu baris per DS per minggu. Hanya Super-admin dan Arcon
// (Arcon otomatis hanya melihat DS yang dipegang: dibatasi di database). Captain memakai tab Shift Planner.
import { useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { sb, useRows, today, addDays, monday, ok, toast, konfirmasi, Err, Kosong, Select, usePage, Pagination, type Ds } from './lib'
import { JadwalGrid } from './jadwal'

type Baris = { ds_id: string; ds_nama: string; minggu: string; rider: number; shift: number; libur_kunci: number }

const RENTANG = [
  { value: '28', label: '4 minggu terakhir dan ke depan' },
  { value: '91', label: '3 bulan terakhir dan ke depan' },
  { value: '182', label: '6 bulan terakhir dan ke depan' },
  { value: '0', label: 'Minggu ini dan ke depan' },
]
const tgl = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export function DaftarJadwal({ bolehHapus = false }: { bolehHapus?: boolean }) {
  const [rentang, setRentang] = useState('28')
  const [dsId, setDsId] = useState('semua')
  const [sel, setSel] = useState<{ ds: Ds; senin: string } | null>(null)
  const dari = addDays(monday(today()), -Number(rentang))
  const sampai = addDays(today(), 63)
  const r = useRows<Baris>(() => sb.rpc('ringkasan_jadwal', { p_dari: dari, p_sampai: sampai }), [dari, sampai])
  const dsl = useRows<Ds>(() => sb.from('ds').select('*').order('nama'), [])

  const daftarDs = [...new Map(r.rows.map((x) => [x.ds_id, x.ds_nama])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const tampil = r.rows.filter((x) => dsId === 'semua' || x.ds_id === dsId)
  const pg = usePage(tampil, [rentang, dsId])
  const sekarang = monday(today())

  // Super-admin: hapus jadwal tersimpan satu DS satu minggu (mis. ada rider baru padahal Captain sudah menyimpan); Captain bisa menyusun ulang
  const hapus = async (x: Baris) => {
    const periode = `${tgl(x.minggu)} – ${tgl(addDays(x.minggu, 6))} ${x.minggu.slice(0, 4)}`
    if (!(await konfirmasi(`Jadwal ${x.ds_nama} untuk minggu ${periode} (${x.shift} shift, ${x.rider} rider) akan dihapus. Captain atau Super-admin bisa menyusunnya lagi. Budget harian tidak ikut terhapus. Tindakan ini tidak bisa dibatalkan.`, { judul: 'Hapus jadwal minggu ini?', ya: 'Hapus jadwal', bahaya: true }))) return
    if (await ok(sb.rpc('hapus_jadwal', { p_ds: x.ds_id, p_minggu: x.minggu }))) {
      toast.ok(`Jadwal ${x.ds_nama} minggu ${periode} dihapus.`)
      if (sel?.ds.id === x.ds_id && sel.senin === x.minggu) setSel(null)
      r.reload()
    }
  }

  return (
    <div>
      <Err msg={r.err || dsl.err} />
      {sel && (
        <div className="card">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-base font-bold">{sel.ds.nama}</div>
              <div className="text-xs text-muted-foreground">Minggu {tgl(sel.senin)} – {tgl(addDays(sel.senin, 6))}. Tampilan lihat saja; jadwal diubah oleh Captain DS ini atau Super-admin.</div>
            </div>
            <button className="btn2" onClick={() => setSel(null)}><X size={14} />Tutup</button>
          </div>
          <JadwalGrid key={sel.ds.id + sel.senin} ds={sel.ds} editable={false} awalDari={sel.senin} />
        </div>
      )}

      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <Select className="w-64" value={dsId} onChange={setDsId} opsi={[{ value: 'semua', label: 'Semua DS' }, ...daftarDs.map(([v, label]) => ({ value: v, label }))]} cari />
          <Select className="w-64" value={rentang} onChange={setRentang} opsi={RENTANG} />
          <span className="ml-auto text-sm text-muted-foreground">{tampil.length} jadwal mingguan</span>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>DS</th><th>Minggu</th><th>Rider terjadwal</th><th>Total shift</th><th>Off terkunci</th><th>Keterangan</th><th /></tr></thead>
            <tbody>
              {pg.rows.map((x) => {
                const ds = dsl.rows.find((d) => d.id === x.ds_id)
                const dipilih = sel?.ds.id === x.ds_id && sel.senin === x.minggu
                return (
                  <tr key={x.ds_id + x.minggu} className={dipilih ? 'bg-primary-soft/60' : ''}>
                    <td className="font-medium">{x.ds_nama}</td>
                    <td>{tgl(x.minggu)} – {tgl(addDays(x.minggu, 6))} {x.minggu.slice(0, 4)}</td>
                    <td className="font-mono">{x.rider}</td>
                    <td className="font-mono">{x.shift}</td>
                    <td className="font-mono text-muted-foreground">{x.libur_kunci}</td>
                    <td><span className={`badge ${x.minggu === sekarang ? 'bg-primary-soft text-primary-soft-foreground' : x.minggu > sekarang ? 'bg-warning-soft text-warning' : 'bg-muted text-muted-foreground'}`}>{x.minggu === sekarang ? 'Minggu ini' : x.minggu > sekarang ? 'Akan datang' : 'Sudah lewat'}</span></td>
                    <td className="whitespace-nowrap text-right">
                      <button className="btn2" disabled={!ds} onClick={() => ds && setSel({ ds, senin: x.minggu })}>{dipilih ? 'Sedang dibuka' : 'Lihat jadwal'}</button>
                      {bolehHapus && (
                        <button className="btn2 ml-2 !px-2.5 text-danger" onClick={() => hapus(x)} title="Hapus jadwal minggu ini" aria-label={`Hapus jadwal ${x.ds_nama} minggu ${tgl(x.minggu)}`}><Trash2 size={15} /></button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!tampil.length && <Kosong teks="Belum ada jadwal tersimpan di rentang ini." hint="Jadwal muncul di sini setelah Captain atau Super-admin menyimpannya." />}
        <div className="p-4"><Pagination {...pg} /></div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Super-admin melihat semua DS, Arcon DS yang dipegang, Captain DS sendiri. Hanya Super-admin yang bisa menghapus jadwal seminggu (ikon sampah), selama absensinya belum diisi atau dikunci.</p>
    </div>
  )
}
