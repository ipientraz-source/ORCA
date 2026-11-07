import { createClient } from '@supabase/supabase-js'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Inbox, Moon, Search, Sun, X, type LucideIcon } from 'lucide-react'

export const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)

export type Peran = 'rider' | 'captain' | 'arcon' | 'recruiter' | 'super_admin'
export type Me = { id: string; nama: string; peran: Peran; ds_id: string | null; email: string }
export type Ds = { id: string; nama: string; kuota_pagi: number; kuota_siang: number; captain_id: string | null; arcon_id: string | null; group_wa_id: string | null }
export type Rider = { id: string; kode_mtr: string | null; nama: string; no_hp: string | null; ds_id: string | null; status: 'aktif' | 'nonaktif'; peran: Peran; email: string | null }

// ── tanggal (WIB, string YYYY-MM-DD agar tidak kena geser zona waktu) ──
export const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
export const addDays = (d: string, n: number) => {
  const t = new Date(d + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}
export const monday = (d: string) => addDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7))
export const hari = (d: string) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

// ── data ──
// ponytail: tanpa react-query; reload manual. PostgREST membatasi 1000 baris per query — cukup untuk skala rider Dash, tambah paginasi bila lewat.
// data: unknown — klien Supabase tanpa tipe salah menebak bentuk embed relasi; bentuk baris dideklarasikan lewat T.
export function useRows<T>(fn: () => PromiseLike<{ data: unknown; error: { message: string } | null }>, deps: unknown[]) {
  const [rows, setRows] = useState<T[]>([])
  const [err, setErr] = useState('')
  const [n, setN] = useState(0)
  useEffect(() => {
    let off = false
    Promise.resolve(fn()).then((r) => {
      if (off) return
      setErr(r.error?.message ?? '')
      setRows((r.data ?? []) as T[])
    })
    return () => {
      off = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n])
  return { rows, err, reload: () => setN((x) => x + 1) }
}

// Pesan teknis dari database diterjemahkan agar mudah dipahami; pesan yang sudah berbahasa Indonesia dibiarkan.
const ramah = (m: string) =>
  /row-level security|permission denied/i.test(m) ? 'Anda tidak punya izin untuk tindakan ini.'
  : /duplicate key/i.test(m) ? 'Data sudah ada. Kode MTR, email, dan nama DS tidak boleh kembar.'
  : /failed to fetch|network/i.test(m) ? 'Koneksi bermasalah. Periksa internet Anda lalu coba lagi.'
  : /invalid input syntax/i.test(m) ? 'Isian tidak valid. Periksa lagi data yang dimasukkan.'
  : /could not find the (table|function)|schema cache|(function|relation) .* does not exist/i.test(m) ? 'Fitur ini belum aktif di database. Jalankan migrasi SQL terbaru di Supabase, lalu muat ulang halaman.'
  : /jwt (expired|invalid)|invalid jwt|not authenticated/i.test(m) ? 'Sesi Anda berakhir. Muat ulang halaman lalu masuk lagi.'
  : /violates foreign key/i.test(m) ? 'Data ini masih terhubung dengan data lain, jadi belum bisa diubah atau dihapus.'
  : /violates (check|not-null)|null value in column/i.test(m) ? 'Ada isian wajib yang kosong atau di luar batas yang diizinkan.'
  : m

export async function ok(p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p
  if (error) toast(error.message)
  return !error
}

// ── notifikasi (menggantikan alert bawaan browser) ──
type Toast = { id: number; msg: string; tone: 'ok' | 'err' }
let pushToast: (t: Toast) => void = () => {}
let toastId = 0
const emit = (msg: string, tone: Toast['tone']) => pushToast({ id: ++toastId, msg, tone })
export const toast = Object.assign((msg: string) => emit(ramah(msg), 'err'), { ok: (msg: string) => emit(msg, 'ok') })

// ── dialog konfirmasi bertema (menggantikan confirm bawaan browser) ──
type Tanya = { msg: string; judul: string; ya: string; bahaya: boolean; selesai: (v: boolean) => void }
let bukaTanya: (t: Tanya) => void = (t) => t.selesai(false)
export const konfirmasi = (msg: string, o: { judul?: string; ya?: string; bahaya?: boolean } = {}) =>
  new Promise<boolean>((selesai) => bukaTanya({ msg, judul: o.judul ?? 'Yakin?', ya: o.ya ?? 'Lanjut', bahaya: !!o.bahaya, selesai }))

function DialogKonfirmasi() {
  const [t, setT] = useState<Tanya | null>(null)
  useEffect(() => {
    bukaTanya = setT
    return () => {
      bukaTanya = (x) => x.selesai(false)
    }
  }, [])
  const tutup = (v: boolean) => {
    t?.selesai(v)
    setT(null)
  }
  useEffect(() => {
    if (!t) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && tutup(false)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })
  if (!t) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4" onClick={() => tutup(false)}>
      <div role="alertdialog" aria-modal="true" aria-label={t.judul} className="rise w-full max-w-md rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${t.bahaya ? 'bg-danger-soft text-danger' : 'bg-primary-soft text-primary'}`}><AlertCircle size={18} /></span>
          <div>
            <h3 className="text-base font-bold">{t.judul}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t.msg}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn2" autoFocus={t.bahaya} onClick={() => tutup(false)}>Batal</button>
          <button className={`btn ${t.bahaya ? '!bg-danger !shadow-none' : ''}`} autoFocus={!t.bahaya} onClick={() => tutup(true)}>{t.ya}</button>
        </div>
      </div>
    </div>
  )
}

