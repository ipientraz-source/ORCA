import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BellRing, Bike, Building2, Eye, EyeOff, CalendarCheck, CalendarDays, ClipboardCheck, ClipboardList, LayoutDashboard, ListChecks, LogOut, ShieldCheck, TrendingUp, UserCog, Users, type LucideIcon } from 'lucide-react'
import { sb, store, useRows, toast, Err, Logo, TemaSwitch, TemaToggle, type Ds, type Me } from './lib'
import { RiderApp, JadwalSaya } from './rider'
import { AbsensiSemua, Daily } from './daily'
import { JadwalDs, JadwalSemua } from './jadwal'
import { Dashboard, Rekap } from './rekap'
import { DataRider } from './riders'
import { Kelola, KelolaArcon } from './kelola'
import { Pengguna } from './pengguna'
import { Armada } from './armada'
import { DaftarJadwal } from './daftarjadwal'

type P = { me: Me; ds: Ds | null; dsList: Ds[] } // ds = DS Captain; dsList = semua DS yang dipegang Arcon
type Tab = { nama: string; desc: string; Icon: LucideIcon; View: (p: P) => ReactElement }

const SUPER: Tab[] = [
  { nama: 'Dashboard', desc: 'Ringkasan kehadiran rider dan keaktifan Captain di semua DS', Icon: LayoutDashboard, View: () => <Dashboard /> },
  { nama: 'Data Rider', desc: 'Atur rider: pindahkan ke DS lain, ubah status aktif/nonaktif, import dan unduh CSV', Icon: Users, View: DataRider },
  { nama: 'Jadwal', desc: 'Lihat dan susun jadwal DS mana pun. Biasanya disusun Captain; Super-admin bisa membantu kapan saja.', Icon: CalendarDays, View: () => <JadwalSemua editable /> },
  { nama: 'Daftar Jadwal', desc: 'Jadwal tersimpan semua DS per minggu. Hanya Super-admin dan Arcon yang bisa melihatnya.', Icon: ListChecks, View: () => <DaftarJadwal bolehHapus /> },
  { nama: 'Laporan Absensi Harian', desc: 'Isi atau koreksi absensi rider di DS mana pun', Icon: ClipboardCheck, View: () => <AbsensiSemua /> },
  { nama: 'Rekap Kehadiran', desc: 'Bandingkan jadwal dengan kehadiran sebenarnya, lihat rekap per rider, dan kunci absensi mingguan', Icon: ClipboardList, View: Rekap },
  { nama: 'Kelola DS & Captain', desc: 'Buat DS, atur kuota rider, pilih Captain, dan tambah Super-admin', Icon: Building2, View: () => <Kelola /> },
  { nama: 'Armada', desc: 'Data motor listrik, servis rutin, dan laporan kerusakan di semua DS', Icon: Bike, View: Armada },
  { nama: 'Pengguna', desc: 'Semua pengguna menurut peran: Super-admin, Arcon, Captain, dan rider. Hanya Super-admin yang bisa mengubah status Arcon dan Captain.', Icon: UserCog, View: () => <Pengguna /> },
]
const CAPTAIN: Tab[] = [
  { nama: 'Jadwal Saya', desc: 'Jadwal kerja Anda sebagai rider', Icon: CalendarCheck, View: JadwalSaya },
  { nama: 'Laporan Absensi Harian', desc: 'Tandai rider yang masuk dan tidak masuk hari ini', Icon: ClipboardCheck, View: Daily },
  { nama: 'Jadwal DS', desc: 'Susun jadwal rider di DS Anda per minggu', Icon: CalendarDays, View: JadwalDs },
  { nama: 'Rekap Kehadiran', desc: 'Rekap kehadiran, alpha, dan pengganti di DS Anda', Icon: TrendingUp, View: Rekap },
  { nama: 'Armada', desc: 'Lihat motor listrik di DS Anda dan laporkan kerusakan', Icon: Bike, View: Armada },
  { nama: 'Rider DS', desc: 'Kelola rider DS Anda dan tarik rider dari DS lain', Icon: Users, View: DataRider },
]
// Arcon: atasan Captain, memantau beberapa DS. Boleh menyusun jadwal (termasuk otomatis), mengatur kebutuhan harian, mengunci absensi mingguan, dan menonaktifkan rider; absensi harian tetap dikerjakan Captain.
const ARCON: Tab[] = [
  { nama: 'Dashboard', desc: 'Ringkasan kehadiran rider dan keaktifan Captain di DS yang Anda pegang', Icon: LayoutDashboard, View: () => <Dashboard /> },
  { nama: 'Data Rider', desc: 'Lihat rider di DS yang Anda pegang, tambah rider baru, dan nonaktifkan rider yang sudah tidak jalan', Icon: Users, View: DataRider },
  { nama: 'Jadwal', desc: 'Lihat dan susun jadwal DS yang Anda pegang, termasuk Susun otomatis. Biasanya disusun Captain; Arcon bisa membantu kapan saja.', Icon: CalendarDays, View: ({ dsList }) => <JadwalSemua daftar={dsList} editable /> },
  { nama: 'Daftar Jadwal', desc: 'Jadwal tersimpan semua DS yang Anda pegang, per minggu', Icon: ListChecks, View: () => <DaftarJadwal /> },
  { nama: 'Armada', desc: 'Kelola motor listrik, servis rutin, dan kerusakan di DS yang Anda pegang', Icon: Bike, View: Armada },
  { nama: 'Rekap Kehadiran', desc: 'Bandingkan jadwal dengan kehadiran sebenarnya dan kunci absensi mingguan di DS Anda', Icon: ClipboardList, View: Rekap },
  { nama: 'Kelola DS', desc: 'Atur kebutuhan rider per shift dan tunjuk Captain untuk DS yang Anda pegang', Icon: Building2, View: ({ dsList }) => <KelolaArcon dsList={dsList} /> },
]
const RIDER: Tab[] = [{ nama: 'Jadwal Saya', desc: 'Jadwal kerja Anda', Icon: CalendarCheck, View: JadwalSaya }]

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [kode, setKode] = useState(() => store.get('kode') ?? '')
  const [pemulihan, setPemulihan] = useState(false) // true saat pengguna membuka tautan reset password dari email

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = sb.auth.onAuthStateChange((e, s) => {
      setSession(s)
      if (e === 'PASSWORD_RECOVERY') setPemulihan(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <p className="p-6 text-muted-foreground">Memuat…</p>
  if (session && pemulihan) return <PasswordBaru selesai={() => { setPemulihan(false); history.replaceState(null, '', location.pathname) }} />
  if (session) return <AdminApp email={session.user.email ?? ''} />
  if (kode) return <RiderApp kode={kode} out={() => { store.del('kode'); setKode('') }} />
  return <Login onKode={(k) => { store.set('kode', k); setKode(k) }} />
}

const initials = (n: string) => n.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')

// Satu halaman login, toggle Admin (email+password) / Rider (Kode MTR)
function Login({ onKode }: { onKode: (k: string) => void }) {
  const [tab, setTab] = useState<'admin' | 'rider'>('admin')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  // tautan reset yang kedaluwarsa dikembalikan Supabase lewat #error=... di alamat
  const [err, setErr] = useState(() => (/error_code=otp_expired|error=access_denied/.test(location.hash) ? 'Tautan reset sudah kedaluwarsa atau tidak valid. Minta tautan baru lewat "Lupa password".' : ''))
  const [busy, setBusy] = useState(false)
  const [lupa, setLupa] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    if (tab === 'admin') {
      const { error } = await sb.auth.signInWithPassword({ email: a.trim(), password: b })
      // hanya kredensial yang salah yang disebut "salah"; gangguan sinyal HP tampil apa adanya (diterjemahkan oleh Err)
      if (error) setErr(/invalid login credentials/i.test(error.message) ? 'Email atau password salah' : error.message)
    } else {
      const { data, error } = await sb.rpc('jadwal_rider', { p_kode: a })
      if (error) setErr(error.message)
      else if (data?.length) onKode(a.trim().toUpperCase())
      else setErr('Kode MTR tidak ditemukan atau rider nonaktif')
    }
    setBusy(false)
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-2">
      <div className="hidden md:flex flex-col justify-between p-12 text-white bg-gradient-to-br from-primary via-primary to-primary-deep relative overflow-hidden">
        <div className="absolute -right-24 -bottom-24 size-96 rounded-full bg-white/10" />
        <div className="absolute -right-4 top-32 size-40 rounded-full bg-white/5" />
        <div className="flex items-center gap-3 relative">
          <div className="size-10 rounded-xl bg-card text-primary font-display font-bold text-lg flex items-center justify-center">D</div>
          <div className="font-display font-bold text-lg">Dash Electric</div>
        </div>
        <div className="relative">
          <h2 className="text-4xl font-bold leading-tight mb-4">Jadwal rapi.<br />Kehadiran terpantau.</h2>
          <p className="text-white/80 max-w-sm mb-8">Captain menyusun jadwal dan mencatat siapa yang masuk setiap hari. Super-admin bisa langsung melihat rekap kehadiran tanpa menghitung manual.</p>
          <ul className="space-y-3 text-sm">
            {[
              [CalendarDays, 'Jadwal per DS disusun langsung oleh Captain'],
              [ClipboardCheck, 'Absensi harian cepat, cukup satu klik untuk hadir'],
              [ShieldCheck, 'Data tiap DS aman: Captain hanya bisa membuka DS-nya sendiri'],
            ].map(([I, t]) => {
              const Icon = I as LucideIcon
              return (
                <li key={t as string} className="flex items-center gap-3">
                  <span className="size-8 rounded-lg bg-white/15 flex items-center justify-center"><Icon size={16} /></span>
                  {t as string}
                </li>
              )
            })}
          </ul>
        </div>
        <div className="relative font-mono text-[11px] uppercase tracking-widest text-white/60">Sistem internal · Dash ORCA · Orbit &amp; Cadence</div>
      </div>

      <div className="relative flex items-center justify-center p-6 min-h-screen md:min-h-0">
        <div className="absolute top-4 right-4"><TemaSwitch /></div>
        {lupa ? <LupaPassword emailAwal={a} balik={() => setLupa(false)} /> : (
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="md:hidden flex items-center gap-3 mb-8">
            <Logo />
            <div className="font-brand text-xl leading-none"><span className="font-medium">DASH </span><span className="font-extrabold text-primary">ORCA</span></div>
          </div>
          <h1 className="text-2xl font-bold mb-1">Masuk</h1>
          <p className="text-sm text-muted-foreground mb-6">Pilih cara masuk sesuai peran Anda.</p>
          <div className="grid grid-cols-2 gap-1 p-1 mb-5 rounded-lg bg-muted">
            {(['admin', 'rider'] as const).map((t) => (
              <button type="button" key={t} onClick={() => { setTab(t); setErr('') }} className={`tab text-center !px-2 ${tab === t ? 'tab-on' : ''}`}>
                {t === 'admin' ? 'Captain / Admin' : 'Rider'}
              </button>
            ))}
          </div>
          <label className="lbl">{tab === 'admin' ? 'Email' : 'Kode MTR'}</label>
          <input
            className="inp w-full mb-4 !py-2.5"
            type={tab === 'admin' ? 'email' : 'text'}
            inputMode={tab === 'admin' ? 'email' : 'text'}
            autoComplete={tab === 'admin' ? 'username' : 'off'}
            autoCapitalize={tab === 'admin' ? 'none' : 'characters'}
            autoCorrect="off"
            spellCheck={false}
            value={a}
            onChange={(e) => setA(e.target.value)}
            autoFocus
            placeholder={tab === 'admin' ? 'nama@dashelectric.co' : 'MTR001'}
          />
          {tab === 'admin' && (
            <>
              <label className="lbl">Password</label>
              <InputPassword value={b} onChange={setB} autoComplete="current-password" />
              <div className="-mt-2 mb-4 text-right">
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => { setLupa(true); setErr('') }}>Lupa password / buat password?</button>
              </div>
            </>
          )}
          <Err msg={err} />
          <button className="btn btn-lg w-full" disabled={busy || !a.trim() || (tab === 'admin' && !b)}>{busy ? 'Memproses…' : 'Masuk'}</button>
          <p className="text-xs text-muted-foreground/70 mt-6 text-center">Akun Captain dan Arcon dibuat oleh Super-admin. Belum punya password atau lupa? Klik "Lupa password" di atas.</p>
        </form>
        )}
      </div>
    </div>
  )
}

