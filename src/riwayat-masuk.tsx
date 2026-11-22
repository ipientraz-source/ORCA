// Riwayat masuk untuk rider (login Kode MTR): status absensi per hari beserta shift, dari Laporan Absensi Harian yang diisi Captain.
// Hari terjadwal yang belum dicatat Captain tampil sebagai "Belum dicatat". Data lewat RPC riwayat_absensi_rider (hanya milik rider itu).
import { useState } from 'react'
import { sb, hari, useRows, Err, Kosong, usePage, Pagination } from './lib'

const SHIFT: Record<string, string> = { pagi: 'Pagi', tengah: 'Middle', siang: 'Siang' }
// Pengganti dibedakan: long shift (terjadwal, lanjut menutup shift lain) dan backup (tanpa jadwal hari itu)
export const JENIS: Record<string, string> = { long_shift: 'Long shift', backup: 'Backup' }
const STATUS: Record<string, { label: string; cls: string }> = {
  hadir: { label: 'Hadir', cls: 'bg-success-soft text-success' },
  pengganti: { label: 'Pengganti', cls: 'bg-success-soft text-success' },
  tukar: { label: 'Tukar shift', cls: 'bg-primary-soft text-primary-soft-foreground' },
  tukar_libur: { label: 'Tukar libur', cls: 'bg-primary-soft text-primary-soft-foreground' },
  izin: { label: 'Izin', cls: 'bg-warning-soft text-warning' },
  sakit: { label: 'Sakit', cls: 'bg-warning-soft text-warning' },
  alpha: { label: 'Alpha', cls: 'bg-danger-soft text-danger' },
  belum: { label: 'Belum dicatat', cls: 'bg-muted text-muted-foreground' },
}
const RINGKAS: { label: string; status: string[]; cls: string }[] = [
  { label: 'Hadir', status: ['hadir', 'pengganti'], cls: 'bg-success-soft text-success' },
  { label: 'Tukar', status: ['tukar', 'tukar_libur'], cls: 'bg-primary-soft text-primary-soft-foreground' },
  { label: 'Izin', status: ['izin'], cls: 'bg-warning-soft text-warning' },
  { label: 'Sakit', status: ['sakit'], cls: 'bg-warning-soft text-warning' },
  { label: 'Alpha', status: ['alpha'], cls: 'bg-danger-soft text-danger' },
  { label: 'Belum dicatat', status: ['belum'], cls: 'bg-muted text-muted-foreground' },
]

type Baris = { tanggal: string; status: string; shift: string | null; jenis?: string | null }

export function RiwayatMasukRider({ kode }: { kode: string }) {
  const [rentang, setRentang] = useState(30)
  const { rows, err } = useRows<Baris>(() => sb.rpc('riwayat_absensi_rider', { p_kode: kode, p_hari: rentang }), [kode, rentang])
  const pg = usePage(rows, [rentang])
  const jumlah = (s: string[]) => rows.filter((r) => s.includes(r.status)).length

  return (
    <div className="space-y-4">
      <Err msg={err} />
      <div className="flex items-center gap-2">
        {[30, 60].map((n) => (
          <button key={n} className={`tab !px-3 ${rentang === n ? 'tab-on' : 'border border-border bg-card'}`} onClick={() => setRentang(n)}>{n} hari terakhir</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        {RINGKAS.filter((r) => r.status[0] !== 'belum' || jumlah(r.status) > 0).map((r) => (
          <span key={r.label} className={`badge ${r.cls}`}>{r.label} {jumlah(r.status)}</span>
        ))}
      </div>
      {!rows.length ? (
        <Kosong teks="Belum ada riwayat masuk" hint="Kehadiran akan muncul di sini setelah Captain mengisi Laporan Absensi Harian." />
      ) : (
        <>
          <ul className="space-y-2">
            {pg.rows.map((r) => {
              const s = STATUS[r.status] ?? { label: r.status, cls: 'bg-muted text-muted-foreground' }
              return (
                <li key={`${r.tanggal}-${r.status}`} className="card !mb-0 !p-3 flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">{hari(r.tanggal)}</span>
                  <span className="flex items-center gap-2">
                    {r.shift && <span className="text-xs text-muted-foreground">{SHIFT[r.shift] ?? r.shift}</span>}
                    <span className={`badge ${s.cls}`}>{r.status === 'pengganti' ? JENIS[r.jenis ?? ''] ?? s.label : s.label}</span>
                  </span>
                </li>
              )
            })}
          </ul>
          <Pagination {...pg} />
          {jumlah(['belum']) > 0 && <p className="text-xs text-muted-foreground">"Belum dicatat" berarti hari itu terjadwal tapi Captain belum mengisi absensinya. Kalau kamu sebenarnya masuk, hubungi Captain.</p>}
        </>
      )}
    </div>
  )
}
