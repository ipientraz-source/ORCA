// Dashboard Klien: angka, grafik, dan detail data untuk toko milik satu klien. Hanya membaca. Untuk saat ini dilihat Super-admin ("Lihat sebagai klien");
// fungsi database yang sama nanti dipakai login klien. Satu angka resmi per ukuran, dan tiap kartu menyebut sumbernya:
// "Data klien" = unggahan klien, "Data Dash" = clock-in BO yang dinilai ORCA. Hari tanpa unggahan tidak ditampilkan sebagai 0%.
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { sb, Select, Field, Err, Kosong, useRows, usePage, Pagination, toCsv, download, tanggal, toast } from './lib'
import {
  jumlah, jumlahBo, pct, perubahan, periodeSebelum, poin, rentangBawaan, teksAngka, teksDesimal, teksPct, trenFulfillment, trenKetepatan, trenMasuk,
  type Bo, type Hari, type Tren,
} from './dashboard-klien.ts'

type Klien = { id: string; nama: string; target_ketepatan: number | null }
type Rentang = { awal: string; akhir: string; hari: number }
type TokoDs = { id: string; nama: string; kode_toko: string | null }
type Toko = { ds_id: string; ds_nama: string; kode_toko: string | null; selesai: number; ontime: number; late: number; pod_sesuai: number; pod_tidak: number; rider_hari: number; hari: number }
type Preset = '7' | '30' | 'semua' | 'kustom'

const kosong = Promise.resolve({ data: [], error: null })

// Di akun klien kata "klien" menjadi "Anda", dan istilah internal Dash (BO, budget, rider-hari, nama menu admin) tidak muncul.
// Super-admin yang "melihat sebagai klien" tetap memakai istilah internal.
const Anda = createContext(false)
const useAnda = () => useContext(Anda)

// klienId diisi untuk akun klien: yang dilihat TETAP satu klien itu, tanpa pemilih klien dan tanpa kata-kata admin.
// Tanpa klienId (Super-admin) ada pemilih "Lihat sebagai klien". Pembatasan sebenarnya ada di database, bukan di sini.
export function DashboardKlien({ klienId }: { klienId?: string }) {
  const klien = useRows<Klien>(() => (klienId ? sb.from('klien').select('*').eq('id', klienId) : sb.from('klien').select('*').order('nama')), [klienId])
  const [id, setId] = useState('')
  const pilih = klien.rows.find((k) => k.id === (klienId || id || klien.rows[0]?.id))
  if (klien.err) return <Err msg={klien.err} />
  if (!pilih) return klienId ? <Kosong teks="Data belum tersedia" hint="Hubungi tim Dash bila ini tidak seharusnya kosong." /> : <Kosong teks="Belum ada klien" hint="Tambahkan klien dan unggah datanya di menu Data Klien." />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {!klienId && klien.rows.length > 1 && (
          <Field label="Lihat sebagai klien">
            <Select className="w-64 max-w-full" value={pilih.id} onChange={setId} opsi={klien.rows.map((k) => ({ value: k.id, label: k.nama }))} />
          </Field>
        )}
        <p className="pb-2 text-sm text-muted-foreground">
          {klienId ? <>Kinerja pengantaran <b>{pilih.nama}</b></> : <>Tampilan hanya baca untuk <b>{pilih.nama}</b>, hanya toko milik klien ini.</>}
        </p>
      </div>
      <Anda.Provider value={!!klienId}><Isi key={pilih.id} klien={pilih} /></Anda.Provider>
    </div>
  )
}

// Periode yang dipilih (7 hari, 30 hari, semua, atau tanggal sendiri) dihitung dari rentang data klien; dipakai Dashboard dan Detail Order
function usePeriode(klienId: string) {
  const rent = useRows<Rentang>(() => sb.rpc('dashboard_klien_rentang', { p_klien: klienId }), [klienId])
  const [preset, setPreset] = useState<Preset>('semua')
  const [kDari, setKDari] = useState('')
  const [kSampai, setKSampai] = useState('')
  const ada = rent.rows[0]
  const kustomSah = preset === 'kustom' && !!kDari && !!kSampai && kDari <= kSampai
  const [dari, sampai] = useMemo<[string, string]>(() => {
    if (!ada) return ['', '']
    if (preset === 'kustom') return kustomSah ? [kDari, kSampai] : ['', '']
    return rentangBawaan(ada.awal, ada.akhir, preset === '7' ? 7 : preset === '30' ? 30 : 0)
  }, [ada, preset, kustomSah, kDari, kSampai])
  return { rent, ada, preset, setPreset, kDari, setKDari, kSampai, setKSampai, kustomSah, dari, sampai }
}

