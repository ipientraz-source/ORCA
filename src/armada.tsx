// Armada (Fleet management): data EV, servis rutin, laporan kerusakan, pindah DS.
// Super-admin kelola semua; Arcon kelola penuh di DS yang dipegang; Captain melihat motor DS-nya dan melaporkan kerusakan.
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bike, ClipboardList, Wrench, Warehouse, X } from 'lucide-react'
import { sb, today, useRows, ok, toast, konfirmasi, Err, Field, Select, Stat, Kosong, usePage, Pagination, type Ds, type Me, type Rider } from './lib'
import { angka, BadgeStatus, rupiah, ServisBerikutnya, tgl, type ItemServis, type Motor, type MotorDihapus, type Permintaan, type Pindah, type RingkasanPermintaan, type Rusak, type Servis } from './armada-lib'
import { BagianDiminta, FormPengajuan } from './armada-diminta'
import { ImporMotor } from './armada-impor'
import { normPlat } from './impor'
import { FormLapor, FormServis, ListRusak, namaPelapor, TabelServis } from './armada-catatan'

const STATUS = [{ value: '', label: 'Semua status' }, { value: 'dipakai', label: 'Dipakai' }, { value: 'di gudang', label: 'Di gudang' }, { value: 'perbaikan', label: 'Perbaikan' }]

