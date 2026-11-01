// Ringkasan rekrutmen: rider direkrut, yang betul-betul aktif, turnover mingguan/bulanan, retensi, kualitas sumber, dan alasan berhenti.
// Semua angka dihitung di database (fungsi kpi_*) dari riwayat bergabung/berhenti dan absensi, dibatasi sesuai hak lihat peran.
import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { addDays, Err, Kosong, Select, konfirmasi, parseCsv, sb, toast, today, useRows, type Me } from './lib'
import { tgl } from './armada-lib'
import { KATEGORI_BERHENTI } from './berhenti'

type Rekrut = { direkrut: number; berhenti: number; aktif: number; aktif_tidak_hadir: number; tidak_pernah_hadir: number; belum_dijadwalkan: number; baru: number; sudah_mulai: number; hari_ke_mulai: number | null; hari_ke_hadir_pertama: number | null }
type Turn = { mulai: string; selesai: string; berjalan: boolean; awal: number; akhir: number; bergabung: number; berhenti: number; mengundurkan_diri: number; diberhentikan: number; kontrak_selesai: number; tidak_diketahui: number; berhenti_dini: number; persen: number | null }
type Retensi = { bulan: string; direkrut: number; eval30: number; tetap30: number; eval60: number; tetap60: number; eval90: number; tetap90: number }
type Sumber = { sumber: string; direkrut: number; aktif: number; berhenti: number; baru: number; aktif_tidak_hadir: number; tidak_pernah_hadir: number; belum_dijadwalkan: number }
type Alasan = { kategori: string; jumlah: number }

const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : null)
const namaBulan = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' })

