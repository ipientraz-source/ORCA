// Impor Data (Super-admin): satu tempat untuk menambah data baku (templat Excel) lewat dua jalur, impor CSV atau input manual.
// Dua jalur memakai mesin yang sama (impor-data.ts) → aturan duplikat sama: data lama tidak pernah dihapus atau ditimpa,
// baris yang dobel dilewati dan dilaporkan.
import { useCallback, useEffect, useState } from 'react'
import { Download, FileUp, PencilLine } from 'lucide-react'
import { sb, ok, toast, Field, Select, usePage, Pagination, parseCsv, toCsv, download } from './lib'
import { JENIS_SERVIS, JENIS_RUSAK } from './armada-lib'
import { ImporRiwayat } from './rekrutmen-angka'
import type { Ds } from './lib'
import { KOLOM, NAMA, TABEL, bacaTabel, ctxKosong, periksa, templatCsv, type Ctx, type Hasil, type Jenis, type Row } from './impor-data.ts'

const URUT: Jenis[] = ['ds', 'rider', 'motor', 'kandidat', 'servis', 'kerusakan']

// Supabase membatasi 1000 baris per permintaan: ambil bertahap supaya pengecekan duplikat tidak terpotong diam-diam
async function semua<T>(tabel: string, kolom: string): Promise<T[]> {
  const out: T[] = []
  for (let dari = 0; ; dari += 1000) {
    const { data, error } = await sb.from(tabel).select(kolom).order('id').range(dari, dari + 999)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as T[]))
    if ((data?.length ?? 0) < 1000) return out
  }
}

function useCtx(jenis: Jenis, batas?: Ds[]) {
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [galat, setGalat] = useState('')
  const [n, setN] = useState(0)
  useEffect(() => {
    let batal = false
    setCtx(null)
    const perlu = (...j: Jenis[]) => j.includes(jenis)
    ;(async () => {
      try {
        const c = ctxKosong()
        c.jenisServis = JENIS_SERVIS
        c.jenisRusak = JENIS_RUSAK
        if (perlu('ds', 'rider', 'motor', 'kandidat')) c.ds = await semua('ds', 'id,nama')
        if (perlu('rider', 'kandidat')) c.riders = await semua('riders', 'id,kode_mtr,nama,no_hp,peran,status')
        if (perlu('motor', 'servis', 'kerusakan')) c.motors = await semua('motor', 'id,kode_motor,plat_nomor,no_rangka')
        if (perlu('kandidat')) c.kandidat = await semua('kandidat', 'nama,no_hp')
        if (perlu('servis')) c.servis = await semua('servis_motor', 'motor_id,tanggal,jenis,jenis_lain')
        if (perlu('kerusakan')) c.rusak = await semua('kerusakan_motor', 'motor_id,tanggal,jenis,deskripsi')
        if (batas) {
          const boleh = new Set(batas.map((d) => d.id))
          c.ds = c.ds.filter((d) => boleh.has(d.id))
          c.wajibDs = true
        }
        if (!batal) { setCtx(c); setGalat('') }
      } catch (e) {
        if (!batal) setGalat((e as Error).message)
      }
    })()
    return () => { batal = true }
  }, [jenis, n, batas?.map((d) => d.id).join()]) // eslint-disable-line react-hooks/exhaustive-deps
  return { ctx, galat, muatUlang: useCallback(() => setN((x) => x + 1), []) }
}

// Simpan baris yang berstatus siap. Per 200 baris; bila satu gelombang ditolak server, gelombang sebelumnya tetap tersimpan.
async function simpan(jenis: Jenis, data: Record<string, unknown>[]): Promise<number> {
  let masuk = 0
  for (let i = 0; i < data.length; i += 200) {
    const potong = data.slice(i, i + 200)
    if (!(await ok(sb.from(TABEL[jenis]).insert(potong)))) break
    masuk += potong.length
  }
  return masuk
}

const lencana = (s: Hasil['status']) =>
  s === 'siap' ? <span className="badge bg-success-soft text-success">Siap</span>
  : s === 'duplikat' ? <span className="badge bg-warning-soft text-warning">Dobel · dilewati</span>
  : <span className="badge bg-danger-soft text-danger">Salah</span>

function opsiUntuk(jenis: Jenis, kunci: string, ctx: Ctx): string[] | null {
  if (kunci === 'ds') return ctx.ds.map((d) => d.nama)
  if (kunci === 'jenis') return jenis === 'servis' ? ctx.jenisServis : jenis === 'kerusakan' ? ctx.jenisRusak : null
  return KOLOM[jenis].find((k) => k.kunci === kunci)?.opsi ?? null
}