export function Toaster() {
  const [list, setList] = useState<Toast[]>([])
  useEffect(() => {
    pushToast = (t) => {
      setList((l) => [...l, t])
      setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), 5000)
    }
    return () => {
      pushToast = () => {}
    }
  }, [])
  return (
    <>
    <DialogKonfirmasi />
    <div className="fixed bottom-4 right-4 z-50 space-y-2 w-96 max-w-[calc(100vw-2rem)]">
      {list.map((t) => (
        <div key={t.id} className={`rise flex items-start gap-3 rounded-xl border bg-card p-3.5 shadow-xl text-sm ${t.tone === 'ok' ? 'border-primary/30' : 'border-danger/30'}`}>
          {t.tone === 'ok' ? <CheckCircle2 size={18} className="text-primary shrink-0 mt-0.5" /> : <AlertCircle size={18} className="text-danger shrink-0 mt-0.5" />}
          <span className="flex-1">{t.msg}</span>
          <button onClick={() => setList((l) => l.filter((x) => x.id !== t.id))} className="text-muted-foreground/70 hover:text-foreground"><X size={16} /></button>
        </div>
      ))}
    </div>
    </>
  )
}

// ── paginasi: pilihan jumlah baris per halaman (10 / 20 / 50 / 100), pilihan diingat di perangkat ──
export const UKURAN_HALAMAN = [10, 20, 50, 100]
const ukuranTersimpan = () => {
  const n = Number(store.get('per_halaman'))
  return UKURAN_HALAMAN.includes(n) ? n : UKURAN_HALAMAN[0]
}
export function usePage<T>(rows: T[], resetKey: unknown[] = []) {
  const [hal, setHal] = useState(1)
  const [ukuran, setUkuranState] = useState(ukuranTersimpan)
  const setUkuran = (n: number) => {
    store.set('per_halaman', String(n))
    setUkuranState(n)
    setHal(1)
  }
  const total = Math.max(1, Math.ceil(rows.length / ukuran))
  const aktif = Math.min(hal, total)
  // kembali ke halaman 1 saat pencarian / filter berubah
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setHal(1), resetKey)
  return { rows: rows.slice((aktif - 1) * ukuran, aktif * ukuran), hal: aktif, total, jumlah: rows.length, setHal, ukuran, setUkuran }
}