export function Armada({ me, ds, dsList }: { me: Me; ds: Ds | null; dsList: Ds[] }) {
  const kelola = me.peran === 'super_admin' || me.peran === 'arcon'
  const dsl = useRows<Ds>(() => sb.from('ds').select('*').order('nama'), [])
  const mts = useRows<Motor>(() => sb.from('motor').select('*').order('kode_motor').limit(1000), [])
  const rid = useRows<Rider>(() => sb.from('riders').select('*').order('nama').limit(1000), [])
  const srv = useRows<Servis>(() => sb.from('servis_motor').select('*').order('tanggal', { ascending: false }).limit(1000), [])
  const rsk = useRows<Rusak>(() => sb.from('kerusakan_motor').select('*').order('tanggal', { ascending: false }).limit(1000), [])
  const pnd = useRows<Pindah>(() => sb.from('perpindahan_motor').select('*').order('waktu', { ascending: false }).limit(500), [])
  const pmt = useRows<Permintaan>(() => sb.from('permintaan_servis').select('*').order('dibuat', { ascending: false }).limit(500), [])
  const rng = useRows<RingkasanPermintaan>(() => sb.rpc('ringkasan_permintaan'), [])
  const itb = useRows<ItemServis>(() => sb.from('permintaan_servis_item').select('*').in('status', ['diminta', 'dijadwalkan']).limit(1000), [])
  const [bagian, setBagian] = useState<'motor' | 'diminta' | 'servis' | 'kerusakan' | 'dihapus'>('motor')
  const [pilih, setPilih] = useState<string | null>(null)
  const [modeAwal, setModeAwal] = useState<'servis' | null>(null) // dari "Catat servis" di daftar menunggu servis
  const [fds, setFds] = useState('')
  const hps = useRows<MotorDihapus>(() => (me.peran === 'super_admin' ? sb.from('motor_dihapus').select('*').order('waktu', { ascending: false }).limit(500) : Promise.resolve({ data: [], error: null })), [])
  const reloadSemua = () => { hps.reload(); dsl.reload(); mts.reload(); srv.reload(); rsk.reload(); pnd.reload(); pmt.reload(); rng.reload(); itb.reload() }
  const pilihMotor = (id: string | null) => { setModeAwal(null); setPilih(id) }
  const bukaServis = (id: string) => { setModeAwal('servis'); setPilih(id); setBagian('motor') }

  // DS yang boleh dipakai untuk menambah/memindah motor
  const dsBoleh = me.peran === 'super_admin' ? dsl.rows : me.peran === 'arcon' ? dsList : ds ? [ds] : []
  const dsNama = (id: string | null) => dsl.rows.find((d) => d.id === id)?.nama ?? '–'
  const motorKode = (id: string) => mts.rows.find((m) => m.id === id)?.kode_motor ?? '?'
  const dsMotor = (id: string) => mts.rows.find((m) => m.id === id)?.ds_id ?? null
  const pelapor = namaPelapor(rid.rows)

  const hari = today()
  const terbuka = rsk.rows.filter((r) => r.status !== 'selesai').length
  const terlambat = mts.rows.filter((m) => m.servis_berikutnya && m.servis_berikutnya < hari).length
  const jml = (s: Motor['status']) => mts.rows.filter((m) => m.status === s).length
  const detail = mts.rows.find((m) => m.id === pilih) ?? null

  return (
    <div>
      <Err msg={mts.err || srv.err || rsk.err || dsl.err || rid.err || pnd.err} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat icon={Bike} label="Total motor" value={mts.rows.length} />
        <Stat icon={Bike} label="Sedang dipakai" value={jml('dipakai')} tone="zinc" />
        <Stat icon={Warehouse} label="Di gudang" value={jml('di gudang')} tone="zinc" />
        <Stat icon={ClipboardList} label="Menunggu servis" value={itb.rows.length} tone={itb.rows.length ? 'red' : 'zinc'} />
        <Stat icon={Wrench} label="Servis terlambat" value={terlambat} tone={terlambat ? 'red' : 'zinc'} />
        <Stat icon={AlertTriangle} label="Laporan terbuka" value={terbuka} tone={terbuka ? 'red' : 'zinc'} />
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {([['motor', 'Data Molis'], ['diminta', 'Molis diminta servis'], ['servis', 'Riwayat servis'], ['kerusakan', 'Kerusakan'], ...(me.peran === 'super_admin' ? [['dihapus', 'Motor dihapus'] as const] : [])] as const).map(([k, l]) => (
          <button key={k} type="button" className={`tab ${bagian === k ? 'tab-on' : ''}`} onClick={() => setBagian(k)}>
            {l}{k === 'kerusakan' && terbuka > 0 ? ` (${terbuka})` : ''}{k === 'diminta' && itb.rows.length > 0 ? ` (${itb.rows.length})` : ''}
          </button>
        ))}
        {dsBoleh.length > 1 && (
          <Select className="ml-auto w-56" value={fds} onChange={setFds} opsi={[{ value: '', label: 'Semua DS' }, ...dsBoleh.map((d) => ({ value: d.id, label: d.nama }))]} />
        )}
      </div>

      {bagian === 'motor' && (
        <BagianMotor
          motors={mts.rows.filter((m) => !fds || m.ds_id === fds)} me={me} kelola={kelola} dsBoleh={dsBoleh} dsNama={dsNama} riders={rid.rows} pilih={pilih} setPilih={pilihMotor} detail={detail}
          servis={srv.rows} rusak={rsk.rows} pindah={pnd.rows} pelapor={pelapor} reload={reloadSemua} modeAwal={modeAwal} diminta={new Set(itb.rows.map((i) => i.motor_id))} keDiminta={() => setBagian('diminta')} semuaMotor={mts.rows}
        />
      )}
      {bagian === 'diminta' && (
        <BagianDiminta
          permintaan={pmt.rows} ringkasan={rng.rows} terbuka={itb.rows.filter((i) => !fds || dsMotor(i.motor_id) === fds)} motors={mts.rows.filter((m) => !fds || m.ds_id === fds)}
          dsNama={dsNama} dsBoleh={dsBoleh} kelola={kelola} superAdmin={me.peran === 'super_admin'} pelapor={pelapor} bukaServis={bukaServis} reload={reloadSemua}
        />
      )}
      {bagian === 'servis' && <BagianServis rows={srv.rows.filter((s) => !fds || dsMotor(s.motor_id) === fds)} motorKode={motorKode} />}
      {bagian === 'dihapus' && <BagianDihapus rows={hps.rows} dsNama={dsNama} pelapor={pelapor} />}
      {bagian === 'kerusakan' && (
        <BagianRusak rows={rsk.rows.filter((r) => !fds || dsMotor(r.motor_id) === fds)} motorKode={motorKode} pelapor={pelapor} kelola={kelola} reload={reloadSemua} />
      )}
    </div>
  )
}

