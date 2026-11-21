// Rekap order untuk Captain, Arcon, dan Super-admin: total per periode, perbandingan antar DS, tren harian per shift, per rider, dan unduh CSV.
// Data dari fungsi SQL rekap_order_ds / rekap_order_rider / rekap_order_hari (hak baca mengikuti DS yang dipegang pemanggil, rentang maksimal 93 hari).
import { useState } from 'react'
import { Download } from 'lucide-react'
import { sb, today, addDays, hari, tanggal, useRows, Err, Kosong, Select, usePage, Pagination } from './lib'
import { InputTanggal } from './tanggal'

type PerDs = { ds_id: string; ds_nama: string; total_order: number; rider_lapor: number; hari_rider_jadwal: number; hari_rider_lapor: number }
type PerRider = { rider_id: string; nama: string; kode_mtr: string | null; total_order: number; hari_lapor: number; hari_jadwal: number }
type PerHari = { tanggal: string; shift: string; total_order: number; pelapor: number }

const MAKS_HARI = 93
const SHIFT: Record<string, string> = { pagi: 'Pagi', tengah: 'Middle', siang: 'Siang' }
const WARNA: Record<string, string> = { pagi: 'var(--amber-400)', tengah: '#38e8d8', siang: 'var(--primary)' }
const angka = (n: number) => n.toLocaleString('id-ID')
const desimal = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 1 })
const persen = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '-')
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const selisih = (dari: string, sampai: string) => Math.round((Date.parse(sampai + 'T00:00:00Z') - Date.parse(dari + 'T00:00:00Z')) / 86400000)

const awalBulan = (d: string) => d.slice(0, 8) + '01'
const PRESET = [
  { k: '7', label: '7 hari', dari: () => addDays(today(), -6), sampai: () => today() },
  { k: '30', label: '30 hari', dari: () => addDays(today(), -29), sampai: () => today() },
  { k: 'bulan', label: 'Bulan ini', dari: () => awalBulan(today()), sampai: () => today() },
  { k: 'lalu', label: 'Bulan lalu', dari: () => awalBulan(addDays(awalBulan(today()), -1)), sampai: () => addDays(awalBulan(today()), -1) },
] as const

