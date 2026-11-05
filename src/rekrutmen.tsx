// Rekrutmen rider: kandidat dengan pipeline (baru → dihubungi → interview → training → diterima / ditolak), kebutuhan rekrut per DS,
// dan "Terima jadi rider". Super-admin dan Recruiter mengelola; Captain dan Arcon hanya melihat kandidat untuk DS yang dipegang (RLS).
import { Fragment, useState } from 'react'
import { Clock, Plus, Search, UserCheck, UserPlus, Users, X } from 'lucide-react'
import { Err, Field, Kosong, Pagination, Select, Stat, ok, sb, toast, usePage, useRows, type Me } from './lib'
import { tgl } from './armada-lib'
import { AngkaRekrutmen } from './rekrutmen-angka'

type Status = 'baru' | 'dihubungi' | 'interview' | 'training' | 'diterima' | 'ditolak'
type Perujuk = { id: string; nama: string; kode_mtr: string | null; ds_nama: string | null }
type Kandidat = { id: string; nama: string; no_hp: string | null; sumber: string | null; perujuk_id: string | null; perujuk_nama: string | null; ds_id: string | null; status: Status; alasan_tolak: string | null; catatan: string | null; rider_id: string | null; dibuat: string; ditutup: string | null }
type KebutuhanDs = { ds_id: string; ds_nama: string; kuota: number; perlu: number; rider_aktif: number; kandidat_proses: number; kurang: number }

const AKTIF: Status[] = ['baru', 'dihubungi', 'interview', 'training']
const LABEL: Record<Status, string> = { baru: 'Baru', dihubungi: 'Dihubungi', interview: 'Interview', training: 'Training', diterima: 'Diterima', ditolak: 'Ditolak' }
const GAYA: Record<Status, string> = {
  baru: 'bg-muted text-foreground/80', dihubungi: 'bg-primary-soft text-primary-soft-foreground', interview: 'bg-warning-soft text-warning',
  training: 'bg-warning-soft text-warning', diterima: 'bg-success-soft text-success', ditolak: 'bg-danger-soft text-danger',
}
const SUMBER = ['Referral rider', 'Walk-in', 'Grup WhatsApp', 'Media sosial', 'Job board', 'Lainnya']
const hari = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5

// Rider hasil rekrutmen dinyatakan mulai aktif saat pertama kali masuk jadwal atau tercatat di laporan Captain
function Penempatan({ p }: { p: { kelas: string; mulai_aktif: string | null } }) {
  const [teks, gaya] = !p.mulai_aktif ? ['Belum masuk jadwal', 'font-semibold text-warning']
    : p.kelas === 'aktif' ? [`Aktif sejak ${tgl(p.mulai_aktif)}`, 'text-success']
    : p.kelas === 'aktif_tidak_hadir' ? ['Aktif, tidak hadir 14 hari', 'text-warning']
    : p.kelas === 'tidak_pernah_hadir' ? ['Dijadwalkan, tak pernah hadir', 'text-danger']
    : p.kelas === 'berhenti' ? ['Sudah berhenti', 'text-muted-foreground']
    : [`Dijadwalkan sejak ${tgl(p.mulai_aktif)}`, 'text-muted-foreground']
  return <div className={`mt-1 text-xs ${gaya}`}>{teks}</div>
}

