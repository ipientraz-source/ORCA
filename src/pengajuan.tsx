// Pengajuan Arcon: Arcon mengajukan DS baru atau menjadi Arcon di sebuah DS; Super-admin menyetujui atau menolak.
// Menulis hanya lewat fungsi database (ajukan_*, batalkan_pengajuan, putuskan_pengajuan); tabelnya tidak bisa ditulis langsung.
import { useEffect, useState, type FormEvent } from 'react'
import { sb, useRows, ok, toast, konfirmasi, Err, Field, Kosong, Select, usePage, Pagination, type Ds, type Me } from './lib'

type Aju = {
  id: string; jenis: 'ds_baru' | 'jadi_arcon'; pemohon_id: string | null; pemohon_nama: string; ds_id: string | null; nama_ds: string
  kuota_pagi: number | null; kuota_siang: number | null; alasan: string; status: 'menunggu' | 'disetujui' | 'ditolak' | 'dibatalkan'
  dibuat: string; diputuskan_nama: string | null; diputuskan_pada: string | null; catatan: string | null
}

const STATUS: Record<Aju['status'], [string, string]> = {
  menunggu: ['Menunggu', 'bg-warning/10 text-warning'],
  disetujui: ['Disetujui', 'bg-success/10 text-success'],
  ditolak: ['Ditolak', 'bg-danger/10 text-danger'],
  dibatalkan: ['Dibatalkan', 'bg-muted text-muted-foreground'],
}
const tgl = (s: string) => new Date(s).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' })
const rincian = (a: Aju) => (a.jenis === 'ds_baru' ? `DS baru ${a.nama_ds} (pagi ${a.kuota_pagi}, siang ${a.kuota_siang})` : `Jadi Arcon di ${a.nama_ds}`)
const BERUBAH = 'pengajuan-berubah'
const kabarkan = () => window.dispatchEvent(new Event(BERUBAH))

const Lencana = ({ s }: { s: Aju['status'] }) => <span className={`badge ${STATUS[s][1]}`}>{STATUS[s][0]}</span>

// Angka kecil di menu Super-admin: berapa pengajuan menunggu
export function LencanaPengajuan() {
  const q = useRows<{ id: string }>(() => sb.from('pengajuan_arcon').select('id').eq('status', 'menunggu'), [])
  useEffect(() => {
    const t = setInterval(q.reload, 60000)
    window.addEventListener(BERUBAH, q.reload)
    return () => { clearInterval(t); window.removeEventListener(BERUBAH, q.reload) }
  })
  return q.rows.length ? <span className="ml-auto rounded-full bg-warning px-1.5 text-[10px] font-bold text-white">{q.rows.length}</span> : null
}

