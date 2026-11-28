// Menu Budget Trend: naik turunnya budget (permintaan rider per shift) dari waktu ke waktu, sebagai bahan presentasi.
// Angkanya dari fungsi database budget_trend_* (migrasi 0076): total harian, ringkasan per DS, dan catatan perubahan.
// Super-admin melihat semua DS, Arcon hanya DS yang dipegang (dibatasi database). Hanya baca.
import { useMemo, useState } from 'react'
import { MenuUnduh } from './menu-unduh'
import { Building2, Copy, Layers, TrendingDown, TrendingUp } from 'lucide-react'
import { sb, useRows, Err, Kosong, Select, Stat, usePage, Pagination, toCsv, download, toast, today, addDays, tanggal, useGayaAktif } from './lib'
import { Dumbbell, KolomBertumpuk } from './chart-formal'

type Harian = { tanggal: string; pagi: number; tengah: number; siang: number; jml_ds: number }
type PerDs = {
  ds_id: string; ds_nama: string; lahir: string | null
  awal_pagi: number | null; awal_tengah: number | null; awal_siang: number | null
  akhir_pagi: number; akhir_tengah: number; akhir_siang: number; jml_perubahan: number
}
type Ubah = { waktu: string; ds_id: string; ds_nama: string; shift: 'pagi' | 'tengah' | 'siang'; tanggal: string | null; lama: number; baru: number; oleh: string; jenis: 'bawaan' | 'harian' }

const MAKS_HARI = 400
const PERIODE = [
  { value: '14', label: '14 hari terakhir' },
  { value: '30', label: '30 hari terakhir' },
  { value: '60', label: '60 hari terakhir' },
  { value: '120', label: '120 hari terakhir' },
  { value: 'bebas', label: 'Pilih tanggal sendiri' },
]
const SHIFT: Record<string, string> = { pagi: 'Pagi', tengah: 'Middle', siang: 'Siang' }
const WARNA = { pagi: '#ffdd00', tengah: '#38e8d8', siang: 'var(--primary)' }

const jum = (a?: number | null, b?: number | null, c?: number | null) => (a ?? 0) + (b ?? 0) + (c ?? 0)
const tot = (h: Harian) => jum(h.pagi, h.tengah, h.siang)
const sel = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n)
const pct = (akhir: number, awal: number) => (awal > 0 ? `${sel(Math.round((1000 * (akhir - awal)) / awal) / 10).replace('.', ',')}%` : '–')
const wib = (iso: string) => new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const wibCsv = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' })
const tglWib = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600e3).toISOString().slice(0, 10)

