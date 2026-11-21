// Laporan order harian rider: jumlah order yang dibawa + screenshot order sebagai bukti.
// Rider (login Kode MTR, tanpa akun Supabase) memakai Edge Function laporan-order-rider. Captain, Arcon, dan Super-admin membaca langsung lewat RLS.
import { useEffect, useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { sb, today, addDays, hari, useRows, toast, Err, Kosong, Field, Select, usePage, Pagination, type Ds } from './lib'
import { InputTanggal } from './tanggal'
import { FotoGaleri, kecilkan } from './armada-lib'

const MAKS_FOTO = 10 // sama dengan batas di Edge Function dan tabel
const HARI_MUNDUR = 7
const SHIFT: Record<string, string> = { pagi: 'Pagi', tengah: 'Middle', siang: 'Siang' }
const jam = (s: string) => new Date(s).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })

type FotoLap = { path: string; url: string | null }
type Lap = { tanggal: string; jumlah_order: number; catatan: string | null; foto: FotoLap[]; diubah: string }
type Muat = { rider: { nama: string; ds_nama: string | null }; hari_ini: string; laporan: Lap[] }

// Edge Function mengembalikan pesan kesalahan berbahasa Indonesia di badan respons; ambil itu, bukan pesan teknis bawaan.
async function panggil<T>(body: FormData | Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const { data, error } = await sb.functions.invoke('laporan-order-rider', { body })
  if (error) {
    let pesan = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const j = await ctx.json()
        if (j?.error) pesan = j.error
      } catch { /* pakai pesan bawaan */ }
    }
    return { error: /not found|404/i.test(pesan) ? 'Fitur ini belum aktif di server. Hubungi admin.' : pesan }
  }
  return { data: data as T }
}

