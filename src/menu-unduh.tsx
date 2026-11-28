// Menu "Unduh" satu tombol untuk beberapa berkas (mis. CSV tren, CSV per DS, CSV perubahan), supaya deretan tombol unduh tidak memakan tempat.
// Hanya menerima daftar label dan fungsi; pembuatan berkasnya tetap di halaman pemakai.
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Download } from 'lucide-react'

export type ItemUnduh = { label: string; aksi: () => void; mati?: boolean }

export function MenuUnduh({ item, label = 'Unduh' }: { item: ItemUnduh[]; label?: string }) {
  const [buka, setBuka] = useState(false)
  const kotak = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!buka) return
    const luar = (e: MouseEvent) => { if (!kotak.current?.contains(e.target as Node)) setBuka(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setBuka(false) }
    document.addEventListener('mousedown', luar)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', luar); document.removeEventListener('keydown', esc) }
  }, [buka])
  return (
    <div ref={kotak} className="relative">
      <button type="button" className="btn2 inline-flex items-center gap-2" disabled={item.every((i) => i.mati)} aria-haspopup="menu" aria-expanded={buka} onClick={() => setBuka((b) => !b)}>
        <Download size={14} />{label}<ChevronDown size={14} />
      </button>
      {buka && (
        <div role="menu" aria-label={label} className="select-hud rise absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border border-border bg-card p-1 shadow-lg">
          {item.map((i) => (
            <button
              key={i.label}
              type="button"
              role="menuitem"
              disabled={i.mati}
              onClick={() => { setBuka(false); i.aksi() }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download size={14} />{i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