function Kartu({ judul, nilai, sub, nada }: { judul: string; nilai: ReactNode; sub?: string; nada?: 'baik' | 'awas' | 'buruk' }) {
  const warna = nada === 'baik' ? 'text-success' : nada === 'awas' ? 'text-warning' : nada === 'buruk' ? 'text-danger' : 'text-foreground'
  return (
    <div className="stat">
      <div className="lbl">{judul}</div>
      <div className={`font-mono text-2xl font-bold ${warna}`}>{nilai}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

export function AngkaRekrutmen({ me }: { me: Me }) {
  const [dari, setDari] = useState(addDays(today(), -179))
  const [sampai, setSampai] = useState(today())
  const [fds, setFds] = useState('')
  const [per, setPer] = useState<'bulan' | 'minggu'>('bulan')
  const arg = { p_dari: dari, p_sampai: sampai, p_ds: fds || null }
  const dsl = useRows<{ ds_id: string; ds_nama: string }>(() => sb.rpc('ds_rekrut'), [])
  const rk = useRows<Rekrut>(() => sb.rpc('kpi_rekrut', arg), [dari, sampai, fds])
  const tn = useRows<Turn>(() => sb.rpc('kpi_turnover', { ...arg, p_per: per }), [dari, sampai, fds, per])
  const rt = useRows<Retensi>(() => sb.rpc('kpi_retensi', arg), [dari, sampai, fds])
  const sm = useRows<Sumber>(() => sb.rpc('kpi_sumber', arg), [dari, sampai, fds])
  const al = useRows<Alasan>(() => sb.rpc('kpi_alasan', arg), [dari, sampai, fds])
  const [valid, setValid] = useState('')
  const muatValid = () => { sb.rpc('kpi_valid_sejak').then(({ data }) => setValid(String(data ?? ''))) }
  useEffect(muatValid, [])

  const r = rk.rows[0]
  const dinilai = r ? r.direkrut - r.baru : 0
  const persenAktif = r ? pct(r.aktif, dinilai) : null
  const bagian = r && r.direkrut ? [
    { k: 'Aktif dan hadir', n: r.aktif, w: 'bg-success' },
    { k: 'Aktif tapi tidak hadir 14 hari', n: r.aktif_tidak_hadir, w: 'bg-warning' },
    { k: 'Belum masuk jadwal', n: r.belum_dijadwalkan, w: 'bg-primary' },
    { k: 'Sudah dijadwalkan tapi tidak pernah hadir', n: r.tidak_pernah_hadir, w: 'bg-danger' },
    { k: 'Baru (sudah dijadwalkan, belum sempat hadir)', n: r.baru, w: 'bg-muted-foreground/40' },
    { k: 'Sudah berhenti', n: r.berhenti, w: 'bg-foreground/70' },
  ] : []
  const label = (t: Turn) => (per === 'bulan' ? namaBulan(t.mulai) : `${tgl(t.mulai)} – ${tgl(t.selesai)}`)
  const maksAlasan = Math.max(1, ...al.rows.map((a) => a.jumlah))

  return (
    <div>
      <Err msg={rk.err || tn.err || rt.err || sm.err || al.err || dsl.err} />
      <div className="card !p-3 flex flex-wrap items-end gap-3">
        <div><label className="lbl">Dari</label><input type="date" className="inp" value={dari} max={sampai} onChange={(e) => e.target.value && setDari(e.target.value)} /></div>
        <div><label className="lbl">Sampai</label><input type="date" className="inp" value={sampai} min={dari} max={today()} onChange={(e) => e.target.value && setSampai(e.target.value)} /></div>
        {dsl.rows.length > 1 && <div className="w-56"><label className="lbl">DS</label><Select value={fds} onChange={setFds} opsi={[{ value: '', label: 'Semua DS' }, ...dsl.rows.map((d) => ({ value: d.ds_id, label: d.ds_nama }))]} /></div>}
        <div>
          <label className="lbl">Turnover per</label>
          <div className="flex gap-1">
            {(['minggu', 'bulan'] as const).map((p) => <button key={p} type="button" className={`tab ${per === p ? 'tab-on' : ''}`} onClick={() => setPer(p)}>{p === 'minggu' ? 'Minggu' : 'Bulan'}</button>)}
          </div>
        </div>
      </div>

      {valid && valid > dari && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-warning">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>Angka turnover lengkap sejak <b>{tgl(valid)}</b>. Sebelum tanggal itu rider yang berhenti belum tercatat, jadi periode tersebut ditandai belum valid. {me.peran === 'super_admin' ? 'Impor riwayat rider lama di bagian bawah untuk melengkapinya.' : ''}</span>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kartu judul="Rider direkrut" nilai={r?.direkrut ?? 0} sub="diterima jadi rider pada rentang ini" />
        <Kartu judul="Sudah mulai aktif" nilai={r?.sudah_mulai ?? 0} sub={r && r.direkrut ? `${pct(r.sudah_mulai, r.direkrut)}% dari direkrut, sudah masuk jadwal atau laporan Captain` : 'masuk jadwal atau laporan Captain'} />
        <Kartu judul="Betul-betul aktif" nilai={r ? r.aktif : 0} sub={r && r.direkrut ? `${pct(r.aktif, r.direkrut)}% dari semua direkrut${persenAktif === null ? '' : ` · ${persenAktif}% dari ${dinilai} yang bisa dinilai`}` : 'hadir dalam 14 hari terakhir'} nada={persenAktif === null ? undefined : persenAktif >= 80 ? 'baik' : persenAktif >= 60 ? 'awas' : 'buruk'} />
        <Kartu judul="Belum masuk jadwal" nilai={r?.belum_dijadwalkan ?? 0} sub="diterima tapi belum disusun ke jadwal" nada={r?.belum_dijadwalkan ? 'buruk' : undefined} />
        <Kartu judul="Aktif tapi tidak hadir" nilai={r?.aktif_tidak_hadir ?? 0} sub="berstatus aktif, tidak hadir 14 hari terakhir" nada={r?.aktif_tidak_hadir ? 'awas' : undefined} />
        <Kartu judul="Tidak pernah hadir" nilai={r?.tidak_pernah_hadir ?? 0} sub="sudah dijadwalkan tapi belum sekali pun hadir" nada={r?.tidak_pernah_hadir ? 'buruk' : undefined} />
        <Kartu judul="Sudah berhenti" nilai={r?.berhenti ?? 0} sub={r && r.direkrut ? `${pct(r.berhenti, r.direkrut)}% dari yang direkrut` : undefined} nada={r?.berhenti ? 'awas' : undefined} />
        <Kartu judul="Hari sampai mulai aktif" nilai={r?.hari_ke_mulai ?? '–'} sub={`rata-rata sejak diterima${r?.hari_ke_hadir_pertama != null ? ` · hadir pertama ${r.hari_ke_hadir_pertama} hari` : ''}`} />
      </div>

      {bagian.length > 0 && (
        <div className="card">
          <div className="lbl">Kondisi rider yang direkrut sekarang</div>
          <div className="mb-3 flex h-3 w-full overflow-hidden rounded-full bg-muted">
            {bagian.filter((b) => b.n).map((b) => <div key={b.k} className={b.w} style={{ width: `${(100 * b.n) / r!.direkrut}%` }} title={`${b.k}: ${b.n}`} />)}
          </div>
          <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {bagian.map((b) => <li key={b.k} className="flex items-center gap-2"><span className={`size-2.5 shrink-0 rounded-full ${b.w}`} /><span className="flex-1">{b.k}</span><b>{b.n}</b></li>)}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Rider dinyatakan <b>mulai aktif</b> saat pertama kali masuk jadwal atau tercatat di laporan Captain. "Betul-betul aktif" = berstatus aktif dan hadir (atau menggantikan) dalam 14 hari terakhir. "Belum masuk jadwal" adalah rider yang sudah diterima tapi belum disusun Arcon atau Captain ke jadwal mana pun. Yang sudah dijadwalkan tapi diterima kurang dari 14 hari dan belum hadir disebut "baru", supaya tidak dianggap gagal sebelum sempat bekerja.</p>
        </div>
      )}

      <div className="card !p-0 overflow-hidden">
        <div className="p-4 pb-2">
          <div className="lbl !mb-0">Turnover rider per {per}</div>
          <p className="text-xs text-muted-foreground">Turnover = rider berhenti ÷ rata-rata jumlah rider (awal + akhir) / 2. Berhenti dini = berhenti dalam 30 hari sejak bergabung.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th className="text-left">Periode</th><th>Awal</th><th>Akhir</th><th>Bergabung</th><th>Berhenti</th><th>Turnover</th><th>vs sebelumnya</th><th>Berhenti dini</th><th className="text-left">Alasan</th></tr></thead>
            <tbody>
              {tn.rows.map((t, i) => {
                const belum = valid !== '' && t.selesai < valid
                const sebagian = valid !== '' && !belum && t.mulai < valid
                const sebelum = i > 0 ? tn.rows[i - 1] : null
                const delta = t.persen !== null && sebelum?.persen != null && valid !== '' && sebelum.selesai >= valid ? Math.round((t.persen - sebelum.persen) * 10) / 10 : null
                return (
                  <tr key={t.mulai} className={`text-center ${belum ? 'opacity-45' : ''}`}>
                    <td className="whitespace-nowrap text-left font-medium">
                      {label(t)}
                      {t.berjalan && <span className="badge ml-2 bg-muted text-muted-foreground">berjalan</span>}
                      {belum && <span className="badge ml-2 bg-warning-soft text-warning">belum valid</span>}
                      {sebagian && <span className="badge ml-2 bg-warning-soft text-warning">sebagian</span>}
                    </td>
                    <td>{t.awal}</td><td>{t.akhir}</td><td>{t.bergabung}</td>
                    <td className={t.berhenti ? 'font-semibold' : ''}>{t.berhenti}</td>
                    <td className={t.persen === null ? 'text-muted-foreground' : t.persen >= 10 ? 'font-semibold text-danger' : t.persen >= 5 ? 'font-semibold text-warning' : 'text-success'}>{belum || t.persen === null ? '–' : `${t.persen}%`}</td>
                    <td className={delta === null ? 'text-muted-foreground' : delta > 0 ? 'text-danger' : delta < 0 ? 'text-success' : ''}>{delta === null ? '–' : `${delta > 0 ? '+' : ''}${delta} poin`}</td>
                    <td>{t.berhenti_dini}</td>
                    <td className="whitespace-nowrap text-left text-xs text-muted-foreground">
                      {[[t.mengundurkan_diri, 'mundur'], [t.diberhentikan, 'diberhentikan'], [t.kontrak_selesai, 'kontrak'], [t.tidak_diketahui, 'tak diketahui']].filter(([n]) => n).map(([n, l]) => `${n} ${l}`).join(', ') || '–'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!tn.rows.length && <Kosong teks="Belum ada data pada rentang ini" />}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card !p-0 overflow-hidden">
          <div className="p-4 pb-2">
            <div className="lbl !mb-0">Retensi per angkatan</div>
            <p className="text-xs text-muted-foreground">Dari yang direkrut tiap bulan, berapa yang masih bertahan 30, 60, dan 90 hari kemudian. Hanya yang sudah cukup umur dihitung.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th className="text-left">Angkatan</th><th>Direkrut</th><th>30 hari</th><th>60 hari</th><th>90 hari</th></tr></thead>
              <tbody>
                {rt.rows.map((x) => (
                  <tr key={x.bulan} className="text-center">
                    <td className="text-left font-medium">{namaBulan(x.bulan)}</td>
                    <td>{x.direkrut}</td>
                    {([[x.eval30, x.tetap30], [x.eval60, x.tetap60], [x.eval90, x.tetap90]] as const).map(([e, t], i) => (
                      <td key={i} className={e === 0 ? 'text-muted-foreground' : (pct(t, e) ?? 0) >= 80 ? 'text-success' : 'text-danger'}>{e === 0 ? '–' : `${pct(t, e)}% (${t}/${e})`}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rt.rows.length && <Kosong teks="Belum ada angkatan pada rentang ini" />}
        </div>

        <div className="card !p-0 overflow-hidden">
          <div className="p-4 pb-2">
            <div className="lbl !mb-0">Kualitas per sumber</div>
            <p className="text-xs text-muted-foreground">Sumber mana yang ridernya betul-betul bertahan, bukan hanya yang paling banyak.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th className="text-left">Sumber</th><th>Direkrut</th><th>Aktif</th><th>% aktif</th><th>Belum dijadwalkan</th><th>Tidak pernah hadir</th></tr></thead>
              <tbody>
                {sm.rows.map((x) => {
                  const p = pct(x.aktif, x.direkrut - x.baru)
                  return (
                    <tr key={x.sumber} className="text-center">
                      <td className="text-left font-medium">{x.sumber}</td><td>{x.direkrut}</td><td>{x.aktif}</td>
                      <td className={p === null ? 'text-muted-foreground' : p >= 80 ? 'text-success' : p >= 60 ? 'text-warning' : 'text-danger'}>{p === null ? '–' : `${p}%`}</td>
                      <td className={x.belum_dijadwalkan ? 'text-warning' : ''}>{x.belum_dijadwalkan}</td>
                      <td className={x.tidak_pernah_hadir ? 'text-danger' : ''}>{x.tidak_pernah_hadir}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!sm.rows.length && <Kosong teks="Belum ada rider direkrut pada rentang ini" />}
        </div>
      </div>

      {al.rows.length > 0 && (
        <div className="card">
          <div className="lbl">Alasan rider berhenti</div>
          {al.rows.map((a) => (
            <div key={a.kategori} className="mb-2">
              <div className="mb-1 flex justify-between text-sm"><span>{KATEGORI_BERHENTI[a.kategori] ?? a.kategori}</span><b>{a.jumlah}</b></div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(100 * a.jumlah) / maksAlasan}%` }} /></div>
            </div>
          ))}
        </div>
      )}

      {me.peran === 'super_admin' && <ImporRiwayat onSelesai={() => { rk.reload(); tn.reload(); rt.reload(); sm.reload(); al.reload(); muatValid() }} />}
    </div>
  )
}

// Impor riwayat rider lama (sekali jalan, Super-admin): melengkapi tanggal bergabung dan berhenti supaya turnover bisa dihitung mundur.
function ImporRiwayat({ onSelesai }: { onSelesai: () => void }) {
  const [baris, setBaris] = useState<Record<string, string | null>[]>([])
  const [hasil, setHasil] = useState<{ diproses: number; tidak_ditemukan: string[]; konflik: string[] } | null>(null)
  const [proses, setProses] = useState(false)

  const kat = (s: string) => /undur|resign|keluar sendiri/i.test(s) ? 'mengundurkan_diri' : /berhentikan|pecat|phk|disiplin/i.test(s) ? 'diberhentikan' : /kontrak/i.test(s) ? 'kontrak_selesai' : 'tidak_diketahui'
  const tanggal = (s: string | undefined) => {
    const t = (s ?? '').trim()
    if (!t) return null
    const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
    const id = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
    if (id) return `${id[3]}-${id[2].padStart(2, '0')}-${id[1].padStart(2, '0')}`
    throw new Error(`Format tanggal tidak dikenali: "${t}". Pakai YYYY-MM-DD atau DD/MM/YYYY.`)
  }
  const baca = async (f: File) => {
    setHasil(null)
    try {
      const [kop, ...isi] = parseCsv(await f.text()).filter((b) => b.some((c) => c.trim()))
      const h = kop.map((x) => x.trim().toLowerCase())
      const cari = (...k: string[]) => h.findIndex((x) => k.some((y) => x.includes(y)))
      const [iK, iB, iH, iKt, iA] = [cari('kode'), cari('bergabung', 'join'), cari('tanggal berhenti', 'tgl berhenti', 'resign date'), cari('kategori'), cari('alasan')]
      if (iK < 0 || iB < 0) throw new Error('Kolom "Kode MTR" dan "Tanggal bergabung" wajib ada di baris judul.')
      setBaris(isi.map((b) => ({ kode_mtr: b[iK]?.trim() ?? '', bergabung: tanggal(b[iB]), berhenti: iH >= 0 ? tanggal(b[iH]) : null, kategori: iKt >= 0 ? kat(b[iKt] ?? '') : 'tidak_diketahui', alasan: iA >= 0 ? (b[iA] ?? '').trim() || null : null })).filter((b) => b.kode_mtr))
    } catch (e) {
      setBaris([])
      toast((e as Error).message)
    }
  }
  const kirim = async () => {
    if (!(await konfirmasi(`Riwayat bergabung dan berhenti ${baris.length} rider di berkas akan MENIMPA riwayat yang sudah ada untuk rider tersebut. Rider yang tidak ada di berkas tidak berubah.`, { judul: 'Impor riwayat rider?', ya: 'Impor', bahaya: true }))) return
    setProses(true)
    const { data, error } = await sb.rpc('impor_riwayat_rider', { p_rows: baris })
    setProses(false)
    if (error) return toast(error.message)
    setHasil(data)
    setBaris([])
    toast.ok(`${data.diproses} rider diimpor`)
    onSelesai()
  }
  return (
    <details className="card">
      <summary className="cursor-pointer font-bold">Impor riwayat rider lama</summary>
      <p className="mt-2 mb-3 text-sm text-muted-foreground">
        Supaya turnover bisa dihitung mundur, unggah berkas CSV dengan kolom: <b>Kode MTR</b>, <b>Tanggal bergabung</b>, <b>Tanggal berhenti</b> (kosongkan bila masih aktif), <b>Kategori</b> (mundur / diberhentikan / kontrak), dan <b>Alasan</b>.
        Tanggal berformat YYYY-MM-DD atau DD/MM/YYYY. Tanggal berhenti hanya untuk rider yang sekarang nonaktif. Datanya bisa diambil dari Pulse (join date) atau Excel.
      </p>
      <input type="file" accept=".csv,text/csv" aria-label="Berkas riwayat rider" onChange={(e) => e.target.files?.[0] && baca(e.target.files[0])} />
      {baris.length > 0 && (
        <div className="mt-3 flex items-center gap-3">
          <span className="text-sm">{baris.length} baris siap diimpor.</span>
          <button className="btn" disabled={proses} onClick={kirim}>{proses ? 'Mengimpor…' : `Impor ${baris.length} rider`}</button>
        </div>
      )}
      {hasil && (
        <div className="mt-3 space-y-1 text-sm">
          <div><b className="text-success">{hasil.diproses}</b> rider berhasil diimpor.</div>
          {hasil.tidak_ditemukan.length > 0 && <div className="text-warning">Kode MTR tidak ditemukan ({hasil.tidak_ditemukan.length}): {hasil.tidak_ditemukan.slice(0, 20).join(', ')}{hasil.tidak_ditemukan.length > 20 ? ', …' : ''}</div>}
          {hasil.konflik.length > 0 && <div className="text-danger">Dilewati karena bertentangan, mis. rider masih aktif tapi ada tanggal berhenti, atau berhenti sebelum bergabung ({hasil.konflik.length}): {hasil.konflik.slice(0, 20).join(', ')}</div>}
        </div>
      )}
    </details>
  )
}