// Kolom password dengan tombol tampilkan / sembunyikan
function InputPassword({ value, onChange, autoFocus, autoComplete }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; autoComplete?: string }) {
  const [lihat, setLihat] = useState(false)
  return (
    <div className="relative mb-4">
      <input className="inp w-full !py-2.5 !pr-11" type={lihat ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} autoComplete={autoComplete} />
      <button type="button" onClick={() => setLihat(!lihat)} aria-label={lihat ? 'Sembunyikan password' : 'Tampilkan password'} title={lihat ? 'Sembunyikan password' : 'Tampilkan password'} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground">
        {lihat ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}

// Lupa password / buat password pertama kali: Supabase mengirim tautan ke email, tautan membuka layar PasswordBaru.
// Tidak ada pengaturan password langsung dari halaman ini, jadi orang lain tidak bisa mengganti password hanya dengan tahu email.
function LupaPassword({ emailAwal, balik }: { emailAwal: string; balik: () => void }) {
  const [email, setEmail] = useState(emailAwal.includes('@') ? emailAwal : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [terkirim, setTerkirim] = useState('')
  const [tunggu, setTunggu] = useState(0) // jeda 60 detik sebelum boleh kirim ulang, supaya tidak menghabiskan jatah email
  useEffect(() => {
    if (tunggu <= 0) return
    const t = setTimeout(() => setTunggu(tunggu - 1), 1000)
    return () => clearTimeout(t)
  }, [tunggu])

  async function kirim(e: FormEvent) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin })
    setBusy(false)
    if (error) return setErr(/rate limit|too many|seconds/i.test(error.message) ? 'Terlalu sering meminta tautan. Tunggu beberapa menit lalu coba lagi.' : 'Tautan belum bisa dikirim. Periksa email Anda lalu coba lagi.')
    setTerkirim(email.trim())
    setTunggu(60)
  }

  return (
    <form onSubmit={kirim} className="w-full max-w-sm">
      <div className="md:hidden flex items-center gap-3 mb-8">
        <Logo />
        <div className="font-brand text-xl leading-none"><span className="font-medium">DASH </span><span className="font-extrabold text-primary">ORCA</span></div>
      </div>
      <h1 className="text-2xl font-bold mb-1">Lupa password</h1>
      <p className="text-sm text-muted-foreground mb-6">Masukkan email akun Anda. Kami kirim tautan untuk membuat password baru. Cara ini juga dipakai untuk membuat password pertama kali.</p>
      {terkirim && (
        <div className="mb-4 rounded-lg border border-primary/30 bg-primary-soft p-3 text-sm text-primary-soft-foreground">
          Jika <b>{terkirim}</b> terdaftar, tautan sudah dikirim. Periksa kotak masuk dan folder spam, lalu buka tautannya.
        </div>
      )}
      <label className="lbl">Email</label>
      <input className="inp w-full mb-4 !py-2.5" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="nama@dashelectric.co" />
      <Err msg={err} />
      <button className="btn btn-lg w-full" disabled={busy || !email.trim() || tunggu > 0}>
        {busy ? 'Mengirim…' : tunggu > 0 ? `Kirim ulang dalam ${tunggu} detik` : terkirim ? 'Kirim ulang tautan' : 'Kirim tautan reset'}
      </button>
      <button type="button" onClick={balik} className="mt-3 w-full text-xs text-primary hover:underline">Kembali ke login</button>
    </form>
  )
}