function Csv({ jenis, ctx, selesai }: { jenis: Jenis; ctx: Ctx; selesai: () => void }) {
  const [berkas, setBerkas] = useState('')
  const [baris, setBaris] = useState<{ baris: number; nilai: Row }[]>([])
  const [galat, setGalat] = useState('')
  const [sibuk, setSibuk] = useState(false)
  const [laporan, setLaporan] = useState<{ tambah: number; dilewati: Hasil[] } | null>(null)
  const hasil = periksa(jenis, baris, ctx)
  const n = { siap: hasil.filter((h) => h.status === 'siap'), dobel: hasil.filter((h) => h.status === 'duplikat'), salah: hasil.filter((h) => h.status === 'salah') }
  const pg = usePage(hasil, [baris.length, jenis])

  async function baca(f: File | undefined) {
    if (!f) return
    setLaporan(null)
    const { baris: b, galat: g } = bacaTabel(parseCsv((await f.text()).replace(/^﻿/, '')), jenis)
    setBerkas(f.name)
    setBaris(b)
    setGalat(g || (b.length ? '' : 'Tidak ada baris data di berkas ini.'))
  }
  async function impor() {
    setSibuk(true)
    try {
      const tambah = await simpan(jenis, n.siap.map((h) => h.data as Record<string, unknown>))
      setLaporan({ tambah, dilewati: [...n.dobel, ...n.salah] })
      if (tambah) toast.ok(`${tambah} ${NAMA[jenis].toLowerCase()} ditambahkan`)
      setBaris([])
      setBerkas('')
      selesai()
    } finally {
      setSibuk(false)
    }
  }
  const unduhDilewati = () =>
    laporan && download(`dilewati-${jenis}.csv`, toCsv(laporan.dilewati.map((h) => ({ Baris: h.baris, Status: h.status === 'duplikat' ? 'Dobel' : 'Salah', Alasan: h.alasan, ...Object.fromEntries(KOLOM[jenis].map((k) => [k.judul, h.nilai[k.kunci]])) }))))

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Unggah berkas CSV (UTF-8, satu jenis data per berkas) sesuai templat di atas. Wajib: <b>{KOLOM[jenis].filter((k) => k.wajib).map((k) => k.judul).join(', ')}</b>.
        Baris yang dobel dengan data lama atau dengan baris lain di berkas <b>dilewati, bukan ditambahkan lagi</b>; data lama tidak diubah.
      </p>
      <label className="flex max-w-full cursor-pointer items-center gap-3 rounded-xl border border-dashed border-input p-4 text-sm text-muted-foreground hover:border-primary/50 hover:bg-muted/40">
        <span className="btn2 shrink-0">Pilih file CSV</span>
        {berkas || 'Belum ada file dipilih — klik di sini untuk unggah'}
        <input key={berkas + (laporan ? 'x' : '')} type="file" accept=".csv,text/csv" aria-label={`Berkas CSV ${NAMA[jenis]}`} className="hidden" onChange={(e) => baca(e.target.files?.[0])} />
      </label>
      {galat && <p className="text-sm text-danger">{galat}</p>}

      {laporan && (
        <div className="space-y-1 rounded-xl border border-border p-3 text-sm">
          <div><b className="text-success">{laporan.tambah}</b> baris ditambahkan.</div>
          {laporan.dilewati.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span><b className="text-warning">{laporan.dilewati.length}</b> baris dilewati (dobel atau salah), data lama utuh.</span>
              <button className="btn2" onClick={unduhDilewati}><Download size={14} />Unduh daftar dilewati</button>
            </div>
          )}
        </div>
      )}

      {baris.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="badge bg-success-soft text-success">{n.siap.length} siap ditambahkan</span>
            {n.dobel.length > 0 && <span className="badge bg-warning-soft text-warning">{n.dobel.length} dobel (dilewati)</span>}
            {n.salah.length > 0 && <span className="badge bg-danger-soft text-danger">{n.salah.length} salah (dilewati)</span>}
            <button className="btn ml-auto" disabled={!n.siap.length || sibuk} onClick={impor}>{sibuk ? 'Menyimpan…' : `Tambahkan ${n.siap.length} baris`}</button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="tbl">
              <thead><tr><th>Baris</th>{KOLOM[jenis].slice(0, 3).map((k) => <th key={k.kunci}>{k.judul}</th>)}<th>Status</th><th>Keterangan</th></tr></thead>
              <tbody>
                {pg.rows.map((h) => (
                  <tr key={h.baris}>
                    <td className="font-mono text-xs">{h.baris}</td>
                    {KOLOM[jenis].slice(0, 3).map((k) => <td key={k.kunci}>{h.nilai[k.kunci] || '–'}</td>)}
                    <td>{lencana(h.status)}</td>
                    <td className="text-xs text-muted-foreground">{h.alasan}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...pg} />
        </>
      )}
    </div>
  )
}

