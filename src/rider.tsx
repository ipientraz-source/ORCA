import { sb, today, hari, useRows, Err, Kosong, Logo, TemaToggle, type Me } from './lib'

const SHIFT: Record<string, string> = { pagi: 'Pagi', siang: 'Siang', off: 'Libur' }

function List({ rows }: { rows: { tanggal: string; shift: string; ds?: string | null }[] }) {
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
            </div>
            {r.ds && <div className="text-xs text-muted-foreground">{r.ds}</div>}
          </div>
          <span className={`badge ${r.shift === 'pagi' ? 'bg-warning-soft text-warning' : r.shift === 'siang' ? 'bg-primary text-white' : 'bg-border text-muted-foreground'}`}>{SHIFT[r.shift]}</span>
        </li>
      ))}
    </ul>
  )
}

// Rider: login Kode MTR, lihat jadwal sendiri (pasif)
export function RiderApp({ kode, out }: { kode: string; out: () => void }) {
  const { rows, err } = useRows<{ nama: string; ds_nama: string | null; tanggal: string | null; shift: string }>(
    () => sb.rpc('jadwal_rider', { p_kode: kode }),
    [kode],
  )
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
        <Err msg={err} />
        <List rows={rows.filter((r) => r.tanggal).map((r) => ({ tanggal: r.tanggal!, shift: r.shift, ds: r.ds_nama }))} />
      </main>
    </div>
  )
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