// Layar setelah pengguna membuka tautan reset dari email: buat password baru
function PasswordBaru({ selesai }: { selesai: () => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const kurang = pw.length < 8 ? 'Password minimal 8 karakter' : pw !== pw2 ? 'Konfirmasi password belum sama' : ''

  async function simpan(e: FormEvent) {
    e.preventDefault()
    if (kurang) return setErr(kurang)
    setErr('')
    setBusy(true)
    const { error } = await sb.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) {
      return setErr(
        /same|different from the old/i.test(error.message) ? 'Password baru tidak boleh sama dengan password lama.'
        : /weak|short|characters/i.test(error.message) ? 'Password terlalu lemah. Pakai minimal 8 karakter, campur huruf dan angka.'
        : 'Password belum bisa disimpan. Tautan mungkin sudah kedaluwarsa, minta tautan baru lewat Lupa password.',
      )
    }
    toast.ok('Password baru tersimpan. Anda sudah masuk.')
    selesai()
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center p-6">
      <div className="absolute top-4 right-4"><TemaSwitch /></div>
      <form onSubmit={simpan} className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8">
          <Logo />
          <div className="font-brand text-xl leading-none"><span className="font-medium">DASH </span><span className="font-extrabold text-primary">ORCA</span></div>
        </div>
        <h1 className="text-2xl font-bold mb-1">Buat password baru</h1>
        <p className="text-sm text-muted-foreground mb-6">Pilih password yang mudah Anda ingat tapi sulit ditebak. Minimal 8 karakter.</p>
        <label className="lbl">Password baru</label>
        <InputPassword value={pw} onChange={setPw} autoFocus autoComplete="new-password" />
        <label className="lbl">Ulangi password baru</label>
        <InputPassword value={pw2} onChange={setPw2} autoComplete="new-password" />
        <Err msg={err} />
        <button className="btn btn-lg w-full" disabled={busy || !pw || !pw2}>{busy ? 'Menyimpan…' : 'Simpan password'}</button>
        <button type="button" onClick={async () => { await sb.auth.signOut(); selesai() }} className="mt-3 w-full text-xs text-primary hover:underline">Batal dan kembali ke login</button>
      </form>
    </div>
  )
}

