import { useState } from 'react'
import { sb, today, hari, useRows, Err, Kosong, Logo, TemaToggle, type Me } from './lib'
import { LaporanOrderRider } from './laporan-order'
import { RiwayatMasukRider, JENIS } from './riwayat-masuk'

const SHIFT: Record<string, string> = { pagi: 'Pagi', tengah: 'Middle', siang: 'Siang', off: 'Libur' }

// pengganti: tanggal -> shift yang ditutup (null bila belum diketahui) dan jenisnya, untuk hari ketika Captain mencatat rider ini sebagai pengganti
type Png = { shift: string | null; jenis?: string | null }
function List({ rows, pengganti = {} }: { rows: { tanggal: string; shift: string; ds?: string | null }[]; pengganti?: Record<string, Png> }) {
  if (!rows.length) return <Kosong teks="Belum ada jadwal" hint="Jadwal akan muncul di sini setelah Captain menyusunnya." />
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.tanggal} data-shift={r.shift} data-hari-ini={r.tanggal === today() ? '' : undefined} style={{ ['--i' as string]: i }} className="card !mb-0 !p-3 flex items-center gap-4">
          <div className="size-12 rounded-lg bg-primary-soft text-primary-soft-foreground flex flex-col items-center justify-center leading-none">
            <span className="font-mono text-lg font-bold">{r.tanggal.slice(8)}</span>
            <span className="text-[10px] uppercase font-semibold mt-0.5">{hari(r.tanggal).split(',')[0]}</span>
          </div>
          <div className="flex-1">
            <div className="font-semibold">
              {SHIFT[r.shift] ?? r.shift}
              {r.tanggal === today() && <span className="badge ml-2 bg-primary-soft text-primary-soft-foreground">Hari ini</span>}
              {r.tanggal in pengganti && <span className="badge ml-2 bg-primary text-white">{JENIS[pengganti[r.tanggal].jenis ?? ''] ?? 'Pengganti'}{pengganti[r.tanggal].shift ? ` · ${SHIFT[pengganti[r.tanggal].shift!] ?? pengganti[r.tanggal].shift}` : ''}</span>}
            </div>
            {r.ds && <div className="text-xs text-muted-foreground">{r.ds}</div>}
          </div>
          <span className={`badge ${r.shift === 'pagi' ? 'bg-warning-soft text-warning' : r.shift === 'tengah' ? 'bg-[#38e8d8] text-black' : r.shift === 'siang' ? 'bg-primary text-white' : 'bg-border text-muted-foreground'}`}>{SHIFT[r.shift]}</span>
        </li>
      ))}
    </ul>
  )
}

// Rider: login Kode MTR, lihat jadwal sendiri (pasif)
export function RiderApp({ kode, out }: { kode: string; out: () => void }) {
  const [menu, setMenu] = useState<'jadwal' | 'order' | 'masuk'>('jadwal')
  const { rows, err } = useRows<{ nama: string; ds_nama: string | null; tanggal: string | null; shift: string }>(
    () => sb.rpc('jadwal_rider', { p_kode: kode }),
    [kode],
  )
  // Hari ketika Captain mencatat rider ini sebagai pengganti; jadwalnya bisa Libur atau kosong. Kalau fungsinya belum ada di server, daftar kosong dan tampilan biasa.
  const png = useRows<{ tanggal: string; shift: string | null; jenis: string | null }>(() => sb.rpc('pengganti_rider', { p_kode: kode }), [kode])
  const jadwal = rows.filter((r) => r.tanggal).map((r) => ({ tanggal: r.tanggal!, shift: r.shift, ds: r.ds_nama }))
  const tambahan = png.rows.filter((p) => !jadwal.some((j) => j.tanggal === p.tanggal)).map((p) => ({ tanggal: p.tanggal, shift: 'off', ds: null as string | null }))
  const daftar = [...jadwal, ...tambahan].sort((a, b) => a.tanggal.localeCompare(b.tanggal))
  return (
    <div className="min-h-screen">
      <div className="rider-bar bg-sidebar text-white px-4 pt-5 pb-8">
        <div className="max-w-md mx-auto flex items-center gap-3">
          <Logo small />
          <div className="flex-1 leading-tight min-w-0">
            <div className="font-display font-bold truncate">{rows[0]?.nama ?? 'Jadwal Saya'}</div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-sidebar-foreground">Rider · {kode}</div>
          </div>
          <TemaToggle className="text-white hover:!bg-white/10" />
          <button className="btn2 !bg-transparent !text-white !border-white/30 hover:!border-white" onClick={out}>Keluar</button>
        </div>
      </div>
      <main className="rider-isi max-w-md mx-auto px-4 -mt-4 pb-10">
        <div role="tablist" aria-label="Menu rider" className="mb-3 flex gap-2">
          {([['jadwal', 'Jadwal Saya'], ['order', 'Order Saya'], ['masuk', 'Absensi Saya']] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={menu === k} onClick={() => setMenu(k)} className={`tab !px-1 text-[13px] flex-1 ${menu === k ? 'tab-on' : 'border border-border bg-card'}`}>{label}</button>
          ))}
        </div>
        {menu === 'order' ? (
          <LaporanOrderRider kode={kode} />
        ) : menu === 'masuk' ? (
          <RiwayatMasukRider kode={kode} />
        ) : (
          <>
            <Err msg={err} />
            <List rows={daftar} pengganti={Object.fromEntries(png.rows.map((p) => [p.tanggal, { shift: p.shift, jenis: p.jenis }]))} />
          </>
        )}
      </main>
    </div>
  )
}

// Captain yang juga ikut jadwal sebagai rider: laporan order dan riwayat masuk dirinya sendiri, lewat Kode MTR di data riders-nya
export function SayaRider({ me, menu }: { me: Me; menu: 'order' | 'masuk' }) {
  if (!me.kode_mtr) return <Kosong teks="Akun Anda belum punya Kode MTR" hint="Minta Super-admin mengisi Kode MTR Anda di Rider Management supaya bisa melapor order sebagai rider." />
  return <div className="max-w-md">{menu === 'order' ? <LaporanOrderRider kode={me.kode_mtr} /> : <RiwayatMasukRider kode={me.kode_mtr} />}</div>
}

// Topi rider untuk Captain / admin: jadwal dirinya sendiri
export function JadwalSaya({ me }: { me: Me }) {
  const { rows, err } = useRows<{ tanggal: string; shift: string; ds: { nama: string } | null }>(
    () => sb.from('jadwal').select('tanggal,shift,ds(nama)').eq('rider_id', me.id).gte('tanggal', today()).order('tanggal'),
    [me.id],
  )
  return (
    <>
      <Err msg={err} />
      <List rows={rows.map((r) => ({ tanggal: r.tanggal, shift: r.shift, ds: r.ds?.nama }))} />
    </>
  )
}
