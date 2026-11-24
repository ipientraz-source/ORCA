// Dashboard dengan sumber Clock-in BO (aktual): fulfillment aktual, tepat waktu, perbandingan dengan absensi Captain per DS, dan tren 14 hari.
// Angkanya dihitung database (aktual_bo, migrasi 0065) dengan jam lokal hub: rider terjadwal mengikuti jadwal, tidak terjadwal dari jam masuk.
// Super-admin melihat semua DS, Arcon hanya DS yang dipegangnya (dibatasi database).
import { useEffect, useRef, useState } from 'react'
import { Gauge, TrendingUp, Users, UserX } from 'lucide-react'
import { sb, today, addDays, tanggal, hari, useRows, Err, Kosong, Stat, usePage, Pagination } from './lib'
import { InputTanggal } from './tanggal'
import { persenBo, teksPersen, type AktualBo, type AktualBoHari } from './aktual-bo'
import { SelShift } from './aktual-bo-ui'

const SELISIH_MERAH = 3 // rider dicatat hadir oleh Captain tapi tidak clock-in (atau sebaliknya) sebanyak ini atau lebih
const HARI_TREN = 14

const ada = (s: (number | null)[]) => s.filter((v): v is number => v !== null)

// Lebar kartu terukur, supaya grafik digambar 1:1 (garis, titik, dan teks tidak ikut membesar di layar lebar)
function useLebar() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(640)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ukur = () => setW(Math.max(320, Math.floor(el.clientWidth)))
    ukur()
    const ro = new ResizeObserver(ukur)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

