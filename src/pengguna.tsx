// Pengguna: semua orang di sistem dikelompokkan menurut peran (Super-admin, Arcon, Captain, Rider). Hanya Super-admin.
import { useState } from 'react'
import { Network, ShieldCheck, UserCog, UserPlus, Users } from 'lucide-react'
import { DialogBerhenti } from './berhenti'
import { sb, useRows, ok, toast, konfirmasi, Err, Kosong, Stat, usePage, Pagination, type Ds, type Peran, type Rider } from './lib'

const PERAN: Record<Peran, { label: string; gaya: string; ket: string }> = {
  super_admin: { label: 'Super-admin', gaya: 'bg-primary text-primary-foreground', ket: 'Akses penuh ke semua DS' },
  arcon: { label: 'Arcon', gaya: 'bg-primary-soft text-primary-soft-foreground', ket: 'Memantau beberapa DS (hanya lihat)' },
  captain: { label: 'Captain', gaya: 'bg-warning-soft text-warning', ket: 'Mengelola satu DS' },
  recruiter: { label: 'Recruiter', gaya: 'bg-success-soft text-success', ket: 'Merekrut rider baru untuk semua DS' },
  rider: { label: 'Rider', gaya: 'bg-muted text-foreground/80', ket: 'Masuk dengan Kode MTR' },
}
const URUT: Peran[] = ['super_admin', 'arcon', 'captain', 'recruiter', 'rider']

