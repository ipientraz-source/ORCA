import { useEffect, useState } from 'react'
import { sb, today, monday, hari, useRows, ok, toast, Err, Kosong, RiderPick, Select, usePage, Pagination, type Ds, type Me, type Rider } from './lib'
import { InputTanggal } from './tanggal'

type Act = { rider_id: string; status: string; backup_untuk_id: string | null; penjelasan: string | null; potongan: boolean | null; insentif: number; tanpa_pengganti: boolean; tukar_dikonfirmasi: boolean }
// potongan: Ya/Tidak untuk alpha/izin/sakit; insentif: nominal rupiah untuk rider pengganti
type TabShift = 'pagi' | 'tengah' | 'siang' | 'lain'
type Catat = (rider: string, status: string, backup?: string, teks?: string, potongan?: boolean | null, insentif?: number, tanpa?: boolean) => Promise<boolean>

const rupiah = (n: number) => `Rp ${n.toLocaleString('id-ID')}`
const angka = (s: string) => parseInt(s.replace(/\D/g, ''), 10) || 0

// Dua pilihan berdampingan (mis. Ya / Tidak); opsi ketiga true = pilihan netral (warna gelap)
function Pilih({ nilai, ubah, opsi }: { nilai: string; ubah: (v: string) => void; opsi: [string, string, boolean?][] }) {
  return (
    <span role="group" className="inline-flex overflow-hidden rounded-lg border border-input">
      {opsi.map(([v, label, netral]) => (
        <button
          key={v}
          type="button"
          aria-pressed={nilai === v}
          onClick={() => ubah(v)}
          className={`px-3.5 py-1.5 text-sm font-semibold transition-colors ${nilai === v ? (netral ? 'bg-foreground text-background' : 'bg-primary text-primary-foreground') : 'bg-card text-muted-foreground hover:bg-muted'}`}
        >
          {label}
        </button>
      ))}
    </span>
  )
}

function Nominal({ nilai, ubah }: { nilai: string; ubah: (v: string) => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      Rp
      <input className="inp w-40" inputMode="numeric" placeholder="Nominal, mis. 50000" value={nilai} onChange={(e) => ubah(e.target.value.replace(/\D/g, '').slice(0, 9))} />
    </span>
  )
}

const ALASAN: [string, string][] = [
  ['alpha', 'Tidak hadir tanpa kabar (Alpha)'],
  ['izin', 'Izin'],
  ['sakit', 'Sakit'],
  ['tukar', 'Tukar shift (sudah direncanakan)'],
  ['tukar_libur', 'Tukar libur (tanpa potongan)'],
]
export const WARNA: Record<string, string> = {
  hadir: 'bg-foreground text-background',
  alpha: 'bg-danger-soft text-danger',
  izin: 'bg-border text-foreground/80',
  sakit: 'bg-border text-foreground/80',
  tukar: 'bg-primary-soft text-primary-soft-foreground',
  tukar_libur: 'bg-primary-soft text-primary-soft-foreground',
  pengganti: 'bg-primary text-white',
}

export function Daily({ ds }: { me: Me; ds: Ds | null }) {
  return ds ? <DailyInner ds={ds} /> : <p>Anda belum ditunjuk sebagai Captain di DS mana pun.</p>
}

// Super-admin (akses penuh): isi atau koreksi absensi di DS mana pun. Arcon: membantu Captain di DS yang dipegangnya (dsList dari App).
export function AbsensiSemua({ dsList }: { dsList?: Ds[] }) {
  const dsl = useRows<Ds>(() => sb.from('ds').select('*').order('nama'), [])
  const daftar = dsList ?? dsl.rows
  const [id, setId] = useState('')
  const ds = daftar.find((d) => d.id === (id || daftar[0]?.id))
  return (
    <div>
      <Select className="mb-3 w-72 max-w-full" value={ds?.id ?? ''} onChange={setId} placeholder="Pilih DS" opsi={daftar.map((d) => ({ value: d.id, label: d.nama }))} />
      {ds ? <DailyInner key={ds.id} ds={ds} /> : <p className="text-muted-foreground">Belum ada DS.</p>}
    </div>
  )
}