export function Pengajuan({ me }: { me: Me }) {
  const sup = me.peran === 'super_admin'
  const aju = useRows<Aju>(() => sb.from('pengajuan_arcon').select('*').order('dibuat', { ascending: false }).limit(1000), [])
  const dsl = useRows<Ds>(() => sb.from('ds').select('*').order('nama'), [])
  const arcon = useRows<{ id: string; nama: string }>(() => (sup ? sb.from('riders').select('id,nama').eq('peran', 'arcon') : sb.from('riders').select('id,nama').eq('id', me.id)), [])
  const muat = () => { aju.reload(); dsl.reload(); kabarkan() }
  const menunggu = aju.rows.filter((a) => a.status === 'menunggu')
  const selesai = aju.rows.filter((a) => a.status !== 'menunggu')
  const pgSelesai = usePage(selesai, [])
  const pgSaya = usePage(aju.rows, [])

  if (sup) {
    return (
      <div className="space-y-3">
        <Err msg={aju.err} />
        <h3 className="text-sm font-semibold">Menunggu keputusan <span className="text-muted-foreground">({menunggu.length})</span></h3>
        {!menunggu.length && <div className="card"><Kosong teks="Tidak ada pengajuan yang menunggu" hint="Pengajuan Arcon muncul di sini." /></div>}
        {menunggu.map((a) => <Menunggu key={a.id} a={a} dsl={dsl.rows} arcon={arcon.rows} selesai={muat} />)}
        <h3 className="pt-2 text-sm font-semibold">Riwayat keputusan</h3>
        {!selesai.length ? <div className="card"><Kosong teks="Belum ada keputusan" /></div> : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Tanggal</th><th>Pemohon</th><th>Pengajuan</th><th>Status</th><th>Diputuskan oleh</th><th>Catatan</th></tr></thead>
                <tbody>
                  {pgSelesai.rows.map((a) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap">{tgl(a.dibuat)}</td><td>{a.pemohon_nama}</td><td>{rincian(a)}</td>
                      <td><Lencana s={a.status} /></td><td>{a.diputuskan_nama ?? '—'}</td><td className="text-muted-foreground">{a.catatan ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...pgSelesai} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <FormDsBaru selesai={muat} />
        <FormJadiArcon dsl={dsl.rows.filter((d) => d.arcon_id !== me.id)} selesai={muat} />
      </div>
      <Err msg={aju.err} />
      <h3 className="text-sm font-semibold">Pengajuan saya</h3>
      {!aju.rows.length ? <div className="card"><Kosong teks="Belum ada pengajuan" hint="Semua pengajuan menunggu persetujuan Super-admin." /></div> : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Tanggal</th><th>Pengajuan</th><th>Alasan</th><th>Status</th><th>Catatan Super-admin</th><th></th></tr></thead>
              <tbody>
                {pgSaya.rows.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">{tgl(a.dibuat)}</td><td>{rincian(a)}</td><td className="text-muted-foreground">{a.alasan}</td>
                    <td><Lencana s={a.status} /></td><td className="text-muted-foreground">{a.catatan ?? ''}</td>
                    <td className="text-right">
                      {a.status === 'menunggu' && (
                        <button className="btn2" onClick={async () => { if (await konfirmasi('Pengajuan ini dibatalkan dan tidak diproses.', { judul: 'Batalkan pengajuan?', ya: 'Batalkan', bahaya: true }) && (await ok(sb.rpc('batalkan_pengajuan', { p_id: a.id })))) muat() }}>Batalkan</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...pgSaya} />
        </div>
      )}
    </div>
  )
}

function FormDsBaru({ selesai }: { selesai: () => void }) {
  const [f, setF] = useState({ nama: '', pagi: '', siang: '', alasan: '' })
  const [sibuk, setSibuk] = useState(false)
  const kirim = async (e: FormEvent) => {
    e.preventDefault()
    if (f.pagi === '' || f.siang === '') return toast('Isi kebutuhan rider pagi dan siang')
    setSibuk(true)
    if (await ok(sb.rpc('ajukan_ds_baru', { p_nama: f.nama, p_pagi: Number(f.pagi), p_siang: Number(f.siang), p_alasan: f.alasan }))) {
      toast.ok('Pengajuan DS baru terkirim, menunggu Super-admin')
      setF({ nama: '', pagi: '', siang: '', alasan: '' })
      selesai()
    }
    setSibuk(false)
  }
  return (
    <form onSubmit={kirim} className="card space-y-2">
      <b className="block">Ajukan DS baru</b>
      <p className="text-xs text-muted-foreground">Jika disetujui, DS dibuat dan Anda menjadi Arcon-nya.</p>
      <Field label="Nama DS"><input className="inp w-full" value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} placeholder="mis. DS CIBUBUR" /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Rider per shift pagi"><input className="inp w-full" type="number" min={0} inputMode="numeric" value={f.pagi} onChange={(e) => setF({ ...f, pagi: e.target.value })} /></Field>
        <Field label="Rider per shift siang"><input className="inp w-full" type="number" min={0} inputMode="numeric" value={f.siang} onChange={(e) => setF({ ...f, siang: e.target.value })} /></Field>
      </div>
      <Field label="Alasan"><input className="inp w-full" value={f.alasan} onChange={(e) => setF({ ...f, alasan: e.target.value })} placeholder="Kenapa DS ini perlu dibuka" /></Field>
      <button className="btn" disabled={sibuk}>{sibuk ? 'Mengirim…' : 'Kirim pengajuan'}</button>
    </form>
  )
}

function FormJadiArcon({ dsl, selesai }: { dsl: Ds[]; selesai: () => void }) {
  const [ds, setDs] = useState('')
  const [alasan, setAlasan] = useState('')
  const [sibuk, setSibuk] = useState(false)
  const kirim = async (e: FormEvent) => {
    e.preventDefault()
    setSibuk(true)
    if (await ok(sb.rpc('ajukan_jadi_arcon', { p_ds: ds, p_alasan: alasan }))) {
      toast.ok('Pengajuan terkirim, menunggu Super-admin')
      setDs('')
      setAlasan('')
      selesai()
    }
    setSibuk(false)
  }
  return (
    <form onSubmit={kirim} className="card space-y-2">
      <b className="block">Ajukan jadi Arcon di DS</b>
      <p className="text-xs text-muted-foreground">Untuk DS yang belum Anda pegang. Berlaku setelah Super-admin menyetujui.</p>
      <Field label="DS">
        <Select value={ds} onChange={setDs} placeholder="Pilih DS" opsi={dsl.map((d) => ({ value: d.id, label: d.nama + (d.arcon_id ? ' (sudah ada Arcon)' : ' (belum ada Arcon)') }))} />
      </Field>
      <Field label="Alasan"><input className="inp w-full" value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="Kenapa Anda perlu memegang DS ini" /></Field>
      <button className="btn" disabled={sibuk || !ds}>{sibuk ? 'Mengirim…' : 'Kirim pengajuan'}</button>
    </form>
  )
}

function Menunggu({ a, dsl, arcon, selesai }: { a: Aju; dsl: Ds[]; arcon: { id: string; nama: string }[]; selesai: () => void }) {
  const [catatan, setCatatan] = useState('')
  const [sibuk, setSibuk] = useState(false)
  const lama = a.jenis === 'jadi_arcon' ? dsl.find((d) => d.id === a.ds_id)?.arcon_id ?? null : null
  const putus = async (setuju: boolean) => {
    if (!setuju && !catatan.trim()) return toast('Isi alasan penolakan di kolom catatan')
    const msg = setuju
      ? a.jenis === 'ds_baru' ? `DS ${a.nama_ds} dibuat dan ${a.pemohon_nama} menjadi Arcon-nya.` : `${a.pemohon_nama} menjadi Arcon di ${a.nama_ds}${lama && lama !== a.pemohon_id ? `, menggantikan ${arcon.find((x) => x.id === lama)?.nama ?? 'Arcon sebelumnya'}` : ''}.`
      : `Pengajuan ${a.pemohon_nama} ditolak.`
    if (!(await konfirmasi(msg, { judul: setuju ? 'Setujui pengajuan?' : 'Tolak pengajuan?', ya: setuju ? 'Setujui' : 'Tolak', bahaya: !setuju }))) return
    setSibuk(true)
    if (await ok(sb.rpc('putuskan_pengajuan', { p_id: a.id, p_setuju: setuju, p_catatan: catatan }))) selesai()
    setSibuk(false)
  }
  return (
    <div className="card !mb-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge bg-primary-soft text-primary">{a.jenis === 'ds_baru' ? 'DS baru' : 'Jadi Arcon'}</span>
        <b>{rincian(a)}</b>
        <span className="ml-auto text-xs text-muted-foreground">{a.pemohon_nama} · {tgl(a.dibuat)}</span>
      </div>
      <p className="text-sm text-muted-foreground">Alasan: {a.alasan}</p>
      {lama && lama !== a.pemohon_id && <p className="text-xs text-warning">DS ini sekarang dipegang {arcon.find((x) => x.id === lama)?.nama ?? 'Arcon lain'}; bila disetujui, digantikan pemohon.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input className="inp min-w-48 flex-1" placeholder="Catatan (wajib bila ditolak)" value={catatan} onChange={(e) => setCatatan(e.target.value)} />
        <button className="btn" disabled={sibuk} onClick={() => putus(true)}>Setujui</button>
        <button className="btn2 text-danger" disabled={sibuk} onClick={() => putus(false)}>Tolak</button>
      </div>
    </div>
  )
}
