// Ringkasan Armada: murni hitungan dari data yang sudah ada (motor, servis, kerusakan, pengajuan servis). Tanpa tabel baru.
import { useMemo, useState } from 'react'
import { type ItemServis, type Motor, type Rusak, type Servis, rupiah, selisihHari } from './armada-lib'

type Ds = { id: string; nama: string }
type Props = { ds: Ds[]; dsId?: string; motor: Motor[]; servis: Servis[]; rusak: Rusak[]; items: ItemServis[]; hari: string }

const persen = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
const MAKS_UMUR_RUSAK = 3 // kerusakan terbuka lebih dari ini (hari) dianggap menggantung

function Kartu({ judul, nilai, sub, nada }: { judul: string; nilai: string; sub?: string; nada?: 'baik' | 'awas' | 'buruk' }) {
  const warna = nada === 'baik' ? 'text-success' : nada === 'awas' ? 'text-warning' : nada === 'buruk' ? 'text-danger' : 'text-foreground'
  return (
    <div className="stat">
      <div className="lbl">{judul}</div>
      <div className={`font-mono text-2xl font-bold ${warna}`}>{nilai}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

function Batang({ nilai, maks, warna = 'bg-primary' }: { nilai: number; maks: number; warna?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${warna}`} style={{ width: `${maks ? Math.min(100, (nilai / maks) * 100) : 0}%` }} />
    </div>
  )
}

export function RingkasanArmada({ ds, dsId = '', motor, servis, rusak, items, hari }: Props) {
  const [bulan, setBulan] = useState(hari.slice(0, 7))

  const k = useMemo(() => {
    const motors = motor.filter((m) => !dsId || m.ds_id === dsId)
    const ids = new Set(motors.map((m) => m.id))
    const bln = <T extends { motor_id: string }>(r: T[], tgl: (x: T) => string) => r.filter((x) => ids.has(x.motor_id) && tgl(x).startsWith(bulan))
    const svs = bln(servis, (s) => s.tanggal)
    const rsk = bln(rusak, (r) => r.tanggal)
    const selesai = rsk.filter((r) => r.status === 'selesai' && r.tanggal_selesai)
    const mttr = selesai.length ? selesai.reduce((a, r) => a + selisihHari(r.tanggal_selesai!, r.tanggal), 0) / selesai.length : null
    const terbuka = rusak.filter((r) => ids.has(r.motor_id) && r.status !== 'selesai')
    const menggantung = terbuka.filter((r) => selisihHari(hari, r.tanggal) > MAKS_UMUR_RUSAK)
    const biaya = svs.reduce((a, s) => a + s.biaya, 0) + rsk.reduce((a, r) => a + r.biaya, 0)
    const asuransi = svs.filter((s) => s.ditanggung_asuransi).length + rsk.filter((r) => r.ditanggung_asuransi).length
    const telat = motors.filter((m) => m.servis_berikutnya && m.servis_berikutnya < hari)
    const perbaikan = motors.filter((m) => m.status === 'perbaikan').length
    const itm = items.filter((i) => ids.has(i.motor_id))
    const langganan = Object.entries(
      rusak.filter((r) => ids.has(r.motor_id) && selisihHari(hari, r.tanggal) <= 90).reduce<Record<string, number>>((a, r) => ({ ...a, [r.motor_id]: (a[r.motor_id] ?? 0) + 1 }), {}),
    ).sort((a, b) => b[1] - a[1]).slice(0, 5)
    const biayaDs = (mm: Motor[]) => {
      const set = new Set(mm.map((m) => m.id))
      return servis.filter((s) => set.has(s.motor_id) && s.tanggal.startsWith(bulan)).reduce((a, s) => a + s.biaya, 0) + rusak.filter((r) => set.has(r.motor_id) && r.tanggal.startsWith(bulan)).reduce((a, r) => a + r.biaya, 0)
    }
    const perDs = ds.map((d) => {
      const mm = motor.filter((m) => m.ds_id === d.id)
      return { ...d, total: mm.length, siap: mm.filter((m) => m.status !== 'perbaikan').length, telat: mm.filter((m) => m.servis_berikutnya && m.servis_berikutnya < hari).length, biaya: biayaDs(mm) }
    })
    const perJenis = Object.entries(svs.reduce<Record<string, number>>((a, s) => ({ ...a, [s.jenis]: (a[s.jenis] ?? 0) + s.biaya }), {})).sort((a, b) => b[1] - a[1])
    return { motors, mttr, terbuka: terbuka.length, menggantung, biaya, perMotor: motors.length ? Math.round(biaya / motors.length) : 0, asuransi: persen(asuransi, svs.length + rsk.length), telat, perbaikan, siap: persen(motors.length - perbaikan, motors.length), itm, itmSelesai: itm.filter((i) => i.status === 'selesai').length, itmLewat: itm.filter((i) => i.status === 'dilewati').length, langganan, perDs, perJenis }
  }, [ds, motor, servis, rusak, items, hari, bulan, dsId])

  const kode = (id: string) => motor.find((m) => m.id === id)?.kode_motor ?? id

  return (
    <div className="rise">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div><label className="lbl">Bulan</label><input type="month" className="inp" value={bulan} onChange={(e) => setBulan(e.target.value)} /></div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kartu judul="Motor siap pakai" nilai={`${k.siap}%`} sub={`${k.motors.length - k.perbaikan} dari ${k.motors.length} motor`} nada={k.siap >= 90 ? 'baik' : k.siap >= 80 ? 'awas' : 'buruk'} />
        <Kartu judul="Rata-rata waktu perbaikan" nilai={k.mttr === null ? '–' : `${k.mttr.toFixed(1)} hari`} sub="kerusakan selesai bulan ini" nada={k.mttr === null ? undefined : k.mttr <= 3 ? 'baik' : k.mttr <= 7 ? 'awas' : 'buruk'} />
        <Kartu judul="Kerusakan menggantung" nilai={String(k.menggantung.length)} sub={`terbuka > ${MAKS_UMUR_RUSAK} hari (dari ${k.terbuka} terbuka)`} nada={k.menggantung.length === 0 ? 'baik' : 'buruk'} />
        <Kartu judul="Biaya per motor" nilai={rupiah(k.perMotor)} sub={`total ${rupiah(k.biaya)} · ${k.asuransi}% ditanggung asuransi`} />
        <Kartu judul="Servis rutin terlambat" nilai={String(k.telat.length)} sub={`${persen(k.telat.length, k.motors.length)}% dari motor`} nada={k.telat.length === 0 ? 'baik' : k.telat.length <= 2 ? 'awas' : 'buruk'} />
        <Kartu judul="Pengajuan servis selesai" nilai={`${persen(k.itmSelesai, k.itm.length)}%`} sub={`${k.itmSelesai}/${k.itm.length} item · ${k.itmLewat} dilewati`} nada={k.itm.length === 0 ? undefined : persen(k.itmSelesai, k.itm.length) >= 80 ? 'baik' : 'awas'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="lbl">Motor langganan rusak (90 hari)</div>
          {k.langganan.length === 0 ? <p className="text-sm text-muted-foreground">Tidak ada.</p> : k.langganan.map(([id, n]) => (
            <div key={id} className="mb-2"><div className="mb-1 flex justify-between text-sm"><span className="font-mono font-semibold">{kode(id)}</span><span className="text-muted-foreground">{n}× rusak</span></div><Batang nilai={n} maks={k.langganan[0][1]} warna="bg-danger" /></div>
          ))}
          <p className="mt-2 text-xs text-muted-foreground">Kandidat dievaluasi atau diganti.</p>
        </div>
        <div className="card">
          <div className="lbl">Biaya servis per jenis</div>
          {k.perJenis.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada biaya bulan ini.</p> : k.perJenis.map(([j, b]) => (
            <div key={j} className="mb-2"><div className="mb-1 flex justify-between text-sm"><span>{j}</span><span className="font-mono">{rupiah(b)}</span></div><Batang nilai={b} maks={k.perJenis[0][1]} /></div>
          ))}
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="p-4 pb-2"><div className="lbl !mb-0">Perbandingan antar DS</div></div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th className="text-left">DS</th><th>Motor</th><th>Siap pakai</th><th>Servis terlambat</th><th>Biaya bulan ini</th></tr></thead>
            <tbody>
              {k.perDs.map((d) => (
                <tr key={d.id} className="text-center">
                  <td className="text-left font-semibold">{d.nama}</td>
                  <td>{d.total}</td>
                  <td><span className={persen(d.siap, d.total) >= 90 ? 'text-success' : 'text-danger'}>{persen(d.siap, d.total)}%</span></td>
                  <td className={d.telat ? 'font-semibold text-danger' : ''}>{d.telat}</td>
                  <td className="font-mono">{rupiah(d.biaya)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
