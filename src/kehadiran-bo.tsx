// Menu Kehadiran BO: sinkron clock-in rider dari API backoffice Dash (otomatis berkala; tombol "Sinkron sekarang" untuk menarik manual bila sinkron terputus),
// pasangkan hub baru ke DS (atau buat DS baru), lihat ringkasan, dan atur jam shift untuk menilai tepat waktu. BO adalah sumber daftar DS.
// Yang disimpan hanya kode mitra, hub, jam masuk dan keluar (NIK, nama, selfie, dan GPS tidak dibawa). Penilaian shift dan tepat waktu dilakukan Orca, bukan BO.
import { useEffect, useMemo, useState } from 'react'
import { sb, today, addDays, hari, useRows, ok, toast, Err, Field, Kosong, Select, usePage, Pagination } from './lib'
import { persenBo, teksPersen, type AktualBo } from './aktual-bo'

const BARU = '__baru__'

type Ds = { id: string; nama: string; hub_bo: string | null }
type Atur = { mulai_pagi: string; mulai_tengah: string; mulai_siang: string; toleransi_menit: number; batas_pagi: string; batas_tengah: string }
type Sinkron = { sinkron_terakhir: string | null; sinkron_status: 'berhasil' | 'gagal' | null; sinkron_pesan: string | null }
type Hasil = { ditarik: number; baris_baru: number; baris_diperbarui: number; ds_dibuat: number; ds_dipasang: number }
type Perlu = { hub: string; baris: number }

const RENTANG = [{ value: '1', label: 'Kemarin dan hari ini' }, { value: '7', label: '7 hari terakhir' }, { value: '30', label: '30 hari terakhir' }]
const waktuWib = (iso: string) => new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const kunci = (s: string) => new Set((s.toLowerCase().replace(/dark store|toko sapa|alfagift|^ds /g, ' ').match(/[a-z]+/g) ?? []).filter((x) => !['ds', 'kso', 'store'].includes(x)))
const mirip = (a: string, b: string) => {
  const x = kunci(a), y = kunci(b)
  const irisan = [...x].filter((k) => y.has(k)).length
  return irisan / ([...new Set([...x, ...y])].length || 1)
}