export function Pagination({ hal, total, jumlah, setHal, ukuran, setUkuran }: { hal: number; total: number; jumlah: number; setHal: (n: number) => void; ukuran: number; setUkuran: (n: number) => void }) {
  if (jumlah <= UKURAN_HALAMAN[0]) return null
  const dari = (hal - 1) * ukuran + 1
  const sampai = Math.min(hal * ukuran, jumlah)
  const awal = Math.max(1, Math.min(hal - 2, total - 4))
  const nomor = Array.from({ length: Math.min(5, total) }, (_, i) => awal + i)
  const btn = 'size-8 rounded-md text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5 border-t border-border text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span>
          Menampilkan <b className="text-foreground">{dari}–{sampai}</b> dari <b className="text-foreground">{jumlah}</b>
        </span>
        <span className="flex items-center gap-2">
          Tampilkan
          <Select className="w-[4.5rem]" value={String(ukuran)} onChange={(v) => setUkuran(Number(v))} opsi={UKURAN_HALAMAN.map((n) => ({ value: String(n), label: String(n) }))} />
        </span>
      </div>
      <div className="flex items-center gap-1" role="navigation" aria-label="Halaman">
        <button className={`${btn} hover:bg-muted`} disabled={hal <= 1} onClick={() => setHal(hal - 1)} aria-label="Halaman sebelumnya"><ChevronLeft size={16} className="mx-auto" /></button>
        {nomor.map((n) => (
          <button key={n} onClick={() => setHal(n)} aria-current={n === hal ? 'page' : undefined} className={`${btn} ${n === hal ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{n}</button>
        ))}
        <button className={`${btn} hover:bg-muted`} disabled={hal >= total} onClick={() => setHal(hal + 1)} aria-label="Halaman berikutnya"><ChevronRight size={16} className="mx-auto" /></button>
      </div>
    </div>
  )
}

// Tombol mode terang / gelap (pilihan disimpan di perangkat)
function useTema() {
  const [gelap, setGelap] = useState(() => document.documentElement.classList.contains('dark'))
  const pilih = (g: boolean) => {
    document.documentElement.classList.toggle('dark', g)
    store.set('tema', g ? 'gelap' : 'terang')
    setGelap(g)
  }
  return { gelap, pilih }
}

// Versi ikon (untuk bar gelap yang sempit)
export function TemaToggle({ className = '' }: { className?: string }) {
  const { gelap, pilih } = useTema()
  return (
    <button onClick={() => pilih(!gelap)} title={gelap ? 'Ganti ke tema terang' : 'Ganti ke tema gelap'} aria-label="Ganti tema" className={`p-2 rounded-md transition-colors hover:bg-foreground/10 ${className}`}>
      {gelap ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}

// Dua ikon (matahari / bulan), tanpa teks supaya hemat ruang; tooltip menjelaskan
export function TemaSwitch() {
  const { gelap, pilih } = useTema()
  const item = (aktif: boolean) =>
    `inline-flex size-7 items-center justify-center rounded-md transition-colors ${aktif ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`
  return (
    <div role="group" aria-label="Pilih tema" className="inline-flex p-0.5 rounded-lg bg-muted border border-border">
      <button onClick={() => pilih(false)} aria-pressed={!gelap} aria-label="Tema terang" title="Tema terang" className={item(!gelap)}><Sun size={15} /></button>
      <button onClick={() => pilih(true)} aria-pressed={gelap} aria-label="Tema gelap" title="Tema gelap" className={item(gelap)}><Moon size={15} /></button>
    </div>
  )
}

// Kartu angka dengan ikon
export function Stat({ icon: Icon, label, value, tone = 'brand' }: { icon: LucideIcon; label: string; value: ReactNode; tone?: 'brand' | 'red' | 'zinc' }) {
  const warna = { brand: 'bg-primary-soft text-primary', red: 'bg-danger-soft text-danger', zinc: 'bg-muted text-muted-foreground' }[tone]
  return (
    <div className="stat flex items-center gap-3 !p-2.5 sm:!px-3">
      <div className={`size-9 shrink-0 rounded-lg flex items-center justify-center ${warna}`}><Icon size={18} /></div>
      <div className="min-w-0">
        <b className={tone === 'red' ? '!text-danger' : ''}>{value}</b>
        <span>{label}</span>
      </div>
    </div>
  )
}

export const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* private mode */
    }
  },
  del: (k: string) => {
    try {
      localStorage.removeItem(k)
    } catch {
      /* private mode */
    }
  },
}

// ── CSV ──
export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return ''
  const keys = Object.keys(rows[0])
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\r\n')
}
export function download(name: string, csv: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })) // BOM agar Excel baca UTF-8
  a.download = name
  a.click()
}
// Pemisah , atau ; (Excel locale Indonesia menyimpan CSV dengan ;)
export function parseCsv(t: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let f = ''
  let q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          f += '"'
          i++
        } else q = false
      } else f += c
    } else if (c === '"') q = true
    else if (c === ',' || c === ';') {
      row.push(f)
      f = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      row.push(f)
      out.push(row)
      row = []
      f = ''
    } else f += c
  }
  if (f || row.length) {
    row.push(f)
    out.push(row)
  }
  return out
}

// ── komponen kecil ──
// Pencarian + dropdown rider (cari nama / Kode MTR)
export function RiderPick({
  riders,
  value,
  onChange,
  placeholder,
}: {
  riders: { id: string; nama: string; kode_mtr?: string | null }[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
}) {
  return (
    <Select
      cari
      className="w-full min-w-52"
      value={value}
      onChange={onChange}
      placeholder={placeholder ?? '— pilih rider —'}
      opsi={riders.map((r) => ({ value: r.id, label: r.nama + (r.kode_mtr ? ` (${r.kode_mtr})` : '') }))}
    />
  )
}

// Pilihan (dropdown) bertema: bisa dicari, bisa dipakai dengan keyboard (↑ ↓ Enter Esc),
// dan daftarnya tidak terpotong di dalam tabel karena ditampilkan lewat portal.
export type Opsi = { value: string; label: string }
export function Select({ value, onChange, opsi, placeholder = 'Pilih…', className = '', disabled = false, cari }: {
  value: string
  onChange: (v: string) => void
  opsi: Opsi[]
  placeholder?: string
  className?: string
  disabled?: boolean
  cari?: boolean // paksa tampilkan kolom cari; default: otomatis bila opsi > 7
}) {
  const [buka, setBuka] = useState(false)
  const [q, setQ] = useState('')
  const [aktif, setAktif] = useState(0)
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number }>({ left: 0, width: 0, maxH: 0 })
  const tombol = useRef<HTMLButtonElement>(null)
  const kotak = useRef<HTMLDivElement>(null)
  const kolomCari = useRef<HTMLInputElement>(null)
  const bisaCari = cari ?? opsi.length > 7
  const tampil = opsi.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()))
  const terpilih = opsi.find((o) => o.value === value)

  // Posisi daftar mengikuti area yang benar-benar terlihat (visualViewport: menyusut saat keyboard HP muncul)
  const hitungPos = (r: DOMRect) => {
    const vv = window.visualViewport
    const bawah = (vv ? vv.height + vv.offsetTop : window.innerHeight) - r.bottom
    const keAtas = bawah < 280 && r.top > bawah
    const width = Math.max(r.width, 224)
    return {
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      width,
      ...(keAtas ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
      maxH: Math.max(120, Math.min(340, (keAtas ? r.top : bawah) - 16)),
    }
  }
  const bukaDaftar = () => {
    setPos(hitungPos(tombol.current!.getBoundingClientRect()))
    setQ('')
    setAktif(Math.max(0, opsi.findIndex((o) => o.value === value)))
    setBuka(true)
  }
  const tutup = () => {
    setBuka(false)
    tombol.current?.focus()
  }
  const pilih = (v: string) => {
    onChange(v)
    tutup()
  }

  useEffect(() => {
    if (!buka) return
    const luar = (e: Event) => {
      if (!kotak.current?.contains(e.target as Node) && !tombol.current?.contains(e.target as Node)) setBuka(false)
    }
    // Gulir halaman atau keyboard HP muncul: daftar ikut pindah, bukan menutup (fokus ke kolom cari memicu gulir/resize di HP).
    // Daftar baru menutup kalau tombolnya sudah keluar dari layar.
    const susun = () => {
      const r = tombol.current?.getBoundingClientRect()
      if (!r || r.bottom < 0 || r.top > window.innerHeight) return setBuka(false)
      setPos(hitungPos(r))
    }
    const gulir = (e: Event) => {
      if (!kotak.current?.contains(e.target as Node)) susun()
    }
    document.addEventListener('mousedown', luar)
    window.addEventListener('scroll', gulir, true)
    window.addEventListener('resize', susun)
    window.visualViewport?.addEventListener('resize', susun)
    setTimeout(() => (bisaCari ? kolomCari.current : kotak.current)?.focus({ preventScroll: true }), 0)
    return () => {
      document.removeEventListener('mousedown', luar)
      window.removeEventListener('scroll', gulir, true)
      window.removeEventListener('resize', susun)
      window.visualViewport?.removeEventListener('resize', susun)
    }
  }, [buka, bisaCari])

  useEffect(() => {
    kotak.current?.querySelector('[data-aktif="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [aktif, buka])

  const tekan = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAktif((a) => Math.min(a + 1, tampil.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAktif((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (tampil[aktif]) pilih(tampil[aktif].value) }
    else if (e.key === 'Escape') { e.preventDefault(); tutup() }
    else if (e.key === 'Tab') setBuka(false)
  }

  return (
    <>
      <button
        ref={tombol}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={buka}
        onClick={() => (buka ? setBuka(false) : bukaDaftar())}
        onKeyDown={(e) => { if (!buka && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); bukaDaftar() } }}
        className={`inp inline-flex items-center justify-between gap-2 text-left ${buka ? '!border-primary ring-[length:var(--ring-width)] ring-ring/25' : ''} ${className}`}
      >
        <span className={`truncate ${terpilih ? '' : 'text-muted-foreground/70'}`}>{terpilih?.label ?? placeholder}</span>
        <ChevronDown size={16} className={`shrink-0 text-muted-foreground transition-transform ${buka ? 'rotate-180' : ''}`} />
      </button>
      {buka &&
        createPortal(
          <div
            ref={kotak}
            tabIndex={-1}
            onKeyDown={tekan}
            style={{ position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH }}
            className="rise z-[60] flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl outline-none"
          >
            {bisaCari && (
              <div className="p-2 border-b border-border">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    ref={kolomCari}
                    className="inp w-full !pl-8"
                    placeholder="Ketik untuk mencari…"
                    value={q}
                    onChange={(e) => { setQ(e.target.value); setAktif(0) }}
                  />
                </div>
              </div>
            )}
            <ul role="listbox" className="overflow-y-auto p-1">
              {tampil.map((o, i) => (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                  data-aktif={i === aktif}
                  onMouseEnter={() => setAktif(i)}
                  onClick={() => pilih(o.value)}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ${i === aktif ? 'bg-primary-soft text-primary-soft-foreground' : ''} ${o.value === value ? 'font-semibold' : ''}`}
                >
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.value === value && <Check size={14} className="shrink-0 text-primary" />}
                </li>
              ))}
              {!tampil.length && <li className="px-3 py-4 text-center text-sm text-muted-foreground">Tidak ada yang cocok</li>}
            </ul>
          </div>,
          document.body,
        )}
    </>
  )
}

export const Err = ({ msg }: { msg: string }) =>
  msg ? <p className="text-danger text-sm mb-3 bg-danger-soft border border-danger/30 rounded-md px-3 py-2">{ramah(msg)}</p> : null

// Kolom isian berlabel + penjelasan fungsinya, supaya jelas untuk apa tiap kolom
export const Field = ({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) => (
  <div className={className}>
    <label className="lbl">{label}</label>
    {children}
    {hint && <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{hint}</p>}
  </div>
)

// Ikon ORCA (tile navy, cincin ber-outline putih): berkas yang sama dengan ikon tab browser
export const Logo = ({ small }: { small?: boolean }) => (
  <img src="/favicon.svg" alt="Dash ORCA" className={`${small ? 'size-9' : 'size-12'} shrink-0 drop-shadow-md`} />
)

export const Kosong = ({ teks, hint }: { teks: string; hint?: string }) => (
  <div className="flex flex-col items-center text-center py-10 text-muted-foreground">
    <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-3"><Inbox size={22} className="text-muted-foreground/70" /></div>
    <p className="font-semibold text-foreground/80">{teks}</p>
    {hint && <p className="text-sm mt-1 max-w-xs">{hint}</p>}
  </div>
)