function PilihPeriode({ p }: { p: ReturnType<typeof usePeriode> }) {
  return (
    <>
      <div role="tablist" aria-label="Periode" className="flex flex-wrap gap-2">
        {([['7', '7 hari data terakhir'], ['30', '30 hari data terakhir'], ['semua', 'Semua data'], ['kustom', 'Pilih tanggal']] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={p.preset === k} onClick={() => p.setPreset(k)} className={`tab !px-3 ${p.preset === k ? 'tab-on' : 'border border-border bg-card'}`}>{label}</button>
        ))}
      </div>
      {p.preset === 'kustom' && (
        <>
          <Field label="Dari"><input type="date" className="inp" value={p.kDari} min={p.ada?.awal} max={p.ada?.akhir} onChange={(e) => p.setKDari(e.target.value)} /></Field>
          <Field label="Sampai"><input type="date" className="inp" value={p.kSampai} min={p.ada?.awal} max={p.ada?.akhir} onChange={(e) => p.setKSampai(e.target.value)} /></Field>
        </>
      )}
    </>
  )
}

function Isi({ klien }: { klien: Klien }) {
  const anda = useAnda()
  const P = usePeriode(klien.id)
  const { rent, ada, preset, kustomSah, dari, sampai } = P
  const dsKlien = useRows<TokoDs>(() => sb.from('ds').select('id,nama,kode_toko').eq('klien_id', klien.id).order('nama'), [klien.id])
  const [toko, setToko] = useState('')
  const [pd, ps] = dari ? periodeSebelum(dari, sampai) : ['', '']

  const arg = (a: string, b: string) => ({ p_klien: klien.id, p_dari: a, p_sampai: b, p_ds: toko ? [toko] : null })
  const kini = useRows<Hari>(() => (dari ? sb.rpc('dashboard_klien_harian', arg(dari, sampai)) : kosong), [klien.id, dari, sampai, toko])
  const lalu = useRows<Hari>(() => (dari ? sb.rpc('dashboard_klien_harian', arg(pd, ps)) : kosong), [klien.id, pd, ps, toko])
  const perToko = useRows<Toko>(() => (dari ? sb.rpc('dashboard_klien_toko', arg(dari, sampai)) : kosong), [klien.id, dari, sampai, toko])
  const bo = useRows<Bo>(() => (dari ? sb.rpc('dashboard_klien_bo', arg(dari, sampai)) : kosong), [klien.id, dari, sampai, toko])

  const galat = rent.err || kini.err || perToko.err
  if (galat) return <Err msg={galat} />
  if (!rent.err && rent.rows.length === 0) return anda
    ? <Kosong teks="Belum ada data" hint="Unggah file kinerja harian Anda di menu Unggah Data, lalu angkanya muncul di sini." />
    : <Kosong teks="Belum ada data untuk klien ini" hint="Unggah file kinerja klien di menu Data Klien, lalu angkanya muncul di sini." />

  const a = jumlah(kini.rows), b = jumlah(lalu.rows)
  const kete = pct(a.ontime, a.selesai), keteLalu = pct(b.ontime, b.selesai)
  const pod = pct(a.podSesuai, a.selesai), podLalu = pct(b.podSesuai, b.selesai)
  const perRider = a.riderHari ? a.selesai / a.riderHari : null
  const perRiderLalu = b.riderHari ? b.selesai / b.riderHari : null
  const jb = jumlahBo(bo.rows)
  const fulf = pct(jb.terpenuhi, jb.kebutuhan), masuk = pct(jb.tepat, jb.hadir)
  const target = klien.target_ketepatan
  const adaBo = bo.rows.length > 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <PilihPeriode p={P} />
        <Field label="Toko">
          <Select className="w-64 max-w-full" value={toko} onChange={setToko} opsi={[{ value: '', label: `Semua toko (${dsKlien.rows.length})` }, ...dsKlien.rows.map((d) => ({ value: d.id, label: d.kode_toko ? `${d.nama} · ${d.kode_toko}` : d.nama }))]} />
        </Field>
      </div>
      {preset === 'kustom' && !kustomSah && <p className="text-sm text-warning">Pilih tanggal awal dan akhir (awal tidak boleh setelah akhir).</p>}
      {dari && ada && (
        <p className="text-xs text-muted-foreground">
          {anda ? 'Data terakhir' : 'Data klien terakhir'}: <b>{tanggal(ada.akhir)}</b> · {ada.hari} hari berdata · periode <b>{tanggal(dari)} – {tanggal(sampai)}</b>{lalu.rows.length ? `, dibandingkan dengan ${tanggal(pd)} – ${tanggal(ps)}` : ', belum ada data di periode sebelumnya untuk dibandingkan'}. Hari tanpa unggahan tidak ditampilkan sebagai 0%.
        </p>
      )}

      {a.hari === 0 && dari ? <Kosong teks="Tidak ada data di periode ini" hint="Pilih periode atau toko lain." /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Pesanan selesai" nilai={teksAngka(a.selesai)} sumber="klien" rumus="Jumlah pesanan yang selesai diantar"
              sub={<Delta v={perubahan(a.selesai, b.selesai)} satuan="%" />} />
            <Kpi label="Ketepatan antar" nilai={teksPct(kete)} sumber="klien" rumus="Ontime ÷ pesanan selesai"
              sub={<><Delta v={poin(kete, keteLalu)} satuan=" poin" />{target !== null && kete !== null && <span className={kete >= target ? 'text-success' : 'text-danger'}> · {kete >= target ? 'mencapai' : 'di bawah'} target {teksPct(target)}</span>}</>} />
            <Kpi label="Pesanan terlambat" nilai={teksAngka(a.late)} sumber="klien" rumus="Late; pesanan selesai yang melewati batas waktu"
              sub={<span>{teksPct(pct(a.late, a.selesai))} dari pesanan selesai</span>} />
            <Kpi label="POD sesuai" nilai={teksPct(pod)} sumber="klien" rumus="POD sesuai ÷ pesanan selesai"
              sub={<Delta v={poin(pod, podLalu)} satuan=" poin" />} />
            <Kpi label="Pesanan per rider per hari" nilai={teksDesimal(perRider)} sumber="klien" rumus={anda ? 'Pesanan selesai ÷ jumlah hari kerja rider (satu rider bekerja satu hari dihitung 1)' : 'Pesanan selesai ÷ jumlah rider-hari'}
              sub={<Delta v={poin(perRider, perRiderLalu)} satuan="" />} />
            <Kpi label="Fulfillment rider" nilai={adaBo ? teksPct(fulf) : '–'} sumber="dash" rumus={anda ? 'Rider yang bekerja ÷ kebutuhan rider per shift' : 'Rider yang bekerja ÷ budget rider (clock-in BO)'}
              sub={adaBo ? <span>{teksAngka(jb.terpenuhi)} dari {teksAngka(jb.kebutuhan)} {anda ? 'rider yang dibutuhkan' : 'slot rider'}</span> : <span>Belum ada data kehadiran di periode ini</span>} />
            <Kpi label="Tepat waktu masuk" nilai={adaBo ? teksPct(masuk) : '–'} sumber="dash" rumus={anda ? 'Rider yang masuk kerja tepat waktu ÷ rider yang hadir' : 'Rider yang clock-in tepat waktu ÷ rider hadir (clock-in BO)'}
              sub={adaBo ? <span>{teksAngka(jb.tepat)} dari {teksAngka(jb.hadir)} rider</span> : <span>Belum ada data kehadiran di periode ini</span>} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card lg:col-span-2">
              <b className="block">Tren harian: pesanan selesai dan ketepatan antar</b>
              <TrenHarian hari={kini.rows} target={target} />
            </div>
            <div className="card">
              <b className="mb-2 block">Komposisi pesanan</b>
              <Proporsi judul="Ketepatan antar" a={a.ontime} b={a.late} namaA="Ontime" namaB="Late" />
              <div className="h-3" />
              <Proporsi judul="Bukti serah terima (POD)" a={a.podSesuai} b={a.podTidak} namaA="Sesuai" namaB="Tidak sesuai" />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card">
              <div className="mb-1 flex items-center justify-between gap-2"><b>Toko dengan ketepatan antar terendah</b><Sumber s="klien" /></div>
              <Peringkat toko={perToko.rows} target={target} />
            </div>
            <div className="card">
              <div className="mb-1 flex items-center justify-between gap-2"><b>Kehadiran rider per hari</b><Sumber s="dash" /></div>
              {adaBo ? <KehadiranHarian bo={bo.rows} /> : <p className="py-6 text-sm text-muted-foreground">{anda ? 'Belum ada data kehadiran rider untuk toko dan periode ini.' : 'Belum ada data clock-in BO untuk toko dan periode ini.'}</p>}
            </div>
          </div>

          <TabelToko toko={perToko.rows} target={target} klien={klien.nama} />
        </>
      )}
    </div>
  )
}

