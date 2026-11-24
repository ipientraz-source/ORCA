// Dashboard dengan sumber Clock-in BO (aktual): fulfillment aktual, tepat waktu, perbandingan dengan absensi Captain per DS, dan tren 14 hari.
// Angkanya dihitung database (aktual_bo, migrasi 0065) dengan jam lokal hub: rider terjadwal mengikuti jadwal, tidak terjadwal dari jam masuk.
// Super-admin melihat semua DS, Arcon hanya DS yang dipegangnya (dibatasi database).
import { useState } from 'react'
import { Gauge, TrendingUp, Users, UserX } from 'lucide-react'
import { sb, today, addDays, tanggal, hari, useRows, Err, Kosong, Stat, usePage, Pagination } from './lib'
import { InputTanggal } from './tanggal'
import { persenBo, teksPersen, type AktualBo, type AktualBoHari } from './aktual-bo'

const SELISIH_MERAH = 3 // rider dicatat hadir oleh Captain tapi tidak clock-in (atau sebaliknya) sebanyak ini atau lebih
const HARI_TREN = 14

const ada = (s: (number | null)[]) => s.filter((v): v is number => v !== null)

// Garis tren dua seri: fulfillment aktual (garis penuh, bulat) dan tepat waktu (putus-putus, belah ketupat) supaya terbaca tanpa bergantung warna
function Tren({ hariIni }: { hariIni: string }) {
  const dari = addDays(hariIni, -(HARI_TREN - 1))
  const t = useRows<AktualBoHari>(() => sb.rpc('aktual_bo_harian', { p_dari: dari, p_sampai: hariIni }), [dari, hariIni])
  const byTgl = new Map(t.rows.map((r) => [String(r.tanggal).slice(0, 10), r]))
  const hariList = Array.from({ length: HARI_TREN }, (_, i) => addDays(dari, i))
  const f = hariList.map((d) => { const r = byTgl.get(d); return r ? persenBo(r.terpenuhi, r.kebutuhan) : null })
  const o = hariList.map((d) => { const r = byTgl.get(d); return r ? persenBo(r.tepat, r.hadir) : null })
  const nilai = [...ada(f), ...ada(o)]
  const W = 640, H = 220, kiri = 40, kanan = 12, atas = 12, bawah = 28
  const min = nilai.length ? Math.max(0, Math.floor((Math.min(...nilai) - 5) / 10) * 10) : 0
  const x = (i: number) => kiri + (i * (W - kiri - kanan)) / (HARI_TREN - 1)
  const y = (v: number) => atas + ((100 - v) * (H - atas - bawah)) / (100 - min)
  // garis putus bila ada hari tanpa data
  const garis = (s: (number | null)[]) => s.map((v, i) => (v === null ? '' : `${i === 0 || s[i - 1] === null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join(' ')
  const ticks = Array.from({ length: Math.floor((100 - min) / 10) + 1 }, (_, i) => min + i * 10)
  const rentang = (s: (number | null)[]) => (ada(s).length ? `${Math.min(...ada(s))}% sampai ${Math.max(...ada(s))}%` : 'belum ada data')
  return (
    <div className="card">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <TrendingUp size={18} className="text-primary" />
        <b className="flex-1">Tren {HARI_TREN} hari</b>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><svg width="26" height="10" aria-hidden><line x1="0" y1="5" x2="26" y2="5" stroke="var(--primary)" strokeWidth="2.5" /><circle cx="13" cy="5" r="3.5" fill="var(--primary)" /></svg>Fulfillment aktual</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><svg width="26" height="10" aria-hidden><line x1="0" y1="5" x2="26" y2="5" stroke="var(--warning)" strokeWidth="2.5" strokeDasharray="5 3" /><rect x="9" y="1" width="8" height="8" transform="rotate(45 13 5)" fill="var(--warning)" /></svg>Tepat waktu</span>
      </div>
      <Err msg={t.err} />
      {!nilai.length ? (
        <Kosong teks="Belum ada data clock-in BO" hint="Tekan Sinkron sekarang di menu Kehadiran BO." />
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Tren ${HARI_TREN} hari. Fulfillment aktual ${rentang(f)}, tepat waktu ${rentang(o)}.`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={kiri} x2={W - kanan} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
              <text x={kiri - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted-foreground)">{v}%</text>
            </g>
          ))}
          {hariList.map((d, i) => (i % 2 === 0 || i === HARI_TREN - 1) && <text key={d} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">{d.slice(8)}</text>)}
          <path d={garis(f)} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" />
          <path d={garis(o)} fill="none" stroke="var(--warning)" strokeWidth="2.5" strokeDasharray="6 4" strokeLinejoin="round" />
          {f.map((v, i) => v !== null && <circle key={'f' + i} cx={x(i)} cy={y(v)} r="3.5" fill="var(--primary)"><title>{`${hari(hariList[i])}: fulfillment aktual ${v}%`}</title></circle>)}
          {o.map((v, i) => v !== null && <rect key={'o' + i} x={x(i) - 3.5} y={y(v) - 3.5} width="7" height="7" transform={`rotate(45 ${x(i)} ${y(v)})`} fill="var(--warning)"><title>{`${hari(hariList[i])}: tepat waktu ${v}%`}</title></rect>)}
        </svg>
      )}
      <p className="mt-1 text-xs text-muted-foreground">Angka di bawah garis adalah tanggal dalam bulan. Hari tanpa data (belum ada clock-in atau jadwal) dilewati.</p>
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
          <Kosong teks="Belum ada data clock-in BO di tanggal ini" hint="Tekan Sinkron sekarang di menu Kehadiran BO, atau pilih tanggal lain." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="tbl w-full text-sm">
                <thead>
                  <tr><th>DS</th><th className="text-right">Budget</th><th className="text-right">Captain</th><th className="text-right">BO</th><th className="text-right">Selisih</th><th className="text-right">Tepat waktu</th></tr>
                </thead>
                <tbody>
                  {pg.rows.map((r) => {
                    const sel = r.hadir - r.captain
                    const merah = Math.abs(sel) >= SELISIH_MERAH
                    return (
                      <tr key={r.ds_id} className={merah ? 'bg-danger-soft' : ''}>
                        <td>{r.ds_nama}{r.kebutuhan === 0 && <span className="badge ml-2 bg-warning-soft text-warning">budget belum diisi</span>}</td>
                        <td className="text-right">{r.kebutuhan || '–'}</td>
                        <td className="text-right">{r.captain}</td>
                        <td className="text-right">{r.hadir}</td>
                        <td className={`text-right ${merah ? 'font-semibold text-danger' : ''}`}>{sel > 0 ? '+' + sel : sel}</td>
                        <td className="text-right">{teksPersen(persenBo(r.tepat, r.hadir))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3"><Pagination {...pg} /></div>
            <p className="mt-2 text-xs text-muted-foreground">
              Selisih = BO dikurangi Captain. Merah bila selisihnya {SELISIH_MERAH} atau lebih: rider dicatat hadir tapi tidak clock-in, atau Captain belum mengabsen. Budget dibatasi per shift, kelebihan rider tidak menambah fulfillment.
            </p>
          </>
        )}
      </div>
      <Tren hariIni={hariIni} />
    </div>
  )
}
