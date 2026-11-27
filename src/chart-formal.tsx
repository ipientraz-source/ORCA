// Chart bergaya Linear untuk tema Formal: garis tipis, satu hue ungu (currentColor, kelas text-primary), tanpa bayangan dan gradasi.
// Semua warna dari token tema, jadi ikut terang/gelap. Komponen hanya menerima angka dan tanggal; tidak membaca data sendiri.
import { useEffect, useRef, useState, type ReactNode } from 'react'

const GARIS = 'var(--border)'
const REDUP = 'var(--muted-foreground)'
const INK = 'var(--foreground)'
const PERMUKAAN = 'var(--card)'

// Lebar kartu diukur supaya grafik digambar 1:1 (huruf, garis, dan kotak tidak ikut membesar di layar lebar)
function useLebar() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(640)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ukur = () => setW(Math.max(300, Math.floor(el.clientWidth)))
    ukur()
    const ro = new ResizeObserver(ukur)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}
function Ukur({ children }: { children: (w: number) => ReactNode }) {
  const [ref, w] = useLebar()
  return <div ref={ref} className="w-full">{children(w)}</div>
}

export type TitikTanggal = { tanggal: string; nilai: number | null } // nilai dalam persen 0..100, null = belum ada data
const tgl = (s: string) => `${+s.slice(8)}/${+s.slice(5, 7)}`