function DaftarKandidat({ me }: { me: Me }) {
  const bisaUbah = me.peran === 'super_admin' || me.peran === 'recruiter'
  const kb = useRows<KebutuhanDs>(() => sb.rpc('ds_rekrut'), [])
  const kd = useRows<Kandidat>(() => sb.from('kandidat').select('*').order('dibuat', { ascending: false }).limit(2000), [])
  const [tahap, setTahap] = useState<'semua' | Status>('semua')
  const [fds, setFds] = useState('')
  const [q, setQ] = useState('')
  const [tambah, setTambah] = useState(false)
  const KOSONG = { nama: '', no_hp: '', sumber: '', ds: '', catatan: '', perujuk: '', perujukNama: '' }
  const [baru, setBaru] = useState(KOSONG)
  const [cariP, setCariP] = useState('')
  const [hasilP, setHasilP] = useState<Perujuk[]>([])
  const referral = baru.sumber === 'Referral rider'
  const [aksi, setAksi] = useState<{ id: string; jenis: 'tolak' | 'terima' } | null>(null)
  const [isi, setIsi] = useState('') // alasan menolak, atau kode MTR saat menerima
  const pn = useRows<{ kandidat_id: string; kelas: string; mulai_aktif: string | null }>(() => sb.rpc('kandidat_penempatan'), [])
  const penempatan = Object.fromEntries(pn.rows.map((p) => [p.kandidat_id, p]))
  const reload = () => { kb.reload(); kd.reload(); pn.reload() }
  const dsNama = (id: string | null) => kb.rows.find((d) => d.ds_id === id)?.ds_nama
  const opsiDs = kb.rows.map((d) => ({ value: d.ds_id, label: d.ds_nama }))

  const jml = (s: Status) => kd.rows.filter((k) => k.status === s).length
  const proses = kd.rows.filter((k) => AKTIF.includes(k.status)).length
  const kurang = kb.rows.reduce((a, d) => a + d.kurang, 0)
  const diterima = kd.rows.filter((k) => k.status === 'diterima' && k.ditutup)
  const rata = diterima.length ? diterima.reduce((a, k) => a + hari(k.dibuat, k.ditutup!), 0) / diterima.length : null
  const putus = jml('diterima') + jml('ditolak')
  const sumberTerbaik = Object.entries(diterima.reduce<Record<string, number>>((a, k) => ({ ...a, [k.sumber ?? 'Tanpa sumber']: (a[k.sumber ?? 'Tanpa sumber'] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0]

  // perujuk teratas: yang kandidatnya paling banyak jadi rider (diurutkan juga menurut jumlah kandidat)
  const perujuk = Object.values(kd.rows.filter((k) => k.perujuk_nama).reduce<Record<string, { nama: string; total: number; diterima: number }>>((a, k) => {
    const kunci = k.perujuk_id ?? k.perujuk_nama!
    const e = a[kunci] ?? { nama: k.perujuk_nama!, total: 0, diterima: 0 }
    e.total++
    if (k.status === 'diterima') e.diterima++
    a[kunci] = e
    return a
  }, {})).sort((a, b) => b.diterima - a.diterima || b.total - a.total).slice(0, 5)

  const tampil = kd.rows
    .filter((k) => (tahap === 'semua' || k.status === tahap) && (!fds || k.ds_id === fds))
    .filter((k) => `${k.nama} ${k.no_hp ?? ''} ${k.sumber ?? ''} ${k.perujuk_nama ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  const pg = usePage(tampil, [tahap, fds, q])

  const cariPerujuk = async () => {
    const { data, error } = await sb.rpc('cari_perujuk', { p_q: cariP.trim() })
    if (error) return toast(error.message)
    setHasilP((data ?? []) as Perujuk[])
    if (!data?.length) toast('Tidak ada rider atau Captain aktif dengan nama atau kode itu.')
  }
  const simpanBaru = async () => {
    const hasil = await ok(sb.from('kandidat').insert({ nama: baru.nama.trim(), no_hp: baru.no_hp.trim() || null, sumber: baru.sumber || null, perujuk_id: referral ? baru.perujuk : null, ds_id: baru.ds || null, catatan: baru.catatan.trim() || null }))
    if (!hasil) return
    toast.ok(`${baru.nama.trim()} ditambahkan sebagai kandidat`)
    setBaru(KOSONG)
    setCariP('')
    setHasilP([])
    setTambah(false)
    reload()
  }
  const ubahTahap = async (k: Kandidat, status: Status) => {
    if (await ok(sb.from('kandidat').update({ status }).eq('id', k.id))) { toast.ok(`${k.nama}: ${LABEL[status]}`); reload() }
  }
  const tolak = async (k: Kandidat) => {
    if (!(await ok(sb.from('kandidat').update({ status: 'ditolak', alasan_tolak: isi.trim() }).eq('id', k.id)))) return
    toast.ok(`${k.nama} ditolak`)
    setAksi(null)
    setIsi('')
    reload()
  }
  const terima = async (k: Kandidat) => {
    if (!(await ok(sb.rpc('terima_kandidat', { p_id: k.id, p_kode: isi.trim() || null })))) return
    toast.ok(`${k.nama} diterima dan sudah jadi rider di ${dsNama(k.ds_id) ?? 'DS tujuan'}.`)
    setAksi(null)
    setIsi('')
    reload()
  }
  const buka = (k: Kandidat, jenis: 'tolak' | 'terima') => { setIsi(''); setAksi(aksi?.id === k.id && aksi.jenis === jenis ? null : { id: k.id, jenis }) }

  return (
    <div>
      <Err msg={kb.err || kd.err} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Users} label="Perlu rekrut" value={kurang} tone={kurang ? 'red' : 'zinc'} />
        <Stat icon={UserPlus} label="Sedang diproses" value={proses} tone="zinc" />
        <Stat icon={Clock} label="Rata-rata lama proses" value={rata === null ? '–' : `${rata.toFixed(1)} hari`} tone="zinc" />
        <Stat icon={UserCheck} label="Berhasil jadi rider" value={putus ? `${Math.round((100 * jml('diterima')) / putus)}%` : '–'} tone="zinc" />
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="p-4 pb-2">
          <div className="lbl !mb-0">Kebutuhan rekrut per DS</div>
          <p className="text-xs text-muted-foreground">Dibutuhkan = kuota harian × 7/6 (rider libur min. 1 hari/minggu). Perlu dicari = kurang yang belum tertutup kandidat.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th className="text-left">DS</th><th>Kuota/hari</th><th>Dibutuhkan</th><th>Rider aktif</th><th>Kurang</th><th>Diproses</th><th>Perlu dicari</th></tr></thead>
            <tbody>
              {kb.rows.map((d) => {
                const sisa = Math.max(0, d.kurang - d.kandidat_proses)
                return (
                  <tr key={d.ds_id} className="text-center">
                    <td className="text-left font-semibold">{d.ds_nama}</td>
                    <td>{d.kuota}</td><td>{d.perlu}</td><td>{d.rider_aktif}</td>
                    <td className={d.kurang ? 'font-semibold text-danger' : 'text-success'}>{d.kurang}</td>
                    <td>{d.kandidat_proses}</td>
                    <td>{sisa ? <span className="badge bg-danger-soft text-danger">{sisa}</span> : <span className="text-success">Cukup</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!kb.rows.length && <Kosong teks="Belum ada DS" />}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(['semua', ...AKTIF, 'diterima', 'ditolak'] as const).map((s) => (
          <button key={s} type="button" className={`tab ${tahap === s ? 'tab-on' : ''}`} onClick={() => setTahap(s)}>
            {s === 'semua' ? 'Semua' : LABEL[s]} <span className="opacity-70">{s === 'semua' ? kd.rows.length : jml(s)}</span>
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {kb.rows.length > 1 && <Select className="w-48" value={fds} onChange={setFds} opsi={[{ value: '', label: 'Semua DS' }, ...opsiDs]} />}
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="inp w-56 max-w-full !pl-9" placeholder="Cari nama, HP, sumber" aria-label="Cari kandidat" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {bisaUbah && <button type="button" className={tambah ? 'btn2' : 'btn'} onClick={() => setTambah(!tambah)}>{tambah ? <X size={16} /> : <Plus size={16} />}{tambah ? 'Batal' : 'Tambah kandidat'}</button>}
        </div>
      </div>

      {bisaUbah && tambah && (
        <div className="card !p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 items-start">
            <Field label="Nama kandidat"><input autoFocus className="inp w-full" value={baru.nama} onChange={(e) => setBaru({ ...baru, nama: e.target.value })} /></Field>
            <Field label="No. HP" hint="Satu nomor hanya boleh satu kandidat yang masih diproses."><input className="inp w-full" inputMode="tel" value={baru.no_hp} onChange={(e) => setBaru({ ...baru, no_hp: e.target.value })} /></Field>
            <Field label="Sumber"><Select value={baru.sumber} onChange={(v) => setBaru({ ...baru, sumber: v })} placeholder="— pilih sumber —" opsi={SUMBER.map((s) => ({ value: s, label: s }))} /></Field>
            <Field label="DS tujuan" hint="Wajib diisi sebelum kandidat bisa diterima."><Select value={baru.ds} onChange={(v) => setBaru({ ...baru, ds: v })} placeholder="— pilih DS —" opsi={opsiDs} /></Field>
          </div>
          {referral && (
            <Field label="Dirujuk oleh" hint="Rider atau Captain yang merekomendasikan kandidat ini. Wajib untuk sumber Referral rider." className="mt-3">
              {baru.perujuk ? (
                <div className="flex items-center gap-2">
                  <span className="badge bg-success-soft text-success !text-sm !px-3 !py-1">{baru.perujukNama}</span>
                  <button type="button" className="btn2" onClick={() => setBaru({ ...baru, perujuk: '', perujukNama: '' })}>Ganti</button>
                </div>
              ) : (
                <>
                  <div className="flex max-w-md gap-2">
                    <input className="inp min-w-0 flex-1" placeholder="Cari nama atau kode MTR perujuk" aria-label="Cari perujuk" value={cariP} onChange={(e) => setCariP(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && cariP.trim().length >= 2 && cariPerujuk()} />
                    <button type="button" className="btn2" disabled={cariP.trim().length < 2} onClick={cariPerujuk}>Cari</button>
                  </div>
                  {hasilP.length > 0 && (
                    <ul className="mt-2 max-w-md divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                      {hasilP.map((r) => (
                        <li key={r.id}>
                          <button type="button" className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-muted/60" onClick={() => { setBaru({ ...baru, perujuk: r.id, perujukNama: r.nama }); setHasilP([]) }}>
                            <span className="font-medium">{r.nama}</span>
                            <span className="text-xs text-muted-foreground">{r.kode_mtr ?? 'tanpa kode'} · {r.ds_nama ?? 'tanpa DS'}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </Field>
          )}
          <Field label="Catatan (opsional)" className="mt-3"><input className="inp w-full" value={baru.catatan} onChange={(e) => setBaru({ ...baru, catatan: e.target.value })} /></Field>
          <div className="mt-3 flex items-center gap-3">
            <button className="btn" disabled={!baru.nama.trim() || (referral && !baru.perujuk)} onClick={simpanBaru}>Simpan kandidat</button>
            {referral && !baru.perujuk && <span className="text-xs text-muted-foreground">Pilih rider yang merujuk dulu</span>}
          </div>
        </div>
      )}

      <div className="card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Kandidat</th><th>Sumber</th><th>DS tujuan</th><th>Tahap</th><th>Masuk</th>{bisaUbah && <th>Aksi</th>}</tr></thead>
            <tbody>
              {pg.rows.map((k) => {
                const tutup = k.status === 'diterima' || k.status === 'ditolak'
                return (
                  <Fragment key={k.id}>
                    <tr className="align-top">
                      <td>
                        <div className="font-medium">{k.nama}</div>
                        <div className="font-mono text-xs text-muted-foreground">{k.no_hp ?? 'tanpa HP'}</div>
                        {k.status === 'ditolak' && k.alasan_tolak && <div className="mt-1 text-xs text-danger">Ditolak: {k.alasan_tolak}</div>}
                        {k.catatan && <div className="mt-1 text-xs text-muted-foreground">{k.catatan}</div>}
                      </td>
                      <td className="text-muted-foreground">
                        {k.sumber ?? '–'}
                        {k.sumber === 'Referral rider' && <div className="text-xs">oleh <b className="text-foreground">{k.perujuk_nama ?? 'tidak tercatat'}</b></div>}
                      </td>
                      <td className={k.ds_id ? '' : 'text-warning'}>{dsNama(k.ds_id) ?? (k.ds_id ? '–' : 'Belum dipilih')}</td>
                      <td className="min-w-40">
                        {bisaUbah && !tutup
                          ? <Select value={k.status} onChange={(v) => v !== k.status && ubahTahap(k, v as Status)} opsi={AKTIF.map((s) => ({ value: s, label: LABEL[s] }))} />
                          : (
                            <>
                              <span className={`badge ${GAYA[k.status]}`}>{LABEL[k.status]}</span>
                              {k.status === 'diterima' && penempatan[k.id] && <Penempatan p={penempatan[k.id]} />}
                            </>
                          )}
                      </td>
                      <td className="whitespace-nowrap">
                        <div>{tgl(k.dibuat.slice(0, 10))}</div>
                        <div className="text-xs text-muted-foreground">{tutup && k.ditutup ? `${Math.max(0, Math.round(hari(k.dibuat, k.ditutup)))} hari proses` : `${Math.max(0, Math.floor(hari(k.dibuat, new Date().toISOString())))} hari lalu`}</div>
                      </td>
                      {bisaUbah && (
                        <td className="whitespace-nowrap">
                          {!tutup && (
                            <div className="flex gap-1.5">
                              <button className="btn" onClick={() => buka(k, 'terima')}><UserCheck size={14} />Terima</button>
                              <button className="btn2 !text-danger" onClick={() => buka(k, 'tolak')}>Tolak</button>
                            </div>
                          )}
                          {k.status === 'ditolak' && <button className="btn2" onClick={() => ubahTahap(k, 'baru')}>Buka lagi</button>}
                          {k.status === 'diterima' && <span className="text-xs text-success">Sudah jadi rider</span>}
                        </td>
                      )}
                    </tr>
                    {bisaUbah && aksi?.id === k.id && (
                      <tr className="bg-muted/40">
                        <td colSpan={6}>
                          {aksi.jenis === 'tolak' ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <input autoFocus className="inp min-w-60 flex-1" placeholder="Alasan menolak (wajib), mis. tidak punya SIM" aria-label="Alasan menolak" value={isi} onChange={(e) => setIsi(e.target.value)} />
                              <button className="btn" disabled={!isi.trim()} onClick={() => tolak(k)}>Tolak kandidat</button>
                              <button className="btn2" onClick={() => setAksi(null)}>Batal</button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm">Jadi rider di <b>{dsNama(k.ds_id) ?? '(DS belum dipilih)'}</b>. Kode MTR:</span>
                              <input autoFocus className="inp w-44" placeholder="mis. MTR0012345" aria-label="Kode MTR" value={isi} onChange={(e) => setIsi(e.target.value)} />
                              <button className="btn" disabled={!k.ds_id} onClick={() => terima(k)}>Terima jadi rider</button>
                              <button className="btn2" onClick={() => setAksi(null)}>Batal</button>
                              <span className="w-full text-xs text-muted-foreground">{k.ds_id ? 'Kode MTR boleh dikosongkan dan diisi nanti di Data Rider.' : 'DS tujuan belum dipilih, pilih dulu agar bisa diterima.'}</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        {!tampil.length && <Kosong teks={kd.rows.length ? 'Tidak ada kandidat yang cocok.' : 'Belum ada kandidat.'} hint={bisaUbah ? 'Klik Tambah kandidat untuk mulai.' : undefined} />}
        <div className="p-4"><Pagination {...pg} /></div>
      </div>
      {perujuk.length > 0 && (
        <div className="card">
          <div className="lbl">Perujuk teratas</div>
          <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {perujuk.map((p) => (
              <li key={p.nama} className="flex justify-between gap-3 border-b border-border/60 py-1">
                <span className="font-medium">{p.nama}</span>
                <span className="text-muted-foreground"><b className="text-success">{p.diterima}</b> diterima dari {p.total} kandidat</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {sumberTerbaik && <p className="text-xs text-muted-foreground">Sumber yang paling banyak jadi rider: <b className="text-foreground">{sumberTerbaik[0]}</b> ({sumberTerbaik[1]} orang).</p>}
    </div>
  )
}

// Dua bagian: daftar kandidat, dan ringkasan angka (direkrut, betul-betul aktif, turnover, retensi, kualitas sumber)
export function Rekrutmen({ me }: { me: Me }) {
  const [bagian, setBagian] = useState<'kandidat' | 'ringkasan'>('kandidat')
  return (
    <div>
      <div className="mb-4 flex gap-1.5">
        {([['kandidat', 'Kandidat'], ['ringkasan', 'Ringkasan']] as const).map(([k, l]) => (
          <button key={k} type="button" className={`tab ${bagian === k ? 'tab-on' : ''}`} onClick={() => setBagian(k)}>{l}</button>
        ))}
      </div>
      {bagian === 'kandidat' ? <DaftarKandidat me={me} /> : <AngkaRekrutmen me={me} />}
    </div>
  )
}
