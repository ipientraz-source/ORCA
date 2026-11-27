// Chart bergaya Linear untuk tema Formal: garis tipis, satu hue ungu (currentColor, kelas text-primary), tanpa bayangan dan gradasi.
// Semua warna dari token tema, jadi ikut terang/gelap. Komponen hanya menerima angka dan tanggal; tidak membaca data sendiri.
import type { ReactNode } from 'react'

const GARIS = 'var(--border)'
const REDUP = 'var(--muted-foreground)'
const INK = 'var(--foreground)'
const PERMUKAAN = 'var(--card)'

export type TitikTanggal = { tanggal: string; nilai: number | null } // nilai dalam persen 0..100, null = belum ada data
const tgl = (s: string) => `${+s.slice(8)}/${+s.slice(5, 7)}`

// ── Area tipis + garis target + titik akhir disorot ──
export function AreaTarget({ data, target = 95, label }: { data: TitikTanggal[]; target?: number; label: string }) {
  const ada = data.filter((d) => d.nilai !== null) as { tanggal: string; nilai: number }[]
  if (!ada.length) return null
  const W = 640, H = 190, l = 34, r = 78, t = 14, b = 26
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
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block text-primary" role="img" aria-label={label}>
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
export function Heatmap({ dsList, hariList, sel, label }: { dsList: { id: string; nama: string }[]; hariList: string[]; sel: (dsId: string, tanggal: string) => SelHeat; label: string }) {
  if (!dsList.length || !hariList.length) return null
  const W = 640, labelW = 190, n = hariList.length, step = (W - labelW) / n, cw = Math.max(8, Math.min(28, step - 3)), baris = cw + 3
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
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block text-primary" role="img" aria-label={label}>
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
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 420 }} className="block text-primary" role="img" aria-label={label}>
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