function AdminApp({ email }: { email: string }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const [ds, setDs] = useState<Ds | null>(null)
  const [dsList, setDsList] = useState<Ds[]>([])
  const [tab, setTab] = useState(0)
  const [galat, setGalat] = useState('')
  const tabBar = useRef<HTMLElement>(null)

  useEffect(() => {
    ;(async () => {
      const { data, error } = await sb.from('riders').select('id,nama,peran,ds_id,email').eq('email', email.toLowerCase()).maybeSingle()
      // gagal memuat (mis. sinyal HP putus) bukan berarti akun tidak terdaftar
      if (error) return setGalat(error.message)
      // DS dimuat lebih dulu daripada me, supaya Captain tidak sempat melihat "belum ditunjuk" sebelum DS-nya terbaca
      if (data?.peran === 'arcon') {
        const r = await sb.from('ds').select('*').eq('arcon_id', data.id).order('nama')
        setDsList((r.data ?? []) as Ds[])
      }
      if (data?.peran === 'captain') {
        const r = await sb.from('ds').select('*').eq('captain_id', data.id).maybeSingle()
        setDs(r.data as Ds | null)
      }
      setMe(data as Me | null)
    })()
  }, [email])

  // Ganti menu: halaman kembali ke atas dan tab yang aktif digeser ke tengah bar tab (di HP bar-nya bisa digulir)
  useEffect(() => {
    window.scrollTo(0, 0)
    tabBar.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [tab])

  if (galat)
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-sm card text-center !p-6">
          <ShieldCheck className="mx-auto mb-3 text-muted-foreground/70" size={32} />
          <p className="mb-4 text-sm">Data akun belum bisa dimuat. Periksa internet Anda lalu coba lagi.</p>
          <button className="btn" onClick={() => location.reload()}>Muat ulang</button>
        </div>
      </div>
    )
  if (me === undefined) return <p className="p-6 text-muted-foreground">Memuat…</p>
  if (me === null)
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-sm card text-center !p-6">
          <ShieldCheck className="mx-auto mb-3 text-muted-foreground/70" size={32} />
          <p className="mb-4 text-sm">Email <b>{email}</b> belum terdaftar sebagai Captain atau Super-admin, atau akunnya sedang nonaktif. Hubungi Super-admin.</p>
          <button className="btn" onClick={() => sb.auth.signOut()}>Keluar</button>
        </div>
      </div>
    )

  const tabs = me.peran === 'super_admin' ? SUPER : me.peran === 'captain' ? CAPTAIN : me.peran === 'arcon' ? ARCON : RIDER
  const lokasi = ds ? ds.nama : me.peran === 'arcon' ? `${dsList.length} DS` : ''
  const cur = tabs[tab] ?? tabs[0]
  const peran = me.peran.replace('_', '-')
  const tgl = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden md:flex w-64 shrink-0 flex-col sidebar-bg text-sidebar-foreground p-4 sticky top-0 h-screen overflow-hidden">
        <div className="flex items-center gap-3 px-2 mb-8 mt-1">
          <Logo small />
          <div>
            <div className="font-brand text-lg leading-none text-white"><span className="font-medium">DASH </span><span className="font-extrabold">ORCA</span></div>
            <div className="text-[10px] tracking-wide mt-1.5 text-white/50">Orbit &amp; Cadence</div>
          </div>
        </div>
        <div className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">Menu</div>
        <nav className="space-y-1 flex-1 overflow-y-auto">
          {tabs.map((t, i) => (
            <button key={t.nama} onClick={() => setTab(i)} className={`nav ${i === tab ? 'nav-on' : ''}`}>
              <t.Icon size={18} />
              {t.nama}
            </button>
          ))}
        </nav>
        <div className="mt-3 rounded-2xl bg-white/[0.05] ring-1 ring-white/10 p-2.5 flex items-center gap-2">
          <div className="size-9 rounded-full bg-primary text-white text-sm font-bold flex items-center justify-center">{initials(me.nama)}</div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-sm font-semibold text-white truncate">{me.nama}</div>
            <div className="font-mono text-[10px] uppercase tracking-wider truncate">{peran}{lokasi ? ` · ${lokasi}` : ''}</div>
          </div>
          <TemaToggle className="hover:!bg-white/10 hover:text-white !p-1.5" />
          <button onClick={() => sb.auth.signOut()} title="Keluar" className="p-2 rounded-md hover:bg-white/10 hover:text-white"><LogOut size={16} /></button>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <div className="md:hidden bg-sidebar text-white px-4 py-3 flex items-center gap-3">
          <Logo small />
          <div className="flex-1 leading-tight min-w-0">
            <div className="text-sm font-semibold truncate">{me.nama}</div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-sidebar-foreground truncate">{peran}{lokasi ? ` · ${lokasi}` : ''}</div>
          </div>
          <TemaToggle className="hover:!bg-white/10" />
          <button onClick={() => sb.auth.signOut()} className="p-2"><LogOut size={18} /></button>
        </div>
        <nav ref={tabBar} className="md:hidden flex gap-1 p-2 bg-card border-b border-border overflow-x-auto no-scrollbar">
          {tabs.map((t, i) => (
            <button key={t.nama} onClick={() => setTab(i)} aria-current={i === tab ? 'page' : undefined} className={`tab ${i === tab ? 'tab-on' : ''}`}>{t.nama}</button>
          ))}
        </nav>

        <header className="px-4 md:px-8 pt-4 pb-4 md:pt-6 md:pb-5 flex flex-wrap items-center gap-3 md:gap-4 border-b border-border bg-card/80 backdrop-blur md:sticky md:top-0 z-10"><div className="size-12 rounded-2xl bg-primary-soft text-primary flex items-center justify-center"><cur.Icon size={24} /></div>
          <div className="flex-1 min-w-60">
            <h2 className="text-xl md:text-2xl font-bold">{cur.nama}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{cur.desc}</p>
          </div>
          <span className="hidden lg:inline font-mono text-xs text-muted-foreground bg-muted rounded-full px-3 py-1.5">{tgl}</span>
          <div className="hidden md:block"><TemaSwitch /></div>
        </header>
        <main className="px-4 md:px-8 py-6 max-w-6xl">
          {me.peran === 'captain' && <Notif me={me} />}
          <div key={tab} className="rise"><cur.View me={me} ds={ds} dsList={dsList} /></div>
        </main>
      </div>
    </div>
  )
}

// Captain lama dinotifikasi saat ridernya ditarik
function Notif({ me }: { me: Me }) {
  const n = useRows<{ id: string; pesan: string }>(
    () => sb.from('notifikasi').select('id,pesan').eq('penerima_id', me.id).eq('dibaca', false).order('waktu', { ascending: false }),
    [me.id],
  )
  if (!n.rows.length) return null
  return (
    <div className="bg-primary-soft border border-primary/30 rounded-xl p-3 mb-4 text-sm space-y-1">
      {n.rows.map((x) => (
        <div key={x.id} className="flex items-center gap-2">
          <BellRing size={16} className="text-primary shrink-0" />
          <span>{x.pesan}</span>
          <button className="underline text-primary-soft-foreground ml-auto shrink-0" onClick={async () => { await sb.from('notifikasi').update({ dibaca: true }).eq('id', x.id); n.reload() }}>
            Tandai sudah dibaca
          </button>
        </div>
      ))}
    </div>
  )
}
