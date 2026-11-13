import { useState } from 'react'
import { sb, today, monday, addDays, hari, tanggal, useRows, ok, toast, konfirmasi, Err, Kosong, Stat, Select, usePage, Pagination, toCsv, download, type Ds, type Me } from './lib'
import { WARNA } from './daily'
import { Fulfillment } from './fulfillment-ui'
import { CalendarDays, ClipboardX, Download, TrendingUp, UserX } from 'lucide-react'

type DsRow = {
  ds_id: string; ds_nama: string; dijadwalkan: number; terisi: number; patuh: number; alpha: number; tukar: number
  pengganti: number; belum_diisi: number; hari_belum_isi: number; terakhir_input: string | null
  pagi_belum_isi: number; siang_belum_isi: number // hari yang shift pagi / siangnya belum diisi sama sekali
}
type RiderRow = {
  rider_id: string; kode_mtr: string | null; nama: string; ds_nama: string | null; dijadwalkan: number; hadir: number
  alpha: number; izin: number; sakit: number; tukar: number; pengganti: number; belum_diisi: number; potongan: number; insentif: number
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const lastOfMonth = (d: string) => {
  const t = new Date(d + 'T00:00:00Z')
  t.setUTCMonth(t.getUTCMonth() + 1, 0)
  return t.toISOString().slice(0, 10)
}
// kepatuhan = hadir sesuai jadwal / jadwal yang sudah diisi Captain
const pct = (d: DsRow) => (d.terisi > 0 ? Math.round((100 * d.patuh) / d.terisi) + '%' : '–')
// "pagi 2, siang 1": shift mana yang belum dilaporkan (kosong bila lengkap)
// Sebelum migrasi 0014 dijalankan, kolom per shift belum ada: pakai hitungan per hari yang lama supaya DS yang lalai tetap terlihat
const lama = (d: DsRow) => d.pagi_belum_isi === undefined
const jmlBelum = (d: DsRow) => (lama(d) ? d.hari_belum_isi : d.pagi_belum_isi + d.siang_belum_isi)
const shiftBelum = (d: DsRow) => lama(d) ? (d.hari_belum_isi ? `${d.hari_belum_isi} hari` : '') : [d.pagi_belum_isi && `pagi ${d.pagi_belum_isi} hari`, d.siang_belum_isi && `siang ${d.siang_belum_isi} hari`].filter(Boolean).join(', ')
const jam = (s: string | null) => (s ? new Date(s).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' }) : 'belum pernah')

function useRange() {
  const [mode, setMode] = useState<'harian' | 'mingguan' | 'bulanan' | 'rentang'>('mingguan')
  const [ref, setRef] = useState(today())
  const [akhir, setAkhir] = useState(today()) // ujung rentang sendiri
  const [from, to] =
    mode === 'harian' ? [ref, ref]
    : mode === 'mingguan' ? [monday(ref), addDays(monday(ref), 6)]
    : mode === 'bulanan' ? [ref.slice(0, 8) + '01', lastOfMonth(ref)]
    : ref <= akhir ? [ref, akhir] : [akhir, ref] // rentang bebas: urutannya dibetulkan otomatis
  const ui = (
    <div className="flex flex-wrap gap-2 items-center mb-3">
      <Select className="w-52" value={mode} onChange={(v) => setMode(v as typeof mode)} opsi={[{ value: 'harian', label: 'Harian' }, { value: 'mingguan', label: 'Mingguan (Senin–Minggu)' }, { value: 'bulanan', label: 'Bulanan' }, { value: 'rentang', label: 'Rentang sendiri' }]} />
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {mode === 'rentang' ? 'Dari' : 'Tanggal acuan'} <input type="date" className="inp" value={ref} onChange={(e) => e.target.value && setRef(e.target.value)} />
      </label>
      {mode === 'rentang' && (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Sampai <input type="date" className="inp" value={akhir} onChange={(e) => e.target.value && setAkhir(e.target.value)} />
        </label>
      )}
      <span className="text-sm text-muted-foreground">
        {tanggal(from)} s/d {tanggal(to)}
      </span>
    </div>
  )
  return { from, to, ui }
}

function DsTable({ rows }: { rows: DsRow[] }) {
  const pg = usePage(rows)
  return (
    <>
      <DsTabelIsi rows={pg.rows} />
      <Pagination {...pg} />
    </>
  )
}

function DsTabelIsi({ rows }: { rows: DsRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>DS</th><th>Terjadwal</th><th>Sesuai jadwal</th><th>Alpha</th><th>Tukar</th><th>Pengganti</th>
            <th>Belum diisi</th><th>Shift belum diisi</th><th>Terakhir mengisi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.ds_id}>
              <td>{d.ds_nama}</td><td>{d.dijadwalkan}</td><td className="font-medium">{pct(d)}</td><td>{d.alpha}</td><td>{d.tukar}</td>
              <td>{d.pengganti}</td><td>{d.belum_diisi}</td>
              <td className={shiftBelum(d) ? 'text-danger font-medium' : ''}>{shiftBelum(d) || '–'}</td>
              <td className="text-xs">{jam(d.terakhir_input)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Top({ title, rows, k }: { title: string; rows: RiderRow[]; k: 'alpha' | 'pengganti' }) {
  const t = [...rows].filter((r) => r[k] > 0).sort((a, b) => b[k] - a[k]).slice(0, 10)
  const gaya = k === 'alpha' ? 'bg-danger-soft text-danger' : 'bg-primary-soft text-primary-soft-foreground'
  return (
    <div className="card min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <b>{title}</b>
        {t.length > 0 && <span className="text-xs text-muted-foreground">{t.length} rider</span>}
      </div>
      <ol className="divide-y divide-border/60 text-sm">
        {t.map((r, i) => (
          <li key={r.rider_id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
            <span className="w-5 shrink-0 text-center font-mono text-xs text-muted-foreground">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{r.nama}</div>
              <div className="truncate text-xs text-muted-foreground">{r.ds_nama ?? '-'}</div>
            </div>
            <span className={`badge shrink-0 ${gaya}`}>{r[k]}×</span>
          </li>
        ))}
        {!t.length && <li className="py-2 text-muted-foreground">Tidak ada.</li>}
      </ol>
    </div>
  )
}

// Super-admin: ringkasan + jejak
export function Dashboard() {
  const { from, to, ui } = useRange()
  const [semuaPindah, setSemuaPindah] = useState(false)
  const [semuaLog, setSemuaLog] = useState(false)
  const d = useRows<DsRow>(() => sb.rpc('laporan_ds', { p_dari: from, p_sampai: to }), [from, to])
  const r = useRows<RiderRow>(() => sb.rpc('laporan_rider', { p_dari: from, p_sampai: to }), [from, to])
  const pindah = useRows<Any>(
    () =>
      sb.from('perpindahan_rider')
        .select('waktu,rider:riders!perpindahan_rider_rider_id_fkey(nama),dari:ds!perpindahan_rider_dari_ds_fkey(nama),ke:ds!perpindahan_rider_ke_ds_fkey(nama),oleh:riders!perpindahan_rider_ditarik_oleh_fkey(nama)')
        .order('waktu', { ascending: false }).limit(10),
    [],
  )
  const log = useRows<Any>(
    () => sb.from('log_aktivitas').select('waktu,aksi,detail,pelaku_nama,captain:riders!log_aktivitas_captain_id_fkey(nama)').order('waktu', { ascending: false }).limit(10),
    [],
  )
  const kosong = d.rows.filter((x) => jmlBelum(x) > 0)
  const sum = (k: 'dijadwalkan' | 'terisi' | 'patuh' | 'alpha') => d.rows.reduce((a, x) => a + x[k], 0)
  const kepatuhan = sum('terisi') > 0 ? Math.round((100 * sum('patuh')) / sum('terisi')) + '%' : '–'
  return (
    <div>
      {ui}
      <Err msg={d.err || r.err} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat icon={TrendingUp} label="Hadir sesuai jadwal" value={kepatuhan} />
        <Stat icon={CalendarDays} label="Shift terjadwal" value={sum('dijadwalkan')} tone="zinc" />
        <Stat icon={UserX} label="Alpha (tidak hadir tanpa kabar)" value={sum('alpha')} tone={sum('alpha') ? 'red' : 'zinc'} />
        <Stat icon={ClipboardX} label="DS belum isi absensi" value={kosong.length} tone={kosong.length ? 'red' : 'zinc'} />
      </div>
      <Fulfillment from={from} to={to} />
      <div className="grid items-start md:grid-cols-2 gap-4 mb-4">
        <div className="card !mb-0">
          <b className="block mb-3">Hadir sesuai jadwal per DS</b>
          {d.rows.length === 0 && <Kosong teks="Belum ada DS" hint="Buat DS di tab Kelola DS & Captain." />}
          {d.rows.map((x) => {
            const p = x.terisi ? Math.round((100 * x.patuh) / x.terisi) : 0
            return (
              <div key={x.ds_id} className="mb-3 last:mb-0">
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{x.ds_nama}</span>
                  <span className="font-mono">{pct(x)}</span>
                </div>
                <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full ${p >= 90 ? 'bg-primary' : p >= 70 ? 'bg-primary/60' : 'bg-danger'}`} style={{ width: `${p}%` }} />
                </div>
              </div>
            )
          })}
        </div>
        <div className="card !mb-0">
          <b className="block mb-3">Rincian kehadiran</b>
          {(() => {
            const seg = (['hadir', 'alpha', 'izin', 'sakit', 'tukar', 'pengganti'] as const).map((k) => ({ k, n: r.rows.reduce((a, x) => a + x[k], 0) }))
            const warna: Record<string, string> = { hadir: 'bg-foreground', alpha: 'bg-danger', izin: 'bg-muted-foreground/60', sakit: 'bg-muted-foreground/40', tukar: 'bg-primary/40', pengganti: 'bg-primary' }
            const total = seg.reduce((a, s) => a + s.n, 0)
            if (!total) return <Kosong teks="Belum ada data kehadiran di periode ini" hint="Data muncul setelah Captain mengisi absensi harian." />
            return (
              <>
                <div className="flex h-4 rounded-full overflow-hidden mb-4">
                  {seg.filter((s) => s.n).map((s) => <div key={s.k} className={warna[s.k]} style={{ width: `${(100 * s.n) / total}%` }} title={`${s.k}: ${s.n}`} />)}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  {seg.map((s) => (
                    <div key={s.k} className="flex items-center gap-2">
                      <span className={`size-2.5 rounded-full ${warna[s.k]}`} />
                      <span className="capitalize text-muted-foreground">{s.k}</span>
                      <span className="font-mono font-semibold ml-auto">{s.n}</span>
                    </div>
                  ))}
                </div>
              </>
            )
          })()}
        </div>
      </div>
      {kosong.length > 0 && (
        <div className="bg-danger-soft border border-danger/30 rounded p-3 mb-4 text-sm">
          <b>DS yang belum mengisi absensi:</b>
          <ul className="list-disc ml-5">
            {kosong.map((x) => (
              <li key={x.ds_id}>
                {x.ds_nama}: shift belum diisi, {shiftBelum(x)} (terakhir mengisi: {jam(x.terakhir_input)})
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="card">
        <div className="flex justify-between mb-2">
          <b>Ringkasan per DS</b>
          <button className="btn2" onClick={() => download(`ringkasan-ds_${from}_${to}.csv`, toCsv(d.rows.map((x) => ({ ...x, kepatuhan: pct(x) }))))}>
            Unduh CSV
          </button>
        </div>
        <DsTable rows={d.rows} />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Top title="Sering tidak hadir (Alpha)" rows={r.rows} k="alpha" />
        <Top title="Sering jadi pengganti" rows={r.rows} k="pengganti" />
      </div>
      <div className="grid items-start md:grid-cols-2 gap-4">
        <div className="card min-w-0">
          <b className="mb-2 block">Perpindahan rider terbaru</b>
          <ul className="divide-y divide-border/60 text-sm">
            {pindah.rows.slice(0, semuaPindah ? 10 : 4).map((p: Any, i: number) => (
              <li key={i} className="py-2 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-medium">{p.rider?.nama}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{jam(p.waktu)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {p.dari?.nama ?? 'belum punya DS'} → <span className="font-semibold text-foreground">{p.ke?.nama ?? 'belum punya DS'}</span> · oleh {p.oleh?.nama ?? '-'}
                </div>
              </li>
            ))}
            {!pindah.rows.length && <li className="py-2 text-muted-foreground">Belum ada perpindahan.</li>}
          </ul>
          {pindah.rows.length > 4 && <button type="button" className="btn2 mt-3 w-full" onClick={() => setSemuaPindah(!semuaPindah)}>{semuaPindah ? 'Tampilkan lebih sedikit' : `Lihat semua (${pindah.rows.length})`}</button>}
        </div>
        <div className="card min-w-0">
          <b className="mb-2 block">Aktivitas Captain</b>
          <ul className="divide-y divide-border/60 text-sm">
            {log.rows.slice(0, semuaLog ? 10 : 5).map((l: Any, i: number) => (
              <li key={i} className="py-2 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{l.captain?.nama ?? l.pelaku_nama}</span> <span className="badge ml-1 bg-muted text-foreground/80">{l.aksi}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{jam(l.waktu)}</span>
                </div>
                {l.detail && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{l.detail}</div>}
              </li>
            ))}
            {!log.rows.length && <li className="py-2 text-muted-foreground">Belum ada aktivitas.</li>}
          </ul>
          {log.rows.length > 5 && <button type="button" className="btn2 mt-3 w-full" onClick={() => setSemuaLog(!semuaLog)}>{semuaLog ? 'Tampilkan lebih sedikit' : `Lihat semua (${log.rows.length})`}</button>}
        </div>
      </div>
    </div>
  )
}

// Super-admin: Laporan Actual · Captain: Rekap Kehadiran (RLS otomatis membatasi Captain ke DS-nya)
export function Rekap({ me, ds, dsList = [] }: { me: Me; ds: Ds | null; dsList?: Ds[] }) {
  const luas = me.peran !== 'captain' // Super-admin (semua DS) dan Arcon (beberapa DS) memilih DS lewat filter
  const { from, to, ui } = useRange()
  const [dsf, setDsf] = useState('')
  const [q, setQ] = useState('')
  const dsl = useRows<Ds>(() => sb.from('ds').select('*').order('nama'), [])
  const dsId = luas ? dsf : ds?.id ?? ''
  const dsNama = dsl.rows.find((x) => x.id === dsId)?.nama
  const d = useRows<DsRow>(() => sb.rpc('laporan_ds', { p_dari: from, p_sampai: to }), [from, to])
  const r = useRows<RiderRow>(() => sb.rpc('laporan_rider', { p_dari: from, p_sampai: to }), [from, to])
  const det = useRows<Any>(() => {
    const base = sb.from('actual_harian')
      .select('tanggal,status,penjelasan,potongan,insentif,jam_input,tanpa_pengganti,rider:riders!actual_harian_rider_id_fkey(nama,kode_mtr),backup:riders!actual_harian_backup_untuk_id_fkey(nama),oleh:riders!actual_harian_diinput_oleh_fkey(nama),ds(nama)')
      .gte('tanggal', from).lte('tanggal', to).order('tanggal', { ascending: false }).limit(1000)
    return dsId ? base.eq('ds_id', dsId) : base
  }, [from, to, dsId])

  const dsRows = d.rows.filter((x) => !dsId || x.ds_id === dsId)
  const rRows = r.rows.filter((x) => (!dsNama || x.ds_nama === dsNama) && (x.nama + (x.kode_mtr ?? '')).toLowerCase().includes(q.toLowerCase()))
  const flat = det.rows.map((x: Any) => ({
    tanggal: x.tanggal, ds: x.ds?.nama, kode_mtr: x.rider?.kode_mtr, rider: x.rider?.nama, status: x.status,
    pengganti_untuk_atau_backup: x.backup?.nama ?? '', tanpa_pengganti: x.tanpa_pengganti ? 'ya' : '', potongan: x.potongan === true ? 'ya' : x.potongan === false ? 'tidak' : '', insentif: x.insentif ?? 0, penjelasan: x.penjelasan ?? '', diinput_oleh: x.oleh?.nama ?? '', jam_input: x.jam_input,
  }))

  const pgR = usePage(rRows, [q, dsId, from, to])
  const pgD = usePage(det.rows, [from, to, dsId])

  return (
    <div>
      {ui}
      <div className="flex flex-wrap gap-2 mb-3">
        {luas && (
          <Select className="w-56" value={dsf} onChange={setDsf} opsi={[{ value: '', label: 'Semua DS' }, ...(me.peran === 'super_admin' ? dsl.rows : dsList).map((x) => ({ value: x.id, label: x.nama }))]} />
        )}
        <input className="inp" placeholder="cari rider / Kode MTR" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn2 ml-auto" onClick={() => download(`rekap-rider_${from}_${to}.csv`, toCsv(rRows as unknown as Record<string, unknown>[]))}><Download size={14} className="inline mr-1.5 -mt-0.5" />Unduh rekap rider</button>
        <button className="btn2" onClick={() => download(`actual-detail_${from}_${to}.csv`, toCsv(flat))}><Download size={14} className="inline mr-1.5 -mt-0.5" />Unduh detail absensi</button>
      </div>
      <Err msg={d.err || r.err || det.err} />
      <Fulfillment from={from} to={to} dsId={dsId || undefined} />
      <div className="card"><b className="mb-2 block">Ringkasan per DS</b><DsTable rows={dsRows} /></div>
      <div className="card">
        <b>Rekap per rider</b>
        <div className="overflow-x-auto"><table className="tbl mt-2 [&_th]:whitespace-normal [&_th]:leading-tight">
          <thead>
            <tr><th>Rider</th><th>DS</th><th>Terjadwal</th><th>Hadir</th><th>Alpha</th><th>Izin</th><th>Sakit</th><th>Tukar</th><th>Pengganti</th><th>Belum diisi</th><th>Kena potongan</th><th>Insentif</th></tr>
          </thead>
          <tbody>
            {pgR.rows.map((x) => (
              <tr key={x.rider_id}>
                <td>{x.nama} <span className="text-muted-foreground/70">{x.kode_mtr}</span></td><td className="whitespace-nowrap">{x.ds_nama}</td><td>{x.dijadwalkan}</td><td>{x.hadir}</td>
                <td className={x.alpha ? 'text-danger font-medium' : ''}>{x.alpha}</td><td>{x.izin}</td><td>{x.sakit}</td><td>{x.tukar}</td><td>{x.pengganti}</td><td>{x.belum_diisi}</td>
                <td className={x.potongan ? 'text-danger font-medium' : ''}>{x.potongan}</td><td className={x.insentif ? 'text-success font-medium' : ''}>{x.insentif ? `Rp ${Number(x.insentif).toLocaleString('id-ID')}` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <Pagination {...pgR} />
      </div>
      <div className="card">
        <b>Detail absensi ({flat.length}{flat.length === 1000 ? '+' : ''} baris)</b>
        <div className="overflow-x-auto"><table className="tbl mt-2">
          <thead>
            <tr><th>Tanggal</th><th>DS</th><th>Rider</th><th>Status</th><th>Terkait</th><th>Potongan</th><th>Insentif</th><th>Penjelasan</th><th>Diinput</th></tr>
          </thead>
          <tbody>
            {pgD.rows.map((x: Any, i: number) => (
              <tr key={i}>
                <td className="whitespace-nowrap">{x.tanggal}</td><td className="whitespace-nowrap">{x.ds?.nama}</td><td>{x.rider?.nama}</td><td><span className={`badge ${WARNA[x.status]}`}>{x.status}</span></td><td>{x.backup?.nama ?? (x.tanpa_pengganti ? <span className="badge bg-warning-soft text-warning">Tanpa pengganti</span> : null)}</td><td>{x.potongan === true ? 'Ya' : x.potongan === false ? 'Tidak' : '–'}</td><td>{x.insentif ? `Rp ${Number(x.insentif).toLocaleString('id-ID')}` : '–'}</td><td>{x.penjelasan}</td>
                <td className="text-xs">{x.oleh?.nama} · {jam(x.jam_input)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <Pagination {...pgD} />
      </div>
      {dsId ? <Kunci dsId={dsId} bisaBuka={me.peran === 'super_admin'} /> : luas && <div className="card text-sm text-muted-foreground">Pilih satu DS di atas untuk mengunci absensi mingguannya.</div>}
    </div>
  )
}

// Kunci actual per minggu (Senin–Minggu) — setelah dikunci tidak bisa diubah
function Kunci({ dsId, bisaBuka }: { dsId: string; bisaBuka: boolean }) {
  const kunci = useRows<{ minggu_mulai: string }>(() => sb.from('periode_kunci').select('minggu_mulai').eq('ds_id', dsId), [dsId])
  const weeks = Array.from({ length: 6 }, (_, i) => addDays(monday(today()), -7 * (i + 1)))
  return (
    <div className="card">
      <b>Kunci absensi mingguan</b>
      <p className="text-xs text-muted-foreground mt-0.5">
        Setelah dikunci, absensi minggu itu tidak bisa diubah supaya hitungan gaji tidak berubah.
        {bisaBuka ? ' Sebagai Super-admin, Anda bisa membuka kunci kalau perlu koreksi (tercatat di log aktivitas).' : ' Hanya Super-admin yang bisa membuka kunci.'}
      </p>
      <ul className="mt-2 text-sm space-y-1">
        {weeks.map((w) => {
          const locked = kunci.rows.some((k) => k.minggu_mulai === w)
          return (
            <li key={w} className="flex items-center gap-2">
              <span>{hari(w)} – {hari(addDays(w, 6))}</span>
              {locked ? (
                <>
                  <span className="text-success">🔒 terkunci</span>
                  {bisaBuka && (
                    <button
                      className="btn2 !px-2.5 !py-1 text-xs"
                      onClick={async () => {
                        if ((await konfirmasi('Absensi bisa diubah lagi dan hitungan gaji bisa ikut berubah. Pembukaan ini tercatat di log.', { judul: 'Buka kunci minggu ini?', ya: 'Buka kunci', bahaya: true })) && (await ok(sb.rpc('buka_kunci', { p_ds: dsId, p_minggu: w })))) {
                          toast.ok('Kunci dibuka. Jangan lupa kunci lagi setelah koreksi.')
                          kunci.reload()
                        }
                      }}
                    >
                      Buka kunci
                    </button>
                  )}
                </>
              ) : (
                <button
                  className="btn2"
                  onClick={async () => {
                    if ((await konfirmasi('Setelah dikunci, absensi tidak bisa diubah lagi.', { judul: 'Kunci absensi minggu ini?', ya: 'Kunci', bahaya: true })) && (await ok(sb.rpc('kunci_periode', { p_ds: dsId, p_minggu: w })))) kunci.reload()
                  }}
                >
                  Kunci
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
