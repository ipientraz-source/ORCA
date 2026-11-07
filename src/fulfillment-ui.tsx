// Kartu "Fulfillment rate per hari": berapa persen kebutuhan client terpenuhi tiap hari, per DS, dan total periode.
// Rumus dan aturannya ada di src/fulfillment.ts.
import { Gauge } from 'lucide-react'
import { sb, useRows, Err, Kosong, usePage, Pagination, toCsv, download, hari } from './lib'
import { persen, ringkasFulfillment, tingkatFulfillment, type BarisFulfillment } from './fulfillment'

const WARNA_BAR = { baik: 'bg-success', perhatian: 'bg-warning', kurang: 'bg-danger', kosong: 'bg-border' }
const WARNA_TEKS = { baik: 'text-success', perhatian: 'text-warning', kurang: 'text-danger', kosong: 'text-muted-foreground' }
const WARNA_LENCANA = { baik: 'bg-success-soft text-success', perhatian: 'bg-warning-soft text-warning', kurang: 'bg-danger-soft text-danger', kosong: 'bg-muted text-muted-foreground' }

export function Fulfillment({ from, to, dsId }: { from: string; to: string; dsId?: string }) {
  const f = useRows<BarisFulfillment>(() => sb.rpc('laporan_fulfillment', { p_dari: from, p_sampai: to }), [from, to])
  const rows = f.rows.filter((r) => !dsId || r.ds_id === dsId)
  const { harian, perDs, total } = ringkasFulfillment(rows)
  const tingkat = tingkatFulfillment(total.rate)
  const terbaru = [...harian].reverse()
  const pg = usePage(terbaru, [from, to, dsId])
  const belum = harian.filter((h) => h.belumLapor.length).length
  const unduh = () =>
    download(
      `fulfillment_${from}_${to}.csv`,
      toCsv(
        harian.map((h) => ({
          tanggal: h.tanggal,
          kebutuhan: h.kebutuhan,
          terpenuhi: h.terpenuhi,
          kelebihan: h.kelebihan,
          fulfillment_rate: h.rate === null ? '' : Math.round(h.rate * 100) + '%',
          belum_dilaporkan: h.belumDs.join('; '),
        })),
      ),
    )

  return (
    <div className="card">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Gauge size={18} className="text-primary" />
        <b>Fulfillment rate per hari</b>
        <button className="btn2 ml-auto" disabled={!harian.length} onClick={unduh}>
          Unduh CSV
        </button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Kebutuhan client yang terpenuhi: (hadir + tukar + pengganti) ÷ kebutuhan, maks. 100% per shift. Shift yang belum dilaporkan ditandai, bukan 0%.
      </p>
      <Err msg={f.err} />
      {!harian.length ? (
        <Kosong teks="Belum ada data di periode ini" hint="Data muncul setelah jadwal disusun dan Captain mengisi absensi." />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-border p-3">
              <div className={`font-mono text-2xl font-bold ${WARNA_TEKS[tingkat]}`}>{persen(total.rate)}</div>
              <div className="text-xs text-muted-foreground">Fulfillment rate periode</div>
            </div>
            <div className="rounded-xl border border-border p-3">
              <div className="font-mono text-2xl font-bold">
                {total.terpenuhi}
                <span className="text-base text-muted-foreground">/{total.kebutuhan}</span>
              </div>
              <div className="text-xs text-muted-foreground">Rider terpenuhi / kebutuhan client</div>
            </div>
            <div className="rounded-xl border border-border p-3">
              <div className="font-mono text-2xl font-bold">{total.kelebihan}</div>
              <div className="text-xs text-muted-foreground">Rider kelebihan (tidak dihitung)</div>
            </div>
            <div className="rounded-xl border border-border p-3">
              <div className={`font-mono text-2xl font-bold ${belum ? 'text-danger' : ''}`}>{belum}</div>
              <div className="text-xs text-muted-foreground">Hari ada shift belum dilaporkan</div>
            </div>
          </div>

          <div className="mb-1 flex items-end gap-1 overflow-x-auto pb-1" style={{ height: '8.5rem' }} role="img" aria-label="Grafik fulfillment rate harian">
            {harian.map((h) => {
              const t = tingkatFulfillment(h.rate)
              return (
                <div
                  key={h.tanggal}
                  className="flex h-full min-w-6 flex-1 flex-col justify-end"
                  title={`${hari(h.tanggal)}: ${persen(h.rate)} (${h.terpenuhi}/${h.kebutuhan})${h.belumLapor.length ? ', belum dilaporkan: ' + h.belumLapor.join(' dan ') : ''}`}
                >
                  <div className="mb-0.5 text-center font-mono text-[9px] text-muted-foreground">{h.rate === null ? '' : Math.round(h.rate * 100)}</div>
                  <div className={`w-full rounded-t ${WARNA_BAR[t]} ${h.belumLapor.length ? 'opacity-60' : ''}`} style={{ height: h.rate === null ? '3px' : `${Math.max(3, h.rate * 100)}%` }} />
                </div>
              )
            })}
          </div>
          <div className="mb-4 flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>{hari(harian[0].tanggal)}</span>
            <span>{hari(harian[harian.length - 1].tanggal)}</span>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-success" />95% atau lebih</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-warning" />80–94%</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-danger" />di bawah 80%</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-border" />belum dilaporkan</span>
          </div>

          {perDs.length > 1 && (
            <div className="mb-4 overflow-x-auto rounded-xl border border-border">
              <table className="tbl">
                <thead>
                  <tr><th>DS</th><th>Terpenuhi</th><th>Kebutuhan</th><th>Kelebihan</th><th>Fulfillment rate</th><th>Hari belum dilaporkan</th></tr>
                </thead>
                <tbody>
                  {perDs.map((d) => (
                    <tr key={d.ds_id}>
                      <td>{d.ds_nama}</td>
                      <td className="font-mono">{d.terpenuhi}</td>
                      <td className="font-mono">{d.kebutuhan}</td>
                      <td className="font-mono">{d.kelebihan}</td>
                      <td><span className={`badge ${WARNA_LENCANA[tingkatFulfillment(d.rate)]}`}>{persen(d.rate)}</span></td>
                      <td className={d.hariBelumLapor ? 'font-medium text-danger' : 'text-muted-foreground'}>{d.hariBelumLapor || '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-border">
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr><th>Tanggal</th><th>Kebutuhan</th><th>Terpenuhi</th><th>Kelebihan</th><th>Fulfillment rate</th><th>Catatan</th></tr>
                </thead>
                <tbody>
                  {pg.rows.map((h) => (
                    <tr key={h.tanggal}>
                      <td className="whitespace-nowrap">{hari(h.tanggal)}</td>
                      <td className="font-mono">{h.kebutuhan}</td>
                      <td className="font-mono">{h.terpenuhi}</td>
                      <td className="font-mono text-muted-foreground">{h.kelebihan || '–'}</td>
                      <td><span className={`badge ${WARNA_LENCANA[tingkatFulfillment(h.rate)]}`}>{persen(h.rate)}</span></td>
                      <td className="text-xs text-danger">{h.belumDs.length ? 'Belum dilaporkan: ' + h.belumDs.join(', ') : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...pg} />
          </div>
        </>
      )}
    </div>
  )
}