// ───────── Motor ─────────
function BagianMotor({ motors, me, kelola, dsBoleh, dsNama, riders, pilih, setPilih, detail, servis, rusak, pindah, pelapor, reload, modeAwal, diminta, keDiminta, semuaMotor }: {
  motors: Motor[]; me: Me; kelola: boolean; dsBoleh: Ds[]; dsNama: (id: string | null) => string; riders: Rider[]; pilih: string | null; setPilih: (id: string | null) => void
  detail: Motor | null; servis: Servis[]; rusak: Rusak[]; pindah: Pindah[]; pelapor: (id: string | null) => string; reload: () => void; modeAwal: 'servis' | null; diminta: Set<string>; keDiminta: () => void; semuaMotor: Motor[]
}) {
  const [q, setQ] = useState('')
  const [fst, setFst] = useState('')
  const [tambah, setTambah] = useState(false)
  const [impor, setImpor] = useState(false)
  // kotak centang (Super-admin dan Arcon): ajukan servis untuk banyak motor sekaligus
  const [dipilih, setDipilih] = useState<Set<string>>(new Set())
  const [ajukan, setAjukan] = useState(false)
  const riderNama = (id: string | null) => riders.find((r) => r.id === id)?.nama ?? '–'
  const tampil = motors.filter((m) => (!fst || m.status === fst) && `${m.kode_motor} ${m.plat_nomor ?? ''} ${m.merek ?? ''} ${m.model ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  const pg = usePage(tampil, [q, fst, motors.length])
  const semua = tampil.length > 0 && tampil.every((m) => dipilih.has(m.id))
  const idDipilih = [...dipilih].filter((id) => motors.some((m) => m.id === id))
  const centang = (id: string) => setDipilih((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div>
      {impor && <ImporMotor dsBoleh={dsBoleh} motors={semuaMotor} bisaBuatDs={me.peran === 'super_admin'} tutup={() => setImpor(false)} selesai={() => { setImpor(false); reload() }} />}
      {tambah && (
        <div className="card">
          <div className="mb-3 flex items-center justify-between"><b>Tambah motor</b><button className="btn2" onClick={() => setTambah(false)}><X size={14} />Tutup</button></div>
          <FormMotor dsBoleh={dsBoleh} riders={riders} selesai={() => { setTambah(false); reload() }} />
        </div>
      )}
      {detail && (
        <DetailMotor
          key={detail.id + (modeAwal ?? '')} modeAwal={modeAwal} m={detail} me={me} kelola={kelola} dsBoleh={dsBoleh} dsNama={dsNama} riders={riders} riderNama={riderNama}
          servis={servis.filter((s) => s.motor_id === detail.id)} rusak={rusak.filter((r) => r.motor_id === detail.id)} pindah={pindah.filter((p) => p.motor_id === detail.id)}
          pelapor={pelapor} tutup={() => setPilih(null)} reload={reload}
        />
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className="inp w-64 max-w-full" placeholder="Cari kode, plat, merek, atau model" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="w-44" value={fst} onChange={setFst} opsi={STATUS} />
        <span className="text-sm text-muted-foreground">{tampil.length} motor</span>
        {kelola && (
          <span className="ml-auto flex gap-2">
            <button className="btn2" onClick={() => setImpor(true)}>Impor CSV</button>
            <button className="btn" onClick={() => setTambah(true)}>Tambah motor</button>
          </span>
        )}
      </div>

      {kelola && idDipilih.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm">{idDipilih.length} molis dicentang</b>
            <button className="btn" onClick={() => setAjukan(true)}>Ajukan servis untuk yang dicentang</button>
            <button className="btn2" onClick={() => { setDipilih(new Set()); setAjukan(false) }}>Kosongkan pilihan</button>
          </div>
          {ajukan && (
            <div className="mt-4 border-t border-border pt-4">
              <FormPengajuan dsBoleh={dsBoleh} motorIds={idDipilih} selesai={() => { setDipilih(new Set()); setAjukan(false); reload(); keDiminta() }} />
            </div>
          )}
        </div>
      )}
      <div className="card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr>{kelola && <th className="w-8"><input type="checkbox" aria-label="Pilih semua molis yang tampil" checked={semua} onChange={() => setDipilih(semua ? new Set() : new Set(tampil.map((m) => m.id)))} /></th>}<th>Kode</th><th>Plat</th><th>Model</th><th>DS</th><th>Pemegang</th><th>Status</th><th>Servis berikutnya</th><th /></tr></thead>
            <tbody>
              {pg.rows.map((m) => (
                <tr key={m.id} className={m.id === pilih ? 'bg-primary-soft/60' : ''}>
                  {kelola && <td><input type="checkbox" aria-label={`Pilih ${m.kode_motor}`} checked={dipilih.has(m.id)} onChange={() => centang(m.id)} /></td>}
                  <td className="whitespace-nowrap font-mono font-medium">{m.kode_motor}</td>
                  <td className="whitespace-nowrap">{m.plat_nomor ?? '–'}</td>
                  <td>{[m.merek, m.model, m.tahun].filter(Boolean).join(' ') || '–'}</td>
                  <td>{dsNama(m.ds_id)}</td>
                  <td>{riderNama(m.dipegang_oleh)}</td>
                  <td>
                    <BadgeStatus s={m.status} />
                    {diminta.has(m.id) && <span className="badge ml-1.5 bg-warning-soft text-warning">Diminta servis</span>}
                  </td>
                  <td><ServisBerikutnya m={m} /></td>
                  <td className="text-right"><button className="btn2" onClick={() => setPilih(m.id === pilih ? null : m.id)}>{m.id === pilih ? 'Tutup' : 'Detail'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!tampil.length && <Kosong teks={motors.length ? 'Tidak ada motor yang cocok.' : 'Belum ada motor.'} hint={kelola ? 'Klik Tambah motor untuk mulai mendata.' : 'Super-admin atau Arcon yang menambahkan data motor.'} />}
        <div className="p-4"><Pagination {...pg} /></div>
      </div>
    </div>
  )
}

// Form tambah / ubah data motor. DS tidak bisa diubah di sini (pakai Pindah DS) supaya ada alasan dan riwayatnya.
function FormMotor({ awal, dsBoleh, riders, selesai }: { awal?: Motor; dsBoleh: Ds[]; riders: Rider[]; selesai: () => void }) {
  const [f, setF] = useState({
    kode: awal?.kode_motor ?? '', ds: awal?.ds_id ?? dsBoleh[0]?.id ?? '', plat: awal?.plat_nomor ?? '', merek: awal?.merek ?? '', model: awal?.model ?? '', tahun: awal?.tahun ? String(awal.tahun) : '',
    warna: awal?.warna ?? '', rangka: awal?.no_rangka ?? '', mesin: awal?.no_mesin ?? '', beli: awal?.tanggal_beli ?? '', interval: awal?.interval_servis_hari ? String(awal.interval_servis_hari) : '',
    berikut: awal?.servis_berikutnya ?? '', pemegang: awal?.dipegang_oleh ?? '', catatan: awal?.catatan ?? '',
  })
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }))
  // Tambah motor: cukup DS, plat nomor, dan nomor rangka; sisanya disembunyikan di "data tambahan". Ubah data: semua tampil.
  const [lengkap, setLengkap] = useState(false)
  const kandidat = riders.filter((r) => r.peran === 'rider' && r.status === 'aktif' && r.ds_id === f.ds)

  async function simpan() {
    const kode = f.kode.trim() || (awal ? '' : normPlat(f.plat)) // kode kosong saat tambah = plat nomor
    if (!kode) return toast(awal ? 'Isi kode motor dulu.' : 'Isi plat nomor dulu.')
    if (!awal && !f.plat.trim()) return toast('Isi plat nomor dulu.')
    if (!awal && !f.ds) return toast('Pilih DS motor ini.')
    if (f.tahun && (angka(f.tahun) < 2000 || angka(f.tahun) > 2100)) return toast('Tahun tidak valid.')
    if (f.interval && (angka(f.interval) < 1 || angka(f.interval) > 730)) return toast('Interval servis 1 sampai 730 hari.')
    const isi = {
      kode_motor: kode, plat_nomor: f.plat.trim() || null, merek: f.merek.trim() || null, model: f.model.trim() || null, tahun: f.tahun ? angka(f.tahun) : null,
      warna: f.warna.trim() || null, no_rangka: f.rangka.trim() || null, no_mesin: f.mesin.trim() || null, tanggal_beli: f.beli || null,
      interval_servis_hari: f.interval ? angka(f.interval) : null, servis_berikutnya: f.berikut || null, dipegang_oleh: f.pemegang || null, catatan: f.catatan.trim() || null,
    }
    const sukses = await ok(awal ? sb.from('motor').update(isi).eq('id', awal.id) : sb.from('motor').insert({ ...isi, ds_id: f.ds }))
    if (!sukses) return
    toast.ok(awal ? 'Data motor disimpan' : 'Motor ditambahkan')
    selesai()
  }

  const sembunyi: string[] = awal || lengkap ? [] : ['kode', 'merek', 'model', 'tahun', 'warna', 'mesin', 'beli', 'interval', 'berikut']
  const input = (k: keyof typeof f, label: string, hint?: string, tipe = 'text') => (
    <Field label={label} hint={hint} className={sembunyi.includes(k) ? 'hidden' : ''}><input className="inp w-full" type={tipe} value={f[k]} onChange={(e) => set(k)(e.target.value)} /></Field>
  )
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {input('kode', 'Kode motor', awal ? 'Nama unik motor ini.' : 'Kosongkan untuk memakai plat nomor.')}
        <Field label="DS" hint={awal ? 'Untuk memindah DS pakai tombol Pindah DS.' : undefined}>
          <Select value={f.ds} onChange={(v) => setF((s) => ({ ...s, ds: v, pemegang: '' }))} disabled={!!awal} placeholder="— pilih DS —" opsi={dsBoleh.map((d) => ({ value: d.id, label: d.nama }))} />
        </Field>
        {input('plat', 'Plat nomor')}
        <Field label="Rider pemegang" hint="Rider di DS yang sama. Kosong = motor di gudang." className={awal || lengkap ? '' : 'hidden'}>
          <Select value={f.pemegang} onChange={set('pemegang')} cari opsi={[{ value: '', label: 'Tanpa pemegang' }, ...kandidat.map((r) => ({ value: r.id, label: `${r.nama} (${r.kode_mtr ?? '–'})` }))]} />
        </Field>
        {input('merek', 'Merek')}
        {input('model', 'Model')}
        {input('tahun', 'Tahun')}
        {input('warna', 'Warna')}
        {input('rangka', 'Nomor rangka (VIN)')}
        {input('mesin', 'Nomor mesin')}
        {input('beli', 'Tanggal beli', undefined, 'date')}
        {input('interval', 'Interval servis (hari)', 'Dipakai untuk menghitung servis berikutnya setelah Servis rutin dicatat.')}
        {input('berikut', 'Servis berikutnya', 'Isi tanggal servis berikutnya; bisa diubah kapan saja.', 'date')}
      </div>
      <Field label="Catatan" className={awal || lengkap ? '' : 'hidden'}><textarea className="inp w-full" rows={2} value={f.catatan} onChange={(e) => set('catatan')(e.target.value)} /></Field>
      {!awal && (
        <button type="button" className="block text-sm text-primary hover:underline" onClick={() => setLengkap(!lengkap)}>
          {lengkap ? 'Sembunyikan data tambahan' : 'Isi data tambahan (merek, tahun, pemegang, jadwal servis, dll.)'}
        </button>
      )}
      <button className="btn" onClick={simpan}>{awal ? 'Simpan perubahan' : 'Tambah motor'}</button>
    </div>
  )
}

function Info({ l, v }: { l: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div>
      <div className="text-sm">{v || '–'}</div>
    </div>
  )
}

function DetailMotor({ m, me, kelola, dsBoleh, dsNama, riders, riderNama, servis, rusak, pindah, pelapor, tutup, reload, modeAwal }: {
  m: Motor; me: Me; kelola: boolean; dsBoleh: Ds[]; dsNama: (id: string | null) => string; riders: Rider[]; riderNama: (id: string | null) => string
  servis: Servis[]; rusak: Rusak[]; pindah: Pindah[]; pelapor: (id: string | null) => string; tutup: () => void; reload: () => void; modeAwal: 'servis' | null
}) {
  const [mode, setMode] = useState<null | 'edit' | 'servis' | 'lapor' | 'pindah' | 'mendesak' | 'hapus'>(kelola ? modeAwal : null)
  const selesai = () => { setMode(null); reload() }
  const tombol = (k: NonNullable<typeof mode>, label: string) => (
    <button className={mode === k ? 'btn' : 'btn2'} onClick={() => setMode(mode === k ? null : k)}>{label}</button>
  )
  const pemegang = riderNama(m.dipegang_oleh)
  // Panel dirender di atas daftar: di HP, yang menekan Detail ada jauh di bawah, jadi panelnya digulir ke layar
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    panel.current?.scrollIntoView({ block: 'start' })
  }, [])

  return (
    <div className="card scroll-mt-4" ref={panel}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-bold font-mono">{m.kode_motor}</h3>
        <BadgeStatus s={m.status} />
        <span className="text-sm text-muted-foreground">{dsNama(m.ds_id)}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {kelola && tombol('edit', 'Ubah data')}
          {kelola && tombol('servis', 'Catat servis')}
          {tombol('lapor', 'Lapor kerusakan')}
          {tombol('mendesak', 'Ajukan servis mendesak')}
          {kelola && tombol('pindah', 'Pindah DS')}
          {me.peran === 'super_admin' && <button className={mode === 'hapus' ? 'btn' : 'btn2 text-danger'} onClick={() => setMode(mode === 'hapus' ? null : 'hapus')}>Hapus motor</button>}
          <button className="btn2" onClick={tutup}><X size={14} />Tutup</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Info l="Plat" v={m.plat_nomor} />
        <Info l="Merek / model" v={[m.merek, m.model].filter(Boolean).join(' ')} />
        <Info l="Tahun / warna" v={[m.tahun, m.warna].filter(Boolean).join(' · ')} />
        <Info l="Pemegang" v={pemegang === '–' ? '' : pemegang} />
        <Info l="Tanggal beli" v={m.tanggal_beli ? tgl(m.tanggal_beli) : ''} />
        <Info l="No. rangka" v={m.no_rangka} />
        <Info l="No. mesin" v={m.no_mesin} />
        <Info l="Servis terakhir" v={m.servis_terakhir ? tgl(m.servis_terakhir) : ''} />
        <Info l="Servis berikutnya" v={<ServisBerikutnya m={m} />} />
        <Info l="Interval servis" v={m.interval_servis_hari ? `${m.interval_servis_hari} hari` : ''} />
      </div>
      {m.catatan && <p className="mt-3 text-sm text-muted-foreground">{m.catatan}</p>}

      {mode && (
        <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4">
          {mode === 'edit' && <FormMotor awal={m} dsBoleh={dsBoleh} riders={riders} selesai={selesai} />}
          {mode === 'servis' && <FormServis motorId={m.id} selesai={selesai} />}
          {mode === 'lapor' && <FormLapor motorId={m.id} me={me} selesai={selesai} />}
          {mode === 'pindah' && <FormPindah m={m} dsBoleh={dsBoleh.filter((d) => d.id !== m.ds_id)} selesai={selesai} />}
          {mode === 'mendesak' && <FormMendesak m={m} selesai={selesai} />}
          {mode === 'hapus' && <FormHapus m={m} servis={servis} rusak={rusak} pindah={pindah} selesai={() => { tutup(); reload() }} />}
        </div>
      )}

      <div className="mt-5 space-y-5">
        <section><b className="mb-2 block">Riwayat servis</b><TabelServis rows={servis} /></section>
        <section><b className="mb-2 block">Laporan kerusakan</b><ListRusak rows={rusak} pelapor={pelapor} bisaProses={kelola} reload={reload} /></section>
        {pindah.length > 0 && (
          <section>
            <b className="mb-2 block">Riwayat pemindahan DS</b>
            <ul className="space-y-1 text-sm">
              {pindah.map((p) => (
                <li key={p.id}>{new Date(p.waktu).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}: {dsNama(p.dari_ds)} → {dsNama(p.ke_ds)} <span className="text-muted-foreground">({p.alasan})</span></li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

// Servis mendesak: untuk motor yang memang butuh servis sekarang (bukan servis rutin). Masuk daftar "Molis diminta servis" dengan tanda URGENT.
function FormMendesak({ m, selesai }: { m: Motor; selesai: () => void }) {
  const [alasan, setAlasan] = useState('')
  async function kirim() {
    if (!alasan.trim()) return toast('Tulis alasan servis mendesak dulu.')
    if (!(await ok(sb.rpc('ajukan_servis_mendesak', { p_motor: m.id, p_alasan: alasan.trim() })))) return
    toast.ok(`Servis mendesak ${m.kode_motor} diajukan. Masuk daftar Molis diminta servis dengan tanda URGENT.`)
    selesai()
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Pakai ini hanya kalau molis butuh servis sekarang. Pengajuan akan tampil paling atas dengan tanda URGENT untuk Arcon dan Super-admin. Untuk kerusakan fisik (jatuh, patah) pakai Lapor kerusakan.</p>
      <Field label="Alasan servis mendesak" hint="Apa masalahnya dan kenapa tidak bisa menunggu."><textarea className="inp w-full" rows={3} value={alasan} onChange={(e) => setAlasan(e.target.value)} /></Field>
      <button className="btn" onClick={kirim}>Ajukan servis mendesak</button>
    </div>
  )
}

// Hanya Super-admin: motor yang salah input (mis. salah plat). Alasan wajib dan tercatat di Riwayat motor dihapus; riwayat servis motor ikut hilang, fotonya dibersihkan dari Storage.
function FormHapus({ m, servis, rusak, pindah, selesai }: { m: Motor; servis: Servis[]; rusak: Rusak[]; pindah: Pindah[]; selesai: () => void }) {
  const [alasan, setAlasan] = useState('')
  async function hapus() {
    if (!alasan.trim()) return toast('Alasan penghapusan wajib diisi.')
    if (!(await konfirmasi(`Motor ${m.kode_motor} (plat ${m.plat_nomor || 'belum diisi'}) dihapus beserta ${servis.length} catatan servis, ${rusak.length} laporan kerusakan, ${pindah.length} riwayat pindah, dan dikeluarkan dari pengajuan servis. Data motornya tersimpan di Riwayat motor dihapus. Tindakan ini tidak bisa dibatalkan.`, { judul: 'Hapus motor ini?', ya: 'Hapus motor', bahaya: true }))) return
    if (!(await ok(sb.rpc('hapus_motor', { p_motor: m.id, p_alasan: alasan.trim() })))) return
    const foto = [...servis, ...rusak].flatMap((x) => x.foto ?? [])
    if (foto.length) await sb.storage.from('armada').remove(foto) // sisa foto tidak menggagalkan penghapusan
    toast.ok(`Motor ${m.kode_motor} dihapus`)
    selesai()
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Untuk motor yang salah input atau tidak sesuai. Kalau hanya platnya yang salah, pakai Ubah data. Alasan wajib diisi dan tersimpan di riwayat.</p>
      <Field label="Alasan penghapusan"><input className="inp w-full" value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="Mis. Salah input plat, motor ganda" /></Field>
      <button className="btn" onClick={hapus}>Hapus motor</button>
    </div>
  )
}

function FormPindah({ m, dsBoleh, selesai }: { m: Motor; dsBoleh: Ds[]; selesai: () => void }) {
  const [ke, setKe] = useState('')
  const [alasan, setAlasan] = useState('')
  async function pindah() {
    if (!ke) return toast('Pilih DS tujuan dulu.')
    if (!alasan.trim()) return toast('Alasan pemindahan wajib diisi.')
    const tujuan = dsBoleh.find((d) => d.id === ke)?.nama
    if (!(await konfirmasi(`Motor ${m.kode_motor} dipindah ke ${tujuan}. Rider pemegang dilepas otomatis dan pemindahan tercatat di riwayat.`, { judul: 'Pindahkan motor?', ya: 'Pindahkan' }))) return
    if (!(await ok(sb.rpc('pindah_motor', { p_motor: m.id, p_ke_ds: ke, p_alasan: alasan.trim() })))) return
    toast.ok('Motor dipindahkan')
    selesai()
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Syarat: tidak ada laporan kerusakan yang belum selesai, dan alasan wajib diisi. Rider pemegang dilepas otomatis. Arcon hanya bisa memindah antar DS yang dia pegang.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="DS tujuan"><Select value={ke} onChange={setKe} placeholder="— pilih DS tujuan —" opsi={dsBoleh.map((d) => ({ value: d.id, label: d.nama }))} /></Field>
        <Field label="Alasan pemindahan"><input className="inp w-full" value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="Mis. DS asal kelebihan motor" /></Field>
      </div>
      <button className="btn" onClick={pindah}>Pindahkan motor</button>
    </div>
  )
}

// ───────── Riwayat motor yang dihapus (Super-admin) ─────────
function BagianDihapus({ rows, dsNama, pelapor }: { rows: MotorDihapus[]; dsNama: (id: string | null) => string; pelapor: (id: string | null) => string }) {
  const pg = usePage(rows, [rows.length])
  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center gap-3"><b>Riwayat motor dihapus</b><span className="text-sm text-muted-foreground">{rows.length} motor</span></div>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Waktu</th><th>Kode</th><th>Plat</th><th>DS</th><th>Alasan</th><th>Ikut terhapus</th><th>Oleh</th></tr></thead>
          <tbody>
            {pg.rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{new Date(r.waktu).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                <td className="font-mono font-medium">{r.kode_motor}</td><td>{r.plat_nomor || '–'}</td><td>{dsNama(r.ds_id)}</td><td>{r.alasan}</td>
                <td className="text-muted-foreground">{r.jumlah_servis} servis · {r.jumlah_kerusakan} kerusakan</td><td>{pelapor(r.dihapus_oleh)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <Kosong teks="Belum ada motor yang dihapus." />}
      <div className="mt-3"><Pagination {...pg} /></div>
    </div>
  )
}

// ───────── Riwayat servis (semua motor) ─────────
function BagianServis({ rows, motorKode }: { rows: Servis[]; motorKode: (id: string) => string }) {
  const pg = usePage(rows, [rows.length])
  const total = rows.reduce((a, s) => a + s.biaya, 0)
  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <b>Riwayat servis</b>
        <span className="text-sm text-muted-foreground">{rows.length} catatan · total biaya {rupiah(total)}</span>
        <span className="ml-auto text-xs text-muted-foreground">Catat servis baru dari Detail motor.</span>
      </div>
      <TabelServis rows={pg.rows} motorNama={motorKode} />
      <div className="mt-3"><Pagination {...pg} /></div>
    </div>
  )
}

// ───────── Kerusakan (semua motor) ─────────
function BagianRusak({ rows, motorKode, pelapor, kelola, reload }: { rows: Rusak[]; motorKode: (id: string) => string; pelapor: (id: string | null) => string; kelola: boolean; reload: () => void }) {
  const [saring, setSaring] = useState('terbuka')
  const tampil = rows.filter((r) => (saring === 'semua' ? true : saring === 'terbuka' ? r.status !== 'selesai' : r.status === saring))
  const pg = usePage(tampil, [saring, rows.length])
  const total = tampil.reduce((a, r) => a + r.biaya, 0)
  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <b>Laporan kerusakan</b>
        <Select className="w-48" value={saring} onChange={setSaring} opsi={[{ value: 'terbuka', label: 'Belum selesai' }, { value: 'dilaporkan', label: 'Dilaporkan' }, { value: 'diproses', label: 'Diproses' }, { value: 'selesai', label: 'Selesai' }, { value: 'semua', label: 'Semua' }]} />
        <span className="text-sm text-muted-foreground">{tampil.length} laporan · total biaya {rupiah(total)}</span>
        <span className="ml-auto text-xs text-muted-foreground">Laporan baru dibuat dari Detail motor.</span>
      </div>
      <ListRusak rows={pg.rows} motorNama={motorKode} pelapor={pelapor} bisaProses={kelola} reload={reload} />
      <div className="mt-3"><Pagination {...pg} /></div>
    </div>
  )
}