// Batang bertumpuk per hari (Pagi, Middle, Siang). Titik hitam di atas batang = ada perubahan budget pada hari itu.
function Grafik({ data, ubahHari }: { data: Harian[]; ubahHari: Map<string, number> }) {
  const W = 760, H = 280, L = 44, R = 12, T = 18, B = 30
  const w = W - L - R, h = H - T - B, n = data.length
  const mx = Math.max(...data.map(tot), 1) * 1.12
  const y = (v: number) => T + h - (v / mx) * h
  const bw = (w / n) * 0.72
  const x = (i: number) => L + (w / n) * (i + 0.5)
  const langkah = Math.ceil(n / 8)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Tren budget harian">
        {[0, 1, 2, 3, 4].map((g) => {
          const yy = T + (h / 4) * g
          return (
            <g key={g}>
              <line x1={L} x2={W - R} y1={yy} y2={yy} stroke="var(--border)" strokeOpacity={0.6} />
              <text x={L - 6} y={yy + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">{Math.round(mx * (1 - g / 4))}</text>
            </g>
          )
        })}
        {data.map((d, i) => {
          const ps = d.pagi, tg = d.tengah, sg = d.siang
          const ban = ubahHari.get(d.tanggal) ?? 0
          return (
            <g key={d.tanggal}>
              <rect x={x(i) - bw / 2} y={y(ps)} width={bw} height={T + h - y(ps)} fill={WARNA.pagi} />
              <rect x={x(i) - bw / 2} y={y(ps + tg)} width={bw} height={y(ps) - y(ps + tg)} fill={WARNA.tengah} />
              <rect x={x(i) - bw / 2} y={y(ps + tg + sg)} width={bw} height={y(ps + tg) - y(ps + tg + sg)} fill={WARNA.siang} rx={bw > 5 ? 2 : 0}>
                <title>{`${tanggal(d.tanggal)}: total ${tot(d)} rider (pagi ${ps}, middle ${tg}, siang ${sg}) · ${d.jml_ds} DS berbudget${ban ? ` · ${ban} perubahan` : ''}`}</title>
              </rect>
              {ban > 0 && <circle cx={x(i)} cy={y(tot(d)) - 6} r={2.8} fill="var(--foreground)"><title>{`${ban} perubahan budget pada ${tanggal(d.tanggal)}`}</title></circle>}
              {(i % langkah === 0 || i === n - 1) && <text x={x(i)} y={H - 10} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">{tanggal(d.tanggal).replace(/ 20\d\d$/, '')}</text>}
            </g>
          )
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span><b style={{ color: WARNA.pagi }}>■</b> Pagi</span>
        <span><b style={{ color: WARNA.tengah }}>■</b> Middle</span>
        <span><b style={{ color: WARNA.siang }}>■</b> Siang</span>
        <span><b style={{ color: 'var(--foreground)' }}>●</b> ada perubahan budget</span>
      </div>
    </div>
  )
}

export function BudgetTrend() {
  const formal = useGayaAktif() === 'formal' // tampilan Formal: kolom bertumpuk dan dumbbell (data sama)
  const hariIni = today()
  const [per, setPer] = useState('60')
  const [dari, setDari] = useState(addDays(hariIni, -29))
  const [sampai, setSampai] = useState(hariIni)
  const bebas = per === 'bebas'
  const [d1, d2] = bebas ? [dari, sampai] : [addDays(hariIni, 1 - Number(per)), hariIni]
  const salah = bebas && (!d1 || !d2 || d1 > d2 || (new Date(d2).getTime() - new Date(d1).getTime()) / 864e5 >= MAKS_HARI)
  const kosong = Promise.resolve({ data: [], error: null })
  const har = useRows<Harian>(() => (salah ? kosong : sb.rpc('budget_trend_harian', { p_dari: d1, p_sampai: d2 })), [d1, d2, salah])
  const dsr = useRows<PerDs>(() => (salah ? kosong : sb.rpc('budget_trend_ds', { p_dari: d1, p_sampai: d2 })), [d1, d2, salah])
  const ubr = useRows<Ubah>(() => (salah ? kosong : sb.rpc('budget_trend_perubahan', { p_dari: d1, p_sampai: d2 })), [d1, d2, salah])

  const [q, setQ] = useState('')
  const [saring, setSaring] = useState('semua')
  const [urut, setUrut] = useState('naik')
  const [q2, setQ2] = useState('')

  const ubahHari = useMemo(() => {
    const m = new Map<string, number>()
    for (const u of ubr.rows) { const t = tglWib(u.waktu); m.set(t, (m.get(t) ?? 0) + 1) }
    return m
  }, [ubr.rows])

  const baris = useMemo(() => dsr.rows.map((d) => {
    const baru = d.awal_pagi === null
    const a = baru ? null : jum(d.awal_pagi, d.awal_tengah, d.awal_siang)
    const z = jum(d.akhir_pagi, d.akhir_tengah, d.akhir_siang)
    return { ...d, baru, a, z, sel: a === null ? z : z - a, dp: d.akhir_pagi - (d.awal_pagi ?? 0), dt: d.akhir_tengah - (d.awal_tengah ?? 0), ds: d.akhir_siang - (d.awal_siang ?? 0) }
  }), [dsr.rows])

  const r = useMemo(() => {
    const h = har.rows
    const awal = h.length ? tot(h[0]) : 0
    const akhir = h.length ? tot(h[h.length - 1]) : 0
    let baru = 0, naik = 0, turun = 0, tetap = 0, tamBaru = 0, tamLama = 0, kurang = 0
    for (const d of baris) {
      if (d.a === null) { baru++; tamBaru += d.z }
      else if (d.z > d.a) { naik++; tamLama += d.z - d.a }
      else if (d.z < d.a) { turun++; kurang += d.a - d.z }
      else tetap++
    }
    let loncat = { tgl: '', n: 0 }
    for (let i = 1; i < h.length; i++) { const n = tot(h[i]) - tot(h[i - 1]); if (Math.abs(n) > Math.abs(loncat.n)) loncat = { tgl: h[i].tanggal, n } }
    return { awal, akhir, baru, naik, turun, tetap, tamBaru, tamLama, kurang, loncat }
  }, [har.rows, baris])

  const awalTgl = har.rows[0]?.tanggal ?? d1
  const akhirTgl = har.rows[har.rows.length - 1]?.tanggal ?? d2
  const ringkasan = har.rows.length < 2 ? '' :
    `Budget rider total ${r.akhir >= r.awal ? 'naik' : 'turun'} dari ${r.awal} menjadi ${r.akhir} rider per hari (${sel(r.akhir - r.awal)}, ${pct(r.akhir, r.awal)}) pada ${tanggal(awalTgl)} sampai ${tanggal(akhirTgl)}. ` +
    `${r.baru} DS baru menambah ${r.tamBaru}; ${r.naik} DS menaikkan budget (+${r.tamLama}); ${r.turun} DS menurunkan (−${r.kurang}); ${r.tetap} DS tetap.` +
    (r.loncat.n ? ` Perubahan harian terbesar: ${tanggal(r.loncat.tgl)} (${sel(r.loncat.n)}).` : '')
  const salin = async () => {
    try { await navigator.clipboard.writeText(ringkasan); toast.ok('Ringkasan disalin') } catch { toast('Tidak bisa menyalin otomatis. Blok teksnya lalu salin manual.') }
  }

  const kata = q.trim().toLowerCase()
  const tabel = baris
    .filter((d) => (saring === 'semua' || (saring === 'baru' && d.baru) || (saring === 'naik' && !d.baru && d.sel > 0) || (saring === 'turun' && !d.baru && d.sel < 0) || (saring === 'tetap' && !d.baru && d.sel === 0)) && (!kata || d.ds_nama.toLowerCase().includes(kata)))
    .sort((x, y) => (urut === 'nama' ? x.ds_nama.localeCompare(y.ds_nama) : urut === 'turun' ? x.sel - y.sel : y.sel - x.sel) || x.ds_nama.localeCompare(y.ds_nama))
  const pgD = usePage(tabel, [d1, d2, q, saring, urut])
  const kata2 = q2.trim().toLowerCase()
  const catatan = ubr.rows.filter((u) => !kata2 || `${u.ds_nama} ${u.oleh} ${SHIFT[u.shift]}`.toLowerCase().includes(kata2))
  const pgU = usePage(catatan, [d1, d2, q2])

  const unduhTren = () => download(`budget-tren_${d1}_${d2}.csv`, toCsv(har.rows.map((h) => ({ tanggal: h.tanggal, pagi: h.pagi, middle: h.tengah, siang: h.siang, total: tot(h), ds_berbudget: h.jml_ds }))))
  const unduhDs = () => download(`budget-per-ds_${d1}_${d2}.csv`, toCsv(baris.map((d) => ({
    ds: d.ds_nama, status: d.baru ? 'DS baru' : d.sel > 0 ? 'Naik' : d.sel < 0 ? 'Turun' : 'Tetap', awal_total: d.a ?? '', akhir_total: d.z, selisih: d.sel,
    selisih_pagi: d.dp, selisih_middle: d.dt, selisih_siang: d.ds, jumlah_perubahan: d.jml_perubahan,
  }))))
  const unduhUbah = () => download(`budget-perubahan_${d1}_${d2}.csv`, toCsv(ubr.rows.map((u) => ({
    waktu_wib: wibCsv(u.waktu), ds: u.ds_nama, shift: SHIFT[u.shift], berlaku: u.tanggal ?? 'bawaan DS', lama: u.lama, baru: u.baru, selisih: u.baru - u.lama, oleh: u.oleh,
  }))))

  const chip = (v: string, label: string, n: number) => (
    <button key={v} className={`tab ${saring === v ? 'tab-on' : ''}`} onClick={() => setSaring(v)}>{label} <span className="opacity-70">{n}</span></button>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><span className="mb-1 block text-xs text-muted-foreground">Periode</span><Select className="w-52" value={per} onChange={setPer} opsi={PERIODE} /></div>
        {bebas && (
          <>
            <div><span className="mb-1 block text-xs text-muted-foreground">Dari</span><input type="date" className="inp !w-40" value={dari} max={hariIni} onChange={(e) => setDari(e.target.value)} /></div>
            <div><span className="mb-1 block text-xs text-muted-foreground">Sampai</span><input type="date" className="inp !w-40" value={sampai} max={hariIni} onChange={(e) => setSampai(e.target.value)} /></div>
          </>
        )}
        <div className="ml-auto">
          <MenuUnduh item={[
            { label: 'CSV tren', aksi: unduhTren, mati: !har.rows.length },
            { label: 'CSV per DS', aksi: unduhDs, mati: !baris.length },
            { label: 'CSV perubahan', aksi: unduhUbah, mati: !ubr.rows.length },
          ]} />
        </div>
      </div>
      {salah && <p className="text-sm text-danger">Rentang tanggal tidak valid (tanggal awal harus sebelum akhir, maksimal {MAKS_HARI} hari).</p>}
      <Err msg={har.err || dsr.err || ubr.err} />

      {!har.rows.length ? (
        <div className="card"><Kosong teks="Belum ada data budget di periode ini" hint="Pilih periode lain. Riwayat dipulihkan dari catatan perubahan sejak awal pencatatan." /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Stat icon={Layers} label={`Budget total ${tanggal(akhirTgl)} (rider/hari)`} value={r.akhir} />
            <Stat icon={r.akhir >= r.awal ? TrendingUp : TrendingDown} label={`${pct(r.akhir, r.awal)} sejak ${tanggal(awalTgl)} (dari ${r.awal})`} value={sel(r.akhir - r.awal)} tone={r.akhir < r.awal ? 'red' : 'brand'} />
            <Stat icon={Building2} label={`${r.baru} DS baru menambah`} value={`+${r.tamBaru}`} />
            <Stat icon={TrendingUp} label={`${r.naik} DS lama menaikkan`} value={`+${r.tamLama}`} />
            <Stat icon={TrendingDown} label={`${r.turun} DS lama menurunkan`} value={`−${r.kurang}`} tone={r.kurang ? 'red' : 'zinc'} />
          </div>

          {ringkasan && (
            <div className="card flex flex-wrap items-start gap-3">
              <p className="min-w-60 flex-1 text-sm">{ringkasan}</p>
              <button className="btn2 inline-flex items-center gap-2" onClick={salin}><Copy size={14} />Salin ringkasan</button>
            </div>
          )}

          <div className="card">
            <b className="mb-2 block">Budget total per hari</b>
            {formal
              ? <KolomBertumpuk data={har.rows} tandai={ubahHari} label="Budget total per hari: kolom bertumpuk pagi, middle, siang" />
              : <Grafik data={har.rows} ubahHari={ubahHari} />}
          </div>

          {formal && baris.some((d) => d.sel !== 0) && (
            <div className="card">
              <b className="mb-2 block">Perubahan terbesar per DS</b>
              <Dumbbell
                items={baris.filter((d) => d.sel !== 0).sort((a, b) => Math.abs(b.sel) - Math.abs(a.sel) || a.ds_nama.localeCompare(b.ds_nama)).slice(0, 8).map((d) => ({ nama: d.ds_nama, awal: d.a, akhir: d.z }))}
                label="Perubahan budget dari awal ke akhir periode untuk DS dengan perubahan terbesar"
              />
            </div>
          )}

          <div className="card">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <b className="mr-2">Perubahan per DS</b>
              {chip('semua', 'Semua', baris.length)}
              {chip('naik', 'Naik', r.naik)}
              {chip('turun', 'Turun', r.turun)}
              {chip('baru', 'DS baru', r.baru)}
              {chip('tetap', 'Tetap', r.tetap)}
              <div className="ml-auto flex flex-wrap gap-2">
                <Select className="w-48" value={urut} onChange={setUrut} opsi={[{ value: 'naik', label: 'Kenaikan terbesar' }, { value: 'turun', label: 'Penurunan terbesar' }, { value: 'nama', label: 'Nama DS' }]} />
                <input className="inp w-48" placeholder="Cari DS" aria-label="Cari DS" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>DS</th><th className="text-right">Awal</th><th className="text-right">Akhir</th><th className="text-right">Selisih</th><th className="text-right">Pagi</th><th className="text-right">Middle</th><th className="text-right">Siang</th><th className="text-right">Perubahan</th></tr></thead>
                <tbody>
                  {pgD.rows.map((d) => (
                    <tr key={d.ds_id}>
                      <td>{d.ds_nama}{d.baru && <span className="badge ml-2 bg-primary-soft text-primary">DS baru{d.lahir ? ` · ${tanggal(d.lahir)}` : ''}</span>}</td>
                      <td className="text-right">{d.a ?? '–'}</td>
                      <td className="text-right font-semibold">{d.z}</td>
                      <td className={`text-right font-semibold ${d.sel > 0 ? 'text-success' : d.sel < 0 ? 'text-danger' : 'text-muted-foreground'}`}>{d.sel === 0 ? '0' : sel(d.sel)}</td>
                      <td className="text-right text-muted-foreground">{d.dp ? sel(d.dp) : '–'}</td>
                      <td className="text-right text-muted-foreground">{d.dt ? sel(d.dt) : '–'}</td>
                      <td className="text-right text-muted-foreground">{d.ds ? sel(d.ds) : '–'}</td>
                      <td className="text-right">{d.jml_perubahan || '–'}</td>
                    </tr>
                  ))}
                  {!tabel.length && <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">Tidak ada DS yang cocok</td></tr>}
                </tbody>
              </table>
            </div>
            <Pagination {...pgD} />
          </div>

          <div className="card">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <b>Catatan perubahan</b>
              <span className="text-xs text-muted-foreground">nilai lama → baru, siapa, dan kapan</span>
              <input className="inp ml-auto w-56" placeholder="Cari DS, pelaku, atau shift" aria-label="Cari catatan perubahan" value={q2} onChange={(e) => setQ2(e.target.value)} />
            </div>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Waktu (WIB)</th><th>DS</th><th>Shift</th><th>Berlaku</th><th className="text-right">Perubahan</th><th>Oleh</th></tr></thead>
                <tbody>
                  {pgU.rows.map((u, i) => (
                    <tr key={`${u.waktu}-${u.ds_id}-${u.shift}-${u.tanggal}-${i}`}>
                      <td className="whitespace-nowrap">{wib(u.waktu)}</td>
                      <td>{u.ds_nama}</td>
                      <td>{SHIFT[u.shift]}</td>
                      <td className="text-muted-foreground">{u.tanggal ? tanggal(u.tanggal) : 'Bawaan DS'}</td>
                      <td className={`whitespace-nowrap text-right font-semibold ${u.baru > u.lama ? 'text-success' : 'text-danger'}`}>{u.lama} → {u.baru} ({sel(u.baru - u.lama)})</td>
                      <td>{u.oleh}</td>
                    </tr>
                  ))}
                  {!catatan.length && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Belum ada catatan perubahan di periode ini</td></tr>}
                </tbody>
              </table>
            </div>
            <Pagination {...pgU} />
            <p className="mt-2 text-xs text-muted-foreground">Perubahan budget per hari baru tercatat dengan nilai lama dan baru sejak fitur ini aktif; catatan lama hanya menyebut jumlah hari yang berbeda, jadi tidak tampil di sini.</p>
          </div>
        </>
      )}
    </div>
  )
}