// ───────── detail order ─────────
// Baris order yang diunggah klien: per rider per hari (kode mitra; nama rider tidak pernah disimpan) atau ringkasan per hari per toko.
// Dimuat per halaman dari database (setahun bisa puluhan ribu baris); unduhan CSV mengambil halaman demi halaman sampai MAKS_UNDUH baris.
type BarisDetail = {
  tanggal: string; ds_id: string; ds_nama: string; kode_toko: string | null; selesai: number; ontime: number; late: number; pod_sesuai: number; pod_tidak: number; total: number
  kode_mtr?: string // mode rider
  rider?: number // mode hari: jumlah rider yang bekerja
}
const MAKS_UNDUH = 10000

export function DetailOrder({ klienId }: { klienId?: string }) {
  const klien = useRows<Klien>(() => (klienId ? sb.from('klien').select('*').eq('id', klienId) : sb.from('klien').select('*').order('nama')), [klienId])
  const [id, setId] = useState('')
  const pilih = klien.rows.find((k) => k.id === (klienId || id || klien.rows[0]?.id))
  if (klien.err) return <Err msg={klien.err} />
  if (!pilih) return klienId ? <Kosong teks="Data belum tersedia" hint="Hubungi tim Dash bila ini tidak seharusnya kosong." /> : <Kosong teks="Belum ada klien" hint="Tambahkan klien dan unggah datanya di menu Data Klien." />
  return (
    <div className="space-y-4">
      {!klienId && klien.rows.length > 1 && (
        <Field label="Lihat sebagai klien">
          <Select className="w-64 max-w-full" value={pilih.id} onChange={setId} opsi={klien.rows.map((k) => ({ value: k.id, label: k.nama }))} />
        </Field>
      )}
      <Anda.Provider value={!!klienId}><DetailIsi key={pilih.id} klien={pilih} /></Anda.Provider>
    </div>
  )
}