export function Pengguna() {
  const rs = useRows<Rider>(() => sb.from('riders').select('*').order('nama').limit(1000), [])
  const dsl = useRows<Ds>(() => sb.from('ds').select('*').order('nama'), [])
  const [f, setF] = useState<'semua' | 'perlu' | Peran>('semua')
  const [q, setQ] = useState('')
  const jml = (p: Peran) => rs.rows.filter((r) => r.peran === p).length
  const dsNama = (id: string | null) => dsl.rows.find((d) => d.id === id)?.nama
  // DS yang dipegang: Arcon dan Captain menurut penunjukan di tabel DS; rider menurut DS tempatnya bekerja
  const dipegang = (r: Rider): string[] =>
    r.peran === 'arcon' ? dsl.rows.filter((d) => d.arcon_id === r.id).map((d) => d.nama)
    : r.peran === 'captain' ? dsl.rows.filter((d) => d.captain_id === r.id).map((d) => d.nama)
    : r.peran === 'rider' && dsNama(r.ds_id) ? [dsNama(r.ds_id)!]
    : []
  // Rider masuk dengan Kode MTR; akun beremail seharusnya Arcon/Captain. Rider beremail (mis. bekas Captain) perlu dibereskan.
  const beremail = rs.rows.filter((r) => r.peran === 'rider' && r.email)
  const fa = f === 'perlu' && !beremail.length ? 'semua' : f // tab "Perlu dicek" hilang bila sudah beres semua
  const tampil = rs.rows
    .filter((r) => fa === 'semua' || (fa === 'perlu' ? r.peran === 'rider' && !!r.email : r.peran === fa))
    .filter((r) => `${r.nama} ${r.email ?? ''} ${r.kode_mtr ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => URUT.indexOf(a.peran) - URUT.indexOf(b.peran) || a.nama.localeCompare(b.nama))
  const pg = usePage(tampil, [f, q])

  const [berhenti, setBerhenti] = useState<Rider | null>(null) // rider yang dinonaktifkan wajib beralasan (angka turnover)
  const ubahStatus = async (r: Rider) => {
    if (r.status === 'aktif' && r.peran === 'rider') return setBerhenti(r)
    const ke = r.status === 'aktif' ? 'nonaktif' : 'aktif'
    const nonaktif = ke === 'nonaktif'
    const yakin = await konfirmasi(
      nonaktif ? `${r.nama} (${PERAN[r.peran].label}) tidak akan dihitung sebagai anggota aktif. Data dan riwayatnya tetap tersimpan.` : `${r.nama} akan aktif kembali.`,
      { judul: nonaktif ? `Nonaktifkan ${r.nama}?` : `Aktifkan ${r.nama}?`, ya: nonaktif ? 'Nonaktifkan' : 'Aktifkan', bahaya: nonaktif },
    )
    if (yakin && (await ok(sb.from('riders').update({ status: ke }).eq('id', r.id)))) {
      toast.ok(`${r.nama} sekarang ${ke}.`)
      rs.reload()
    }
  }

  const [hapus, setHapus] = useState<Rider | null>(null) // Arcon nonaktif yang akan dihapus (wajib beralasan)

  // Rider beremail: emailnya dihapus, orangnya tetap rider dan masuk dengan Kode MTR
  const hapusEmail = async (r: Rider) => {
    const yakin = await konfirmasi(
      `${r.nama} (${r.email}) tidak akan bisa masuk dengan email lagi dan tetap berperan Rider. ${r.kode_mtr ? `Ia masuk dengan Kode MTR ${r.kode_mtr}.` : 'Ia belum punya Kode MTR, jadi belum bisa masuk sama sekali sampai diberi kode.'}`,
      { judul: `Hapus email ${r.nama}?`, ya: 'Hapus email', bahaya: true },
    )
    if (yakin && (await ok(sb.rpc('hapus_email_rider', { p_rider: r.id })))) {
      toast.ok(`Email ${r.nama} dihapus. Ia tetap rider.`)
      rs.reload()
    }
  }

  // Captain atau rider berakun email naik jabatan: orang, email, dan riwayat tetap.
  // Captain: DS yang dulu dipimpin kehilangan Captain sampai ditunjuk yang baru. Rider: jadwal ke depan dihapus dan motor dilepas.
  const jadikanArcon = async (r: Rider) => {
    const dsnya = dipegang(r)
    const akibat = r.peran === 'captain'
      ? (dsnya.length ? `DS ${dsnya.join(', ')} jadi tanpa Captain sampai Anda menunjuk yang baru. ` : '')
      : 'Jadwal dari hari ini ke depan dihapus dan motor yang dipegangnya dilepas (jadwal dan absensi lama tetap). '
    const yakin = await konfirmasi(
      `${r.nama} (${r.email}) naik jadi Arcon dengan email dan riwayat yang sama. ${akibat}Setelah itu pilih Arcon ini di kartu DS yang akan dipegang.`,
      { judul: `Jadikan ${r.nama} Arcon?`, ya: 'Jadikan Arcon', bahaya: true },
    )
    if (yakin && (await ok(sb.rpc('jadikan_arcon', { p_rider: r.id })))) {
      toast.ok(`${r.nama} sekarang Arcon. Pilih di kartu DS untuk memberinya DS.`)
      rs.reload()
      dsl.reload()
    }
  }

  return (
    <div>
      <Err msg={rs.err || dsl.err} />
      {berhenti && <DialogBerhenti rider={berhenti} tutup={() => setBerhenti(null)} selesai={() => { setBerhenti(null); rs.reload() }} />}
      {hapus && <DialogHapusArcon arcon={hapus} tutup={() => setHapus(null)} selesai={() => { setHapus(null); rs.reload(); dsl.reload() }} />}
      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat icon={ShieldCheck} label="Super-admin" value={jml('super_admin')} />
        <Stat icon={Network} label="Arcon" value={jml('arcon')} />
        <Stat icon={UserCog} label="Captain" value={jml('captain')} />
        <Stat icon={UserPlus} label="Recruiter" value={jml('recruiter')} />
        <Stat icon={Users} label="Rider" value={jml('rider')} tone="zinc" />
      </div>

      {beremail.length > 0 && (
        <div className="mb-4 flex flex-wrap items-start gap-3 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-warning">
          <span className="min-w-60 flex-1">
            <b>{beremail.length} rider punya email login.</b> Rider masuk dengan Kode MTR, sedangkan akun beremail seharusnya Arcon atau Captain (biasanya bekas Captain yang diganti). Pilih per orang: <b>Jadikan Arcon</b>, atau <b>Hapus email</b> (tetap rider, masuk dengan Kode MTR).
          </span>
          {f !== 'perlu' && <button type="button" className="btn2" onClick={() => setF('perlu')}>Lihat daftarnya</button>}
        </div>
      )}

      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="flex flex-wrap gap-1.5">
            {(['semua', ...URUT] as const).map((p) => (
              <button key={p} type="button" className={`tab ${fa === p ? 'tab-on' : ''}`} onClick={() => setF(p)}>
                {p === 'semua' ? 'Semua' : PERAN[p].label} <span className="opacity-70">{p === 'semua' ? rs.rows.length : jml(p)}</span>
              </button>
            ))}
            {beremail.length > 0 && (
              <button type="button" className={`tab ${f === 'perlu' ? 'tab-on' : '!text-warning'}`} onClick={() => setF('perlu')}>
                Perlu dicek <span className="opacity-70">{beremail.length}</span>
              </button>
            )}
          </div>
          <input className="inp ml-auto w-64 max-w-full" placeholder="Cari nama, email, atau Kode MTR" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>Nama</th><th>Peran</th><th>Email / ID Driver</th><th>DS yang dipegang</th><th>Status</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {pg.rows.map((r) => {
                const ds = dipegang(r)
                return (
                  <tr key={r.id}>
                    <td className="font-medium">{r.nama}</td>
                    <td><span className={`badge ${PERAN[r.peran].gaya}`} title={PERAN[r.peran].ket}>{PERAN[r.peran].label}</span></td>
                    <td className={r.email ? 'text-muted-foreground' : 'font-mono text-xs text-muted-foreground'}>{r.email ?? r.kode_mtr ?? '—'}</td>
                    <td>
                      {r.peran === 'super_admin' || r.peran === 'recruiter' ? <span className="text-muted-foreground">{r.peran === 'recruiter' ? 'Rekrutmen (semua DS)' : 'Semua DS'}</span>
                        : ds.length ? <div className="flex flex-wrap gap-1">{ds.map((n) => <span key={n} className="badge bg-muted text-foreground/80">{n}</span>)}</div>
                        : <span className="text-muted-foreground">Belum memegang DS</span>}
                    </td>
                    <td>
                      <button
                        className={r.status === 'aktif' ? 'btn2 capitalize text-success' : 'btn2 capitalize text-muted-foreground'}
                        disabled={r.peran === 'super_admin'}
                        title={r.peran === 'super_admin' ? 'Super-admin tidak dinonaktifkan dari sini, supaya akses penuh tidak hilang tanpa sengaja' : 'Klik untuk mengubah status'}
                        onClick={() => ubahStatus(r)}
                      >
                        {r.status}
                      </button>
                    </td>
                    <td className="whitespace-nowrap">
                      {(r.peran === 'captain' || (r.peran === 'rider' && r.email && r.status === 'aktif')) && (
                        <button className="btn2" disabled={!r.email} title={r.email ? 'Naikkan jadi Arcon' : 'Captain ini belum punya email login'} onClick={() => jadikanArcon(r)}>
                          Jadikan Arcon
                        </button>
                      )}
                      {r.peran === 'rider' && r.email && (
                        <button className="btn2 ml-1.5" title="Hapus email: tetap rider, masuk dengan Kode MTR" onClick={() => hapusEmail(r)}>Hapus email</button>
                      )}
                      {r.peran === 'arcon' && r.status === 'nonaktif' && (
                        <button className="btn2 !text-danger" disabled={ds.length > 0} title={ds.length ? 'Masih memegang DS. Lepas dulu di Kelola DS' : 'Hapus Arcon yang sudah tidak aktif'} onClick={() => setHapus(r)}>
                          Hapus
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!tampil.length && <Kosong teks={rs.rows.length ? 'Tidak ada pengguna yang cocok.' : 'Belum ada pengguna.'} />}
        <div className="p-4"><Pagination {...pg} /></div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Hanya Super-admin yang bisa mengubah status Arcon dan Captain. Captain, atau rider yang sudah punya email login, bisa dinaikkan jadi Arcon dari tombol di barisnya. Arcon yang sudah nonaktif dan tidak memegang DS bisa dihapus. Untuk menunjuk atau mengganti Captain dan Arcon di tiap DS, pakai halaman Kelola DS &amp; Captain.
      </p>
    </div>
  )
}

// Menghapus Arcon yang sudah tidak aktif: alasan wajib dan tercatat di Riwayat. Aktivitas lamanya tetap tampil atas namanya.
function DialogHapusArcon({ arcon, tutup, selesai }: { arcon: Rider; tutup: () => void; selesai: () => void }) {
  const [alasan, setAlasan] = useState('')
  const [proses, setProses] = useState(false)
  const kirim = async () => {
    setProses(true)
    const hasil = await ok(sb.rpc('hapus_arcon', { p_rider: arcon.id, p_alasan: alasan.trim() }))
    setProses(false)
    if (hasil) {
      toast.ok(`${arcon.nama} dihapus`)
      selesai()
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={`Hapus ${arcon.nama}`} onClick={tutup}>
      <div className="card !mb-0 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-lg font-bold">Hapus {arcon.nama}?</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          {arcon.email ? `${arcon.email} tidak bisa masuk lagi. ` : ''}Penghapusan tercatat di Riwayat dan tidak bisa dibatalkan. Aktivitas lamanya tetap tampil atas namanya.
        </p>
        <label className="lbl">Alasan menghapus</label>
        <input autoFocus className="inp w-full" placeholder="mis. sudah pindah divisi" value={alasan} onChange={(e) => setAlasan(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && alasan.trim() && kirim()} />
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn2" onClick={tutup}>Batal</button>
          <button className="btn !bg-danger" disabled={!alasan.trim() || proses} onClick={kirim}>{proses ? 'Menghapus…' : 'Hapus'}</button>
        </div>
      </div>
    </div>
  )
}
