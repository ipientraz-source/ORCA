// Armada: pengajuan servis (mis. "Servis rutin Oktober 2026" untuk semua EV), daftar molis yang menunggu servis, dan riwayat pengajuan.
import { useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { sb, today, useRows, ok, toast, konfirmasi, Field, Select, Kosong, usePage, Pagination, type Ds } from './lib'
import { angka, BadgeItem, BadgeUrgent, FotoPicker, InputRupiah, JENIS_SERVIS, PilihPart, rupiah, Tenggat, tgl, type ItemServis, type Motor, type Permintaan, type RingkasanPermintaan } from './armada-lib'

type Props = {
  permintaan: Permintaan[]; ringkasan: RingkasanPermintaan[]; terbuka: ItemServis[]; motors: Motor[]; dsNama: (id: string | null) => string
  dsBoleh: Ds[]; kelola: boolean; superAdmin: boolean; pelapor: (id: string | null) => string; bukaServis: (motorId: string) => void; reload: () => void
}

export function BagianDiminta(p: Props) {
  const [tampil, setTampil] = useState<'menunggu' | 'pengajuan'>('menunggu')
  const [buat, setBuat] = useState(false)
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {([['menunggu', `Menunggu servis (${p.terbuka.length})`], ['pengajuan', 'Pengajuan & riwayat']] as const).map(([k, l]) => (
          <button key={k} type="button" className={`tab ${tampil === k ? 'tab-on' : ''}`} onClick={() => setTampil(k)}>{l}</button>
        ))}
        {p.kelola && <button className="btn ml-auto" onClick={() => setBuat(true)}>Buat pengajuan servis</button>}
      </div>
      {buat && (
        <div className="card">
          <div className="mb-3 flex items-center justify-between"><b>Pengajuan servis baru</b><button className="btn2" onClick={() => setBuat(false)}><X size={14} />Tutup</button></div>
          <FormPengajuan dsBoleh={p.dsBoleh} selesai={() => { setBuat(false); setTampil('menunggu'); p.reload() }} />
        </div>
      )}
      {tampil === 'menunggu' ? <Menunggu {...p} /> : <Pengajuan {...p} />}
    </div>
  )
}

const bulanIni = () => new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })

// motorIds diisi kalau pengajuan dibuat dari motor yang dicentang di Data Molis; kosong = semua motor di DS yang dipilih
export function FormPengajuan({ dsBoleh, selesai, motorIds }: { dsBoleh: Ds[]; selesai: () => void; motorIds?: string[] }) {
  const [judul, setJudul] = useState(`Servis rutin ${bulanIni()}`)
  const [jenis, setJenis] = useState('Servis rutin')
  const [tenggat, setTenggat] = useState('')
  const [ds, setDs] = useState('')
  const [catatan, setCatatan] = useState('')
  const [pekerjaan, setPekerjaan] = useState<string[]>([])

  async function kirim() {
    if (!judul.trim()) return toast('Isi judul pengajuan dulu.')
    const sukses = await ok(sb.rpc('buat_permintaan_servis', { p_judul: judul.trim(), p_jenis: jenis, p_tenggat: tenggat || null, p_catatan: catatan.trim() || null, p_ds: motorIds ? null : ds || null, p_motor: motorIds ?? null, p_pekerjaan: pekerjaan }))
    if (!sukses) return
    toast.ok(motorIds ? `Pengajuan servis dibuat untuk ${motorIds.length} motor.` : 'Pengajuan servis dibuat. Semua motor di cakupan masuk daftar menunggu servis.')
    selesai()
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Semua motor di cakupan yang dipilih otomatis masuk daftar menunggu servis. Saat servis dengan jenis yang sama dicatat untuk sebuah motor, statusnya langsung selesai.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Judul pengajuan"><input className="inp w-full" value={judul} onChange={(e) => setJudul(e.target.value)} /></Field>
        <Field label="Jenis servis"><Select value={jenis} onChange={setJenis} opsi={JENIS_SERVIS.map((v) => ({ value: v, label: v }))} /></Field>
        <Field label="Tenggat (opsional)"><input type="date" className="inp w-full" min={today()} value={tenggat} onChange={(e) => setTenggat(e.target.value)} /></Field>
        {motorIds ? (
          <Field label="Cakupan"><div className="inp flex items-center font-semibold">{motorIds.length} motor yang dicentang</div></Field>
        ) : (
          <Field label="Cakupan" hint="Semua DS yang bisa Anda kelola, atau satu DS saja.">
            <Select value={ds} onChange={setDs} opsi={[{ value: '', label: 'Semua DS saya' }, ...dsBoleh.map((d) => ({ value: d.id, label: d.nama }))]} />
          </Field>
        )}
      </div>
      <Field label="Part yang diganti (opsional)" hint="Centang semua part yang akan diganti. Berlaku sama untuk semua motor di pengajuan ini."><PilihPart value={pekerjaan} ubah={setPekerjaan} /></Field>
      <Field label="Catatan (opsional)"><input className="inp w-full" value={catatan} onChange={(e) => setCatatan(e.target.value)} /></Field>
      <button className="btn" onClick={kirim}>Buat pengajuan</button>
    </div>
  )
}