// ───────── Rider ─────────
export function LaporanOrderRider({ kode }: { kode: string }) {
  const [data, setData] = useState<Muat | null>(null)
  const [err, setErr] = useState('')
  const [tgl, setTgl] = useState(today())
  const [jumlah, setJumlah] = useState('')
  const [catatan, setCatatan] = useState('')
  const [tahan, setTahan] = useState<FotoLap[]>([]) // foto yang sudah tersimpan dan masih dipakai
  const [baru, setBaru] = useState<{ blob: Blob; url: string }[]>([]) // foto baru, diunggah saat Simpan
  const [sibuk, setSibuk] = useState(false)
  const [kecil, setKecil] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const pratinjau = useRef<string[]>([])

  const lepas = () => { pratinjau.current.forEach((u) => URL.revokeObjectURL(u)); pratinjau.current = [] }
  useEffect(() => lepas, [])

  const muat = async () => {
    const r = await panggil<Muat>({ aksi: 'ambil', kode })
    if (r.error) return setErr(r.error)
    setErr('')
    setData(r.data!)
  }
  useEffect(() => { muat() }, [kode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Isi formulir dari laporan tanggal yang dipilih (kosong bila belum ada)
  useEffect(() => {
    const l = data?.laporan.find((x) => x.tanggal === tgl)
    setJumlah(l ? String(l.jumlah_order) : '')
    setCatatan(l?.catatan ?? '')
    setTahan(l?.foto ?? [])
    lepas()
    setBaru([])
  }, [data, tgl])

  const sisa = MAKS_FOTO - tahan.length - baru.length
  async function pilih(files: FileList | null) {
    if (!files?.length) return
    if (files.length > sisa) toast(`Maksimal ${MAKS_FOTO} foto per hari.`)
    setKecil(true)
    const tambah: { blob: Blob; url: string }[] = []
    for (const f of [...files].slice(0, Math.max(sisa, 0))) {
      try {
        const blob = await kecilkan(f)
        const url = URL.createObjectURL(blob)
        pratinjau.current.push(url)
        tambah.push({ blob, url })
      } catch { toast('Foto tidak bisa diproses. Coba foto lain.') }
    }
    if (tambah.length) setBaru((b) => [...b, ...tambah])
    setKecil(false)
    if (input.current) input.current.value = ''
  }

  async function simpan() {
    const n = jumlah.trim() === '' ? NaN : Number(jumlah)
    if (!Number.isInteger(n) || n < 0 || n > 999) return toast('Isi jumlah order dengan angka 0 sampai 999.')
    if (n > 0 && tahan.length + baru.length === 0) return toast('Unggah minimal satu screenshot order sebagai bukti.')
    const fd = new FormData()
    fd.append('aksi', 'simpan')
    fd.append('kode', kode)
    fd.append('tanggal', tgl)
    fd.append('jumlah', String(n))
    fd.append('catatan', catatan)
    fd.append('simpan', JSON.stringify(tahan.map((p) => p.path)))
    baru.forEach((b, i) => fd.append('foto', b.blob, `ss-${i + 1}.jpg`))
    setSibuk(true)
    const r = await panggil<{ ok: boolean }>(fd)
    setSibuk(false)
    if (r.error) return toast(r.error)
    toast.ok('Laporan tersimpan')
    muat()
  }

  const tersimpan = data?.laporan.find((x) => x.tanggal === tgl)
  const daftarHari = Array.from({ length: HARI_MUNDUR + 1 }, (_, i) => addDays(today(), -i))
  return (
    <div className="space-y-4">
      <Err msg={err} />
      <div className="card !mb-0 space-y-3">
        <div className="flex items-center gap-2">
          <InputTanggal className="inp" value={tgl} min={addDays(today(), -HARI_MUNDUR)} max={today()} onChange={(e) => e.target.value && setTgl(e.target.value)} />
          <b className="text-sm">{hari(tgl)}</b>
        </div>
        <Field label="Jumlah order yang kamu bawa" hint="Isi 0 kalau hari itu tidak ada order.">
          <input className="inp w-full !text-lg" inputMode="numeric" placeholder="0" value={jumlah} onChange={(e) => setJumlah(e.target.value.replace(/\D/g, '').slice(0, 3))} />
        </Field>
        <Field label="Screenshot order" hint={`Wajib minimal satu bila ada order. ${tahan.length + baru.length}/${MAKS_FOTO} foto, dikecilkan otomatis sebelum diunggah.`}>
          <div className="flex flex-wrap items-center gap-2">
            {tahan.map((p) => (
              <span key={p.path} className="relative">
                {p.url ? <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt="Screenshot order" className="size-20 rounded-lg border border-border object-cover" /></a> : <span className="block size-20 animate-pulse rounded-lg bg-muted" />}
                <button type="button" aria-label="Hapus foto" onClick={() => setTahan((t) => t.filter((x) => x.path !== p.path))} className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-foreground text-background"><X size={13} /></button>
              </span>
            ))}
            {baru.map((b) => (
              <span key={b.url} className="relative">
                <img src={b.url} alt="Foto baru" className="size-20 rounded-lg border-2 border-primary object-cover" />
                <button type="button" aria-label="Hapus foto" onClick={() => { URL.revokeObjectURL(b.url); setBaru((x) => x.filter((y) => y.url !== b.url)) }} className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-foreground text-background"><X size={13} /></button>
              </span>
            ))}
            {sisa > 0 && (
              <button type="button" className="btn2 !h-20" disabled={kecil || sibuk} onClick={() => input.current?.click()}>
                <ImagePlus size={16} />{kecil ? 'Memproses…' : 'Tambah foto'}
              </button>
            )}
          </div>
          <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => pilih(e.target.files)} />
        </Field>
        <Field label="Catatan (opsional)">
          <input className="inp w-full" maxLength={500} placeholder="Contoh: banyak order batal, hujan deras" value={catatan} onChange={(e) => setCatatan(e.target.value)} />
        </Field>
        <button className="btn btn-lg w-full" disabled={sibuk || kecil || !data} onClick={simpan}>{sibuk ? 'Menyimpan…' : tersimpan ? 'Perbarui laporan' : 'Kirim laporan'}</button>
        {tersimpan && <p className="text-xs text-muted-foreground">Terakhir disimpan pukul {jam(tersimpan.diubah)}. Kamu masih bisa mengubahnya sampai {HARI_MUNDUR} hari ke belakang.</p>}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Riwayat {HARI_MUNDUR + 1} hari terakhir</h3>
        <ul className="space-y-2">
          {daftarHari.map((d) => {
            const l = data?.laporan.find((x) => x.tanggal === d)
            return (
              <li key={d}>
                <button type="button" onClick={() => setTgl(d)} className={`card !mb-0 !p-3 flex w-full items-center justify-between gap-3 text-left ${d === tgl ? '!border-primary' : ''}`}>
                  <span className="text-sm font-semibold">{hari(d)}{d === today() && <span className="badge ml-2 bg-primary-soft text-primary-soft-foreground">Hari ini</span>}</span>
                  {l ? <span className="badge bg-success-soft text-success">{l.jumlah_order} order · {l.foto.length} foto</span> : <span className="badge bg-warning-soft text-warning">Belum lapor</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

// ───────── Captain, Arcon, Super-admin ─────────
// Captain: DS-nya. Arcon: DS yang dipegang (dsList dari App). Super-admin: semua DS.
export function LaporanOrderMenu({ ds, dsList }: { ds: Ds | null; dsList?: Ds[] }) {
  const semua = useRows<Ds>(() => (ds || dsList ? Promise.resolve({ data: [], error: null }) : sb.from('ds').select('*').order('nama')), [ds?.id, dsList?.length])
  const daftar = ds ? [ds] : dsList ?? semua.rows
  const [id, setId] = useState('')
  const pilih = daftar.find((d) => d.id === (id || daftar[0]?.id))
  if (!ds && !pilih && !daftar.length) return <Kosong teks="Belum ada DS" hint="Laporan order muncul setelah ada DS yang Anda pegang." />
  return (
    <div>
      {!ds && <Select className="mb-3 w-72 max-w-full" value={pilih?.id ?? ''} onChange={setId} placeholder="Pilih DS" opsi={daftar.map((d) => ({ value: d.id, label: d.nama }))} />}
      {pilih && <LaporanOrderDs key={pilih.id} ds={pilih} />}
    </div>
  )
}

type Lihat = { rider_id: string; jumlah_order: number; catatan: string | null; foto: string[]; diubah: string }
function LaporanOrderDs({ ds }: { ds: Ds }) {
  const [tgl, setTgl] = useState(today())
  const [q, setQ] = useState('')
  const [saring, setSaring] = useState<'semua' | 'belum' | 'sudah'>('semua')
  const riders = useRows<{ id: string; nama: string; kode_mtr: string | null }>(() => sb.from('riders').select('id,nama,kode_mtr').eq('ds_id', ds.id).eq('status', 'aktif').eq('peran', 'rider').order('nama'), [ds.id])
  const jd = useRows<{ rider_id: string; shift: string }>(() => sb.from('jadwal').select('rider_id,shift').eq('ds_id', ds.id).eq('tanggal', tgl), [ds.id, tgl])
  const lap = useRows<Lihat>(() => sb.from('laporan_order').select('rider_id,jumlah_order,catatan,foto,diubah').eq('ds_id', ds.id).eq('tanggal', tgl), [ds.id, tgl])

  const shift = (id: string) => jd.rows.find((r) => r.rider_id === id && r.shift !== 'off')?.shift
  const laporan = (id: string) => lap.rows.find((l) => l.rider_id === id)
  // Yang diharapkan melapor: rider terjadwal hari itu. Rider tak terjadwal ikut tampil bila tetap melapor.
  const tampil = riders.rows.filter((r) => shift(r.id) || laporan(r.id))
  const terjadwal = tampil.filter((r) => shift(r.id))
  const sudah = terjadwal.filter((r) => laporan(r.id)).length
  const totalOrder = lap.rows.reduce((n, l) => n + l.jumlah_order, 0)
  const rows = tampil.filter((r) => (r.nama + (r.kode_mtr ?? '')).toLowerCase().includes(q.toLowerCase()) && (saring === 'semua' || (saring === 'sudah') === !!laporan(r.id)))
  const pg = usePage(rows, [q, saring, tgl, ds.id])

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <InputTanggal className="inp" value={tgl} max={today()} onChange={(e) => e.target.value && setTgl(e.target.value)} />
        <b>{hari(tgl)}</b>
        <input className="inp ml-auto" placeholder="cari rider / Kode MTR" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Err msg={riders.err || jd.err || lap.err} />
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="badge bg-primary-soft text-primary-soft-foreground">{sudah} dari {terjadwal.length} rider terjadwal sudah lapor</span>
        <span className="badge bg-muted text-muted-foreground">Total {totalOrder} order</span>
        <span className="ml-auto flex gap-2">
          {(['semua', 'belum', 'sudah'] as const).map((s) => (
            <button key={s} className={`tab !px-3 ${saring === s ? 'tab-on' : 'border border-border'}`} onClick={() => setSaring(s)}>{s === 'semua' ? 'Semua' : s === 'belum' ? 'Belum lapor' : 'Sudah lapor'}</button>
          ))}
        </span>
      </div>
      {!tampil.length ? (
        <div className="card"><Kosong teks="Tidak ada rider yang dijadwalkan di tanggal ini" hint="Susun jadwal di tab Jadwal, atau pilih tanggal lain." /></div>
      ) : (
        <div className="card !p-0 overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Rider</th><th>Shift</th><th>Status</th><th>Order</th><th>Screenshot</th><th>Catatan</th><th>Diinput</th></tr></thead>
            <tbody>
              {pg.rows.map((r) => {
                const l = laporan(r.id)
                return (
                  <tr key={r.id}>
                    <td><b>{r.nama}</b> <span className="text-xs text-muted-foreground">{r.kode_mtr}</span></td>
                    <td>{SHIFT[shift(r.id) ?? ''] ?? <span className="text-muted-foreground">Tidak terjadwal</span>}</td>
                    <td>{l ? <span className="badge bg-success-soft text-success">Sudah lapor</span> : <span className="badge bg-warning-soft text-warning">Belum lapor</span>}</td>
                    <td className="font-mono font-semibold">{l ? l.jumlah_order : '-'}</td>
                    <td>{l?.foto.length ? <FotoGaleri paths={l.foto} kecil bucket="order-ss" /> : <span className="text-xs text-muted-foreground">{l && l.jumlah_order === 0 ? 'Tanpa order' : '-'}</span>}</td>
                    <td className="text-xs">{l?.catatan ?? ''}</td>
                    <td className="text-xs">{l ? jam(l.diubah) : ''}</td>
                  </tr>
                )
              })}
              {!rows.length && <tr><td colSpan={7}><Kosong teks="Tidak ada rider yang cocok" /></td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3"><Pagination {...pg} /></div>
    </div>
  )
}