// Garis tren dua seri: fulfillment aktual (garis penuh, bulat) dan tepat waktu (putus-putus, belah ketupat) supaya terbaca tanpa bergantung warna
function Tren({ hariIni }: { hariIni: string }) {
  const dari = addDays(hariIni, -(HARI_TREN - 1))
  const t = useRows<AktualBoHari>(() => sb.rpc('aktual_bo_harian', { p_dari: dari, p_sampai: hariIni }), [dari, hariIni])
  const [ref, W] = useLebar()
  const byTgl = new Map(t.rows.map((r) => [String(r.tanggal).slice(0, 10), r]))
  const hariList = Array.from({ length: HARI_TREN }, (_, i) => addDays(dari, i))
  const f = hariList.map((d) => { const r = byTgl.get(d); return r ? persenBo(r.terpenuhi, r.kebutuhan) : null })
  const o = hariList.map((d) => { const r = byTgl.get(d); return r ? persenBo(r.tepat, r.hadir) : null })
  const nilai = [...ada(f), ...ada(o)]
  const H = 200, kiri = 34, kanan = 40, atas = 14, bawah = 24
  const min = nilai.length ? Math.max(0, Math.floor((Math.min(...nilai) - 5) / 10) * 10) : 0
  const x = (i: number) => kiri + (i * (W - kiri - kanan)) / (HARI_TREN - 1)
  const y = (v: number) => atas + ((100 - v) * (H - atas - bawah)) / (100 - min)
  // garis putus bila ada hari tanpa data
  const garis = (s: (number | null)[]) => s.map((v, i) => (v === null ? '' : `${i === 0 || s[i - 1] === null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join(' ')
  const ticks = Array.from({ length: Math.floor((100 - min) / 10) + 1 }, (_, i) => min + i * 10)
  const rentang = (s: (number | null)[]) => (ada(s).length ? `${Math.min(...ada(s))}% sampai ${Math.max(...ada(s))}%` : 'belum ada data')
  const akhir = (s: (number | null)[]) => { for (let i = s.length - 1; i >= 0; i--) if (s[i] !== null) return { i, v: s[i] as number }; return null }
  const af = akhir(f), ao = akhir(o)
  const langkah = W < 520 ? 2 : 1 // tanggal di sumbu: tiap hari bila cukup lebar
  return (
    <div className="card">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <TrendingUp size={18} className="text-primary" />
        <b className="flex-1">Tren {HARI_TREN} hari</b>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><svg width="22" height="10" aria-hidden><line x1="0" y1="5" x2="22" y2="5" stroke="var(--primary)" strokeWidth="2" /><circle cx="11" cy="5" r="3" fill="var(--primary)" /></svg>Fulfillment aktual</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><svg width="22" height="10" aria-hidden><line x1="0" y1="5" x2="22" y2="5" stroke="var(--warning)" strokeWidth="2" strokeDasharray="4 3" /><rect x="8" y="2" width="6" height="6" transform="rotate(45 11 5)" fill="var(--warning)" /></svg>Tepat waktu</span>
      </div>
      <Err msg={t.err} />
      <div ref={ref} className="w-full">
        {!nilai.length ? (
          <Kosong teks="Belum ada data clock-in BO" hint="Tekan Sinkron sekarang di menu Clock-in BO." />
        ) : (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full" role="img" aria-label={`Tren ${HARI_TREN} hari. Fulfillment aktual ${rentang(f)}, tepat waktu ${rentang(o)}.`}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={kiri} x2={W - kanan} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 4" opacity="0.7" />
                <text x={kiri - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted-foreground)">{v}%</text>
              </g>
            ))}
            {hariList.map((d, i) => (i % langkah === (HARI_TREN - 1) % langkah) && <text key={d} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">{d.slice(8)}</text>)}
            <path d={garis(f)} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            <path d={garis(o)} fill="none" stroke="var(--warning)" strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" />
            {f.map((v, i) => v !== null && <circle key={'f' + i} cx={x(i)} cy={y(v)} r="3" fill="var(--primary)"><title>{`${hari(hariList[i])}: fulfillment aktual ${v}%`}</title></circle>)}
            {o.map((v, i) => v !== null && <rect key={'o' + i} x={x(i) - 3} y={y(v) - 3} width="6" height="6" transform={`rotate(45 ${x(i)} ${y(v)})`} fill="var(--warning)"><title>{`${hari(hariList[i])}: tepat waktu ${v}%`}</title></rect>)}
            {af && <text x={x(af.i) + 8} y={y(af.v) + (ao && ao.v >= af.v ? -5 : 13)} fontSize="12" fontWeight="700" fill="var(--primary)">{af.v}%</text>}
            {ao && <text x={x(ao.i) + 8} y={y(ao.v) + (af && af.v > ao.v ? 13 : -5)} fontSize="12" fontWeight="700" fill="var(--warning)">{ao.v}%</text>}
          </svg>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Angka di bawah garis adalah tanggal dalam bulan; angka tebal di kanan adalah nilai terbaru. Hari tanpa data (belum ada clock-in atau jadwal) dilewati.</p>
    </div>
  )
}

export function DashboardBo() {
  const hariIni = today()
  const [tgl, setTgl] = useState(hariIni)
  const a = useRows<AktualBo>(() => sb.rpc('aktual_bo', { p_dari: tgl, p_sampai: tgl }), [tgl])
  const rows = a.rows
  const jum = (k: 'kebutuhan' | 'terpenuhi' | 'hadir' | 'tepat' | 'tanpa_orca') => rows.reduce((s, r) => s + r[k], 0)
  const pg = usePage(rows, [tgl])
  const ful = persenBo(jum('terpenuhi'), jum('kebutuhan'))
  const tw = persenBo(jum('tepat'), jum('hadir'))
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Tanggal <InputTanggal className="inp" value={tgl} onChange={(e) => e.target.value && setTgl(e.target.value > hariIni ? hariIni : e.target.value)} />
        </label>
        <span className="text-sm text-muted-foreground">{tanggal(tgl)}{tgl === hariIni ? ' · hari ini, masih berjalan' : ''}</span>
      </div>
      <Err msg={a.err} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={Gauge} label={`Fulfillment aktual · ${jum('terpenuhi')} dari ${jum('kebutuhan')} rider`} value={teksPersen(ful)} />
        <Stat icon={TrendingUp} label={`Tepat waktu · ${jum('tepat')} dari ${jum('hadir')} clock-in`} value={teksPersen(tw)} tone={tw !== null && tw < 80 ? 'red' : 'brand'} />
        <Stat icon={Users} label={`Clock-in BO · ${rows.length} DS`} value={jum('hadir')} tone="zinc" />
        <Stat icon={UserX} label="Mitra belum terdaftar di Orca" value={jum('tanpa_orca')} tone={jum('tanpa_orca') ? 'red' : 'zinc'} />
      </div>
      <div className="card">
        <b className="mb-3 block">Per DS</b>
        {!rows.length ? (
          <Kosong teks="Belum ada data clock-in BO di tanggal ini" hint="Tekan Sinkron sekarang di menu Clock-in BO, atau pilih tanggal lain." />
        ) : (
          <>
            <div className="mb-3 rounded-md bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
              <b className="text-foreground">Cara membaca.</b> Kolom Pagi, Middle, dan Siang berisi <b>rider clock-in / budget</b> shift itu, dan baris kecil di bawahnya adalah berapa yang <b>tepat waktu</b> (clock-in paling lambat jam mulai shift + toleransi).
              Angka <span className="font-semibold text-success">hijau</span> berarti budget terpenuhi, <span className="font-semibold text-warning">kuning</span> berarti kurang. <b>Total</b> adalah fulfillment aktual: kelebihan rider di satu shift tidak menutup kekurangan shift lain.
              <b> Captain</b> adalah rider hadir menurut absensi Captain, ditandai <span className="font-semibold text-danger">merah</span> bila beda 3 atau lebih dari clock-in BO. Bila Captain belum mengisi, tertulis "belum diabsen" dan tidak ditandai merah.
            </div>
            <div className="overflow-x-auto">
              <table className="tbl w-full text-sm">
                <thead>
                  <tr><th>DS</th><th className="text-center">Pagi</th><th className="text-center">Middle</th><th className="text-center">Siang</th><th className="text-center">Total</th><th className="text-right">Tepat waktu</th><th className="text-right">Captain</th></tr>
                </thead>
                <tbody>
                  {pg.rows.map((r) => {
                    const diabsen = (r.diabsen ?? r.captain) > 0
                    const sel = r.hadir - r.captain
                    const merah = diabsen && Math.abs(sel) >= SELISIH_MERAH
                    return (
                      <tr key={r.ds_id} className={merah ? 'bg-danger-soft' : ''}>
                        <td>{r.ds_nama}{r.kebutuhan === 0 && <span className="badge ml-2 bg-warning-soft text-warning">budget belum diisi</span>}</td>
                        <SelShift b={r.b_pagi} h={r.h_pagi} t={r.t_pagi} />
                        <SelShift b={r.b_tengah} h={r.h_tengah} t={r.t_tengah} />
                        <SelShift b={r.b_siang} h={r.h_siang} t={r.t_siang} />
                        <td className="text-center">
                          {r.kebutuhan > 0
                            ? <><span className="font-semibold">{r.terpenuhi}/{r.kebutuhan}</span><span className="block text-[11px] leading-tight text-muted-foreground">{teksPersen(persenBo(r.terpenuhi, r.kebutuhan))}</span></>
                            : <span className="text-muted-foreground">{r.hadir} clock-in</span>}
                        </td>
                        <td className="text-right">{teksPersen(persenBo(r.tepat, r.hadir))}</td>
                        <td className={`text-right ${merah ? 'font-semibold text-danger' : ''}`}>
                          {diabsen
                            ? <>{r.captain}{merah && <span className="block text-[11px] leading-tight">{sel > 0 ? '+' + sel : sel} vs BO</span>}</>
                            : <span className="text-xs font-normal text-muted-foreground">belum diabsen</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3"><Pagination {...pg} /></div>
          </>
        )}
      </div>
      <Tren hariIni={hariIni} />
    </div>
  )
}
