// Menu Laporan WhatsApp (Super-admin): daftar pesan terjadwal di kiri, pengaturan pesan yang dipilih di kanan.
// Tiap pesan punya isi (jenis), shift, jam, hari atau tanggal bulanan, cakupan DS, dan grup tujuannya sendiri.
// Disimpan di tabel pesan_wa; saklar utama di pengaturan_wa. Pengiriman dilakukan fungsi kirim-laporan (cron tiap 5 menit, sesi 'auto'); riwayat dari log_wa.
import { useEffect, useMemo, useState } from 'react'
import { sb, useRows, ok, toast, konfirmasi, Err, Field, Kosong, Select, usePage, Pagination } from './lib'

const FORMAT_GRUP = /^\d+(-\d+)?@g\.us$/
const JENIS = [
  { value: 'fulfillment_shift', label: 'Fulfillment rate per shift', perShift: true, ket: 'Terpenuhi dari kebutuhan rider di satu shift, per DS (✅ penuh, ⚠️ belum), yang bermasalah di atas.' },
  { value: 'fulfillment_hari', label: 'Fulfillment seharian (pagi + Middle + siang)', perShift: false, ket: 'Proses fulfillment satu hari penuh: total dan rincian pagi, Middle, siang per DS.' },
  { value: 'pengingat_captain', label: 'Pengingat captain yang belum mengisi absensi', perShift: true, ket: 'Daftar DS dan jumlah rider yang absensinya belum diisi captain di shift itu.' },
  { value: 'budget', label: 'Budget (kebutuhan rider per shift)', perShift: false, ket: 'Kebutuhan rider per shift untuk tiap DS hari ini. Wajib memilih grup.' },
  { value: 'ringkasan_mingguan', label: 'Ringkasan mingguan (budget, fulfillment, rider baru, churn)', perShift: false, ket: 'Minggu Senin–Minggu yang baru lewat, dibanding minggu sebelumnya, dengan tanda ▲▼. Biasanya dikirim hari Senin.' },
  { value: 'ringkasan_bulanan', label: 'Ringkasan bulanan (budget, fulfillment, rider baru, churn)', perShift: false, ket: 'Bulan yang baru lewat, dibanding bulan sebelumnya, dengan tanda ▲▼. Dikirim pada tanggal yang dipilih tiap bulan.' },
]
const SHIFT = [{ value: 'pagi', label: 'Pagi' }, { value: 'tengah', label: 'Middle' }, { value: 'siang', label: 'Siang' }]
const HARI = [[1, 'Sen'], [2, 'Sel'], [3, 'Rab'], [4, 'Kam'], [5, 'Jum'], [6, 'Sab'], [7, 'Min']] as const
const SEMUA_HARI = [1, 2, 3, 4, 5, 6, 7]
const TANGGAL = Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `Tanggal ${i + 1}` }))
const CAKUPAN = [{ value: 'semua', label: 'Semua DS' }, { value: 'arcon', label: 'DS milik Arcon tertentu' }, { value: 'ds', label: 'DS tertentu' }]
const SESI: Record<string, string> = {
  ingat_pagi: 'Pengingat pagi', laporan_pagi: 'Laporan pagi', ingat_tengah: 'Pengingat Middle', laporan_tengah: 'Laporan Middle',
  ingat_siang: 'Pengingat siang', laporan_siang: 'Laporan siang', laporan_hari: 'Fulfillment seharian', budget: 'Budget',
  ringkasan_mingguan: 'Ringkasan mingguan', ringkasan_bulanan: 'Ringkasan bulanan',
}
const wib = (iso: string) => new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

type Pesan = { id: string; nama: string; jenis: string; shift: string | null; jam: string; hari: number[]; tanggal_bulan: number | null; cakupan: string; cakupan_ids: string[]; grup: string[]; aktif: boolean; diubah: string }
type Grup = { id: string; nama: string }
type Log = { tanggal: string; sesi: string; status: string; waktu: string; respons: string | null; pesan_id: string | null }
type Ds = { id: string; nama: string }

