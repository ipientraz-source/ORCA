import { useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { sb, useRows, ok, toast, konfirmasi, Err, Field, RiderPick, Select, usePage, Pagination, type Ds, type Rider } from './lib'

// Buat / ganti password akun login lewat edge function (service role ada di server, bukan di browser)
async function buatAkun(email: string, password: string) {
  const { error } = await sb.functions.invoke('kelola-admin', { body: { email, password } })
  if (!error) return true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detail = await (error as any).context?.json?.().then((j: any) => j.error).catch(() => null)
  toast(`Akun login gagal dibuat: ${detail ?? error.message}\nAlternatif: buat manual di Supabase → Authentication → Users.`)
  return false
}

const LANGKAH = [
  ['Buat DS', 'Tulis nama tiap DS (depot/store) satu per satu.'],
  ['Isi kuota', 'Tentukan berapa rider yang harus masuk di tiap shift setiap hari.'],
  ['Pilih Captain', 'Pilih rider yang menyusun jadwal dan mengisi absensi DS itu.'],
]

export function Kelola() {
  const dsl = useRows<Ds>(() => sb.from('ds').select('*').order('nama'), [])
  const rs = useRows<Rider>(() => sb.from('riders').select('*').order('nama').limit(1000), [])
  const [nama, setNama] = useState('')
  const [cari, setCari] = useState('')
  const candidates = rs.rows.filter((r) => (r.peran === 'rider' || r.peran === 'captain') && r.status === 'aktif')
  const arcons = rs.rows.filter((r) => r.peran === 'arcon' && r.status === 'aktif') // Arcon = tim khusus, bukan rider
  const tampil = dsl.rows.filter((d) => (d.nama + (rs.rows.find((r) => r.id === d.captain_id)?.nama ?? '')).toLowerCase().includes(cari.toLowerCase()))
  const pg = usePage(tampil, [cari])

  return (
    <div>
      <Err msg={dsl.err || rs.err} />

      <div className="card !bg-primary-soft !border-primary/20">
        <b className="block mb-3">Cara menyiapkan DS</b>
        <ol className="grid sm:grid-cols-3 gap-4">
          {LANGKAH.map(([judul, isi], i) => (
            <li key={judul} className="flex gap-3">
              <span className="size-7 shrink-0 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center">{i + 1}</span>
              <div className="text-sm">
                <div className="font-semibold">{judul}</div>
                <div className="text-muted-foreground">{isi}</div>
              </div>
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground mt-3">Buat DS lebih dulu sebelum import rider, supaya nama DS di file CSV cocok.</p>
      </div>

      <div className="card">
        <b className="block mb-3">Buat DS baru</b>
        <div className="flex flex-wrap items-start gap-3">
          <Field label="Nama DS" hint="Tulis persis seperti yang akan dipakai di file CSV rider, misalnya DS HAYAM WURUK." className="min-w-[min(18rem,100%)] flex-1 max-w-md">
            <input className="inp w-full" placeholder="Contoh: DS HAYAM WURUK" value={nama} onChange={(e) => setNama(e.target.value)} />
          </Field>
          <div className="pt-5">
            <button
              className="btn"
              disabled={!nama.trim()}
              onClick={async () => {
                if (await ok(sb.from('ds').insert({ nama: nama.trim() }))) {
                  setNama('')
                  toast.ok('DS berhasil dibuat. Lanjut isi kuota dan pilih Captain.')
                  dsl.reload()
                }
              }}
            >
              <Plus size={16} />Buat DS
            </button>
          </div>
        </div>
      </div>

      <ArconTim arcons={rs.rows.filter((r) => r.peran === 'arcon')} captains={rs.rows.filter((r) => r.peran === 'captain' && r.status === 'aktif')} semuaDs={dsl.rows} reload={() => { dsl.reload(); rs.reload() }} />

      <div className="mb-3 mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-5">
        <h2 className="mr-2 text-lg font-bold">Daftar DS</h2>
        <div className="relative max-w-full">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="inp w-72 max-w-full !pl-9" placeholder="Cari DS atau nama Captain…" aria-label="Cari DS" value={cari} onChange={(e) => setCari(e.target.value)} />
        </div>
        <span className="text-sm text-muted-foreground">{tampil.length} DS</span>
      </div>
      {pg.rows.map((d) => (
        <DsCard key={d.id} d={d} riders={rs.rows} candidates={candidates} arcons={arcons} semuaDs={dsl.rows} reload={() => { dsl.reload(); rs.reload() }} />
      ))}
      {!tampil.length && <div className="card text-center text-muted-foreground text-sm">{dsl.rows.length ? 'Tidak ada DS yang cocok dengan pencarian.' : 'Belum ada DS. Buat yang pertama di atas.'}</div>}

      <div className="mb-4"><Pagination {...pg} /></div>

      <SuperAdmins admins={rs.rows.filter((r) => r.peran === 'super_admin')} reload={rs.reload} />
    </div>
  )
}

// terbatas = tampilan Arcon: hanya kebutuhan rider (kuota) dan Captain; tanpa nama DS, grup WhatsApp, password, dan pilihan Arcon
function DsCard({ d, riders, candidates, arcons, semuaDs, reload, terbatas = false }: { d: Ds; riders: Rider[]; candidates: Rider[]; arcons: Rider[]; semuaDs: Ds[]; reload: () => void; terbatas?: boolean }) {
  const [arPick, setArPick] = useState('')
  const arc = riders.find((r) => r.id === d.arcon_id)
  const jmlDsArcon = arc ? semuaDs.filter((x) => x.arcon_id === arc.id).length : 0
  const kurangArcon = !arcons.length ? 'Belum ada Arcon. Tambahkan dulu di bagian Arcon di atas' : !arPick ? 'Pilih Arcon dulu' : ''
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

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h3 className="text-lg font-bold mr-1">{d.nama}</h3>
        <span className="badge bg-muted text-muted-foreground">
          Kuota: {d.kuota_pagi} pagi + {d.kuota_siang} siang = {d.kuota_pagi + d.kuota_siang} rider per hari
        </span>
        {cap ? <span className="badge bg-primary-soft text-primary-soft-foreground">Captain: {cap.nama}</span> : <span className="badge bg-warning-soft text-warning">Belum ada Captain</span>}
        {arc && <span className="badge bg-muted text-foreground/80">Arcon: {arc.nama}</span>}
      </div>

      <div className={`grid gap-4 sm:grid-cols-2 ${terbatas ? 'lg:grid-cols-2' : 'lg:grid-cols-4'} items-start`}>
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

      <div className="mt-5 pt-4 border-t border-border">
        <b className="block">{cap ? 'Ganti Captain' : 'Tunjuk Captain'}</b>
        <p className="text-sm text-muted-foreground mb-3">
          {cap ? <>Captain sekarang: <b className="text-foreground">{cap.nama}</b> ({cap.email}). </> : ''}
          Captain menyusun jadwal dan mengisi absensi hanya untuk DS ini.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 items-start">
          <Field label="Rider yang jadi Captain" hint="Ketik nama untuk mencari, lalu pilih dari daftar.">
            <RiderPick riders={candidates} value={pick} onChange={setPick} placeholder="— pilih rider —" />
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
        {terbatas && <p className="mt-2 text-xs text-muted-foreground">Captain membuat password sendiri lewat "Lupa password / buat password?" di layar masuk, memakai email di atas. Calon Captain hanya dari rider DS ini.</p>}
        <div className="mt-3 flex items-center gap-3">
          <button className="btn2" disabled={!!kurang} onClick={tunjuk}>{cap ? 'Ganti Captain' : 'Jadikan Captain'}</button>
          {kurang && <span className="text-xs text-muted-foreground">{kurang}</span>}
        </div>
      </div>

      {!terbatas && (
      <div className="mt-5 pt-4 border-t border-border">
        <b className="block">{arc ? 'Ganti Arcon' : 'Pilih Arcon (opsional)'}</b>
        <p className="text-sm text-muted-foreground mb-3">
          Arcon adalah atasan Captain dari tim yang ditunjuk khusus, bukan rider. Satu Arcon bisa dipilih di banyak DS. Arcon memantau (dashboard, rider, jadwal, laporan), menyusun jadwal termasuk otomatis, mengatur kebutuhan rider dan Captain, menonaktifkan rider, dan mengunci absensi mingguan di DS yang dipegang. Absensi harian tetap dikerjakan Captain.{' '}
          {arc && <>Arcon sekarang: <b className="text-foreground">{arc.nama}</b> ({arc.email}), memegang {jmlDsArcon} DS.</>}
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 items-start">
          <Field label="Arcon untuk DS ini" hint="Pilih dari daftar Arcon. Arcon baru ditambahkan di bagian Arcon di atas daftar DS.">
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
        <DsCard key={d.id} d={d} terbatas riders={rs.rows} candidates={calon.filter((r) => r.ds_id === d.id)} arcons={[]} semuaDs={milik} reload={() => { dsl.reload(); rs.reload() }} />
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
    <div className="card">
      <b className="block">Arcon</b>
      <p className="text-sm text-muted-foreground mb-3">
        Arcon adalah atasan Captain dari tim yang ditunjuk khusus, bukan rider. Tambahkan orangnya di sini, lalu pilih Arcon di kartu tiap DS. Satu Arcon bisa memegang banyak DS.
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 items-start">
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
    </div>
  )
}

function SuperAdmins({ admins, reload }: { admins: Rider[]; reload: () => void }) {
  const [f, setF] = useState({ nama: '', email: '', pw: '' })
  const kurang = !f.nama.trim() ? 'Isi nama dulu' : !f.email.trim() ? 'Isi email untuk login' : f.pw && f.pw.length < 8 ? 'Password minimal 8 karakter' : ''
  return (
    <div className="card">
      <b className="block">Super-admin</b>
      <p className="text-sm text-muted-foreground mb-3">Super-admin bisa melihat semua DS dan mengatur sistem. Jumlahnya boleh lebih dari satu.</p>
      <ul className="flex flex-wrap gap-2 mb-5">
        {admins.map((a) => (
          <li key={a.id} className="badge bg-primary-soft text-primary-soft-foreground !text-sm !px-3 !py-1">{a.nama} · {a.email}</li>
        ))}
      </ul>
      <b className="block text-sm mb-3">Tambah Super-admin baru</b>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 items-start">
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
            if (!(await ok(sb.from('riders').insert({ nama: f.nama.trim(), email: f.email, peran: 'super_admin' })))) return
            if (f.pw) await buatAkun(f.email, f.pw)
            setF({ nama: '', email: '', pw: '' })
            toast.ok('Super-admin ditambahkan')
            reload()
          }}
        >
          Tambah Super-admin
        </button>
        {kurang && <span className="text-xs text-muted-foreground">{kurang}</span>}
      </div>
    </div>
  )
}