// ── Area tipis + garis target + titik akhir disorot ──
function AreaTargetSvg({ data, target = 95, label, W }: { data: TitikTanggal[]; target?: number; label: string; W: number }) {
  const ada = data.filter((d) => d.nilai !== null) as { tanggal: string; nilai: number }[]
  if (!ada.length) return null
  const H = 190, l = 34, r = 78, t = 14, b = 26
  const min = Math.max(0, Math.floor((Math.min(...ada.map((d) => d.nilai), target) - 5) / 10) * 10)
  const x = (i: number) => l + (data.length === 1 ? (W - l - r) / 2 : (i * (W - l - r)) / (data.length - 1))
  const y = (v: number) => t + ((100 - v) * (H - t - b)) / (100 - min)
  const seg: number[][] = []
  data.forEach((p, i) => {
    if (p.nilai === null) return
    const last = seg[seg.length - 1]
    if (last && last[last.length - 1] === i - 1) last.push(i)
    else seg.push([i])
  })
  const jalur = (s: number[]) => s.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(data[i].nilai as number).toFixed(1)}`).join(' ')
  const garis = seg.map(jalur).join(' ')
  const area = seg.filter((s) => s.length > 1).map((s) => `${jalur(s)} L${x(s[s.length - 1]).toFixed(1)},${y(min)} L${x(s[0]).toFixed(1)},${y(min)}Z`).join(' ')
  const ticks = Array.from({ length: Math.floor((100 - min) / 10) + 1 }, (_, i) => min + i * 10)
  const k = data.length - 1 - [...data].reverse().findIndex((p) => p.nilai !== null)
  const akhir = data[k].nilai as number
  const langkah = Math.max(1, Math.ceil(data.length / 7))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full text-primary" role="img" aria-label={label}>
      <title>{label}</title>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={l} x2={W - r} y1={y(v)} y2={y(v)} stroke={GARIS} strokeWidth="1" />
          <text x={l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={REDUP}>{v}</text>
        </g>
      ))}
      <path d={area} fill="currentColor" fillOpacity="0.1" />
      <path d={garis} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <line x1={l} x2={W - r} y1={y(target)} y2={y(target)} stroke={INK} strokeWidth="1" strokeDasharray="3 4" opacity="0.55" />
      <text x={W - r + 6} y={y(target) + 4} fontSize="11" fill={REDUP}>target {target}%</text>
      {data.map((p, i) => p.nilai !== null && <circle key={p.tanggal} cx={x(i)} cy={y(p.nilai)} r="8" fill="transparent"><title>{`${tgl(p.tanggal)}: ${Math.round(p.nilai)}%`}</title></circle>)}
      <circle cx={x(k)} cy={y(akhir)} r="5" fill="currentColor" stroke={PERMUKAAN} strokeWidth="2" />
      <text x={x(k) - 9} y={y(akhir) + (akhir > 92 ? 16 : -9)} textAnchor="end" fontSize="12" fontWeight="600" fill={INK}>{Math.round(akhir)}%</text>
      {data.map((p, i) => i % langkah === (data.length - 1) % langkah && <text key={'x' + p.tanggal} x={x(i)} y={H - 7} textAnchor="middle" fontSize="11" fill={REDUP}>{tgl(p.tanggal)}</text>)}
    </svg>
  )
}

// ── Heatmap DS x hari: satu hue, makin gelap makin terpenuhi; kotak putus-putus = belum dilaporkan ──
export type SelHeat = { rate: number | null; belum: boolean }
function HeatmapSvg({ dsList, hariList, sel, label, W }: { dsList: { id: string; nama: string }[]; hariList: string[]; sel: (dsId: string, tanggal: string) => SelHeat; label: string; W: number }) {
  if (!dsList.length || !hariList.length) return null
  const labelW = 190, n = hariList.length, step = Math.min((W - labelW) / n, 44), cw = Math.max(8, Math.min(28, step - 3)), baris = cw + 3
  const H = dsList.length * baris + 52
  const langkah = Math.max(1, Math.ceil(n / 10))
  const taraf = (v: number) => (v >= 0.95 ? 1 : v >= 0.9 ? 0.7 : v >= 0.8 ? 0.42 : 0.2)
  // Nama DS yang berawalan sama (mis. "Dark Store Alfagift - …") diringkas ke bagian yang membedakan
  const awal = (s: string) => s.split(' - ')[0]
  const dipakaiBersama = new Set(dsList.map((d) => awal(d.nama)).filter((a, i, arr) => arr.indexOf(a) !== i))
  const ringkas = (s: string) => (s.includes(' - ') && dipakaiBersama.has(awal(s)) ? s.slice(awal(s).length + 3) : s)
  const potong = (s: string) => (ringkas(s).length > 30 ? ringkas(s).slice(0, 29) + '…' : ringkas(s))
  const ly = dsList.length * baris + 28
  const kotak = (xx: number, op: number | null, teks: string) => (
    <g key={teks}>
      {op === null ? <rect x={xx} y={ly} width="11" height="11" rx="2.5" fill="none" stroke={REDUP} strokeDasharray="2 2" /> : <rect x={xx} y={ly} width="11" height="11" rx="2.5" fill="currentColor" fillOpacity={op} />}
      <text x={xx + 16} y={ly + 9} fontSize="11" fill={REDUP}>{teks}</text>
    </g>
  )
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full text-primary" role="img" aria-label={label}>
      <title>{label}</title>
      {dsList.map((d, r) => (
        <g key={d.id}>
          <text x={labelW - 10} y={r * baris + cw - 3} textAnchor="end" fontSize="11" fill={INK}><title>{d.nama}</title>{potong(d.nama)}</text>
          {hariList.map((h, c) => {
            const v = sel(d.id, h)
            const px = labelW + c * step, py = r * baris
            const ket = `${d.nama}, ${tgl(h)}: ${v.belum ? 'belum dilaporkan' : v.rate === null ? 'tidak ada budget' : Math.round(v.rate * 100) + '%'}`
            return v.rate === null || v.belum ? (
              <rect key={h} x={px + 0.75} y={py + 0.75} width={cw - 1.5} height={cw - 1.5} rx="3" fill="none" stroke={REDUP} strokeWidth="1" strokeDasharray="2 2"><title>{ket}</title></rect>
            ) : (
              <rect key={h} x={px} y={py} width={cw} height={cw} rx="3" fill="currentColor" fillOpacity={taraf(v.rate)}><title>{ket}</title></rect>
            )
          })}
        </g>
      ))}
      {hariList.map((h, c) => c % langkah === 0 && <text key={'x' + h} x={labelW + c * step + cw / 2} y={dsList.length * baris + 14} textAnchor="middle" fontSize="11" fill={REDUP}>{+h.slice(8)}</text>)}
      {[kotak(labelW, 1, '95%+'), kotak(labelW + 62, 0.7, '90–94%'), kotak(labelW + 140, 0.42, '80–89%'), kotak(labelW + 218, 0.2, '<80%'), kotak(labelW + 280, null, 'belum dilaporkan')]}
    </svg>
  )
}

// ── Kartu angka besar + chip perubahan + sparkline ──
export function KpiSpark({ label, nilai, deret, selisih, tone = 'normal' }: { label: string; nilai: ReactNode; deret: number[]; selisih: number | null; tone?: 'normal' | 'bahaya' }) {
  const W = 110, H = 34
  const ada = deret.length > 1
  const lo = ada ? Math.min(...deret) : 0, hi = ada ? Math.max(...deret) : 1
  const x = (i: number) => 4 + (i * (W - 8)) / Math.max(1, deret.length - 1)
  const y = (v: number) => H - 5 - ((v - lo) * (H - 10)) / Math.max(1, hi - lo)
  const g = deret.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const naik = selisih !== null && selisih >= 0
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className={`font-mono text-2xl font-bold ${tone === 'bahaya' ? 'text-danger' : ''}`}>{nilai}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
        {ada && (
          <svg viewBox={`0 0 ${W} ${H}`} width="96" className="shrink-0 text-primary" role="img" aria-label={`Tren ${deret.length} hari terakhir`}>
            <title>{`Tren ${deret.length} hari terakhir`}</title>
            <path d={g} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={x(deret.length - 1)} cy={y(deret[deret.length - 1])} r="3.5" fill="currentColor" stroke={PERMUKAAN} strokeWidth="2" />
          </svg>
        )}
      </div>
      {selisih !== null && (
        <div className={`mt-2 inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${naik ? 'bg-primary-soft text-primary-soft-foreground' : 'bg-danger-soft text-danger'}`}>
          {naik ? '▲' : '▼'} {Math.abs(Math.round(selisih))} poin vs 3 hari sebelumnya
        </div>
      )}
    </div>
  )
}

// ── Cincin progres bersarang (satu hue, tiga shade): satu cincin per shift, angka total di tengah ──
export function Rings({ items, tengah, label }: { items: { nama: string; nilai: number | null; detail: string }[]; tengah: string; label: string }) {
  const W = 360, H = 170, cx = 90, cy = 85, R0 = 70, gap = 17, sw = 11
  const shade = [1, 0.62, 0.34]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full text-primary" role="img" aria-label={label}>
      <title>{label}</title>
      {items.map((it, i) => {
        const R = R0 - i * gap, C = 2 * Math.PI * R, v = Math.max(0, Math.min(100, it.nilai ?? 0))
        return (
          <g key={it.nama}>
            <circle cx={cx} cy={cy} r={R} fill="none" stroke={GARIS} strokeWidth={sw} />
            {it.nilai !== null && <circle cx={cx} cy={cy} r={R} fill="none" stroke="currentColor" strokeOpacity={shade[i] ?? 0.3} strokeWidth={sw} strokeLinecap="round" strokeDasharray={`${((C * v) / 100).toFixed(1)} ${C.toFixed(1)}`} transform={`rotate(-90 ${cx} ${cy})`} />}
            <rect x={190} y={34 + i * 38} width="10" height="10" rx="2.5" fill="currentColor" fillOpacity={shade[i] ?? 0.3} />
            <text x={208} y={43 + i * 38} fontSize="12" fontWeight="500" fill={INK}>{it.nama}</text>
            <text x={208} y={58 + i * 38} fontSize="11" fill={REDUP}>{it.detail}</text>
            <text x={W - 6} y={43 + i * 38} textAnchor="end" fontSize="13" fontWeight="600" fill={INK}>{it.nilai === null ? '–' : Math.round(it.nilai) + '%'}</text>
          </g>
        )
      })}
      <text x={cx} y={cy + 7} textAnchor="middle" fontSize="20" fontWeight="600" fill={INK}>{tengah}</text>
    </svg>
  )
}

// Ringkas nama DS yang berawalan sama (mis. "Dark Store Alfagift - ...") ke bagian yang membedakan, lalu potong bila panjang
function bikinRingkas(names: string[], maks: number) {
  const awal = (x: string) => x.split(' - ')[0]
  const bersama = new Set(names.map(awal).filter((a, i, arr) => arr.indexOf(a) !== i))
  return (x: string) => {
    const r = x.includes(' - ') && bersama.has(awal(x)) ? x.slice(awal(x).length + 3) : x
    return r.length > maks ? r.slice(0, maks - 1) + '…' : r
  }
}

// ── Kolom bertumpuk tiga shade (Pagi/Middle/Siang) per hari, titik kecil di atas kolom = ada perubahan ──
export type KolomHari = { tanggal: string; pagi: number; tengah: number; siang: number }
function KolomBertumpukSvg({ data, tandai, label, W }: { data: KolomHari[]; tandai?: Map<string, number>; label: string; W: number }) {
  if (!data.length) return null
  const H = 210, l = 36, r = 10, t = 16, b = 26, n = data.length
  const total = (d: KolomHari) => d.pagi + d.tengah + d.siang
  const mx = Math.max(...data.map(total), 1) * 1.1
  const y = (v: number) => t + (H - t - b) - (v / mx) * (H - t - b)
  const lebar = (W - l - r) / n, bw = Math.max(3, Math.min(24, lebar * 0.7))
  const x = (i: number) => l + lebar * (i + 0.5)
  const langkah = Math.max(1, Math.ceil(n / 8))
  const shade = [1, 0.62, 0.34]
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(mx * f))
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full text-primary" role="img" aria-label={label}>
        <title>{label}</title>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={l} x2={W - r} y1={y(v)} y2={y(v)} stroke={GARIS} strokeWidth="1" />
            <text x={l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={REDUP}>{v}</text>
          </g>
        ))}
        {data.map((d, i) => {
          let acc = 0
          const bag = [d.pagi, d.tengah, d.siang]
          const ban = tandai?.get(d.tanggal) ?? 0
          return (
            <g key={d.tanggal}>
              {bag.map((v, k) => {
                const y1 = y(acc + v), y0 = y(acc)
                acc += v
                return v > 0 ? <rect key={k} x={x(i) - bw / 2} y={y1} width={bw} height={Math.max(1, y0 - y1 - (k < 2 ? 1.5 : 0))} rx={k === 2 && bw > 6 ? 3 : 0} fill="currentColor" fillOpacity={shade[k]} /> : null
              })}
              <rect x={x(i) - lebar / 2} y={t} width={lebar} height={H - t - b} fill="transparent"><title>{`${tgl(d.tanggal)}: total ${total(d)} (pagi ${d.pagi}, middle ${d.tengah}, siang ${d.siang})${ban ? `, ${ban} perubahan` : ''}`}</title></rect>
              {ban > 0 && <circle cx={x(i)} cy={y(total(d)) - 7} r="2.8" fill={INK} />}
              {(i % langkah === 0 || i === n - 1) && <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill={REDUP}>{tgl(d.tanggal)}</text>}
            </g>
          )
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {['Pagi', 'Middle', 'Siang'].map((nm, i) => <span key={nm} className="flex items-center gap-1.5 text-primary"><span className="inline-block size-2.5 rounded-sm bg-current" style={{ opacity: shade[i] }} /><span className="text-muted-foreground">{nm}</span></span>)}
        {tandai && <span className="flex items-center gap-1.5"><span className="inline-block size-1.5 rounded-full bg-foreground" />ada perubahan budget</span>}
      </div>
    </div>
  )
}

// ── Dumbbell: dari awal ke akhir per baris (lingkaran kosong = awal, titik penuh = akhir), selisih di kanan ──
export type BarisDumbbell = { nama: string; awal: number | null; akhir: number }
function DumbbellSvg({ items, label, W }: { items: BarisDumbbell[]; label: string; W: number }) {
  if (!items.length) return null
  const l = 232, r = 64, rowH = 30, H = items.length * rowH + 32
  const semua = items.flatMap((i) => [i.akhir, ...(i.awal === null ? [] : [i.awal])])
  const lo = Math.max(0, Math.min(...semua) - 4), hi = Math.max(...semua) + 4
  const x = (v: number) => l + ((v - lo) * (W - l - r)) / Math.max(1, hi - lo)
  const ringkas = bikinRingkas(items.map((i) => i.nama), 30)
  const sel = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full text-primary" role="img" aria-label={label}>
      <title>{label}</title>
      {items.map((it, i) => {
        const yy = 16 + i * rowH, d = it.awal === null ? it.akhir : it.akhir - it.awal
        return (
          <g key={it.nama}>
            <text x={l - 12} y={yy + 4} textAnchor="end" fontSize="12" fill={INK}><title>{it.nama}</title>{ringkas(it.nama)}</text>
            <line x1={l} x2={W - r} y1={yy} y2={yy} stroke={GARIS} strokeWidth="1" />
            {it.awal !== null && it.awal !== it.akhir && <line x1={x(it.awal)} x2={x(it.akhir)} y1={yy} y2={yy} stroke="currentColor" strokeWidth="2" />}
            {it.awal !== null && <circle cx={x(it.awal)} cy={yy} r="5" fill={PERMUKAAN} stroke={REDUP} strokeWidth="2"><title>{`awal ${it.awal}`}</title></circle>}
            <circle cx={x(it.akhir)} cy={yy} r="6" fill="currentColor"><title>{`akhir ${it.akhir}`}</title></circle>
            <text x={W - r + 12} y={yy + 4} fontSize="12" fontWeight="600" fill={d === 0 ? REDUP : INK}>{it.awal === null ? `baru ${it.akhir}` : sel(d)}</text>
          </g>
        )
      })}
      <text x={l} y={H - 6} fontSize="11" fill={REDUP}>○ awal   ● akhir (rider/hari)</text>
    </svg>
  )
}

export function AreaTarget(p: Omit<Parameters<typeof AreaTargetSvg>[0], 'W'>) {
  return <Ukur>{(W) => <AreaTargetSvg {...p} W={W} />}</Ukur>
}
export function Heatmap(p: Omit<Parameters<typeof HeatmapSvg>[0], 'W'>) {
  return <Ukur>{(W) => <HeatmapSvg {...p} W={W} />}</Ukur>
}
export function KolomBertumpuk(p: Omit<Parameters<typeof KolomBertumpukSvg>[0], 'W'>) {
  return <Ukur>{(W) => <KolomBertumpukSvg {...p} W={W} />}</Ukur>
}
export function Dumbbell(p: Omit<Parameters<typeof DumbbellSvg>[0], 'W'>) {
  return <Ukur>{(W) => <DumbbellSvg {...p} W={W} />}</Ukur>
}