const ringkasHari = (h: number[]) => (h.length === 7 ? 'Tiap hari' : HARI.filter(([n]) => h.includes(n)).map(([, x]) => x).join(' '))
const jadwalTeks = (m: Pesan) => (m.jenis === 'ringkasan_bulanan' ? `Tanggal ${m.tanggal_bulan} tiap bulan` : ringkasHari(m.hari))

export function PengaturanWa() {
  const p = useRows<{ aktif: boolean; diubah: string }>(() => sb.from('pengaturan_wa').select('aktif,diubah').eq('id', 1), [])
  const pw = useRows<Pesan>(() => sb.from('pesan_wa').select('*').order('jam').order('nama'), [])
  const dsl = useRows<Ds>(() => sb.from('ds').select('id,nama').order('nama'), [])
  const arl = useRows<Ds>(() => sb.from('riders').select('id,nama').eq('peran', 'arcon').eq('status', 'aktif').order('nama'), [])
  const lg = useRows<Log>(() => sb.from('log_wa').select('tanggal,sesi,status,waktu,respons,pesan_id').order('waktu', { ascending: false }).limit(600), [])
  const [grupOpsi, setGrupOpsi] = useState<Grup[]>([])
  const [ketGrup, setKetGrup] = useState('')
  const [muatGrup, setMuatGrup] = useState(false)
  const [pilih, setPilih] = useState<string | null>(null)

  const ambilGrup = async () => {
    setMuatGrup(true)
    setKetGrup('')
    const { data, error } = await sb.functions.invoke('kirim-laporan', { body: { aksi: 'daftar_grup' } })
    setMuatGrup(false)
    const g = (data?.grup ?? []) as Grup[]
    setGrupOpsi(g)
    setKetGrup(error ? 'Daftar grup belum bisa diambil. Isi ID grup secara manual.' : g.length ? '' : (data?.keterangan ?? 'Tidak ada grup ditemukan. Isi ID grup secara manual.'))
  }
  useEffect(() => { void ambilGrup() }, [])

  const saklar = p.rows[0]
  const ubahSaklar = async (aktif: boolean) => {
    if (await ok(sb.from('pengaturan_wa').update({ aktif, diubah: new Date().toISOString() }).eq('id', 1))) p.reload()
  }
  const tambah = async () => {
    const { data, error } = await sb.from('pesan_wa').insert({ nama: 'Pesan baru', jenis: 'fulfillment_shift', shift: 'pagi', jam: '09:00', aktif: false }).select('id').single()
    if (error) return toast(error.message)
    toast.ok('Pesan ditambahkan. Atur isinya di kanan, lalu hidupkan.')
    pw.reload()
    setPilih(data?.id ?? null)
  }

  const namaPesan = useMemo(() => new Map(pw.rows.map((x) => [x.id, x.nama])), [pw.rows])
  const namaGrup = (id: string) => grupOpsi.find((g) => g.id === id)?.nama || id
  const terpilih = pw.rows.find((x) => x.id === pilih)
  // Satu baris per kali kirim (pesan + tanggal + hasil), bukan satu baris per DS
  const riwayat = useMemo(() => {
    const m = new Map<string, { nama: string; tanggal: string; status: string; waktu: string; n: number; respons: string | null }>()
    for (const r of lg.rows) {
      const k = `${r.pesan_id ?? r.sesi}|${r.tanggal}|${r.status}`
      const x = m.get(k)
      if (x) x.n++
      else m.set(k, { nama: (r.pesan_id && namaPesan.get(r.pesan_id)) || SESI[r.sesi] || r.sesi, tanggal: r.tanggal, status: r.status, waktu: r.waktu, n: 1, respons: r.respons })
    }
    return [...m.values()].sort((a, b) => b.waktu.localeCompare(a.waktu))
  }, [lg.rows, namaPesan])
  const pg = usePage(riwayat, [])
  const muatUlang = () => { pw.reload(); lg.reload() }

  return (
    <div className="w-full space-y-4">
      <Err msg={p.err || pw.err || lg.err} />
      <div className="card !mb-0 flex flex-wrap items-center gap-4">
        <label className="flex flex-1 items-center gap-3 min-w-64">
          <input type="checkbox" className="size-5" checked={saklar?.aktif ?? true} disabled={!saklar} onChange={(e) => ubahSaklar(e.target.checked)} />
          <span>
            <b className="block">Pengiriman otomatis</b>
            <span className="text-xs text-muted-foreground">Mati = tidak ada pesan terjadwal yang dikirim, semuanya sekaligus. Tombol "Kirim sekarang" tetap bisa dipakai.</span>
          </span>
        </label>
        <button className="btn" onClick={tambah}>+ Tambah pesan</button>
      </div>
      {ketGrup && <p className="text-xs text-muted-foreground">{ketGrup}</p>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="space-y-3">
          {!pw.rows.length ? (
            <div className="card !mb-0"><Kosong teks="Belum ada pesan terjadwal" hint='Klik "Tambah pesan" untuk membuat yang pertama.' /></div>
          ) : (
            pw.rows.map((m) => (
              <BarisPesan key={m.id} m={m} terpilih={m.id === pilih} namaGrup={namaGrup} onPilih={() => setPilih(m.id === pilih ? null : m.id)} reload={muatUlang} />
            ))
          )}
        </div>
        <div className="lg:sticky lg:top-20">
          {terpilih ? (
            <EditorPesan key={terpilih.id} m={terpilih} dsl={dsl.rows} arl={arl.rows} grupOpsi={grupOpsi} muatGrup={muatGrup} onUlang={ambilGrup} namaGrup={namaGrup} reload={muatUlang} tutup={() => setPilih(null)} />
          ) : (
            <div className="card !mb-0"><Kosong teks="Pilih pesan di kiri" hint='Klik "Atur" pada salah satu pesan untuk mengubah isi, jam, cakupan, dan grup tujuannya di sini.' /></div>
          )}
        </div>
      </div>

      <div className="card !mb-0">
        <b className="block mb-1">Riwayat pengiriman</b>
        <p className="text-xs text-muted-foreground mb-3">Satu baris per pesan per tanggal. "DS" = berapa DS yang tercakup dalam pesan itu.</p>
        {!riwayat.length ? (
          <Kosong teks="Belum ada pengiriman" hint="Riwayat muncul setelah pesan pertama dikirim." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="tbl w-full text-sm">
                <thead><tr><th>Waktu (WIB)</th><th>Pesan</th><th>Tanggal laporan</th><th>Hasil</th><th>DS</th></tr></thead>
                <tbody>
                  {pg.rows.map((r) => (
                    <tr key={`${r.nama}|${r.tanggal}|${r.status}|${r.waktu}`}>
                      <td className="whitespace-nowrap">{wib(r.waktu)}</td>
                      <td>{r.nama}</td>
                      <td className="whitespace-nowrap">{r.tanggal}</td>
                      <td>
                        <span className={`badge ${r.status === 'terkirim' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>{r.status}</span>
                        {r.status === 'gagal' && r.respons && <div className="text-xs text-muted-foreground mt-1 max-w-xs break-words">{r.respons}</div>}
                      </td>
                      <td>{r.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3"><Pagination {...pg} /></div>
          </>
        )}
      </div>
    </div>
  )
}

// Satu baris ringkas di daftar kiri: saklar hidup/mati, nama, ringkasan jadwal, dan tombol Atur
function BarisPesan({ m, terpilih, namaGrup, onPilih, reload }: { m: Pesan; terpilih: boolean; namaGrup: (id: string) => string; onPilih: () => void; reload: () => void }) {
  const hidup = async (aktif: boolean) => { if (await ok(sb.from('pesan_wa').update({ aktif, diubah: new Date().toISOString() }).eq('id', m.id))) reload() }
  const ringkas = [JENIS.find((j) => j.value === m.jenis)?.label, m.shift ? SHIFT.find((s) => s.value === m.shift)?.label : null, m.jam, jadwalTeks(m)].filter(Boolean).join(' · ')
  return (
    <div className={`card !mb-0 flex flex-wrap items-center gap-3 ${terpilih ? 'ring-2 ring-primary' : ''} ${m.aktif ? '' : 'opacity-80'}`}>
      <label className="flex items-center gap-2" title={m.aktif ? 'Hidup' : 'Mati'}>
        <input type="checkbox" className="size-5" checked={m.aktif} onChange={(e) => hidup(e.target.checked)} />
        <span className={`badge ${m.aktif ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground'}`}>{m.aktif ? 'Hidup' : 'Mati'}</span>
      </label>
      <div className="min-w-40 flex-1">
        <b className="block">{m.nama}</b>
        <span className="text-xs text-muted-foreground">{ringkas}</span>
        <span className="block text-xs text-muted-foreground">
          {m.cakupan === 'semua' ? 'Semua DS' : m.cakupan === 'arcon' ? `${m.cakupan_ids.length} Arcon` : `${m.cakupan_ids.length} DS`} · {m.grup.length ? `${m.grup.length} grup: ${m.grup.map(namaGrup).join(', ')}` : 'grup tiap DS'}
        </span>
      </div>
      <button className={terpilih ? 'btn' : 'btn2'} onClick={onPilih} aria-pressed={terpilih}>{terpilih ? 'Dipilih' : 'Atur'}</button>
    </div>
  )
}

// Editor pesan yang dipilih (kolom kanan)
function EditorPesan({ m, dsl, arl, grupOpsi, muatGrup, onUlang, namaGrup, reload, tutup }: { m: Pesan; dsl: Ds[]; arl: Ds[]; grupOpsi: Grup[]; muatGrup: boolean; onUlang: () => void; namaGrup: (id: string) => string; reload: () => void; tutup: () => void }) {
  const [nama, setNama] = useState(m.nama)
  const [jenis, setJenis] = useState(m.jenis)
  const [shift, setShift] = useState(m.shift ?? 'pagi')
  const [jam, setJam] = useState(m.jam)
  const [hari, setHari] = useState<number[]>(m.hari)
  const [tglBulan, setTglBulan] = useState<number>(m.tanggal_bulan ?? 1)
  const [cakupan, setCakupan] = useState(m.cakupan)
  const [cakIds, setCakIds] = useState<string[]>(m.cakupan_ids)
  const [grup, setGrup] = useState<string[]>(m.grup)
  const [manual, setManual] = useState('')
  const [sibuk, setSibuk] = useState(false)

  // Setelah disimpan atau dimuat ulang, isian mengikuti data tersimpan
  useEffect(() => {
    setNama(m.nama); setJenis(m.jenis); setShift(m.shift ?? 'pagi'); setJam(m.jam); setHari(m.hari); setTglBulan(m.tanggal_bulan ?? 1); setCakupan(m.cakupan); setCakIds(m.cakupan_ids); setGrup(m.grup)
  }, [m])

  const info = JENIS.find((j) => j.value === jenis)
  const perShift = info?.perShift ?? false
  const bulanan = jenis === 'ringkasan_bulanan'
  const jamSalah = !/^([01]\d|2[0-3]):[0-5]\d$/.test(jam)
  const cakSalah = cakupan !== 'semua' && !cakIds.length
  const hariUrut = [...hari].sort()
  const hariSimpan = bulanan ? SEMUA_HARI : hariUrut
  const berubah =
    nama.trim() !== m.nama || jenis !== m.jenis || (perShift ? shift : null) !== m.shift || jam !== m.jam || hariSimpan.join() !== [...m.hari].sort().join() ||
    (bulanan ? tglBulan : null) !== m.tanggal_bulan ||
    cakupan !== m.cakupan || (cakupan === 'semua' ? [] : [...cakIds].sort()).join() !== [...m.cakupan_ids].sort().join() || grup.join('|') !== m.grup.join('|')
  const invalid = !nama.trim() || jamSalah || !hariSimpan.length || cakSalah

  // Mengganti jenis menyesuaikan bawaan: mingguan biasanya Senin, bulanan memakai tanggal
  const gantiJenis = (v: string) => {
    setJenis(v)
    if (v === 'ringkasan_mingguan' && hari.length === 7) setHari([1])
    if (v !== 'ringkasan_mingguan' && v !== 'ringkasan_bulanan' && hari.length < 7 && m.jenis === 'ringkasan_mingguan') setHari(SEMUA_HARI)
  }

  const simpan = async () => {
    if (invalid) return toast('Periksa isian: nama, jam (jam:menit), minimal satu hari, dan cakupan tidak boleh kosong')
    setSibuk(true)
    const berhasil = await ok(
      sb.from('pesan_wa').update({
        nama: nama.trim(), jenis, shift: perShift ? shift : null, jam, hari: hariSimpan, tanggal_bulan: bulanan ? tglBulan : null,
        cakupan, cakupan_ids: cakupan === 'semua' ? [] : cakIds, grup, diubah: new Date().toISOString(),
      }).eq('id', m.id),
    )
    setSibuk(false)
    if (berhasil) { toast.ok('Pesan tersimpan'); reload() }
  }
  const hapus = async () => {
    if (!(await konfirmasi(`Hapus pesan "${m.nama}"? Riwayat pengirimannya tetap ada.`, { judul: 'Hapus pesan', ya: 'Hapus', bahaya: true }))) return
    if (await ok(sb.from('pesan_wa').delete().eq('id', m.id))) { reload(); tutup() }
  }
  const kirimSekarang = async () => {
    if (berubah) return toast('Simpan perubahan dulu, baru kirim.')
    if (!m.grup.length && (m.jenis === 'budget' || m.jenis.startsWith('ringkasan_'))) return toast('Pesan ini wajib memilih minimal satu grup tujuan.')
    if (!(await konfirmasi(`Kirim "${m.nama}" sekarang${m.grup.length ? ` ke ${m.grup.length} grup` : ' ke grup tiap DS'}? Pesan asli langsung masuk WhatsApp.`, { judul: 'Kirim sekarang', ya: 'Kirim' }))) return
    setSibuk(true)
    const { data, error } = await sb.functions.invoke('kirim-laporan', { body: { pesan_id: m.id, ulang: true } })
    setSibuk(false)
    reload()
    if (error || data?.error) return toast(data?.error ?? 'Pesan belum bisa dikirim. Coba lagi.')
    const h = (data?.hasil ?? []) as { status: string; alasan?: string }[]
    if (data?.dilewati) return toast(data.dilewati)
    if (!h.length) return toast('Tidak ada yang dikirim: belum ada data atau DS dengan jadwal pada periode atau cakupan pesan ini.')
    const gagal = h.filter((x) => x.status === 'gagal')
    if (gagal.length) return toast(`Gagal: ${gagal[0].alasan ?? 'tidak diketahui'}`)
    const lewat = h.filter((x) => x.status === 'dilewati')
    if (lewat.length === h.length) return toast(lewat[0].alasan ?? 'Dilewati')
    toast.ok('Pesan terkirim')
  }

  const tambahGrup = (id: string) => { const v = id.trim(); if (v && !grup.includes(v)) setGrup([...grup, v]) }
  const sisaGrup = grupOpsi.filter((g) => !grup.includes(g.id))
  const manualSalah = manual.trim() !== '' && !FORMAT_GRUP.test(manual.trim())
  const daftarCak = cakupan === 'arcon' ? arl : dsl

  return (
    <div className="card !mb-0 space-y-4">
      <div className="flex items-center gap-2">
        <b className="flex-1">Atur pesan</b>
        <button className="btn2" onClick={tutup}>Tutup</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nama pesan"><input className="inp w-full" value={nama} onChange={(e) => setNama(e.target.value)} /></Field>
        <Field label="Isi pesan" hint={info?.ket}><Select value={jenis} onChange={gantiJenis} opsi={JENIS.map(({ value, label }) => ({ value, label }))} /></Field>
        {perShift && <Field label="Shift"><Select value={shift} onChange={setShift} opsi={SHIFT} /></Field>}
        <Field label="Jam kirim (WIB)" hint="Pesan tiba antara jam ini sampai 5 menit sesudahnya.">
          <input type="time" className="inp !w-32" value={jam} onChange={(e) => setJam(e.target.value)} />
        </Field>
      </div>
      {bulanan ? (
        <Field label="Tanggal kirim tiap bulan" hint="Dibatasi sampai tanggal 28 supaya selalu ada di setiap bulan.">
          <Select className="sm:w-48" value={String(tglBulan)} onChange={(v) => setTglBulan(Number(v))} opsi={TANGGAL} />
        </Field>
      ) : (
        <div>
          <label className="lbl">Hari kirim</label>
          <div className="flex flex-wrap gap-3">
            {HARI.map(([n, x]) => (
              <label key={n} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" className="size-4" checked={hari.includes(n)} onChange={(e) => setHari(e.target.checked ? [...hari, n] : hari.filter((y) => y !== n))} />
                {x}
              </label>
            ))}
          </div>
          {!hari.length && <p className="mt-1 text-xs text-danger">Pilih minimal satu hari.</p>}
        </div>
      )}
      <div>
        <Field label="Cakupan" hint="DS yang hari itu belum ada jadwalnya di Orca tidak ikut dilaporkan.">
          <Select className="sm:w-72" value={cakupan} onChange={(v) => { setCakupan(v); setCakIds([]) }} opsi={CAKUPAN} />
        </Field>
        {cakupan !== 'semua' && (
          <div className="mt-2 grid max-h-44 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
            {daftarCak.map((x) => (
              <label key={x.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" checked={cakIds.includes(x.id)} onChange={(e) => setCakIds(e.target.checked ? [...cakIds, x.id] : cakIds.filter((y) => y !== x.id))} />
                {x.nama}
              </label>
            ))}
            {!daftarCak.length && <span className="text-xs text-muted-foreground">Belum ada data.</span>}
          </div>
        )}
        {cakSalah && <p className="mt-1 text-xs text-danger">Pilih minimal satu.</p>}
      </div>
      <div>
        <label className="lbl">Kirim ke grup</label>
        <div className="mb-2 flex flex-wrap gap-2">
          {grup.map((g) => (
            <span key={g} className="badge bg-primary-soft text-primary-soft-foreground flex items-center gap-1.5" title={g}>
              {namaGrup(g)}
              <button type="button" aria-label={`Hapus ${namaGrup(g)}`} onClick={() => setGrup(grup.filter((x) => x !== g))}>✕</button>
            </span>
          ))}
          {!grup.length && <span className="text-xs text-muted-foreground">Belum ada grup: pesan dikirim ke grup tiap DS (diatur di Kelola DS). Budget dan ringkasan wajib memilih grup.</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sisaGrup.length > 0 && <Select className="sm:w-72" value="" onChange={tambahGrup} placeholder="Pilih grup dari akun Fonnte…" opsi={sisaGrup.map((g) => ({ value: g.id, label: g.nama || g.id }))} />}
          <input className="inp w-60 font-mono text-sm" placeholder="atau ketik ID: 120363…@g.us" value={manual} onChange={(e) => setManual(e.target.value)} />
          <button className="btn2" disabled={!manual.trim() || manualSalah} onClick={() => { tambahGrup(manual); setManual('') }}>Tambah</button>
          <button className="btn2" disabled={muatGrup} onClick={onUlang}>{muatGrup ? 'Memuat…' : 'Muat ulang daftar grup'}</button>
        </div>
        {manualSalah && <p className="mt-1 text-xs text-danger">ID grup berbentuk angka diikuti @g.us.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <button className="btn" disabled={sibuk || !berubah || invalid} onClick={simpan}>{sibuk ? 'Memproses…' : 'Simpan'}</button>
        <button className="btn2" disabled={sibuk} onClick={kirimSekarang}>Kirim sekarang</button>
        <button className="btn2 ml-auto !text-danger" disabled={sibuk} onClick={hapus}>Hapus</button>
      </div>
    </div>
  )
}