// ───────── molis yang menunggu servis ─────────
function Menunggu({ permintaan, terbuka, motors, dsNama, kelola, bukaServis, reload }: Props) {
  const [q, setQ] = useState('')
  const [aksi, setAksi] = useState<{ id: string; jenis: 'jadwal' | 'lewati' | 'selesai' } | null>(null)
  const [nilai, setNilai] = useState('')
  const [bengkel, setBengkel] = useState('')
  const [biaya, setBiaya] = useState('')
  const [asuransi, setAsuransi] = useState(false)
  // pilihan massal: beberapa motor sekaligus ditandai selesai dengan tanggal / bengkel / biaya yang sama
  const [dipilih, setDipilih] = useState<Set<string>>(new Set())
  const [mTgl, setMTgl] = useState(today())
  const [mBengkel, setMBengkel] = useState('')
  const [mBiaya, setMBiaya] = useState('')
  const [mAsuransi, setMAsuransi] = useState(false)
  const [mFoto, setMFoto] = useState<string[]>([])
  const [foto, setFoto] = useState<string[]>([])
  const baris = terbuka
    .map((it) => ({ it, m: motors.find((x) => x.id === it.motor_id), r: permintaan.find((x) => x.id === it.permintaan_id) }))
    .filter((b) => b.m && b.r && `${b.m.kode_motor} ${b.m.plat_nomor ?? ''} ${b.r.judul}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.r!.urgent) - Number(a.r!.urgent) || (a.r!.tenggat ?? '9999').localeCompare(b.r!.tenggat ?? '9999') || a.m!.kode_motor.localeCompare(b.m!.kode_motor))
  const pg = usePage(baris, [q, terbuka.length])
  const terpilih = baris.filter((b) => dipilih.has(b.it.id))
  const semua = baris.length > 0 && terpilih.length === baris.length
  const centang = (id: string) => setDipilih((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  async function selesaiMassal() {
    if (!mTgl) return toast('Pilih tanggal servis.')
    if (terpilih.some((b) => b.r!.jenis === 'Lainnya')) return toast('Pengajuan berjenis Lainnya harus dicatat satu per satu.')
    // Biaya dihitung keseluruhan: satu total untuk semua motor, dibagi rata ke tiap catatan servis (sisa pembagian ke motor pertama).
    // Rinciannya ada di foto struk dan foto motor yang dilampirkan ke setiap catatan.
    const total = mAsuransi ? 0 : angka(mBiaya)
    const bagi = Math.floor(total / terpilih.length)
    const rows = terpilih.map(({ m, r }, i) => ({
      motor_id: m!.id, tanggal: mTgl, jenis: r!.jenis, pekerjaan: r!.pekerjaan, bengkel: mBengkel.trim() || null,
      biaya: bagi + (i === 0 ? total - bagi * terpilih.length : 0), ditanggung_asuransi: mAsuransi, foto: mFoto,
    }))
    if (!(await ok(sb.from('servis_motor').insert(rows)))) return
    toast.ok(`${rows.length} motor ditandai selesai${total ? `, total biaya ${rupiah(total)}` : ''}`)
    setDipilih(new Set())
    setMFoto([])
    setMBiaya('')
    reload()
  }

  async function simpan(id: string) {
    if (!aksi) return
    if (aksi.jenis === 'jadwal' && !nilai) return toast('Pilih tanggal servis.')
    if (aksi.jenis === 'lewati' && !nilai.trim()) return toast('Tulis alasan dilewati.')
    const isi = aksi.jenis === 'jadwal' ? { status: 'dijadwalkan', tanggal_jadwal: nilai } : { status: 'dilewati', catatan: nilai.trim() }
    if (!(await ok(sb.from('permintaan_servis_item').update(isi).eq('id', id)))) return
    toast.ok(aksi.jenis === 'jadwal' ? 'Servis dijadwalkan' : 'Motor dilewati dari pengajuan ini')
    setAksi(null)
    setNilai('')
    reload()
  }
  const buka = (id: string, jenis: 'jadwal' | 'lewati' | 'selesai') => {
    setAksi(aksi?.id === id && aksi.jenis === jenis ? null : { id, jenis })
    setNilai(jenis === 'selesai' ? today() : '')
    setBengkel('')
    setBiaya('')
    setAsuransi(false)
  }
  // Tandai selesai = mencatat servis (jenis sama dengan pengajuan); trigger database yang menyelesaikan item dan memajukan jadwal servis
  async function tandaiSelesai(motorId: string, jenis: string, pekerjaan: string[]) {
    if (!nilai) return toast('Pilih tanggal servis.')
    const sukses = await ok(sb.from('servis_motor').insert({ motor_id: motorId, tanggal: nilai, jenis, pekerjaan, bengkel: bengkel.trim() || null, biaya: asuransi ? 0 : angka(biaya), ditanggung_asuransi: asuransi, foto }))
    if (!sukses) return
    toast.ok('Servis dicatat dan motor ditandai selesai')
    setAksi(null)
    setFoto([])
    reload()
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className="inp w-64 max-w-full" placeholder="Cari kode, plat, atau pengajuan" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-sm text-muted-foreground">{baris.length} motor menunggu servis</span>
      </div>
      {kelola && terpilih.length > 0 && (
        <div className="mb-3 space-y-2 rounded-xl border border-primary/30 bg-primary-soft p-3">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm">{terpilih.length} motor dipilih</b>
            <button className="btn2 ml-auto" onClick={() => setDipilih(new Set())}>Kosongkan pilihan</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5 text-muted-foreground">Tanggal servis <input type="date" className="inp" max={today()} value={mTgl} onChange={(e) => setMTgl(e.target.value)} /></label>
            <input className="inp w-48 max-w-full" placeholder="Bengkel (opsional)" value={mBengkel} onChange={(e) => setMBengkel(e.target.value)} />
            <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={mAsuransi} onChange={(e) => { setMAsuransi(e.target.checked); if (e.target.checked) setMBiaya('') }} />Ditanggung asuransi</label>
            <span className="flex items-center gap-2 text-muted-foreground">Total biaya semua motor <InputRupiah nilai={mAsuransi ? '' : mBiaya} ubah={setMBiaya} disabled={mAsuransi} /></span>
          </div>
          <div className="text-sm"><div className="mb-1 text-muted-foreground">Foto struk dan foto motor (opsional)</div><FotoPicker motorId={terpilih[0].m!.id} value={mFoto} ubah={setMFoto} /></div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn" onClick={selesaiMassal}>Tandai {terpilih.length} motor selesai</button>
            <span className="text-xs text-muted-foreground">Part mengikuti isi tiap pengajuan. Total biaya dibagi rata ke catatan servis tiap motor; foto dilampirkan ke semuanya.</span>
          </div>
        </div>
      )}
      <div className="card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr>{kelola && <th className="w-8"><input type="checkbox" aria-label="Pilih semua motor yang tampil" checked={semua} onChange={() => setDipilih(semua ? new Set() : new Set(baris.map((b) => b.it.id)))} /></th>}<th>Motor</th><th>DS</th><th>Pengajuan</th><th>Tenggat</th><th>Status</th>{kelola && <th>Tindakan</th>}</tr></thead>
            <tbody>
              {pg.rows.map(({ it, m, r }) => (
                <tr key={it.id} className={r!.urgent ? 'bg-danger-soft/40' : dipilih.has(it.id) ? 'bg-primary-soft/60' : ''}>
                  {kelola && <td><input type="checkbox" aria-label={`Pilih ${m!.kode_motor}`} checked={dipilih.has(it.id)} onChange={() => centang(it.id)} /></td>}
                  <td><div className="font-mono font-medium">{m!.kode_motor}</div><div className="text-xs text-muted-foreground">{m!.plat_nomor ?? '–'}</div></td>
                  <td>{dsNama(m!.ds_id)}</td>
                  <td>
                    <span className="inline-flex flex-wrap items-center gap-1.5">{r!.judul}{r!.urgent && <BadgeUrgent />}</span>
                    <div className="text-xs text-muted-foreground">{r!.jenis}{r!.pekerjaan?.length > 0 ? ` · ${r!.pekerjaan.join(', ')}` : ''}</div>
                    {r!.urgent && r!.catatan && <div className="mt-0.5 text-xs">{r!.catatan}</div>}
                  </td>
                  <td><Tenggat d={r!.tenggat} /></td>
                  <td><BadgeItem s={it.status} />{it.tanggal_jadwal && <div className="mt-1 text-xs text-muted-foreground">{tgl(it.tanggal_jadwal)}</div>}</td>
                  {kelola && (
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {r!.jenis === 'Lainnya'
                          ? <button className="btn2" onClick={() => bukaServis(m!.id)}>Catat servis</button>
                          : <button className={aksi?.id === it.id && aksi.jenis === 'selesai' ? 'btn' : 'btn2'} onClick={() => buka(it.id, 'selesai')}>Tandai selesai</button>}
                        <button className="btn2" onClick={() => buka(it.id, 'jadwal')}>Jadwalkan</button>
                        <button className="btn2" onClick={() => buka(it.id, 'lewati')}>Lewati</button>
                      </div>
                      {aksi?.id === it.id && aksi.jenis === 'selesai' && (
                        <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/40 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">Tanggal servis <input type="date" className="inp" max={today()} value={nilai} onChange={(e) => setNilai(e.target.value)} /></label>
                            <input className="inp w-48 max-w-full" placeholder="Bengkel (opsional)" value={bengkel} onChange={(e) => setBengkel(e.target.value)} />
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                            <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={asuransi} onChange={(e) => { setAsuransi(e.target.checked); if (e.target.checked) setBiaya('') }} />Ditanggung asuransi (biaya Rp 0)</label>
                            <span className="flex items-center gap-2 text-muted-foreground">Biaya <InputRupiah nilai={asuransi ? '' : biaya} ubah={setBiaya} disabled={asuransi} /></span>
                          </div>
                          <FotoPicker motorId={m!.id} value={foto} ubah={setFoto} />
                          <div className="flex flex-wrap items-center gap-2">
                            <button className="btn" onClick={() => tandaiSelesai(m!.id, r!.jenis, r!.pekerjaan ?? [])}>Simpan dan tandai selesai</button>
                            <button className="btn2" onClick={() => bukaServis(m!.id)} title="Buka form servis lengkap: kilometer, catatan, dan foto">Isi lengkap (foto, kilometer)</button>
                          </div>
                        </div>
                      )}
                      {aksi?.id === it.id && aksi.jenis !== 'selesai' && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {aksi.jenis === 'jadwal'
                            ? <input type="date" className="inp" min={today()} value={nilai} onChange={(e) => setNilai(e.target.value)} />
                            : <input className="inp w-56 max-w-full" placeholder="Alasan dilewati" value={nilai} onChange={(e) => setNilai(e.target.value)} />}
                          <button className="btn" onClick={() => simpan(it.id)}>Simpan</button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!baris.length && <Kosong teks={terbuka.length ? 'Tidak ada yang cocok dengan pencarian.' : 'Tidak ada motor yang menunggu servis.'} hint={kelola ? 'Klik Buat pengajuan servis untuk meminta servis semua motor.' : 'Super-admin atau Arcon yang membuat pengajuan servis.'} />}
        <div className="p-4"><Pagination {...pg} /></div>
      </div>
    </div>
  )
}

// ───────── pengajuan & riwayat ─────────
type PengajuanDihapus = { id: string; judul: string; jenis: string | null; status: string | null; jumlah_motor: number; alasan: string; dihapus_oleh: string | null; waktu: string }

// Riwayat pengajuan yang dihapus (Super-admin)
function RiwayatDihapus({ pelapor }: { pelapor: (id: string | null) => string }) {
  const h = useRows<PengajuanDihapus>(() => sb.from('permintaan_dihapus').select('*').order('waktu', { ascending: false }).limit(500), [])
  const pg = usePage(h.rows, [h.rows.length])
  return (
    <div className="card">
      {h.err && <p className="text-sm text-danger">{h.err}</p>}
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Waktu</th><th>Pengajuan</th><th>Jenis</th><th>Motor</th><th>Alasan</th><th>Oleh</th></tr></thead>
          <tbody>
            {pg.rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{new Date(r.waktu).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                <td className="font-medium">{r.judul}</td><td>{r.jenis ?? '–'}</td><td>{r.jumlah_motor}</td><td>{r.alasan}</td><td>{pelapor(r.dihapus_oleh)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!h.rows.length && <Kosong teks="Belum ada pengajuan yang dihapus." />}
      <div className="mt-3"><Pagination {...pg} /></div>
    </div>
  )
}

function Pengajuan({ permintaan, ringkasan, motors, dsNama, superAdmin, pelapor, reload }: Props) {
  const [status, setStatus] = useState('berjalan')
  const [bulan, setBulan] = useState('')
  const daftar = permintaan.filter((r) => (status === 'semua' || status === 'dihapus' || r.status === status) && (!bulan || r.dibuat.slice(0, 7) === bulan))
  const pg = usePage(daftar, [status, bulan, permintaan.length])

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select className="w-48" value={status} onChange={setStatus} opsi={[{ value: 'berjalan', label: 'Sedang berjalan' }, { value: 'selesai', label: 'Selesai (riwayat)' }, { value: 'semua', label: 'Semua pengajuan' }, ...(superAdmin ? [{ value: 'dihapus', label: 'Dihapus (riwayat)' }] : [])]} />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">Bulan <input type="month" className="inp" value={bulan} onChange={(e) => setBulan(e.target.value)} /></label>
        {bulan && <button className="btn2" onClick={() => setBulan('')}>Semua bulan</button>}
        {status !== 'dihapus' && <span className="text-sm text-muted-foreground">{daftar.length} pengajuan</span>}
      </div>
      {status === 'dihapus' ? <RiwayatDihapus pelapor={pelapor} /> : <>
      <div className="space-y-3">
        {pg.rows.map((r) => <KartuPengajuan key={r.id} r={r} s={ringkasan.find((x) => x.permintaan_id === r.id)} motors={motors} dsNama={dsNama} superAdmin={superAdmin} reload={reload} />)}
        {!daftar.length && <div className="card"><Kosong teks="Belum ada pengajuan servis." hint="Pengajuan yang sudah selesai tetap tersimpan di sini sebagai riwayat." /></div>}
      </div>
      <div className="mt-3"><Pagination {...pg} /></div>
      </>}
    </div>
  )
}

function KartuPengajuan({ r, s, motors, dsNama, superAdmin, reload }: { r: Permintaan; s?: RingkasanPermintaan; motors: Motor[]; dsNama: (id: string | null) => string; superAdmin: boolean; reload: () => void }) {
  const [buka, setBuka] = useState(false)
  // Hanya Super-admin: pengajuan yang salah dibuat. Alasan wajib dan tercatat di riwayat; item di dalamnya ikut terhapus, catatan servis motor tidak.
  const [hapusBuka, setHapusBuka] = useState(false)
  const [alasan, setAlasan] = useState('')
  async function hapus() {
    if (!alasan.trim()) return toast('Alasan penghapusan wajib diisi.')
    if (!(await konfirmasi(`Pengajuan "${r.judul}" dihapus beserta ${s?.total ?? 0} motor di dalamnya. Catatan servis yang sudah dicatat tidak ikut terhapus. Pengajuan ini tersimpan di riwayat dihapus. Tindakan ini tidak bisa dibatalkan.`, { judul: 'Hapus pengajuan ini?', ya: 'Hapus pengajuan', bahaya: true }))) return
    if (!(await ok(sb.rpc('hapus_permintaan', { p_id: r.id, p_alasan: alasan.trim() })))) return
    toast.ok('Pengajuan dihapus')
    reload()
  }
  const total = s?.total ?? 0
  const beres = (s?.selesai ?? 0) + (s?.dilewati ?? 0)
  const tglPendek = (d: string) => new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setBuka(!buka)} aria-expanded={buka}>
        {buka ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <b>{r.judul}</b>
        <span className={`badge ${r.status === 'selesai' ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}>{r.status === 'selesai' ? 'Selesai' : 'Berjalan'}</span>
        <span className="badge bg-muted text-foreground/80">{r.jenis}</span>
        {r.urgent && <BadgeUrgent />}
        <span className="ml-auto text-xs text-muted-foreground">Dibuat {tglPendek(r.dibuat)}{r.ditutup ? ` · selesai ${tglPendek(r.ditutup)}` : ''}</span>
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span className="flex items-center gap-2">
          <span className="h-2 w-28 overflow-hidden rounded-full bg-border"><span className="block h-full bg-primary" style={{ width: total ? `${(100 * beres) / total}%` : '0%' }} /></span>
          <span className="font-mono">{beres}/{total}</span> motor beres
        </span>
        {s && <span className="text-muted-foreground">{s.selesai} selesai · {s.dilewati} dilewati · {s.menunggu} menunggu</span>}
        <span className="text-muted-foreground">Tenggat: <Tenggat d={r.tenggat} /></span>
      </div>
      {r.pekerjaan?.length > 0 && <p className="mt-1 text-sm text-muted-foreground">Part: {r.pekerjaan.join(', ')}</p>}
      {r.catatan && <p className="mt-1 text-sm text-muted-foreground">{r.catatan}</p>}
      {buka && <ItemPengajuan id={r.id} motors={motors} dsNama={dsNama} />}
      {superAdmin && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          {hapusBuka && <input className="inp min-w-0 flex-1" value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="Alasan penghapusan (wajib)" aria-label="Alasan penghapusan" />}
          {hapusBuka && <button type="button" className="btn" onClick={hapus}>Hapus</button>}
          <button type="button" className="btn2 text-danger" onClick={() => setHapusBuka(!hapusBuka)}>{hapusBuka ? 'Batal' : 'Hapus pengajuan'}</button>
        </div>
      )}
    </div>
  )
}

