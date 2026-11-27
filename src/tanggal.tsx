// Kotak tanggal. Di gaya Neo memakai <input type="date"> bawaan browser (tidak berubah). Di gaya Cyber memakai kalender HUD sendiri,
// karena kalender bawaan browser tidak bisa digayakan. API sengaja sama dengan input bawaan: value, min, max (teks YYYY-MM-DD),
// onChange menerima objek { target: { value } } sehingga pemakai lama (e.target.value) tidak perlu diubah.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { today } from './lib'

type Props = { value: string; onChange: (e: { target: { value: string } }) => void; min?: string; max?: string; className?: string }

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const HARI = ['SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB', 'MIN']
const LEBAR = 300
const TINGGI = 340

// Kalender buatan sendiri dipakai di Cyber dan di Neo bergaya komik (atribut data-sketsa); gaya lain tetap input bawaan.
// Ikut berubah saat tombol gaya ditekan (atribut data-gaya / data-sketsa di <html>)
function useKalenderHud() {
  return useSyncExternalStore(
    (cb) => {
      const o = new MutationObserver(cb)
      o.observe(document.documentElement, { attributes: true, attributeFilter: ['data-gaya', 'data-sketsa'] })
      return () => o.disconnect()
    },
    () => {
      const h = document.documentElement
      return h.dataset.gaya === 'cyber' || (h.dataset.gaya === undefined && h.hasAttribute('data-sketsa'))
    },
    () => false,
  )
}

const teks = (s: string) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '')

export function InputTanggal(p: Props) {
  const hud = useKalenderHud()
  if (!hud) return <input type="date" className={p.className} value={p.value} min={p.min} max={p.max} onChange={p.onChange} />
  return <KalenderHud {...p} />
}

function KalenderHud({ value, onChange, min, max, className = 'inp' }: Props) {
  const [buka, setBuka] = useState(false)
  const [bulan, setBulan] = useState({ y: 0, m: 0 })
  const [pos, setPos] = useState({ left: 0, top: 0, lebar: LEBAR })
  const tombol = useRef<HTMLButtonElement>(null)
  const kotak = useRef<HTMLDivElement>(null)

  const bukaKalender = () => {
    const r = tombol.current!.getBoundingClientRect()
    const lebar = Math.min(LEBAR, window.innerWidth - 16)
    const kebawah = r.bottom + TINGGI + 8 <= window.innerHeight || r.top < TINGGI + 8
    setPos({ left: Math.min(Math.max(8, r.left), window.innerWidth - lebar - 8), top: kebawah ? r.bottom + 4 : r.top - TINGGI - 4, lebar })
    const acuan = value || today()
    setBulan({ y: +acuan.slice(0, 4), m: +acuan.slice(5, 7) - 1 })
    setBuka(true)
  }
  const tutup = () => { setBuka(false); tombol.current?.focus() }

  useEffect(() => {
    if (!buka) return
    const luar = (e: MouseEvent) => { if (!kotak.current?.contains(e.target as Node) && !tombol.current?.contains(e.target as Node)) setBuka(false) }
    const tekan = (e: KeyboardEvent) => { if (e.key === 'Escape') tutup() }
    const tutupSaja = () => setBuka(false)
    document.addEventListener('mousedown', luar)
    document.addEventListener('keydown', tekan)
    window.addEventListener('resize', tutupSaja)
    window.addEventListener('scroll', tutupSaja, true)
    return () => {
      document.removeEventListener('mousedown', luar)
      document.removeEventListener('keydown', tekan)
      window.removeEventListener('resize', tutupSaja)
      window.removeEventListener('scroll', tutupSaja, true)
    }
  }, [buka])

  const mati = (s: string) => (!!min && s < min) || (!!max && s > max)
  const pilih = (s: string) => { if (mati(s)) return; onChange({ target: { value: s } }); setBuka(false); tombol.current?.focus() }
  const geser = (dy: number, dm: number) => setBulan(({ y, m }) => { const t = y * 12 + m + dy * 12 + dm; return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 } })

  const offset = (new Date(Date.UTC(bulan.y, bulan.m, 1)).getUTCDay() + 6) % 7
  const sel = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(Date.UTC(bulan.y, bulan.m, 1 - offset + i))
    return { s: d.toISOString().slice(0, 10), n: d.getUTCDate(), luar: d.getUTCMonth() !== bulan.m }
  })
  const hariIni = today()

  return (
    <>
      <button ref={tombol} type="button" onClick={() => (buka ? tutup() : bukaKalender())} aria-haspopup="dialog" aria-expanded={buka} className={`${className} inline-flex items-center justify-between gap-2 text-left`}>
        <span className={`truncate ${value ? '' : 'text-muted-foreground/70'}`}>{teks(value) || 'Pilih tanggal'}</span>
        <CalendarDays size={15} className="shrink-0 text-muted-foreground" />
      </button>
      {buka &&
        createPortal(
          <div ref={kotak} role="dialog" aria-label="Pilih tanggal" style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.lebar }} className="select-hud tanggal-hud z-[60]">
            <div className="tgl-nav">
              <button type="button" aria-label="Tahun sebelumnya" onClick={() => geser(-1, 0)}><ChevronsLeft size={15} /></button>
              <button type="button" aria-label="Bulan sebelumnya" onClick={() => geser(0, -1)}><ChevronLeft size={15} /></button>
              <span className="tgl-judul">{BULAN[bulan.m]} {bulan.y}</span>
              <button type="button" aria-label="Bulan berikutnya" onClick={() => geser(0, 1)}><ChevronRight size={15} /></button>
              <button type="button" aria-label="Tahun berikutnya" onClick={() => geser(1, 0)}><ChevronsRight size={15} /></button>
            </div>
            <div className="tgl-hari">{HARI.map((h) => <span key={h}>{h}</span>)}</div>
            <div className="tgl-grid" key={`${bulan.y}-${bulan.m}`}>
              {sel.map((c) => (
                <button
                  key={c.s}
                  type="button"
                  disabled={mati(c.s)}
                  aria-label={teks(c.s)}
                  aria-pressed={c.s === value}
                  data-luar={c.luar || undefined}
                  data-ini={c.s === hariIni || undefined}
                  onClick={() => pilih(c.s)}
                >
                  {c.n}
                </button>
              ))}
            </div>
            <div className="tgl-kaki">
              <button type="button" disabled={mati(hariIni)} onClick={() => pilih(hariIni)}>Hari ini</button>
              <button type="button" onClick={tutup}>Tutup</button>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