function Manual({ jenis, ctx, selesai }: { jenis: Jenis; ctx: Ctx; selesai: () => void }) {
  const kosong = (): Row => Object.fromEntries(KOLOM[jenis].map((k) => [k.kunci, '']))
  const [f, setF] = useState<Row>(kosong)
  const [pesan, setPesan] = useState<Hasil | null>(null)
  const [sibuk, setSibuk] = useState(false)

  async function kirim() {
    const h = periksa(jenis, [{ baris: 1, nilai: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()])) }], ctx)[0]
    setPesan(h)
    if (h.status !== 'siap') return
    setSibuk(true)
    try {
      if (await simpan(jenis, [h.data as Record<string, unknown>])) {
        toast.ok(`${NAMA[jenis]} ditambahkan`)
        setF(kosong())
        setPesan(null)
        selesai()
      }
    } finally {
      setSibuk(false)
    }
  }

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); kirim() }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {KOLOM[jenis].map((k) => {
          const opsi = opsiUntuk(jenis, k.kunci, ctx)
          const set = (v: string) => { setF((s) => ({ ...s, [k.kunci]: v })); setPesan(null) }
          return (
            <Field key={k.kunci} label={k.judul + (k.wajib ? ' *' : '')} hint={k.bantuan}>
              {opsi ? <Select value={f[k.kunci]} onChange={set} placeholder="— pilih —" opsi={[{ value: '', label: '— kosong —' }, ...opsi.map((o) => ({ value: o, label: o }))]} />
                : <input className="inp w-full" type={k.tipe === 'tanggal' ? 'date' : 'text'} inputMode={k.tipe === 'angka' ? 'numeric' : undefined} value={f[k.kunci]} onChange={(e) => set(e.target.value)} />}
            </Field>
          )
        })}
      </div>
      {pesan?.status === 'salah' && <p className="text-sm text-danger">{pesan.alasan}</p>}
      {pesan?.status === 'duplikat' && <p className="text-sm text-warning">{pesan.alasan}. Tidak disimpan lagi, data yang lama tidak diubah.</p>}
      <button className="btn" disabled={sibuk}>{sibuk ? 'Menyimpan…' : `Tambah ${NAMA[jenis].toLowerCase()}`}</button>
    </form>
  )
}

