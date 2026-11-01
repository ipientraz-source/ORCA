import { useState } from 'react'
import { ChevronDown, Plus, Search, X } from 'lucide-react'
import { sb, useRows, ok, toast, konfirmasi, Err, Field, RiderPick, Select, type Ds, type Rider } from './lib'

// Buat / ganti password akun login lewat edge function (service role ada di server, bukan di browser)
async function buatAkun(email: string, password: string) {
  const { error } = await sb.functions.invoke('kelola-admin', { body: { email, password } })
  if (!error) return true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detail = await (error as any).context?.json?.().then((j: any) => j.error).catch(() => null)
  toast(`Akun login gagal dibuat: ${detail ?? error.message}\nAlternatif: buat manual di Supabase → Authentication → Users.`)
  return false
}

export function Kelola() {
  const dsl = useRows<Ds>(() => sb.from('ds').select('*').order('nama'), [])
  const rs = useRows<Rider>(() => sb.from('riders').select('*').order('nama').limit(1000), [])
  const [nama, setNama] = useState('')
  const [cari, setCari] = useState('')
  const candidates = rs.rows.filter((r) => (r.peran === 'rider' || r.peran === 'captain') && r.status === 'aktif')
  const arcons = rs.rows.filter((r) => r.peran === 'arcon' && r.status === 'aktif') // Arcon = tim khusus, bukan rider
  const tampil = dsl.rows.filter((d) => (d.nama + (rs.rows.find((r) => r.id === d.captain_id)?.nama ?? '')).toLowerCase().includes(cari.toLowerCase()))
  const [pilih, setPilih] = useState('')
  const [tambah, setTambah] = useState(false)
  const dipilih = tampil.find((d) => d.id === pilih) ?? tampil[0] ?? null // DS yang formulirnya tampil di panel kanan
  const tanpaCaptain = dsl.rows.filter((d) => !d.captain_id).length
  const buatDs = async () => {
    if (await ok(sb.from('ds').insert({ nama: nama.trim() }))) {
      setNama('')
      setTambah(false)
      toast.ok('DS berhasil dibuat. Pilih di daftar, lalu isi kuota dan pilih Captain.')
      dsl.reload()
    }
  }

  return (
    <div>
      <Err msg={dsl.err || rs.err} />

      <div className="mb-3 flex flex-wrap items-start gap-3">
        <p className="min-w-60 flex-1 text-sm text-muted-foreground">
          Urutan menyiapkan DS: <b className="text-foreground">1.</b> buat DS, <b className="text-foreground">2.</b> isi kuota rider per shift, <b className="text-foreground">3.</b> pilih Captain. Buat DS lebih dulu sebelum import rider supaya nama DS di file CSV cocok.
        </p>
        <button type="button" className={tambah ? 'btn2' : 'btn'} onClick={() => setTambah(!tambah)}>{tambah ? <X size={16} /> : <Plus size={16} />}{tambah ? 'Batal' : 'Buat DS'}</button>
      </div>

      {tambah && (
        <div className="card !p-3 flex flex-wrap items-center gap-2">
          <input autoFocus className="inp min-w-[min(16rem,100%)] max-w-sm flex-1" placeholder="Nama DS baru, mis. DS HAYAM WURUK" aria-label="Nama DS baru" value={nama} onChange={(e) => setNama(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && nama.trim() && buatDs()} />
          <button className="btn" disabled={!nama.trim()} onClick={buatDs}>Simpan</button>
          <span className="text-xs text-muted-foreground">Tulis persis seperti di file CSV rider.</span>
        </div>
      )}

      <div className="mb-4 grid items-start gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <div className="card !mb-0 !p-0 overflow-hidden">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className="inp w-full !pl-9" placeholder="Cari DS atau Captain" aria-label="Cari DS" value={cari} onChange={(e) => setCari(e.target.value)} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{tampil.length} DS</span>
              {tanpaCaptain > 0 && <span className="badge bg-warning-soft text-warning">{tanpaCaptain} belum ada Captain</span>}
            </div>
          </div>
          <div className="max-h-[55vh] overflow-y-auto">
            {tampil.map((d) => {
              const capNama = rs.rows.find((r) => r.id === d.captain_id)?.nama
              return (
                <button key={d.id} type="button" aria-current={d.id === dipilih?.id} onClick={() => setPilih(d.id)}
                  className={`flex w-full flex-col gap-0.5 border-b border-border px-3 py-2.5 text-left last:border-0 ${d.id === dipilih?.id ? 'bg-primary-soft' : 'hover:bg-muted/60'}`}>
                  <span className="text-sm font-semibold">{d.nama}</span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className={`size-1.5 shrink-0 rounded-full ${capNama ? 'bg-success' : 'bg-warning'}`} />
                    {capNama ?? 'Belum ada Captain'} · {d.kuota_pagi + d.kuota_siang} rider/hari
                  </span>
                </button>
              )
            })}
            {!tampil.length && <p className="p-4 text-center text-sm text-muted-foreground">{dsl.rows.length ? 'Tidak ada DS yang cocok.' : 'Belum ada DS.'}</p>}
          </div>
        </div>

        {dipilih
          ? <DsCard key={dipilih.id} tetap d={dipilih} riders={rs.rows} candidates={candidates} arcons={arcons} semuaDs={dsl.rows} reload={() => { dsl.reload(); rs.reload() }} />
          : <div className="card !mb-0 text-center text-sm text-muted-foreground">{dsl.rows.length ? 'Tidak ada DS yang cocok dengan pencarian.' : 'Belum ada DS. Klik "Buat DS" di kanan atas untuk membuat yang pertama.'}</div>}
      </div>

      <ArconTim arcons={rs.rows.filter((r) => r.peran === 'arcon')} captains={rs.rows.filter((r) => r.peran === 'captain' && r.status === 'aktif')} semuaDs={dsl.rows} reload={() => { dsl.reload(); rs.reload() }} />
      <AkunTim peran="recruiter" judul="Recruiter" ket="Tim rekrutmen: mengelola kandidat rider dan menerimanya jadi rider. Hanya melihat menu Rekrutmen. Jumlahnya boleh lebih dari satu." orang={rs.rows.filter((r) => r.peran === 'recruiter')} reload={rs.reload} />
      <AkunTim peran="super_admin" judul="Super-admin" ket="Bisa melihat semua DS dan mengatur sistem. Jumlahnya boleh lebih dari satu." orang={rs.rows.filter((r) => r.peran === 'super_admin')} reload={rs.reload} />
    </div>
  )
}

// terbatas = tampilan Arcon: hanya kebutuhan rider (kuota) dan Captain; tanpa nama DS, grup WhatsApp, password, dan pilihan Arcon
function DsCard({ d, riders, candidates, arcons, semuaDs, reload, terbatas = false, awalBuka = false, tetap = false }: { d: Ds; riders: Rider[]; candidates: Rider[]; arcons: Rider[]; semuaDs: Ds[]; reload: () => void; terbatas?: boolean; awalBuka?: boolean; tetap?: boolean }) {
  // Ringkas: formulir dipisah per tab supaya tidak menumpuk. tetap = panel detail yang selalu terbuka; selain itu satu baris yang dibuka lewat "Atur"
  const [buka, setBuka] = useState(awalBuka || tetap)
  const [tab, setTab] = useState<'dasar' | 'captain' | 'arcon'>('dasar')
  const [arPick, setArPick] = useState('')
  const arc = riders.find((r) => r.id === d.arcon_id)
  const jmlDsArcon = arc ? semuaDs.filter((x) => x.arcon_id === arc.id).length : 0
  const kurangArcon = !arcons.length ? 'Belum ada Arcon. Tambahkan dulu di bagian Tim Arcon, di bawah daftar DS' : !arPick ? 'Pilih Arcon dulu' : ''
  const tunjukArcon = async () => {
    if (!(await ok(sb.rpc('pilih_arcon', { p_ds: d.id, p_arcon: arPick })))) return
    setArPick('')
    toast.ok('Arcon berhasil dipilih')
    reload()
  }
  const lepasArcon = async () => {
    if ((await konfirmasi(`Lepas ${arc?.nama} dari ${d.nama}? Beliau tetap memegang DS lain kalau ada.`, { judul: 'Lepas Arcon dari DS ini?', ya: 'Lepas', bahaya: true })) && (await ok(sb.rpc('lepas_arcon', { p_ds: d.id })))) {
      toast.ok('Arcon dilepas dari DS ini')
      reload()
    }
  }
  const [f, setF] = useState({ nama: d.nama, kuota_pagi: d.kuota_pagi, kuota_siang: d.kuota_siang, group_wa_id: d.group_wa_id ?? '' })
  const [pick, setPick] = useState('')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  // Tampilan Arcon: selain rider di DS ini, boleh mencari rider aktif yang belum punya DS (daftar rider Arcon tidak memuatnya)
  const [cariBebas, setCariBebas] = useState('')
  const [bebas, setBebas] = useState<{ id: string; nama: string }[]>([])
  const cariRiderBebas = async () => {
    const { data, error } = await sb.rpc('cari_rider', { p_q: cariBebas.trim() })
    if (error) return toast(error.message)
    const hasil = ((data ?? []) as { id: string; nama: string; ds_id: string | null; status: string }[]).filter((x) => !x.ds_id && x.status === 'aktif')
    setBebas(hasil)
    if (!hasil.length) toast('Tidak ada rider aktif yang belum punya DS dengan nama itu.')
  }
  const calonCaptain = terbatas ? [...candidates, ...bebas.filter((b) => !candidates.some((c) => c.id === b.id)).map((b) => ({ ...b, kode_mtr: null }))] : candidates
  const cap = riders.find((r) => r.id === d.captain_id)
  const berubah = f.kuota_pagi !== d.kuota_pagi || f.kuota_siang !== d.kuota_siang || (!terbatas && (f.nama.trim() !== d.nama || f.group_wa_id !== (d.group_wa_id ?? '')))
  const angka = (v: string) => Math.max(0, Math.floor(+v || 0))

  const kurang = !pick ? 'Pilih rider dulu' : !email.trim() ? 'Isi email untuk login' : pw && pw.length < 8 ? 'Password minimal 8 karakter' : ''

  const simpan = async () => {
    const isi = terbatas ? { kuota_pagi: f.kuota_pagi, kuota_siang: f.kuota_siang } : { nama: f.nama.trim(), kuota_pagi: f.kuota_pagi, kuota_siang: f.kuota_siang, group_wa_id: f.group_wa_id.trim() || null }
    if (await ok(sb.from('ds').update(isi).eq('id', d.id))) {
      toast.ok('Perubahan DS disimpan')
      reload()
    }
  }
  const tunjuk = async () => {
    if (!(await ok(sb.rpc('tunjuk_captain', { p_ds: d.id, p_rider: pick, p_email: email })))) return
    if (pw && !terbatas) await buatAkun(email, pw)
    setPick('')
    setEmail('')
    setPw('')
    toast.ok('Captain berhasil dipilih')
    reload()
  }

  const ringkas = (
    <>
      <h3 className="mr-1 min-w-40 text-base font-bold">{d.nama}</h3>
      <span className="badge bg-muted text-muted-foreground" title="Rider yang harus masuk tiap hari">
        {d.kuota_pagi} pagi + {d.kuota_siang} siang = {d.kuota_pagi + d.kuota_siang} rider/hari
      </span>
      {cap ? <span className="badge bg-primary-soft text-primary-soft-foreground">Captain: {cap.nama}</span> : <span className="badge bg-warning-soft text-warning">Belum ada Captain</span>}
      {!terbatas && (arc ? <span className="badge bg-muted text-foreground/80">Arcon: {arc.nama}</span> : <span className="badge bg-muted text-muted-foreground">Tanpa Arcon</span>)}
      {!tetap && (
        <span className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-primary">
          {buka ? 'Tutup' : 'Atur'}<ChevronDown size={16} className={`transition-transform ${buka ? 'rotate-180' : ''}`} />
        </span>
      )}
    </>
  )

  return (
    <div className={`card !p-0 overflow-hidden ${tetap ? '!mb-0' : ''}`}>
      {tetap
        ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 p-4">{ringkas}</div>
        : <button type="button" className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 p-4 text-left hover:bg-muted/50" aria-expanded={buka} onClick={() => setBuka(!buka)}>{ringkas}</button>}

      {buka && (
      <div className="border-t border-border p-4">
      <div className="mb-4 flex flex-wrap gap-1.5">
        {([['dasar', terbatas ? 'Kebutuhan rider' : 'Pengaturan DS'], ['captain', 'Captain'], ...(terbatas ? [] : [['arcon', 'Arcon'] as const])] as const).map(([k, l]) => (
          <button key={k} type="button" className={`tab ${tab === k ? 'tab-on' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'dasar' && (<>
      <div className={`grid gap-4 sm:grid-cols-2 items-start`}>
        {!terbatas && (
          <Field label="Nama DS" hint="Dipakai di file CSV rider dan di laporan.">
            <input className="inp w-full" value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} />
          </Field>
        )}
        <Field label={terbatas ? 'Kebutuhan rider shift pagi' : 'Kuota shift pagi'} hint="Jumlah rider yang harus masuk shift pagi setiap hari.">
          <input type="number" min={0} className="inp w-full" value={f.kuota_pagi} onChange={(e) => setF({ ...f, kuota_pagi: angka(e.target.value) })} />
        </Field>
        <Field label={terbatas ? 'Kebutuhan rider shift siang' : 'Kuota shift siang'} hint="Jumlah rider yang harus masuk shift siang setiap hari.">
          <input type="number" min={0} className="inp w-full" value={f.kuota_siang} onChange={(e) => setF({ ...f, kuota_siang: angka(e.target.value) })} />
        </Field>
        {!terbatas && (
          <Field label="ID grup WhatsApp (opsional)" hint="Untuk pengingat jadwal ke grup nanti. Boleh dikosongkan.">
            <input className="inp w-full" placeholder="Contoh: 1203630xxxx@g.us" value={f.group_wa_id} onChange={(e) => setF({ ...f, group_wa_id: e.target.value })} />
          </Field>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button className="btn" disabled={!berubah || (!terbatas && !f.nama.trim())} onClick={simpan}>Simpan perubahan</button>
        {!berubah && <span className="text-xs text-muted-foreground">Belum ada yang diubah</span>}
      </div>
      </>)}

      {tab === 'captain' && (
      <div>
        <p className="text-sm text-muted-foreground mb-3">
          {cap ? <>Captain sekarang: <b className="text-foreground">{cap.nama}</b> ({cap.email}). </> : 'Belum ada Captain. '}
          Captain menyusun jadwal dan mengisi absensi hanya untuk DS ini.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 items-start">
          <Field label="Rider yang jadi Captain" hint="Ketik nama untuk mencari, lalu pilih dari daftar.">
            <RiderPick riders={calonCaptain} value={pick} onChange={setPick} placeholder="— pilih rider —" />
            {terbatas && (
              <div className="mt-2 flex gap-2">
                <input className="inp min-w-0 flex-1" placeholder="Cari rider yang belum punya DS" aria-label="Cari rider yang belum punya DS" value={cariBebas} onChange={(e) => setCariBebas(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && cariBebas.trim().length >= 2 && cariRiderBebas()} />
                <button className="btn2" type="button" disabled={cariBebas.trim().length < 2} onClick={cariRiderBebas}>Cari</button>
              </div>
            )}
          </Field>
          <Field label="Email untuk login" hint="Captain memakai email ini untuk masuk ke aplikasi.">
            <input className="inp w-full" type="email" placeholder="nama@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {!terbatas && (
            <Field label="Password (opsional)" hint="Minimal 8 karakter. Kosongkan kalau akun login sudah dibuat sendiri di Supabase.">
              <input className="inp w-full" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
          )}
        </div>
        {terbatas && <p className="mt-2 text-xs text-muted-foreground">Captain membuat password sendiri lewat "Lupa password / buat password?" di layar masuk. Calon: rider di DS ini atau rider yang belum punya DS (cari lewat kolom di atas). Rider di DS lain hanya bisa dipindah Super-admin.</p>}
        <div className="mt-3 flex items-center gap-3">
          <button className="btn2" disabled={!!kurang} onClick={tunjuk}>{cap ? 'Ganti Captain' : 'Jadikan Captain'}</button>
          {kurang && <span className="text-xs text-muted-foreground">{kurang}</span>}
        </div>
      </div>
      )}

      {!terbatas && tab === 'arcon' && (
      <div>
        <p className="text-sm text-muted-foreground mb-3">
          Arcon memantau dan mengatur jadwal, kebutuhan rider, dan Captain di DS yang dipegang; absensi harian tetap dikerjakan Captain. Satu Arcon bisa memegang banyak DS.{' '}
          {arc ? <>Sekarang: <b className="text-foreground">{arc.nama}</b> ({arc.email}), memegang {jmlDsArcon} DS.</> : 'Belum ada Arcon untuk DS ini (opsional).'}
        </p>
        <div className="grid gap-4 sm:grid-cols-2 items-start">
          <Field label="Arcon untuk DS ini" hint="Pilih dari daftar Arcon. Arcon baru ditambahkan di bagian Tim Arcon, di bawah daftar DS.">
            <Select value={arPick} onChange={setArPick} placeholder="— pilih Arcon —" opsi={arcons.map((a) => ({ value: a.id, label: `${a.nama} (${a.email ?? 'tanpa email'})` }))} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="btn2" disabled={!!kurangArcon} onClick={tunjukArcon}>{arc ? 'Ganti Arcon' : 'Jadikan Arcon'}</button>
          {arc && <button className="btn2 !text-danger" onClick={lepasArcon}>Lepas Arcon dari DS ini</button>}
          {kurangArcon && <span className="text-xs text-muted-foreground">{kurangArcon}</span>}
        </div>
      </div>
      )}
      </div>
      )}
    </div>
  )
}

// Tampilan Arcon: hanya DS yang dipegang; mengatur kebutuhan rider per shift dan menunjuk Captain dari rider DS itu
export function KelolaArcon({ dsList }: { dsList: Ds[] }) {
  const dsl = useRows<Ds>(() => sb.from('ds').select('*').order('nama'), [])
  const rs = useRows<Rider>(() => sb.from('riders').select('*').order('nama').limit(1000), [])
  const milik = dsl.rows.filter((d) => dsList.some((x) => x.id === d.id))
  const calon = rs.rows.filter((r) => (r.peran === 'rider' || r.peran === 'captain') && r.status === 'aktif')
  return (
    <div>
      <Err msg={dsl.err || rs.err} />
      <div className="card !bg-primary-soft !border-primary/20">
        <b className="block mb-1">Yang bisa Anda atur di sini</b>
        <p className="text-sm text-muted-foreground">
          Untuk DS yang Anda pegang: berapa rider yang harus masuk tiap shift setiap hari, dan siapa Captain-nya. Membuat DS baru, mengganti nama DS, dan memilih Arcon dilakukan Super-admin.
        </p>
      </div>
      {milik.map((d) => (
        <DsCard key={d.id} d={d} terbatas awalBuka={milik.length <= 2} riders={rs.rows} candidates={calon.filter((r) => r.ds_id === d.id)} arcons={[]} semuaDs={milik} reload={() => { dsl.reload(); rs.reload() }} />
      ))}
      {!milik.length && <div className="card text-center text-muted-foreground text-sm">{dsl.rows.length ? 'Anda belum memegang DS mana pun.' : 'Memuat…'}</div>}
    </div>
  )
}

// Arcon = tim yang ditunjuk khusus (bukan rider). Dibuat di sini, lalu dipilih per DS di kartu DS.
function ArconTim({ arcons, captains, semuaDs, reload }: { arcons: Rider[]; captains: Rider[]; semuaDs: Ds[]; reload: () => void }) {
  const [f, setF] = useState({ nama: '', email: '', pw: '' })
  const [naik, setNaik] = useState('')
  // Captain yang naik jabatan: orang, email, dan riwayatnya tetap; DS yang dulu dipimpin kehilangan Captain sampai ditunjuk yang baru
  const jadikan = async () => {
    const c = captains.find((x) => x.id === naik)
    if (!c) return
    const dsnya = semuaDs.filter((d) => d.captain_id === c.id).map((d) => d.nama)
    if (!(await konfirmasi(`${c.nama} (${c.email}) naik jadi Arcon dengan email dan riwayat yang sama. ${dsnya.length ? `DS ${dsnya.join(', ')} jadi tanpa Captain sampai Anda menunjuk yang baru. ` : ''}Setelah itu pilih Arcon ini di kartu DS yang akan dipegang.`, { judul: 'Jadikan Arcon?', ya: 'Jadikan Arcon', bahaya: true }))) return
    if (!(await ok(sb.rpc('jadikan_arcon', { p_rider: c.id })))) return
    setNaik('')
    toast.ok(`${c.nama} sekarang Arcon. Pilih di kartu DS untuk memberinya DS.`)
    reload()
  }
  const kurang = !f.nama.trim() ? 'Isi nama dulu' : !f.email.trim() ? 'Isi email untuk login' : f.pw && f.pw.length < 8 ? 'Password minimal 8 karakter' : ''
  return (
    <details className="card">
      <summary className="cursor-pointer font-bold">Tim Arcon <span className="badge ml-1 bg-muted text-muted-foreground">{arcons.length}</span></summary>
      <p className="mt-2 text-sm text-muted-foreground mb-3">
        Atasan Captain dari tim yang ditunjuk khusus, bukan rider. Tambahkan orangnya di sini, lalu pilih di tab Arcon pada tiap DS.
      </p>
      {arcons.length > 0 ? (
        <ul className="flex flex-wrap gap-2 mb-5">
          {arcons.map((a) => (
            <li key={a.id} className="badge bg-primary-soft text-primary-soft-foreground !text-sm !px-3 !py-1">
              {a.nama} · {a.email} · {semuaDs.filter((d) => d.arcon_id === a.id).length} DS{a.status === 'nonaktif' ? ' · nonaktif' : ''}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground mb-5">Belum ada Arcon.</p>
      )}
      <b className="block text-sm mb-1">Naikkan Captain jadi Arcon</b>
      <p className="text-xs text-muted-foreground mb-3">Untuk Captain yang sudah ada: email login dan riwayatnya tetap, tidak perlu menambah orang baru.</p>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Select className="w-72" value={naik} onChange={setNaik} placeholder="— pilih Captain —" opsi={captains.map((c) => ({ value: c.id, label: `${c.nama} (${c.email ?? 'tanpa email'})` }))} />
        <button className="btn2" disabled={!naik} onClick={jadikan}>Jadikan Arcon</button>
        {!captains.length && <span className="text-xs text-muted-foreground">Tidak ada Captain aktif.</span>}
      </div>
      <b className="block text-sm mb-3">Tambah Arcon baru</b>
      <div className="grid gap-4 sm:grid-cols-2 items-start">
        <Field label="Nama" hint="Nama lengkap orangnya.">
          <input className="inp w-full" value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} />
        </Field>
        <Field label="Email untuk login" hint="Arcon memakai email ini untuk masuk ke aplikasi.">
          <input className="inp w-full" type="email" placeholder="nama@email.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Password (opsional)" hint="Minimal 8 karakter. Kosongkan kalau akun login sudah dibuat sendiri di Supabase.">
          <input className="inp w-full" type="password" autoComplete="new-password" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          className="btn2"
          disabled={!!kurang}
          onClick={async () => {
            if (!(await ok(sb.from('riders').insert({ nama: f.nama.trim(), email: f.email, peran: 'arcon' })))) return
            if (f.pw) await buatAkun(f.email, f.pw)
            setF({ nama: '', email: '', pw: '' })
            toast.ok('Arcon ditambahkan. Sekarang pilih Arcon ini di kartu DS.')
            reload()
          }}
        >
          Tambah Arcon
        </button>
        {kurang && <span className="text-xs text-muted-foreground">{kurang}</span>}
      </div>
    </details>
  )
}

// Akun tim yang dibuat Super-admin (Super-admin lain, Recruiter): daftar orangnya dan formulir menambah
function AkunTim({ orang, reload, peran, judul, ket }: { orang: Rider[]; reload: () => void; peran: 'super_admin' | 'recruiter'; judul: string; ket: string }) {
  const [f, setF] = useState({ nama: '', email: '', pw: '' })
  const kurang = !f.nama.trim() ? 'Isi nama dulu' : !f.email.trim() ? 'Isi email untuk login' : f.pw && f.pw.length < 8 ? 'Password minimal 8 karakter' : ''
  return (
    <details className="card">
      <summary className="cursor-pointer font-bold">{judul} <span className="badge ml-1 bg-muted text-muted-foreground">{orang.length}</span></summary>
      <p className="mt-2 text-sm text-muted-foreground mb-3">{ket}</p>
      <ul className="flex flex-wrap gap-2 mb-5">
        {orang.map((a) => (
          <li key={a.id} className="badge bg-primary-soft text-primary-soft-foreground !text-sm !px-3 !py-1">{a.nama} · {a.email}</li>
        ))}
      </ul>
      <b className="block text-sm mb-3">Tambah {judul} baru</b>
      <div className="grid gap-4 sm:grid-cols-2 items-start">
        <Field label="Nama" hint="Nama lengkap orangnya.">
          <input className="inp w-full" value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} />
        </Field>
        <Field label="Email untuk login" hint="Dipakai untuk masuk ke aplikasi.">
          <input className="inp w-full" type="email" placeholder="nama@email.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Password (opsional)" hint="Minimal 8 karakter. Kosongkan kalau akun login sudah dibuat sendiri di Supabase.">
          <input className="inp w-full" type="password" autoComplete="new-password" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          className="btn2"
          disabled={!!kurang}
          onClick={async () => {
            if (!(await ok(sb.from('riders').insert({ nama: f.nama.trim(), email: f.email, peran })))) return
            if (f.pw) await buatAkun(f.email, f.pw)
            setF({ nama: '', email: '', pw: '' })
            toast.ok(`${judul} ditambahkan`)
            reload()
          }}
        >
          Tambah {judul}
        </button>
        {kurang && <span className="text-xs text-muted-foreground">{kurang}</span>}
      </div>
    </details>
  )
}