function DetailIsi({ klien }: { klien: Klien }) {
  const anda = useAnda()
  const P = usePeriode(klien.id)
  const { rent, dari, sampai, preset, kustomSah } = P
  const dsKlien = useRows<TokoDs>(() => sb.from('ds').select('id,nama,kode_toko').eq('klien_id', klien.id).order('nama'), [klien.id])
  const [toko, setToko] = useState('')
  const [mode, setMode] = useState<'rider' | 'hari'>('rider')
  const [cari, setCari] = useState('')
  const [cariPakai, setCariPakai] = useState('')
  const [ukuran, setUkuran] = useState(50)
  const [mengunduh, setMengunduh] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setCariPakai(cari.trim()), 350)
    return () => clearTimeout(t)
  }, [cari])
  // Ganti penyaring = kembali ke halaman 1, tanpa efek tambahan (halaman tersimpan bersama kunci penyaringnya)
  const kunci = [klien.id, dari, sampai, toko, mode, cariPakai, ukuran].join('|')
  const [h, setH] = useState({ kunci, hal: 0 })
  const hal = h.kunci === kunci ? h.hal : 0
  const panggil = (limit: number, offset: number) => {
    const arg = { p_klien: klien.id, p_dari: dari, p_sampai: sampai, p_ds: toko ? [toko] : null, p_limit: limit, p_offset: offset }
    return mode === 'rider' ? sb.rpc('dashboard_klien_detail_rider', { ...arg, p_cari: cariPakai || null }) : sb.rpc('dashboard_klien_detail_hari', arg)
  }
  const baris = useRows<BarisDetail>(() => (dari ? panggil(ukuran, hal * ukuran) : kosong), [kunci, hal])
  const total = Number(baris.rows[0]?.total ?? 0)
  const halaman = Math.max(1, Math.ceil(total / ukuran))

  async function unduh() {
    setMengunduh(true)
    try {
      const semua: BarisDetail[] = []
      for (let off = 0; off < Math.min(total, MAKS_UNDUH); off += 200) {
        const { data, error } = await panggil(200, off)
        if (error) return toast(error.message)
        semua.push(...((data ?? []) as BarisDetail[]))
      }
      download(`detail-order-${klien.nama}-${dari}-${sampai}.csv`, toCsv(semua.map((r) => ({
        Tanggal: r.tanggal, Toko: r.ds_nama, 'Kode toko': r.kode_toko ?? '', ...(mode === 'rider' ? { 'Kode mitra': r.kode_mtr ?? '' } : { 'Jumlah rider': r.rider ?? '' }),
        'Pesanan selesai': r.selesai, Ontime: r.ontime, Late: r.late, 'Ketepatan antar (%)': r.selesai ? ((r.ontime * 100) / r.selesai).toFixed(1) : '',
        'POD sesuai': r.pod_sesuai, 'POD tidak sesuai': r.pod_tidak,
      }))))
      if (total > MAKS_UNDUH) toast(`Unduhan dibatasi ${teksAngka(MAKS_UNDUH)} baris pertama dari ${teksAngka(total)}. Persempit periode atau toko untuk sisanya.`)
    } finally {
      setMengunduh(false)
    }
  }

  if (rent.err) return <Err msg={rent.err} />
  if (!rent.err && rent.rows.length === 0) return anda
    ? <Kosong teks="Belum ada data" hint="Unggah file kinerja harian Anda di menu Unggah Data, lalu detailnya muncul di sini." />
    : <Kosong teks="Belum ada data untuk klien ini" hint="Unggah file kinerja klien di menu Data Klien, lalu detailnya muncul di sini." />
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <PilihPeriode p={P} />
        <Field label="Toko">
          <Select className="w-64 max-w-full" value={toko} onChange={setToko} opsi={[{ value: '', label: `Semua toko (${dsKlien.rows.length})` }, ...dsKlien.rows.map((d) => ({ value: d.id, label: d.kode_toko ? `${d.nama} · ${d.kode_toko}` : d.nama }))]} />
        </Field>
        {mode === 'rider' && <Field label="Cari kode mitra"><input className="inp w-44" value={cari} onChange={(e) => setCari(e.target.value)} placeholder="mis. MTR9000" /></Field>}
      </div>
      {preset === 'kustom' && !kustomSah && <p className="text-sm text-warning">Pilih tanggal awal dan akhir (awal tidak boleh setelah akhir).</p>}

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="tablist" aria-label="Bentuk detail" className="flex gap-2">
            {([['rider', 'Per rider per hari'], ['hari', 'Per hari per toko']] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={`tab !px-3 ${mode === k ? 'tab-on' : 'border border-border bg-card'}`}>{label}</button>
            ))}
          </div>
          <div className="flex items-center gap-2"><Sumber s="klien" /><button className="btn2" disabled={!total || mengunduh} onClick={unduh}><Download size={14} />{mengunduh ? 'Menyiapkan…' : 'Unduh CSV'}</button></div>
        </div>

        {baris.err ? <Err msg={baris.err} /> : !baris.rows.length ? <Kosong teks="Tidak ada baris yang cocok" hint="Ubah periode, toko, atau kata pencarian." /> : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="tbl">
              <thead><tr><th>Tanggal</th><th>Toko</th><th>{mode === 'rider' ? 'Kode mitra' : 'Jumlah rider'}</th><th>Pesanan</th><th>Ontime</th><th>Late</th><th>Ketepatan</th><th>POD sesuai</th><th>POD tidak</th></tr></thead>
              <tbody>
                {baris.rows.map((r) => (
                  <tr key={`${r.tanggal}|${r.ds_id}|${r.kode_mtr ?? ''}`}>
                    <td className="whitespace-nowrap">{tanggal(r.tanggal)}</td>
                    <td>{r.ds_nama}{r.kode_toko && <span className="ml-2 font-mono text-[11px] text-muted-foreground">{r.kode_toko}</span>}</td>
                    <td className="font-mono text-xs">{mode === 'rider' ? r.kode_mtr : r.rider}</td>
                    <td>{teksAngka(Number(r.selesai))}</td>
                    <td>{teksAngka(Number(r.ontime))}</td>
                    <td className={Number(r.late) > 0 ? 'text-danger' : ''}>{teksAngka(Number(r.late))}</td>
                    <td>{teksPct(pct(Number(r.ontime), Number(r.selesai)))}</td>
                    <td>{teksAngka(Number(r.pod_sesuai))}</td>
                    <td>{teksAngka(Number(r.pod_tidak))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">{total ? `${teksAngka(hal * ukuran + 1)}–${teksAngka(Math.min((hal + 1) * ukuran, total))} dari ${teksAngka(total)} baris` : 'Tidak ada baris'}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Select className="w-28" lebarMin={120} value={String(ukuran)} onChange={(v) => setUkuran(Number(v))} opsi={[25, 50, 100, 200].map((n) => ({ value: String(n), label: `${n} baris` }))} />
            <button className="btn2" disabled={hal === 0} onClick={() => setH({ kunci, hal: hal - 1 })}>Sebelumnya</button>
            <span className="text-muted-foreground">Hal {teksAngka(hal + 1)} / {teksAngka(halaman)}</span>
            <button className="btn2" disabled={hal + 1 >= halaman} onClick={() => setH({ kunci, hal: hal + 1 })}>Berikutnya</button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Data persis seperti yang {anda ? 'Anda' : 'diunggah klien'} unggah. Nama rider tidak disimpan, hanya kode mitra. Urutan: tanggal terbaru lebih dulu.</p>
      </div>
    </div>
  )
}

// ───────── bagian kecil ─────────
function Sumber({ s }: { s: 'klien' | 'dash' }) {
  const anda = useAnda()
  const judul = s === 'klien' ? (anda ? 'Dari file yang Anda unggah' : 'Dari file yang diunggah klien') : anda ? 'Dari catatan kehadiran rider yang dicatat Dash' : 'Dari clock-in BO, dinilai ORCA'
  return (
    <span className={`badge shrink-0 ${s === 'klien' ? 'bg-primary-soft text-primary' : 'bg-muted text-muted-foreground'}`} title={judul}>
      {s === 'klien' ? (anda ? 'Data Anda' : 'Data klien') : 'Data Dash'}
    </span>
  )
}

function Kpi({ label, nilai, sub, sumber, rumus }: { label: string; nilai: string; sub: React.ReactNode; sumber: 'klien' | 'dash'; rumus: string }) {
  return (
    <div className="card" title={rumus}>
      <div className="flex items-center justify-between gap-2"><span className="text-sm text-muted-foreground">{label}</span><Sumber s={sumber} /></div>
      <div className="mt-1 text-3xl font-bold leading-tight">{nilai}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
      <div className="mt-1 text-[11px] text-muted-foreground/80">{rumus}</div>
    </div>
  )
}

function Delta({ v, satuan }: { v: number | null; satuan: string }) {
  if (v === null) return <span>belum ada pembanding</span>
  const naik = v > 0, nol = Math.abs(v) < 0.05
  return <span className={nol ? '' : naik ? 'text-success' : 'text-danger'}>{nol ? '≈ sama' : `${naik ? '▲' : '▼'} ${Math.abs(v).toFixed(1).replace('.', ',')}${satuan}`} dibanding periode sebelumnya</span>
}

// Garis di atas deret hari yang sama dengan batang: koordinat 0–100 diregangkan ke kotak, tebal garis tetap (non-scaling-stroke) supaya tidak melar.
function Garis({ n, seri, lo, hi }: { n: number; seri: { kelas: string; nilai: (number | null)[]; putus?: boolean }[]; lo: number; hi: number }) {
  const y = (v: number) => 100 - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * 100
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {seri.map((s, si) => {
        const ruas: [number, number][][] = []
        let cur: [number, number][] = []
        s.nilai.forEach((v, i) => {
          if (v === null) { if (cur.length) ruas.push(cur); cur = []; return }
          cur.push([((i + 0.5) / n) * 100, y(v)])
        })
        if (cur.length) ruas.push(cur)
        return ruas.map((r, ri) => (
          <polyline key={`${si}-${ri}`} points={(r.length === 1 ? [r[0], [r[0][0] + 0.6, r[0][1]]] : r).map((p) => p.join(',')).join(' ')}
            className={`fill-none ${s.kelas}`} strokeWidth={s.putus ? 1.5 : 2.5} strokeDasharray={s.putus ? '5 4' : undefined} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        ))
      })}
    </svg>
  )
}

function SumbuTanggal({ tgl }: { tgl: string[] }) {
  if (!tgl.length) return null
  const tengah = tgl[Math.floor((tgl.length - 1) / 2)]
  return (
    <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
      <span>{tanggal(tgl[0])}</span>{tgl.length > 2 && <span>{tanggal(tengah)}</span>}{tgl.length > 1 && <span>{tanggal(tgl[tgl.length - 1])}</span>}
    </div>
  )
}

function TrenHarian({ hari, target }: { hari: Hari[]; target: number | null }) {
  const tren = trenKetepatan(hari)
  const nilai = tren.map((t) => t.nilai).filter((v): v is number => v !== null)
  const lo = Math.max(0, Math.floor(Math.min(...nilai, target ?? 100) - 3)), hi = 100
  const maks = Math.max(...hari.map((h) => Number(h.selesai)), 1)
  return (
    <div className="mt-3">
      <div className="relative h-52" role="img" aria-label={`Grafik harian: batang pesanan selesai, garis ketepatan antar, ${hari.length} hari`}>
        <div className="absolute inset-0 flex items-end gap-px">
          {hari.map((h) => (
            <div key={h.tanggal} className="group relative flex h-full flex-1 items-end" title={`${tanggal(h.tanggal)}: ${teksAngka(Number(h.selesai))} pesanan, ketepatan ${teksPct(pct(Number(h.ontime), Number(h.selesai)))}`}>
              <div className="w-full rounded-t bg-primary/25 group-hover:bg-primary/40" style={{ height: `${(Number(h.selesai) / maks) * 92}%` }} />
            </div>
          ))}
        </div>
        <Garis n={hari.length} lo={lo} hi={hi} seri={[
          ...(target !== null ? [{ kelas: 'stroke-warning', nilai: hari.map(() => target), putus: true }] : []),
          { kelas: 'stroke-primary', nilai: tren.map((t) => t.nilai) },
        ]} />
        <span className="absolute left-1 top-0 rounded bg-card/80 px-1 text-[10px] text-muted-foreground">{hi}%</span>
        <span className="absolute bottom-0 left-1 rounded bg-card/80 px-1 text-[10px] text-muted-foreground">{lo}%</span>
      </div>
      <SumbuTanggal tgl={hari.map((h) => h.tanggal)} />
      <p className="mt-1 text-[11px] text-muted-foreground">Batang: pesanan selesai (tinggi mengikuti hari tersibuk, {teksAngka(maks)}). Garis ungu: ketepatan antar, skala {lo}–{hi}%.{target !== null && ` Garis putus: target ${teksPct(target)}.`}</p>
    </div>
  )
}

function Proporsi({ judul, a, b, namaA, namaB }: { judul: string; a: number; b: number; namaA: string; namaB: string }) {
  const pa = pct(a, a + b)
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm"><span>{judul}</span><b>{teksPct(pa)}</b></div>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${judul}: ${namaA} ${teksPct(pa)}`}>
        <div className="bg-success" style={{ width: `${pa ?? 0}%` }} />
        <div className="flex-1 bg-danger/70" />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground"><span>{namaA} {teksAngka(a)}</span><span>{namaB} {teksAngka(b)}</span></div>
    </div>
  )
}

function Peringkat({ toko, target }: { toko: Toko[]; target: number | null }) {
  const baris = toko.map((t) => ({ ...t, kete: pct(Number(t.ontime), Number(t.selesai)) })).filter((t) => t.kete !== null).sort((x, y) => (x.kete as number) - (y.kete as number)).slice(0, 8)
  if (!baris.length) return <p className="py-6 text-sm text-muted-foreground">Belum ada data toko.</p>
  const lo = Math.max(0, Math.floor(Math.min(...baris.map((t) => t.kete as number)) - 5))
  return (
    <ul className="mt-2 space-y-2">
      {baris.map((t) => {
        const k = t.kete as number
        const bawah = target !== null && k < target
        return (
          <li key={t.ds_id} className="text-sm" title={`${t.ds_nama}: ${teksAngka(Number(t.selesai))} pesanan`}>
            <div className="flex justify-between gap-2"><span className="truncate">{t.ds_nama}</span><b className={bawah ? 'text-danger' : ''}>{teksPct(k)}</b></div>
            <div className="h-2 rounded-full bg-muted"><div className={`h-2 rounded-full ${bawah ? 'bg-danger' : 'bg-success'}`} style={{ width: `${Math.max(((k - lo) / (100 - lo)) * 100, 3)}%` }} /></div>
          </li>
        )
      })}
      <li className="text-[11px] text-muted-foreground">Skala batang {lo}–100%{target !== null && `; merah = di bawah target ${teksPct(target)}`}.</li>
    </ul>
  )
}

function KehadiranHarian({ bo }: { bo: Bo[] }) {
  const f: Tren[] = trenFulfillment(bo), m: Tren[] = trenMasuk(bo)
  const semua = [...f, ...m].map((t) => t.nilai).filter((v): v is number => v !== null)
  const lo = Math.max(0, Math.floor(Math.min(...semua, 100) - 5))
  return (
    <div className="mt-3">
      <div className="relative h-40" role="img" aria-label="Grafik harian fulfillment rider dan tepat waktu masuk">
        <Garis n={bo.length} lo={lo} hi={100} seri={[{ kelas: 'stroke-primary', nilai: f.map((t) => t.nilai) }, { kelas: 'stroke-success', nilai: m.map((t) => t.nilai) }]} />
        <span className="absolute left-1 top-0 rounded bg-card/80 px-1 text-[10px] text-muted-foreground">100%</span>
        <span className="absolute bottom-0 left-1 rounded bg-card/80 px-1 text-[10px] text-muted-foreground">{lo}%</span>
      </div>
      <SumbuTanggal tgl={bo.map((b) => b.tanggal)} />
      <p className="mt-1 text-[11px] text-muted-foreground"><span className="text-primary">━</span> Fulfillment rider · <span className="text-success">━</span> Tepat waktu masuk. Skala {lo}–100%.</p>
    </div>
  )
}

type Urut = 'ds_nama' | 'selesai' | 'kete' | 'late' | 'pod' | 'rider_hari' | 'per_rider'
function TabelToko({ toko, target, klien }: { toko: Toko[]; target: number | null; klien: string }) {
  const anda = useAnda()
  const kolomRider = anda ? 'Hari kerja rider' : 'Rider-hari'
  const [urut, setUrut] = useState<Urut>('selesai')
  const [naik, setNaik] = useState(false)
  const baris = useMemo(() => toko.map((t) => ({
    ...t, kete: pct(Number(t.ontime), Number(t.selesai)), pod: pct(Number(t.pod_sesuai), Number(t.selesai)), per_rider: Number(t.rider_hari) ? Number(t.selesai) / Number(t.rider_hari) : null,
  })), [toko])
  const terurut = useMemo(() => [...baris].sort((x, y) => {
    const a = x[urut], c = y[urut]
    const d = typeof a === 'string' || typeof c === 'string' ? String(a ?? '').localeCompare(String(c ?? '')) : (Number(a ?? -1) - Number(c ?? -1))
    return naik ? d : -d
  }), [baris, urut, naik])
  const pg = usePage(terurut, [urut, naik, toko.length])
  const Th = ({ k, children }: { k: Urut; children: string }) => (
    <th><button className="inline-flex items-center gap-1 font-semibold" onClick={() => { if (k === urut) setNaik(!naik); else { setUrut(k); setNaik(k === 'ds_nama') } }} aria-label={`Urutkan menurut ${children}`}>{children}{urut === k && <span aria-hidden>{naik ? '▲' : '▼'}</span>}</button></th>
  )
  const unduh = () => download(`kinerja-toko-${klien}.csv`, toCsv(terurut.map((t) => ({
    Toko: t.ds_nama, 'Kode toko': t.kode_toko ?? '', 'Pesanan selesai': t.selesai, 'Ketepatan antar (%)': t.kete === null ? '' : t.kete.toFixed(1), Late: t.late,
    'POD sesuai (%)': t.pod === null ? '' : t.pod.toFixed(1), [kolomRider]: t.rider_hari, 'Pesanan per rider per hari': t.per_rider === null ? '' : t.per_rider.toFixed(1),
  }))))
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><b>Kinerja per toko</b><div className="flex items-center gap-2"><Sumber s="klien" /><button className="btn2" onClick={unduh}><Download size={14} />Unduh CSV</button></div></div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="tbl">
          <thead><tr><Th k="ds_nama">Toko</Th><Th k="selesai">Pesanan</Th><Th k="kete">Ketepatan antar</Th><Th k="late">Late</Th><Th k="pod">POD sesuai</Th><Th k="rider_hari">{kolomRider}</Th><Th k="per_rider">Per rider/hari</Th></tr></thead>
          <tbody>
            {pg.rows.map((t) => (
              <tr key={t.ds_id}>
                <td>{t.ds_nama}{t.kode_toko && <span className="ml-2 font-mono text-[11px] text-muted-foreground">{t.kode_toko}</span>}</td>
                <td>{teksAngka(Number(t.selesai))}</td>
                <td className={target !== null && t.kete !== null && t.kete < target ? 'font-semibold text-danger' : ''}>{teksPct(t.kete)}</td>
                <td>{teksAngka(Number(t.late))}</td>
                <td>{teksPct(t.pod)}</td>
                <td>{teksAngka(Number(t.rider_hari))}</td>
                <td>{teksDesimal(t.per_rider)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination {...pg} />
    </div>
  )
}