function DailyInner({ ds }: { ds: Ds }) {
  const [tgl, setTgl] = useState(today())
  const [q, setQ] = useState('')
  const riders = useRows<Rider>(() => sb.from('riders').select('*').eq('ds_id', ds.id).eq('status', 'aktif').order('nama'), [ds.id])
  const jd = useRows<{ rider_id: string; shift: string }>(() => sb.from('jadwal').select('rider_id,shift').eq('ds_id', ds.id).eq('tanggal', tgl), [ds.id, tgl])
  const ac = useRows<Act>(
    () => sb.from('actual_harian').select('rider_id,status,backup_untuk_id,penjelasan,potongan,insentif,tanpa_pengganti,tukar_dikonfirmasi').eq('ds_id', ds.id).eq('tanggal', tgl),
    [ds.id, tgl],
  )
  const lock = useRows<{ minggu_mulai: string }>(
    () => sb.from('periode_kunci').select('minggu_mulai').eq('ds_id', ds.id).eq('minggu_mulai', monday(tgl)),
    [ds.id, tgl],
  )
  const locked = lock.rows.length > 0
  const nama = (id: string | null) => riders.rows.find((r) => r.id === id)?.nama ?? '?'
  const shift = (id: string) => jd.rows.find((r) => r.rider_id === id && r.shift !== 'off')?.shift
  // Rider yang dijadwalkan bisa punya dua isian: miliknya sendiri (hadir, dst.) dan isian pengganti bila ia lanjut menutup shift lain (long shift).
  // act() = isian miliknya sendiri; longShift() = isian pengganti rider terjadwal. Rider tanpa jadwal tetap satu isian.
  // Isian pengganti hasil tukar lama (satu arah): rekan yang digantikan berstatus tukar. Itu absensi rider itu sendiri, bukan long shift.
  const dariTukar = (r: Act) => ac.rows.some((t) => t.rider_id === r.backup_untuk_id && t.status === 'tukar')
  const act = (id: string) => {
    const milik = ac.rows.filter((r) => r.rider_id === id)
    if (!shift(id)) return milik[0]
    return milik.find((r) => r.status !== 'pengganti') ?? milik.find((r) => r.status === 'pengganti' && dariTukar(r))
  }
  const longShift = (id: string) => (shift(id) ? ac.rows.find((r) => r.rider_id === id && r.status === 'pengganti' && !dariTukar(r)) : undefined)

  // Tiap rider masuk tab shift-nya. Rider pengganti (tak ada di jadwal hari itu) ikut tab shift rider yang digantikannya;
  // kalau tidak menggantikan siapa pun, masuk tab "Lainnya".
  // Rider yang bertukar shift (dua arah) tampil di shift yang DIKERJAKAN, yaitu shift rekannya: yang pagi jadi siang, yang siang jadi pagi.
  // Shift yang benar-benar dikerjakan hari ini: rider yang bertukar mengerjakan shift rekannya. Rider hasil tukar yang tidak hadir (alpha/izin/sakit)
  // tidak datang di shift hasil tukar itu, jadi shift-nya juga shift rekannya (rekannya tetap berstatus tukar menunjuk ke dia).
  const shiftKerja = (id: string) => {
    const a = act(id)
    const rekan = a?.status === 'tukar' && a.backup_untuk_id ? a.backup_untuk_id : ac.rows.find((t) => t.status === 'tukar' && t.backup_untuk_id === id && shift(t.rider_id))?.rider_id
    return (rekan ? shift(rekan) : undefined) ?? shift(id)
  }
  const shiftTab = (id: string): TabShift => {
    const a = act(id)
    const s = shiftKerja(id) ?? shift(a?.backup_untuk_id ?? '')
    return s === 'pagi' || s === 'tengah' || s === 'siang' ? s : 'lain'
  }
  const listed = riders.rows.filter((r) => shift(r.id) || act(r.id))
  const terjadwal = riders.rows.filter((r) => shift(r.id))
  // Tukar dua arah yang belum dikonfirmasi Captain dihitung belum diabsen (sama seperti di laporan)
  const sudahIsi = (id: string) => { const a = act(id); return !!a && !(a.status === 'tukar' && !a.tukar_dikonfirmasi) }
  const hitung = (t: TabShift) => ({ total: terjadwal.filter((r) => shiftTab(r.id) === t).length, terisi: terjadwal.filter((r) => shiftTab(r.id) === t && sudahIsi(r.id)).length })
  const ada = (t: TabShift) => listed.some((r) => shiftTab(r.id) === t)
  // Tab awal: shift pertama yang masih ada rider belum diabsen (pagi dulu), jadi Captain langsung di shift yang perlu dilaporkan.
  const [pilihTab, setPilihTab] = useState<TabShift | null>(null)
  useEffect(() => setPilihTab(null), [tgl])
  const tabAwal: TabShift = (['pagi', 'tengah', 'siang'] as const).find((t) => hitung(t).terisi < hitung(t).total) ?? (ada('pagi') ? 'pagi' : ada('tengah') ? 'tengah' : ada('siang') ? 'siang' : 'pagi')
  const tab = pilihTab ?? tabAwal
  const dicari = q.trim().length > 0
  // Mencari rider menelusuri semua shift sekaligus; tanpa kata kunci, hanya shift yang sedang dibuka
  const shown = listed.filter((r) => (dicari || shiftTab(r.id) === tab) && (r.nama + (r.kode_mtr ?? '')).toLowerCase().includes(q.toLowerCase()))
  const total = hitung(tab).total
  const terisiTab = hitung(tab).terisi
  const pg = usePage(shown, [q, tgl, tab])
  // Rider pengganti milik seorang rider yang tidak hadir; calon pengganti = rider lain yang hari itu tidak dijadwalkan masuk
  // dan belum punya absensi lain (aturan yang sama dipaksakan di database)
  const penggantiDari = (id: string) => ac.rows.find((a) => a.status === 'pengganti' && a.backup_untuk_id === id)
  // Rider yang sudah dijadwalkan boleh lanjut menutup shift LAIN (long shift) bila ia hadir/belum diabsen dan belum menutup orang lain.
  const calonPengganti = (id: string) =>
    riders.rows.filter((x) => {
      if (x.id === id) return false
      if (!shift(x.id)) return !act(x.id) || (act(x.id)!.status === 'pengganti' && act(x.id)!.backup_untuk_id === id)
      const lain = longShift(x.id)
      if (lain && lain.backup_untuk_id !== id) return false
      // yang sudah bertukar shift pun boleh lanjut menutup shift lain, asalkan beda dari shift yang sedang ia kerjakan
      return shiftKerja(x.id) !== shiftKerja(id)
    })

  const catat: Catat = async (rider, status, backup, teks, potongan, insentif, tanpa) => {
    setPilihTab((t) => t ?? tab) // kunci tab yang sedang dibuka: selesai mengabsen satu shift tidak langsung memindahkan layar ke shift lain
    const done = await ok(
      sb.rpc('catat_actual', { p_tanggal: tgl, p_rider: rider, p_status: status, p_backup: backup || null, p_penjelasan: teks || null, p_potongan: potongan ?? null, p_insentif: insentif ?? 0, p_tanpa_pengganti: tanpa ?? false }),
    )
    if (done) ac.reload()
    return done
  }
  const hapus = async (rider: string) => {
    setPilihTab((t) => t ?? tab)
    if (await ok(sb.rpc('hapus_actual', { p_tanggal: tgl, p_rider: rider }))) ac.reload()
  }
  // Hadir pada rider hasil tukar = konfirmasi bahwa ia benar masuk di shift barunya (tukarnya tidak berubah)
  const konfirmasi = async (rider: string, hadir: boolean) => {
    setPilihTab((t) => t ?? tab)
    if (await ok(sb.rpc('konfirmasi_tukar', { p_tanggal: tgl, p_rider: rider, p_hadir: hadir }))) ac.reload()
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <InputTanggal className="inp" value={tgl} max={today()} onChange={(e) => e.target.value && setTgl(e.target.value)} />
        <b>{hari(tgl)}</b>
        <input className="inp ml-auto" placeholder="cari rider / Kode MTR" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div role="tablist" aria-label="Shift" className="mb-3 flex flex-wrap items-center gap-2">
        {([['pagi', 'Shift Pagi'], ['tengah', 'Shift Middle'], ['siang', 'Shift Siang'], ['lain', 'Lainnya']] as const).filter(([t]) => (t !== 'lain' && t !== 'tengah') || ada(t)).map(([t, label]) => {
          const h = hitung(t)
          const lengkap = h.total > 0 && h.terisi === h.total
          return (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setPilihTab(t)} className={`tab !px-3 ${tab === t && !dicari ? 'tab-on' : 'border border-border'}`}>
              {label}
              {h.total > 0 && <span className={`ml-2 font-mono text-xs ${tab === t && !dicari ? 'text-primary-foreground/80' : lengkap ? 'text-success' : 'text-muted-foreground'}`}>{h.terisi}/{h.total}{lengkap ? ' ✓' : ''}</span>}
            </button>
          )
        })}
        {!dicari && total > 0 && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-2 w-28 overflow-hidden rounded-full bg-border">
              <span className="block h-full bg-primary" style={{ width: `${(100 * terisiTab) / total}%` }} />
            </span>
            {terisiTab}/{total} rider sudah diabsen
          </span>
        )}
        {dicari && <span className="text-sm text-muted-foreground">Hasil pencarian dari semua shift</span>}
      </div>
      {locked && <p className="bg-warning-soft border border-warning/40 rounded p-2 text-sm mb-3">Absensi minggu ini sudah dikunci dan tidak bisa diubah lagi.</p>}
      <Err msg={riders.err || jd.err || ac.err} />
      <div className="space-y-3 md:space-y-2">
        {pg.rows.map((r) => (
          <Baris
            key={r.id + tgl}
            r={r}
            shift={shift(r.id)}
            act={act(r.id)}
            nama={nama}
            rekan={riders.rows.filter((x) => x.id !== r.id && !(shift(x.id) && shift(x.id) === shift(r.id)))} // tukar butuh shift berbeda
            pengganti={penggantiDari(r.id)}
            longShift={longShift(r.id)}
            shiftDari={shift}
            shiftKerja={shiftKerja}
            calon={calonPengganti(r.id)}
            locked={locked}
            catat={catat}
            hapus={hapus}
            konfirmasi={konfirmasi}
          />
        ))}
        {!shown.length && <div className="card"><Kosong teks={dicari ? 'Tidak ada rider yang cocok' : listed.length ? `Tidak ada rider di ${tab === 'pagi' ? 'shift pagi' : tab === 'tengah' ? 'shift middle' : tab === 'siang' ? 'shift siang' : 'tab ini'}` : 'Tidak ada rider yang dijadwalkan di tanggal ini'} hint={listed.length ? 'Coba shift lain di atas.' : 'Susun jadwal di tab Jadwal DS, atau tambahkan rider pengganti di bawah.'} /></div>}
      </div>
      <div className="mt-3"><Pagination {...pg} /></div>
      <TambahPengganti
        kandidat={riders.rows.filter((r) => !listed.some((l) => l.id === r.id))}
        terjadwal={terjadwal}
        locked={locked}
        catat={catat}
      />
    </div>
  )
}