function ItemPengajuan({ id, motors, dsNama }: { id: string; motors: Motor[]; dsNama: (id: string | null) => string }) {
  const it = useRows<ItemServis>(() => sb.from('permintaan_servis_item').select('*').eq('permintaan_id', id).limit(1000), [id])
  const baris = it.rows.map((i) => ({ i, m: motors.find((x) => x.id === i.motor_id) })).filter((b) => b.m).sort((a, b) => a.m!.kode_motor.localeCompare(b.m!.kode_motor))
  return (
    <div className="mt-3 overflow-x-auto border-t border-border pt-3">
      {it.err && <p className="text-sm text-danger">{it.err}</p>}
      <table className="tbl">
        <thead><tr><th>Motor</th><th>DS</th><th>Status</th><th>Tanggal</th><th>Catatan</th></tr></thead>
        <tbody>
          {baris.map(({ i, m }) => (
            <tr key={i.id}>
              <td className="font-mono font-medium">{m!.kode_motor}</td>
              <td>{dsNama(m!.ds_id)}</td>
              <td><BadgeItem s={i.status} /></td>
              <td>{i.status === 'selesai' ? `Selesai ${tgl(i.selesai_pada)}` : i.tanggal_jadwal ? `Jadwal ${tgl(i.tanggal_jadwal)}` : '–'}</td>
              <td>{i.catatan ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!baris.length && !it.err && <p className="py-2 text-sm text-muted-foreground">Memuat…</p>}
    </div>
  )
}