// bacaSaja = tampilan Arcon: hanya melihat clock-in DS yang dipegangnya (datanya sudah dibatasi database); sinkron manual dan ubah jam shift hanya Super-admin
export function KehadiranBo({ bacaSaja = false }: { bacaSaja?: boolean }) {
  const dsl = useRows<Ds>(() => sb.from('ds').select('id,nama,hub_bo').order('nama'), [])
  const st = useRows<Sinkron>(() => sb.from('pengaturan_kehadiran').select('sinkron_terakhir,sinkron_status,sinkron_pesan').eq('id', 1), [])
  const status = st.rows[0]
  const [rentang, setRentang] = useState('1')
  const [sibuk, setSibuk] = useState(false)
  const [perlu, setPerlu] = useState<Perlu[] | null>(null)
  const [peta, setPeta] = useState<Record<string, string>>({})
  const [hasil, setHasil] = useState<Hasil | null>(null)

  // Hub baru dari BO: usulan DS yang namanya mirip dan belum terhubung
  const hubs = useMemo(() => (perlu ?? []).map((h) => {
    const kandidat = dsl.rows.filter((d) => !d.hub_bo).map((d) => ({ d, skor: mirip(h.hub, d.nama) })).sort((a, b) => b.skor - a.skor)[0]
    return { ...h, usulan: kandidat && kandidat.skor >= 0.5 ? kandidat.d : undefined }
  }), [perlu, dsl.rows])
  useEffect(() => { setPeta(Object.fromEntries(hubs.map((h) => [h.hub, h.usulan?.id ?? BARU]))) }, [hubs])
  const dipilih = Object.values(peta).filter((v) => v !== BARU)
  const ganda = dipilih.length !== new Set(dipilih).size

  // Ringkasan per DS dan per shift untuk satu hari (14 hari terakhir), dinilai Orca dari clock-in BO (aktual_bo, migrasi 0065)
  const hariIni = today()
  const [tgl, setTgl] = useState(hariIni)
  const tglOpsi = Array.from({ length: 14 }, (_, i) => addDays(hariIni, -i))
  const ring = useRows<AktualBo>(() => sb.rpc('aktual_bo', { p_dari: tgl, p_sampai: tgl }), [tgl])
  const barisTgl = ring.rows
  const pg = usePage(barisTgl, [tgl])

  // Tanpa pasangan: hub baru ditanyakan dulu. Dengan pasangan (peta): hub dipasangkan atau dibuatkan DS baru, lalu data disimpan.
  const sinkron = async (pasang?: Record<string, string>) => {
    setSibuk(true)
    setHasil(null)
    const { data, error } = await sb.functions.invoke('tarik-kehadiran-bo', { body: { dari: addDays(today(), -Number(rentang)), sampai: today(), ...(pasang ? { peta: pasang } : {}) } })
    setSibuk(false)
    st.reload()
    if (error || data?.error) return toast(data?.error ?? 'Sinkron belum bisa dijalankan. Coba lagi.')
    if (data.perlu_pasangan) return setPerlu(data.perlu_pasangan as Perlu[])
    setPerlu(null)
    setHasil(data as Hasil)
    toast.ok('Kehadiran BO tersinkron')
    dsl.reload()
    ring.reload()
  }
  const lanjut = () => sinkron(Object.fromEntries(Object.entries(peta).filter(([, v]) => v !== BARU)))

  return (
    <div className="w-full space-y-4">
      <Err msg={dsl.err || ring.err || st.err} />
      <div className="card !mb-0 space-y-3">
        <div>
          <b className="block">Sinkron kehadiran dari BO</b>
          <p className="text-xs text-muted-foreground">
            {status?.sinkron_terakhir
              ? <>Sinkron terakhir {waktuWib(status.sinkron_terakhir)}: <span className={status.sinkron_status === 'gagal' ? 'text-danger' : 'text-success'}>{status.sinkron_status === 'gagal' ? 'gagal' : 'berhasil'}</span>{status.sinkron_pesan ? ` · ${status.sinkron_pesan}` : ''}</>
              : 'Belum pernah sinkron.'}
          </p>
          {bacaSaja && <p className="text-xs text-muted-foreground">Menampilkan clock-in dari BO untuk DS yang Anda pegang. Sinkron manual dilakukan Super-admin.</p>}
        </div>
        {!bacaSaja && (
          <>
            <p className="text-xs text-muted-foreground">Data ditarik otomatis berkala. Bila sinkron otomatis terputus (status di atas gagal atau sudah lama), tarik manual di sini. Aman diulang: baris yang sama tidak tercatat dua kali.</p>
            <div className="flex flex-wrap items-center gap-3">
              <Select className="w-56" value={rentang} onChange={setRentang} opsi={RENTANG} />
              <button className="btn" disabled={sibuk || !!perlu} onClick={() => void sinkron()}>{sibuk ? 'Menarik data…' : 'Sinkron sekarang'}</button>
            </div>
          </>
        )}
        {perlu && (
          <div className="space-y-3">
            <p className="text-sm"><b>{perlu.length}</b> hub baru dari BO belum punya DS di Orca. Pasangkan ke DS yang sudah ada, atau buat DS baru, lalu lanjutkan.</p>
            <div className="overflow-x-auto">
              <table className="tbl w-full text-sm">
                <thead><tr><th>Hub di BO</th><th>Baris</th><th>Dipasangkan ke DS di Orca</th></tr></thead>
                <tbody>
                  {hubs.map((h) => (
                    <tr key={h.hub}>
                      <td>{h.hub}</td>
                      <td>{h.baris}</td>
                      <td>
                        <Select className="min-w-72" value={peta[h.hub] ?? BARU} onChange={(v) => setPeta({ ...peta, [h.hub]: v })}
                          opsi={[{ value: BARU, label: 'Buat DS baru (budget 0)' }, ...dsl.rows.filter((d) => !d.hub_bo).map((d) => ({ value: d.id, label: `${d.nama}${h.usulan?.id === d.id ? ' (usulan)' : ''}` }))]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {ganda && <p className="text-sm text-danger">Satu DS dipilih untuk lebih dari satu hub. Perbaiki dulu.</p>}
            <p className="text-xs text-muted-foreground">DS yang dipasangkan mengganti namanya mengikuti nama hub BO (jadwal, captain, dan riwayat tetap). Hub yang belum ada DS-nya dibuatkan DS baru dengan budget 0, yang perlu Anda isi di Kelola DS.</p>
            <div className="flex gap-2">
              <button className="btn" disabled={sibuk || ganda} onClick={() => void lanjut()}>{sibuk ? 'Menyimpan…' : 'Lanjutkan sinkron'}</button>
              <button className="btn2" disabled={sibuk} onClick={() => setPerlu(null)}>Batal</button>
            </div>
          </div>
        )}
        {hasil && (
          <p className="rounded-md bg-success-soft p-3 text-sm text-success">
            Selesai: {hasil.ditarik} baris dari BO, {hasil.baris_baru} baru, {hasil.baris_diperbarui} diperbarui · {hasil.ds_dipasang} DS dipasangkan, {hasil.ds_dibuat} DS baru dibuat.
            {hasil.ds_dibuat > 0 ? ' DS baru belum punya budget, isi di Kelola DS.' : ''}
          </p>
        )}
      </div>

      <div className="card !mb-0">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <b className="flex-1">Ringkasan clock-in per shift</b>
          <Select className="w-56" value={tgl} onChange={setTgl} opsi={tglOpsi.map((t) => ({ value: t, label: t === hariIni ? `${hari(t)} (hari ini)` : hari(t) }))} />
        </div>
        {!barisTgl.length ? (
          <Kosong teks="Belum ada data kehadiran BO di tanggal ini" hint="Tekan Sinkron sekarang di atas, atau pilih tanggal lain (14 hari terakhir)." />
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {barisTgl.length} DS · {barisTgl.reduce((a, r) => a + r.hadir, 0)} rider clock-in · tepat waktu {teksPersen(persenBo(barisTgl.reduce((a, r) => a + r.tepat, 0), barisTgl.reduce((a, r) => a + r.hadir, 0)))}
            </p>
            <div className="overflow-x-auto">
              <table className="tbl w-full text-sm">
                <thead><tr><th>DS</th><th>Pagi</th><th>Middle</th><th>Siang</th><th>Tepat waktu</th><th>Catatan</th></tr></thead>
                <tbody>
                  {pg.rows.map((r) => (
                    <tr key={r.ds_id}>
                      <td>{r.ds_nama}</td>
                      <SelShift b={r.b_pagi} h={r.h_pagi} t={r.t_pagi} />
                      <SelShift b={r.b_tengah} h={r.h_tengah} t={r.t_tengah} />
                      <SelShift b={r.b_siang} h={r.h_siang} t={r.t_siang} />
                      <td>{teksPersen(persenBo(r.tepat, r.hadir))}</td>
                      <td className="text-xs text-warning">
                        {r.kebutuhan === 0 && <span className="mr-2">budget belum diisi</span>}
                        {r.tanpa_orca > 0 && <span>{r.tanpa_orca} belum ada di Orca</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3"><Pagination {...pg} /></div>
            <p className="mt-2 text-xs text-muted-foreground">
              Tiap shift: rider clock-in / budget, dan berapa yang tepat waktu. Rider terjadwal mengikuti jadwalnya; yang tidak terjadwal ditentukan dari jam masuk memakai jam shift di bawah.
            </p>
          </>
        )}
      </div>

      <JamShift bacaSaja={bacaSaja} />
    </div>
  )
}

// Sel satu shift: "hadir/budget" dan jumlah tepat waktunya; kosong bila shift itu tidak dipakai hari itu
function SelShift({ b, h, t }: { b: number; h: number; t: number }) {
  if (!b && !h) return <td className="text-muted-foreground">–</td>
  return <td>{h}/{b}{h > 0 && <span className="ml-1 text-xs text-muted-foreground">· {t} tepat</span>}</td>
}

// Jam mulai tiap shift dan toleransi untuk menilai tepat waktu; batas jam untuk menentukan shift rider yang tidak terjadwal
function JamShift({ bacaSaja }: { bacaSaja: boolean }) {
  const p = useRows<Atur>(() => sb.from('pengaturan_kehadiran').select('mulai_pagi,mulai_tengah,mulai_siang,toleransi_menit,batas_pagi,batas_tengah').eq('id', 1), [])
  const simpanan = p.rows[0]
  const [f, setF] = useState<Atur | null>(null)
  const [sibuk, setSibuk] = useState(false)
  useEffect(() => { if (simpanan) setF(simpanan) }, [simpanan])
  if (!f || !simpanan) return null
  const jam = /^([01]\d|2[0-3]):[0-5]\d$/
  const salah = ![f.mulai_pagi, f.mulai_tengah, f.mulai_siang, f.batas_pagi, f.batas_tengah].every((x) => jam.test(x)) || !(f.toleransi_menit >= 0 && f.toleransi_menit <= 60)
  const berubah = JSON.stringify(f) !== JSON.stringify(simpanan)
  const simpan = async () => {
    setSibuk(true)
    const berhasil = await ok(sb.from('pengaturan_kehadiran').update({ ...f, diubah: new Date().toISOString() }).eq('id', 1))
    setSibuk(false)
    if (berhasil) { toast.ok('Jam shift tersimpan'); p.reload() }
  }
  const kolom = (label: string, k: keyof Atur, hint?: string) => (
    <Field label={label} hint={hint}><input type="time" className="inp !w-32" value={String(f[k])} disabled={bacaSaja} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
  )
  return (
    <div className="card !mb-0 space-y-3">
      <div>
        <b className="block">Jam shift dan tepat waktu</b>
        <p className="text-xs text-muted-foreground">Dinilai Orca memakai jam lokal hub (WITA tidak dikonversi). Tepat waktu bila clock-in paling lambat jam mulai ditambah toleransi.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {kolom('Mulai pagi', 'mulai_pagi')}
        {kolom('Mulai Middle', 'mulai_tengah')}
        {kolom('Mulai siang', 'mulai_siang')}
        <Field label="Toleransi (menit)"><input type="number" min={0} max={60} className="inp !w-24" value={f.toleransi_menit} disabled={bacaSaja} onChange={(e) => setF({ ...f, toleransi_menit: Number(e.target.value) })} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {kolom('Pagi paling lambat clock-in', 'batas_pagi', 'Rider tidak terjadwal yang clock-in sampai jam ini dihitung shift pagi.')}
        {kolom('Middle paling lambat clock-in', 'batas_tengah', 'Setelah itu dihitung shift siang.')}
      </div>
      {salah && <p className="text-xs text-danger">Periksa jam (jam:menit) dan toleransi 0–60 menit.</p>}
      {bacaSaja ? <p className="text-xs text-muted-foreground">Hanya Super-admin yang bisa mengubah jam ini.</p> : <button className="btn" disabled={sibuk || salah || !berubah} onClick={simpan}>{sibuk ? 'Menyimpan…' : 'Simpan'}</button>}
    </div>
  )
}