// Panduan isi kolom: dibangun dari KOLOM (sumber yang sama dengan pemeriksa), jadi tidak bisa menyimpang dari aturan sistem
function Panduan({ jenis, ctx }: { jenis: Jenis; ctx: Ctx | null }) {
  const isi = (k: (typeof KOLOM)[Jenis][number]) => {
    if (k.opsi) return k.opsi.join(' / ')
    if (jenis === 'servis' && k.kunci === 'jenis') return JENIS_SERVIS.join(' / ')
    if (jenis === 'kerusakan' && k.kunci === 'jenis') return JENIS_RUSAK.join(' / ')
    if (k.tipe === 'tanggal') return 'Tanggal: 2026-10-28 atau 28/10/2026'
    if (k.tipe === 'angka') return 'Angka bulat, tanpa Rp'
    return 'Teks bebas'
  }
  const daftarDs = ctx?.ds.map((d) => d.nama).join(', ')
  return (
    <details open className="rounded-lg border border-border bg-muted/30 text-sm">
      <summary className="cursor-pointer select-none px-3 py-2 font-semibold">Panduan: cara mengisi {NAMA[jenis].toLowerCase()}</summary>
      <div className="space-y-3 border-t border-border px-3 py-3">
        <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
          <li>Klik <b className="text-foreground">Unduh templat CSV</b>, buka di Excel atau Google Sheets.</li>
          <li>Isi mulai baris ke-2 dan <b className="text-foreground">hapus baris contoh</b>. Jangan ubah nama kolom di baris pertama.</li>
          <li>Simpan sebagai CSV, lalu unggah di bawah. Cek pratinjau, baru klik Tambahkan.</li>
        </ol>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Kolom</th><th>Wajib?</th><th>Isi yang diterima</th><th>Contoh</th><th>Catatan</th></tr></thead>
            <tbody>
              {KOLOM[jenis].map((k) => (
                <tr key={k.kunci}>
                  <td className="whitespace-nowrap font-semibold">{k.judul}</td>
                  <td>{k.wajib ? <span className="badge bg-danger/10 text-danger">Wajib</span> : <span className="text-muted-foreground">Opsional</span>}</td>
                  <td>{isi(k)}</td>
                  <td className="font-mono text-xs">{k.contoh || '—'}</td>
                  <td className="text-muted-foreground">{k.bantuan ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          <li>Nomor HP: di Excel, ubah format kolom ke <b className="text-foreground">Text</b> sebelum mengetik, supaya angka 0 di depan tidak hilang.</li>
          <li>Nama DS harus persis seperti di Kelola DS{daftarDs ? <>. DS yang ada: <span className="text-foreground">{daftarDs}</span></> : ''}.</li>
          <li>Baris yang dobel dilewati dan dilaporkan; data lama tidak pernah diubah.</li>
        </ul>
      </div>
    </details>
  )
}

function Panel({ jenis, batas }: { jenis: Jenis; batas?: Ds[] }) {
  const { ctx, galat, muatUlang } = useCtx(jenis, batas)
  const [jalur, setJalur] = useState<'csv' | 'manual'>('csv')
  const [judul, contoh] = templatCsv(jenis)
  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`tab ${jalur === 'csv' ? 'tab-on' : ''}`} onClick={() => setJalur('csv')}><FileUp size={14} className="mr-1 inline" />Impor CSV</button>
        <button type="button" className={`tab ${jalur === 'manual' ? 'tab-on' : ''}`} onClick={() => setJalur('manual')}><PencilLine size={14} className="mr-1 inline" />Input manual</button>
        <button className="btn2 ml-auto" onClick={() => download(`templat-${jenis}.csv`, toCsv([Object.fromEntries(judul.map((h, i) => [h, contoh[i]]))]))}><Download size={14} />Unduh templat CSV</button>
      </div>
      <Panduan jenis={jenis} ctx={ctx} />
      {galat ? <p className="text-sm text-danger">Gagal memuat data yang sudah ada: {galat}</p>
        : !ctx ? <p className="text-sm text-muted-foreground">Memuat data yang sudah ada untuk cek dobel…</p>
        : jalur === 'csv' ? <Csv jenis={jenis} ctx={ctx} selesai={muatUlang} /> : <Manual jenis={jenis} ctx={ctx} selesai={muatUlang} />}
    </div>
  )
}

// terbatas = tampilan Arcon: hanya DS yang dipegang; DS baru, kandidat, dan riwayat rider khusus Super-admin/Recruiter
export function ImporData({ terbatas }: { terbatas?: Ds[] }) {
  const tersedia = terbatas ? URUT.filter((j) => ['rider', 'motor', 'servis', 'kerusakan'].includes(j)) : URUT
  const [tab, setTab] = useState<Jenis | 'riwayat'>(tersedia[0])
  return (
    <div className="space-y-4">
      <div className="card text-sm text-muted-foreground">
        <b className="text-foreground">Aturan duplikat:</b> data yang sudah ada tidak pernah dihapus atau ditimpa. Baris yang dobel (dengan data lama atau dengan baris lain di berkas) dilewati dan dilaporkan, jadi impor berkas yang sama dua kali tidak menambah apa pun.
        Urutan yang disarankan: DS → Rider → Motor → Kandidat → Servis dan Kerusakan, karena data belakangan merujuk data sebelumnya.
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tersedia.map((j) => <button key={j} type="button" className={`tab ${tab === j ? 'tab-on' : ''}`} onClick={() => setTab(j)}>{NAMA[j]}</button>)}
        {!terbatas && <button type="button" className={`tab ${tab === 'riwayat' ? 'tab-on' : ''}`} onClick={() => setTab('riwayat')}>Riwayat Rider</button>}
      </div>
      {tab === 'riwayat' ? (
        <div className="space-y-2">
          <p className="text-sm text-warning">Beda dengan sheet lain: impor riwayat rider MENIMPA riwayat bergabung/berhenti rider yang ada di berkas (ada konfirmasi sebelum jalan).</p>
          <ImporRiwayat onSelesai={() => {}} />
        </div>
      ) : <Panel key={tab} jenis={tab} batas={terbatas} />}
    </div>
  )
}