function Baris({
  r, shift, act, nama, rekan, pengganti, longShift, shiftDari, shiftKerja, calon, locked, catat, hapus, konfirmasi,
}: {
  r: Rider
  shift?: string
  act?: Act
  nama: (id: string | null) => string
  rekan: Rider[] // rekan tukar shift
  pengganti?: Act // baris pengganti milik rider ini (kalau ada)
  longShift?: Act // isian pengganti rider ini sendiri, bila ia dijadwalkan lalu lanjut menutup shift rider lain
  shiftDari: (id: string) => string | undefined // shift terjadwal seorang rider pada tanggal ini
  shiftKerja: (id: string) => string | undefined // shift yang benar-benar dikerjakan (rider yang bertukar mengerjakan shift rekannya)
  calon: Rider[] // calon rider pengganti
  locked: boolean
  catat: Catat
  hapus: (id: string) => void
  konfirmasi: (id: string, hadir: boolean) => void
}) {
  // Form "Tidak hadir" memuat isian yang sudah tersimpan, jadi mengoreksi tidak mengulang dari awal.
  const lama = act && ['alpha', 'izin', 'sakit', 'tukar', 'tukar_libur'].includes(act.status) ? act : undefined
  const tukaran = act?.status === 'tukar' || act?.status === 'tukar_libur' // tukar shift atau tukar libur: bukan tidak hadir biasa, tanpa potongan
  // Tukar dua arah (rekan juga terjadwal): shift keduanya sudah terkunci, Captain tinggal mengonfirmasi hadir atau tidaknya.
  const rekanTukar = act?.status === 'tukar' ? act.backup_untuk_id : null
  const tukarDua = !!rekanTukar && !!shiftDari(rekanTukar)
  const urut = (s?: string) => (s === 'pagi' ? 0 : s === 'tengah' ? 1 : s === 'siang' ? 2 : 9)
  // Tukar hanya bisa dibatalkan dari shift pertama (yang dikerjakan lebih awal); di shift kedua isiannya sudah terkunci
  const shiftPertama = !tukarDua || urut(shiftKerja(r.id)) < urut(shift)
  const hadirTukar = tukarDua && !!act?.tukar_dikonfirmasi
  // Sudah masuk isian = punya status tersimpan (tukar dua arah baru terisi setelah dikonfirmasi). Dipakai untuk penanda di baris.
  const terisi = !!act && !(act.status === 'tukar' && !act.tukar_dikonfirmasi)
  const awal = tukarDua ? undefined : lama // tidak hadir pada baris tukar mulai dari isian kosong (alpha), bukan dari isian tukarnya
  const [buka, setBuka] = useState(false)
  const [alasan, setAlasan] = useState(awal?.status ?? 'alpha')
  const [backup, setBackup] = useState(pengganti?.rider_id ?? '')
  // alpha/izin/sakit: pilih rider pengganti ('ada') ATAU "Tidak dapat pengganti" ('tidak'). Tanpa calon sama sekali, bawaannya 'tidak'.
  const [adaPengganti, setAdaPengganti] = useState(awal ? !awal.tanpa_pengganti : calon.length > 0)
  const [teks, setTeks] = useState(awal?.penjelasan ?? '')
  const [potongan, setPotongan] = useState(awal ? (awal.potongan === true || (awal.potongan == null && awal.status === 'alpha') ? 'ya' : 'tidak') : 'ya') // saran awal: Alpha = Ya, Izin/Sakit = Tidak; Captain bisa mengubah
  const [ins, setIns] = useState(!!pengganti?.insentif)
  const [nominal, setNominal] = useState(pengganti?.insentif ? String(pengganti.insentif) : '')

  const gantiAlasan = (v: string) => {
    setAlasan(v)
    setPotongan(v === 'alpha' ? 'ya' : 'tidak')
    setBackup('') // tukar memilih dari rekan, selain itu dari calon pengganti: daftarnya berbeda
    setIns(false)
    setNominal('')
  }
  const simpan = async () => {
    if (alasan === 'tukar' && !backup) return toast('Pilih rekan yang bertukar')
    if (alasan !== 'tukar' && adaPengganti && !backup) return toast('Pilih rider pengganti, atau pilih "Tidak dapat pengganti"')
    const pakaiPengganti = alasan === 'tukar' || adaPengganti
    const adaIns = alasan !== 'tukar' && adaPengganti && !!backup && ins
    if (adaIns && angka(nominal) <= 0) return toast('Isi nominal insentif lebih dari 0')
    const pot = alasan === 'tukar' || alasan === 'tukar_libur' ? undefined : potongan === 'ya'
    if (await catat(r.id, alasan, pakaiPengganti ? backup : undefined, teks, pot, adaIns ? angka(nominal) : 0, alasan !== 'tukar' && !adaPengganti)) setBuka(false)
  }

  return (
    <div className={`card !mb-0 !border-l-4 ${terisi ? '!border-l-success' : '!border-l-warning'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-40">
          {terisi && <span className="mr-1 font-bold text-success" title="Sudah diabsen" aria-label="Sudah diabsen">✓</span>}
          <b>{r.nama}</b> <span className="text-muted-foreground/70 text-xs">{r.kode_mtr}</span>
          <div className="text-xs text-muted-foreground capitalize">
            {act?.status === 'tukar' && act.backup_untuk_id && shiftDari(act.backup_untuk_id) ? `${shift} → ${shiftDari(act.backup_untuk_id)} (tukar)` : shift ?? 'tidak ada di jadwal'}
          </div>
        </div>
        {!terisi && !tukarDua && <span className="badge bg-warning-soft text-warning">Belum diabsen</span>}
        {act && (
          <span className={`badge ${WARNA[act.status]}`}>
            {act.status.replace('_', ' ')}
            {act.status === 'pengganti' && act.backup_untuk_id ? ` untuk ${nama(act.backup_untuk_id)}` : ''}
          </span>
        )}
        {pengganti && act && act.status !== 'pengganti' && <span className="badge bg-primary-soft text-primary-soft-foreground">Pengganti: {nama(pengganti.rider_id)}</span>}
        {act?.status === 'tukar' && act.backup_untuk_id && (
          <span className="badge bg-primary-soft text-primary-soft-foreground">
            Tukar dengan {nama(act.backup_untuk_id)}{shiftDari(act.backup_untuk_id) ? ` (kerja ${shiftDari(act.backup_untuk_id)})` : ''}
          </span>
        )}
        {tukarDua && (hadirTukar
          ? <span className="badge bg-success-soft text-success">Hadir dikonfirmasi</span>
          : <span className="badge bg-warning-soft text-warning">Belum dikonfirmasi hadir</span>)}
        {longShift && (
          <span className="badge bg-primary text-white">
            {longShift.backup_untuk_id ? `${act?.status === 'tukar' ? 'Menutup' : 'Long shift: menutup'} ${shiftDari(longShift.backup_untuk_id) ?? 'shift lain'} untuk ${nama(longShift.backup_untuk_id)}` : 'Pengganti tambahan'}
            {longShift.insentif ? ` · + Insentif ${rupiah(longShift.insentif)}` : ''}
          </span>
        )}
        {act?.tanpa_pengganti && <span className="badge bg-warning-soft text-warning">Tanpa pengganti</span>}
        {act?.potongan === true && <span className="badge bg-danger-soft text-danger">Potongan: Ya</span>}
        {act?.potongan === false && <span className="badge bg-muted text-muted-foreground">Tanpa potongan</span>}
        {!!act?.insentif && <span className="badge bg-success-soft text-success">+ Insentif {rupiah(act.insentif)}</span>}
        {act?.penjelasan && <span className="text-xs text-muted-foreground">“{act.penjelasan}”</span>}
        <div className="flex w-full flex-wrap gap-2 md:ml-auto md:w-auto">
          {/* Tombol yang sesuai status tersimpan berubah warna (hijau = hadir, merah = tidak hadir) supaya Captain tahu mana yang sudah diklik */}
          <button
            className={`${act?.status === 'hadir' || hadirTukar ? 'btn2 !border-success !bg-success-soft !text-success' : 'btn'} btn-lg flex-1 whitespace-nowrap md:flex-none`}
            disabled={locked}
            aria-pressed={act?.status === 'hadir' || hadirTukar}
            onClick={() => { setBuka(false); if (tukarDua) konfirmasi(r.id, !hadirTukar); else catat(r.id, 'hadir') }}
          >
            {act?.status === 'hadir' || hadirTukar ? '✓ Hadir' : 'Hadir'}
          </button>
          <button
            className={`btn2 btn-lg flex-1 whitespace-nowrap md:flex-none ${tukaran && !tukarDua ? '!border-primary !bg-primary-soft !text-primary-soft-foreground' : lama && !tukarDua ? '!border-danger !bg-danger-soft !text-danger' : ''}`}
            disabled={locked}
            aria-expanded={buka}
            onClick={() => setBuka(!buka)}
          >
            {tukarDua ? 'Tidak hadir' : act?.status === 'tukar' ? '✓ Tukar shift' : act?.status === 'tukar_libur' ? '✓ Tukar libur' : lama ? '✓ Tidak hadir' : 'Tidak hadir'}
          </button>
          {tukarDua && !shiftPertama && <span className="self-center text-xs text-muted-foreground">Batalkan tukar lewat shift {shift}</span>}
          {(act || longShift) && shiftPertama && (
            <button className="btn2 w-full md:w-auto" disabled={locked} onClick={() => hapus(r.id)} title={act ? 'Hapus isian, kembali ke belum diabsen' : 'Hapus isian pengganti tambahan'}>
              {act ? 'Batalkan' : 'Batalkan pengganti'}
            </button>
          )}
        </div>
      </div>
      {buka && (
        <div className="mt-2 pt-2 border-t flex flex-wrap gap-2 items-center">
          <Select className="w-72 max-w-full" value={alasan} onChange={gantiAlasan} opsi={ALASAN.map(([value, label]) => ({ value, label }))} />
          {tukarDua && rekanTukar && alasan !== 'tukar' && (
            <span className="basis-full text-xs text-muted-foreground">
              {backup === rekanTukar
                ? `Pengganti ${nama(rekanTukar)} membatalkan tukar: ${nama(rekanTukar)} menutup ${shift} lalu lanjut shift ${shiftDari(rekanTukar)} sendiri dan perlu diabsen lagi.`
                : `Rider ini bertukar dengan ${nama(rekanTukar)}, yang sudah mengerjakan ${shift}. Tukar tetap jalan: ${nama(rekanTukar)} tetap dihitung di ${shift} (konfirmasi hadirnya), dan pengganti menutup shift ${shiftDari(rekanTukar)} yang ditinggalkan rider ini.`}
            </span>
          )}
          {alasan === 'tukar' && <RiderPick riders={rekan} value={backup} onChange={setBackup} placeholder="Rekan tukar" />}
          {alasan === 'tukar' && backup && shiftDari(backup) && shift && (
            <span className="basis-full text-xs text-muted-foreground">Tukar: {r.nama} pindah ke {shiftDari(backup)}, {nama(backup)} pindah ke {shift}. Keduanya dihitung hadir di shift barunya.</span>
          )}
          {alasan !== 'tukar' && (
            <div className="flex basis-full flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Rider pengganti (wajib):</span>
              <Pilih nilai={adaPengganti ? 'ada' : 'tidak'} ubah={(v) => { setAdaPengganti(v === 'ada'); if (v !== 'ada') { setBackup(''); setIns(false); setNominal('') } }} opsi={[['ada', 'Ada pengganti'], ['tidak', 'Tidak dapat pengganti', true]]} />
              {!adaPengganti && !calon.length && <span className="text-xs text-muted-foreground">Tidak ada rider yang bisa jadi pengganti hari ini.</span>}
              {adaPengganti && (
                calon.length ? (
                  <>
                    <RiderPick riders={calon} value={backup} onChange={setBackup} placeholder="Pilih rider pengganti" />
                    {backup && shiftKerja(backup) && (
                      <span className="text-xs text-muted-foreground">{nama(backup)} masuk {shiftKerja(backup)}{shiftKerja(backup) !== shiftDari(backup) ? ' (hasil tukar)' : ''}, lalu menutup {(backup === rekanTukar ? shift : shiftKerja(r.id)) ?? 'shift ini'}: long shift, dihitung 2 shift. Jika shift {shiftKerja(backup)}-nya ditukar ke rider lain, catat lewat Tukar shift pada {nama(backup)}.</span>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-warning">Tidak ada rider yang bisa jadi pengganti hari ini (semua dijadwalkan di shift yang sama, tidak hadir, atau sudah menutup shift lain). Pilih "Tidak dapat pengganti".</span>
                )
              )}
            </div>
          )}
          {alasan !== 'tukar' && (
            <input className="inp flex-1 min-w-40" placeholder={!adaPengganti ? 'Kenapa tidak dapat pengganti? (opsional)' : alasan === 'sakit' ? 'Keterangan (opsional)' : 'Keterangan'} value={teks} onChange={(e) => setTeks(e.target.value)} />
          )}
          {alasan === 'tukar_libur' && <span className="basis-full text-xs text-muted-foreground">Tukar libur: rider ini menukar hari liburnya dengan rider lain, jadi tanpa potongan. Pilih rider yang menutup shift-nya di atas.</span>}
          {alasan !== 'tukar' && alasan !== 'tukar_libur' && (
            <div className="flex basis-full flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Kena potongan gaji (deduction)?</span>
              <Pilih nilai={potongan} ubah={setPotongan} opsi={[['ya', 'Ya'], ['tidak', 'Tidak', true]]} />
              <span className="text-xs text-muted-foreground">Saran: {alasan === 'alpha' ? 'Ya' : 'Tidak'} untuk {alasan === 'alpha' ? 'tidak hadir tanpa kabar' : alasan}. Bisa diubah.</span>
            </div>
          )}
          {alasan !== 'tukar' && adaPengganti && backup && (
            <div className="flex basis-full flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Insentif untuk pengganti?</span>
              <Pilih nilai={ins ? 'ya' : 'tidak'} ubah={(v) => { setIns(v === 'ya'); if (v !== 'ya') setNominal('') }} opsi={[['tidak', 'Tanpa insentif', true], ['ya', '+ Insentif']]} />
              {ins && <Nominal nilai={nominal} ubah={setNominal} />}
            </div>
          )}
          <button className="btn" onClick={simpan}>
            Simpan
          </button>
        </div>
      )}
    </div>
  )
}

function TambahPengganti({ kandidat, terjadwal, locked, catat }: { kandidat: Rider[]; terjadwal: Rider[]; locked: boolean; catat: Catat }) {
  const [rid, setRid] = useState('')
  const [gt, setGt] = useState('')
  const [ins, setIns] = useState(false)
  const [nominal, setNominal] = useState('')
  return (
    <div className="card mt-4">
      <b className="block mb-2">Tambah rider pengganti</b>
      <p className="text-xs text-muted-foreground mb-3 -mt-1">Untuk rider yang masuk kerja padahal tidak ada di jadwal hari itu.</p>
      <div className="flex flex-wrap gap-2 items-center">
        <RiderPick riders={kandidat} value={rid} onChange={setRid} placeholder="Rider pengganti" />
        <RiderPick riders={terjadwal} value={gt} onChange={setGt} placeholder="Menggantikan siapa? (opsional)" />
        <div className="flex basis-full flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Insentif untuk pengganti?</span>
          <Pilih nilai={ins ? 'ya' : 'tidak'} ubah={(v) => { setIns(v === 'ya'); if (v !== 'ya') setNominal('') }} opsi={[['tidak', 'Tanpa insentif', true], ['ya', '+ Insentif']]} />
          {ins && <Nominal nilai={nominal} ubah={setNominal} />}
        </div>
        <button
          className="btn"
          disabled={!rid || locked}
          onClick={async () => {
            if (ins && angka(nominal) <= 0) return toast('Isi nominal insentif lebih dari 0')
            if (await catat(rid, 'pengganti', gt, undefined, null, ins ? angka(nominal) : 0)) {
              setRid('')
              setGt('')
              setIns(false)
              setNominal('')
            }
          }}
        >
          Tambah
        </button>
      </div>
    </div>
  )
}