// CSV dengan pemisah titik koma dan BOM supaya langsung terbaca benar di Excel (pengaturan regional Indonesia).
function unduhCsv(nama: string, kepala: string[], baris: (string | number)[][]) {
  const sel = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const isi = '﻿' + [kepala, ...baris].map((b) => b.map(sel).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([isi], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nama
  a.click()
  URL.revokeObjectURL(url)
}

export function RekapOrder() {
  const [preset, setPreset] = useState<string>('bulan')
  const [dari, setDari] = useState(PRESET[2].dari())
  const [sampai, setSampai] = useState(PRESET[2].sampai())
  const [pilih, setPilih] = useState('semua')

  const kalender = selisih(dari, sampai) + 1
  const salah = dari > sampai ? 'Tanggal awal harus sebelum tanggal akhir.' : kalender > MAKS_HARI ? `Rentang maksimal ${MAKS_HARI} hari.` : ''
  const kosong = Promise.resolve({ data: [], error: null })

  const dsr = useRows<PerDs>(() => (salah ? kosong : sb.rpc('rekap_order_ds', { p_dari: dari, p_sampai: sampai })), [dari, sampai, salah])
  const banyak = dsr.rows.length > 1
  // Pemilik satu DS (Captain) langsung melihat DS-nya; yang memegang banyak DS memilih, awalnya gabungan semua.
  const aktif = banyak ? dsr.rows.find((d) => d.ds_id === pilih) : dsr.rows[0]
  const lingkup = aktif ? [aktif] : dsr.rows
  const rr = useRows<PerRider>(() => (salah || !aktif ? kosong : sb.rpc('rekap_order_rider', { p_dari: dari, p_sampai: sampai, p_ds: aktif.ds_id })), [dari, sampai, salah, aktif?.ds_id])
  const hr = useRows<PerHari>(() => (salah || !dsr.rows.length ? kosong : sb.rpc('rekap_order_hari', { p_dari: dari, p_sampai: sampai, p_ds: aktif?.ds_id ?? null })), [dari, sampai, salah, aktif?.ds_id, dsr.rows.length])

  const total = lingkup.reduce((n, d) => n + d.total_order, 0)
  const jadwal = lingkup.reduce((n, d) => n + d.hari_rider_jadwal, 0)
  const lapor = lingkup.reduce((n, d) => n + d.hari_rider_lapor, 0)
  const pelapor = lingkup.reduce((n, d) => n + d.rider_lapor, 0)

  const pgDs = usePage(dsr.rows, [dari, sampai])
  const pgRider = usePage(rr.rows, [dari, sampai, aktif?.ds_id])

  // Tren: satu batang per tanggal (termasuk hari tanpa laporan), ditumpuk per shift
  const hariList = salah ? [] : Array.from({ length: kalender }, (_, i) => addDays(dari, i))
  const perTgl = (d: string) => hr.rows.filter((x) => x.tanggal === d)
  const puncak = Math.max(1, ...hariList.map((d) => perTgl(d).reduce((n, x) => n + x.total_order, 0)))

  const setRentang = (k: string, a: string, b: string) => { setPreset(k); setDari(a); setSampai(b) }
  const periode = `${tanggal(dari)} – ${tanggal(sampai)}`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {PRESET.map((p) => (
          <button key={p.k} className={`tab !px-3 ${preset === p.k ? 'tab-on' : 'border border-border bg-card'}`} onClick={() => setRentang(p.k, p.dari(), p.sampai())}>{p.label}</button>
        ))}
        <span className="ml-auto flex items-center gap-2 text-sm">
          <InputTanggal className="inp" value={dari} max={sampai} onChange={(e) => { if (e.target.value) { setPreset('bebas'); setDari(e.target.value) } }} />
          <span>–</span>
          <InputTanggal className="inp" value={sampai} min={dari} max={today()} onChange={(e) => { if (e.target.value) { setPreset('bebas'); setSampai(e.target.value) } }} />
        </span>
      </div>
      <Err msg={salah || dsr.err || rr.err || hr.err} />

      {banyak && (
        <Select className="w-72 max-w-full" value={aktif?.ds_id ?? 'semua'} onChange={setPilih} opsi={[{ value: 'semua', label: 'Semua DS' }, ...dsr.rows.map((d) => ({ value: d.ds_id, label: d.ds_nama }))]} />
      )}

      {!dsr.rows.length && !salah ? (
        <div className="card"><Kosong teks="Belum ada DS" hint="Rekap muncul setelah ada DS yang Anda pegang." /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['Total order', angka(total)],
              ['Rata-rata per hari', desimal(total / Math.max(kalender, 1))],
              ['Kepatuhan lapor', persen(lapor, jadwal)],
              ['Rider yang melapor', angka(pelapor)],
            ].map(([label, nilai]) => (
              <div key={label} className="card !mb-0 !p-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="font-mono text-2xl font-bold">{nilai}</div>
              </div>
            ))}
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">{periode} ({kalender} hari){aktif ? ` · ${aktif.ds_nama}` : banyak ? ' · semua DS' : ''}. Kepatuhan = hari rider terjadwal yang sudah ada laporannya.</p>

          <div className="card !mb-0">
            <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
              <b className="text-sm">Tren order harian</b>
              {Object.keys(SHIFT).map((k) => (
                <span key={k} className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm" style={{ background: WARNA[k] }} />{SHIFT[k]}</span>
              ))}
            </div>
            {!hr.rows.length ? (
              <Kosong teks="Belum ada laporan order di periode ini" />
            ) : (
              <div role="img" aria-label={`Grafik batang total order per hari, ${periode}. Puncak ${angka(puncak)} order.`}>
                <div className="flex h-32 items-end gap-px">
                  {hariList.map((d) => {
                    const ls = perTgl(d)
                    const jml = ls.reduce((n, x) => n + x.total_order, 0)
                    const judul = `${hari(d)}: ${angka(jml)} order${ls.length ? ' (' + ls.map((x) => `${SHIFT[x.shift] ?? x.shift} ${angka(x.total_order)}`).join(', ') + ')' : ''}`
                    return (
                      <div key={d} title={judul} className="flex h-full min-w-0 flex-1 flex-col-reverse">
                        {['pagi', 'tengah', 'siang'].map((k) => {
                          const n = ls.find((x) => x.shift === k)?.total_order ?? 0
                          return n > 0 ? <div key={k} style={{ height: `${(n / puncak) * 100}%`, background: WARNA[k] }} /> : null
                        })}
                      </div>
                    )
                  })}
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-muted-foreground"><span>{hari(dari)}</span><span>puncak {angka(puncak)}</span><span>{hari(sampai)}</span></div>
              </div>
            )}
          </div>

          {banyak && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Perbandingan antar DS</h3>
                <button className="btn2" onClick={() => unduhCsv(`rekap-order-ds-${dari}_${sampai}.csv`, ['DS', 'Total order', 'Rata-rata per hari', 'Rider melapor', 'Hari rider terjadwal', 'Hari rider melapor', 'Kepatuhan'], dsr.rows.map((d) => [d.ds_nama, d.total_order, desimal(d.total_order / kalender), d.rider_lapor, d.hari_rider_jadwal, d.hari_rider_lapor, persen(d.hari_rider_lapor, d.hari_rider_jadwal)]))}><Download size={14} />Unduh CSV</button>
              </div>
              <div className="card !p-0 overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>#</th><th>DS</th><th>Total order</th><th>Rata-rata/hari</th><th>Rider melapor</th><th>Kepatuhan</th></tr></thead>
                  <tbody>
                    {pgDs.rows.map((d, i) => (
                      <tr key={d.ds_id} className={`cursor-pointer ${aktif?.ds_id === d.ds_id ? 'bg-primary-soft/60' : ''}`} onClick={() => setPilih(d.ds_id)}>
                        <td className="text-muted-foreground">{(pgDs.hal - 1) * pgDs.ukuran + i + 1}</td>
                        <td><b>{d.ds_nama}</b></td>
                        <td className="font-mono font-semibold">{angka(d.total_order)}</td>
                        <td className="font-mono">{desimal(d.total_order / kalender)}</td>
                        <td className="font-mono">{angka(d.rider_lapor)}</td>
                        <td className="font-mono">{persen(d.hari_rider_lapor, d.hari_rider_jadwal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3"><Pagination {...pgDs} /></div>
            </div>
          )}

          {aktif ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Per rider · {aktif.ds_nama}</h3>
                <button className="btn2" disabled={!rr.rows.length} onClick={() => unduhCsv(`rekap-order-${slug(aktif.ds_nama)}-${dari}_${sampai}.csv`, ['Rider', 'Kode MTR', 'Total order', 'Hari melapor', 'Hari terjadwal', 'Rata-rata per hari lapor'], rr.rows.map((r) => [r.nama, r.kode_mtr ?? '', r.total_order, r.hari_lapor, r.hari_jadwal, r.hari_lapor ? desimal(r.total_order / r.hari_lapor) : '-']))}><Download size={14} />Unduh CSV</button>
              </div>
              {!rr.rows.length ? (
                <div className="card"><Kosong teks="Belum ada rider atau laporan di periode ini" /></div>
              ) : (
                <div className="card !p-0 overflow-x-auto">
                  <table className="tbl">
                    <thead><tr><th>#</th><th>Rider</th><th>Total order</th><th>Hari lapor / terjadwal</th><th>Rata-rata/hari lapor</th></tr></thead>
                    <tbody>
                      {pgRider.rows.map((r, i) => (
                        <tr key={r.rider_id}>
                          <td className="text-muted-foreground">{(pgRider.hal - 1) * pgRider.ukuran + i + 1}</td>
                          <td><b>{r.nama}</b> <span className="text-xs text-muted-foreground">{r.kode_mtr}</span></td>
                          <td className="font-mono font-semibold">{angka(r.total_order)}</td>
                          <td className="font-mono">{r.hari_lapor} / {r.hari_jadwal}</td>
                          <td className="font-mono">{r.hari_lapor ? desimal(r.total_order / r.hari_lapor) : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-3"><Pagination {...pgRider} /></div>
            </div>
          ) : (
            banyak && <p className="text-xs text-muted-foreground">Pilih satu DS (di atas atau klik barisnya di tabel) untuk melihat rincian per rider.</p>
          )}
        </>
      )}
    </div>
  )
}
