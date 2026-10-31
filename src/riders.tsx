import { useEffect, useState } from 'react'
import { UserCheck, UserMinus, Users } from 'lucide-react'
import { cocokDs, namaDsBaru, ringkasPerRider, type Baris } from './impor'
import { sb, useRows, ok, toast, konfirmasi, Err, Kosong, Stat, Field, Select, usePage, Pagination, toCsv, download, parseCsv, type Ds, type Me, type Rider } from './lib'

type Hasil = { inserted: number; updated: number; errors: { baris: number; pesan: string }[] }

export function DataRider({ me, ds, dsList = [] }: { me: Me; ds: Ds | null; dsList?: Ds[] }) {
  const sup = me.peran === 'super_admin'
  const [q, setQ] = useState('')
  const [fds, setFds] = useState('')
  const rs = useRows<Rider>(() => sb.from('riders').select('*').order('nama').limit(1000), [])
  const dsl = useRows<Ds>(() => sb.from('ds').select('*').order('nama'), [])
  const dsNama = (id: string | null) => dsl.rows.find((d) => d.id === id)?.nama ?? '—'

  // Status berubah langsung di layar begitu ditekan; bila database menolak atau data dimuat ulang, tampilan mengikuti kenyataan
  const [lokal, setLokal] = useState<Record<string, Rider['status']>>({})
  useEffect(() => setLokal({}), [rs.rows])
  const semuaRider = rs.rows.map((r) => (lokal[r.id] ? { ...r, status: lokal[r.id] } : r))
  const orang = semuaRider.filter((r) => r.peran !== 'super_admin') // super-admin bukan rider — dikelola di Kelola DS & Captain
  const shown = orang.filter(
    (r) => (r.nama + (r.kode_mtr ?? '')).toLowerCase().includes(q.toLowerCase()) && (!fds || (fds === '-' ? !r.ds_id : r.ds_id === fds)),
  )
  const aktif = orang.filter((r) => r.status === 'aktif').length
  const pg = usePage(shown, [q, fds])

  const setStatus = async (r: Rider) => {
    if (r.status === 'aktif' && !(await konfirmasi(`${r.nama} tidak akan muncul di jadwal baru dan tidak bisa masuk dengan Kode MTR. Bisa diaktifkan lagi kapan saja.`, { judul: 'Nonaktifkan rider ini?', ya: 'Nonaktifkan', bahaya: true }))) return
    const baru = r.status === 'aktif' ? 'nonaktif' : 'aktif'
    setLokal((l) => ({ ...l, [r.id]: baru }))
    if (await ok(sb.from('riders').update({ status: baru }).eq('id', r.id))) rs.reload()
    else setLokal((l) => Object.fromEntries(Object.entries(l).filter(([k]) => k !== r.id)))
  }
  const setDs = async (r: Rider, ds_id: string) => {
    if (await ok(sb.from('riders').update({ ds_id: ds_id || null }).eq('id', r.id))) rs.reload()
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <Stat icon={Users} label="Total rider" value={orang.length} />
        <Stat icon={UserCheck} label="Rider aktif" value={aktif} tone="zinc" />
        <Stat icon={UserMinus} label="Belum punya DS" value={orang.filter((r) => !r.ds_id && r.peran === 'rider').length} tone="zinc" />
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        <input className="inp" placeholder="cari nama / Kode MTR" value={q} onChange={(e) => setQ(e.target.value)} />
        {(sup || me.peran === 'arcon') && (
          <Select className="w-56" value={fds} onChange={setFds} opsi={[{ value: '', label: 'Semua DS' }, ...(sup ? [{ value: '-', label: 'Belum punya DS' }] : []), ...(sup ? dsl.rows : dsList).map((d) => ({ value: d.id, label: d.nama }))]} />
        )}
        {sup && (
          <button className="btn2 ml-auto" onClick={() => download('rider.csv', toCsv(shown.map((r) => ({ kode_mtr: r.kode_mtr, nama: r.nama, no_hp: r.no_hp, ds: dsNama(r.ds_id) === '—' ? '' : dsNama(r.ds_id), status: r.status, peran: r.peran }))))}>
            Unduh CSV
          </button>
        )}
      </div>
      <Err msg={rs.err} />
      {!shown.length && (
        <div className="card">
          <Kosong teks={orang.length ? 'Tidak ada rider yang cocok' : 'Belum ada rider'} hint={orang.length ? 'Ubah kata kunci atau filter DS.' : 'Import CSV di bawah, atau tambah rider satuan.'} />
        </div>
      )}
      <div className="mb-4 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr><th>Kode MTR</th><th>Nama</th><th>No HP</th><th>DS</th><th>Peran</th><th>Status</th></tr>
          </thead>
          <tbody>
            {pg.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.kode_mtr}</td><td>{r.nama}</td><td>{r.no_hp}</td>
                <td>
                  {sup ? (
                    <Select className="w-52" value={r.ds_id ?? ''} onChange={(v) => setDs(r, v)} opsi={[{ value: '', label: '— belum punya DS —' }, ...dsl.rows.map((d) => ({ value: d.id, label: d.nama }))]} />
                  ) : (
                    dsNama(r.ds_id)
                  )}
                </td>
                <td><span className="badge bg-muted text-foreground/80 capitalize">{r.peran.replace('_', '-')}</span></td>
                <td>
                  <button className={r.status === 'aktif' ? 'btn2 capitalize text-success' : 'btn2 capitalize text-muted-foreground'} disabled={!sup && (!(r.ds_id && (r.ds_id === ds?.id || (me.peran === 'arcon' && dsList.some((d) => d.id === r.ds_id)))) || r.peran !== 'rider')} title={!sup && r.peran !== 'rider' ? 'Hanya Super-admin yang bisa mengubah status Arcon dan Captain' : undefined} onClick={() => setStatus(r)}>
                    {r.status}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <Pagination {...pg} />
      </div>
      {sup ? <ImportCsv done={() => { rs.reload(); dsl.reload() }} dsl={dsl.rows} /> : ds && <Tarik ds={ds} done={rs.reload} />}
      {sup && <TambahRider dsl={dsl.rows} done={rs.reload} />}
      {!sup && me.peran === 'arcon' && <TambahRider dsl={dsList} done={rs.reload} wajibDs />}
    </div>
  )
}

// wajibDs = tampilan Arcon: rider hanya bisa ditambahkan ke DS yang dipegang (rider tanpa DS tak terlihat lagi oleh Arcon)
function TambahRider({ dsl, done, wajibDs = false }: { dsl: Ds[]; done: () => void; wajibDs?: boolean }) {
  const [f, setF] = useState({ kode_mtr: '', nama: '', no_hp: '', ds_id: '' })
  return (
    <div className="card">
      <b className="block">Tambah satu rider</b>
      <p className="text-sm text-muted-foreground mb-3">{wajibDs ? 'Rider baru langsung masuk ke DS yang dipilih. Captain DS itu bisa menjadwalkannya.' : 'Untuk menambah rider satu per satu. Kalau banyak, pakai Import CSV di atas.'}</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 items-start">
        <Field label="Kode MTR (wajib)" hint="Kode unik rider. Dipakai rider untuk login dan tidak boleh kembar.">
          <input className="inp w-full" placeholder="Contoh: MTR001" value={f.kode_mtr} onChange={(e) => setF({ ...f, kode_mtr: e.target.value })} />
        </Field>
        <Field label="Nama rider (wajib)" hint="Nama lengkap sesuai identitas.">
          <input className="inp w-full" value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} />
        </Field>
        <Field label="Nomor HP" hint="Boleh dikosongkan.">
          <input className="inp w-full" placeholder="Contoh: 08123456789" value={f.no_hp} onChange={(e) => setF({ ...f, no_hp: e.target.value })} />
        </Field>
        <Field label={wajibDs ? 'DS (wajib)' : 'DS'} hint={wajibDs ? 'Pilih salah satu DS yang Anda pegang.' : 'DS tempat rider bekerja. Kalau belum jelas, biarkan dulu — Captain bisa menariknya nanti.'}>
          <Select className="w-full" value={f.ds_id} onChange={(v) => setF({ ...f, ds_id: v })} placeholder={wajibDs ? '— pilih DS —' : undefined} opsi={[...(wajibDs ? [] : [{ value: '', label: '— belum punya DS —' }]), ...dsl.map((d) => ({ value: d.id, label: d.nama }))]} />
        </Field>
      </div>
      <div className="mt-3">
        <button
          className="btn"
          disabled={!f.kode_mtr.trim() || !f.nama.trim() || (wajibDs && !f.ds_id)}
          onClick={async () => {
            if (await ok(sb.from('riders').insert({ kode_mtr: f.kode_mtr, nama: f.nama.trim(), no_hp: f.no_hp || null, ds_id: f.ds_id || null }))) {
              setF({ kode_mtr: '', nama: '', no_hp: '', ds_id: '' })
              done()
            }
          }}
        >
          Tambah rider
        </button>
      </div>
    </div>
  )
}

// Import CSV (Super-admin): gabung pakai Kode MTR; DS harus sudah ada; yang tak ada di file dibiarkan.
// Alur dua langkah ala Pulse: upload → preview → konfirmasi.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const ALIAS: Record<string, string[]> = {
  kode_mtr: ['kodemtr', 'employeeid', 'employee', 'id', 'mtr', 'kodemitra', 'mtrcode', 'idkaryawan', 'kodekaryawan'],
  nama: ['nama', 'fullname', 'name', 'namalengkap'],
  no_hp: ['nohp', 'phone', 'telepon', 'telp', 'hp', 'notelp', 'nowa', 'whatsapp', 'wa', 'nomorwhatsapp'],
  ds: ['ds', 'depot', 'store', 'namads', 'pitstopname', 'pitstop'],
  status: ['status'],
}
// Alias status ala Pulse → aktif / nonaktif. Nilai lain dibiarkan apa adanya agar ditolak server dengan pesan jelas.
const STATUS: Record<string, string> = {
  aktif: 'aktif', active: 'aktif', ready: 'aktif', readytowork: 'aktif', available: 'aktif', hire: 'aktif', probation: 'aktif', contract: 'aktif',
  nonaktif: 'nonaktif', inactive: 'nonaktif', nonactive: 'nonaktif', resign: 'nonaktif', resigned: 'nonaktif', withdrawn: 'nonaktif', blacklisted: 'nonaktif', blacklist: 'nonaktif', suspended: 'nonaktif',
}
function ImportCsv({ done, dsl }: { done: () => void; dsl: Ds[] }) {
  const [rows, setRows] = useState<Baris[]>([])
  const [absensi, setAbsensi] = useState(false) // file export absensi (punya kolom Pitstop Name)
  const [jmlBaris, setJmlBaris] = useState(0)
  const [buatBaru, setBuatBaru] = useState(true)
  // Khusus file absensi: lokasi di file → DS yang sudah ada (atau DS baru yang diusulkan)
  const peta = absensi
    ? [...rows.reduce((m, r) => (r.ds ? m.set(r.ds, (m.get(r.ds) ?? 0) + 1) : m), new Map<string, number>())]
        .map(([lokasi, jumlah]) => {
          const ke = cocokDs(lokasi, dsl.map((d) => d.nama))
          return { lokasi, jumlah, ke, baru: ke ? '' : namaDsBaru(lokasi) }
        })
        .sort((a, b) => b.jumlah - a.jumlah)
    : []
  const pgPeta = usePage(peta, [rows])
  const [file, setFile] = useState('')
  const [hasil, setHasil] = useState<Hasil | null>(null)
  const [busy, setBusy] = useState(false)

  async function onFile(f: File) {
    setHasil(null)
    const [h, ...body] = parseCsv((await f.text()).replace(/^﻿/, ''))
    if (!h || !body.length) return toast('CSV kosong atau hanya berisi header')
    const col: Record<string, number> = {}
    h.forEach((x, i) => {
      for (const [field, al] of Object.entries(ALIAS)) if (!(field in col) && (norm(x) === norm(field) || al.includes(norm(x)))) col[field] = i
    })
    if (!('kode_mtr' in col) || !('nama' in col)) return toast('Kolom wajib tidak ditemukan: kode_mtr (atau employee_id / kode mitra) dan nama (atau full_name)')
    const get = (c: string[], k: string) => (k in col ? (c[col[k]] ?? '').trim() : '')
    const semua = body
      .map((c, i) => {
        const st = get(c, 'status')
        return { baris: i + 2, kode_mtr: get(c, 'kode_mtr'), nama: get(c, 'nama'), no_hp: get(c, 'no_hp'), ds: get(c, 'ds'), status: STATUS[norm(st)] ?? st }
      })
      .filter((r) => r.kode_mtr || r.nama || r.no_hp || r.ds)
    // File absensi punya banyak baris per rider: jadikan satu baris per rider. CSV rider biasa tidak diubah.
    const dariAbsensi = h.some((x) => norm(x) === 'pitstopname')
    setAbsensi(dariAbsensi)
    setJmlBaris(semua.length)
    setRows(dariAbsensi ? ringkasPerRider(semua) : semua)
    setFile(f.name)
  }

  async function run() {
    setBusy(true)
    let kirim: Baris[] = rows
    if (absensi) {
      // DS baru dibuat hanya untuk file absensi (nama lokasi berasal dari sistem). CSV rider biasa tetap ketat: DS salah ketik ditolak.
      const tujuan = new Map(peta.map((p) => [p.lokasi, p.ke ?? (buatBaru ? p.baru : '')]))
      const baruDs = [...new Set(peta.filter((p) => !p.ke && buatBaru).map((p) => p.baru))]
      if (baruDs.length) {
        const { error: e1 } = await sb.from('ds').upsert(baruDs.map((nama) => ({ nama })), { onConflict: 'nama', ignoreDuplicates: true })
        if (e1) {
          setBusy(false)
          return toast(e1.message)
        }
      }
      kirim = rows.map((r) => ({ ...r, ds: r.ds ? tujuan.get(r.ds) ?? '' : '' }))
    }
    const { data, error } = await sb.rpc('import_riders', { p_rows: kirim })
    setBusy(false)
    if (error) return toast(error.message)
    setHasil(data as Hasil)
    setRows([])
    setFile('')
    done()
  }

  return (
    <div className="card">
      <b className="block mb-1">Import CSV rider</b>
      <p className="text-xs text-muted-foreground mb-3">
        Wajib: kode MTR dan nama. Opsional: no_hp, ds, status (aktif / nonaktif). Nama kolom fleksibel (mis. <i>employee_id</i>, <i>full_name</i>, <i>kode mitra</i> juga dikenali). Nama DS harus persis sama dengan DS yang sudah dibuat. Rider yang sudah ada di-update, yang baru ditambah, yang tidak ada di file dibiarkan. File absensi dari sistem (ada kolom Kode Mitra dan Pitstop Name) juga bisa langsung diunggah: rider diambil otomatis tanpa NIK, selfie, dan GPS.{' '}
        <button className="underline" onClick={() => download('template-rider.csv', 'kode_mtr,nama,no_hp,ds,status\r\nMTR001,Budi,0812xxxx,Galaxy,aktif')}>
          Unduh template
        </button>
      </p>
      <input type="file" accept=".csv,text/csv" disabled={busy} className="block max-w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3.5 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:border-foreground/50" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
      {rows.length > 0 && (
        <div className="mt-4">
          {absensi && (
            <div className="mb-4 rounded-xl border border-border p-3 text-sm">
              <p className="mb-2">
                <b>File absensi terdeteksi:</b> {jmlBaris} baris absensi menjadi <b>{rows.length}</b> rider unik. NIK, selfie, dan GPS tidak dibaca. Rider yang muncul di beberapa lokasi dimasukkan ke lokasi yang paling sering.
              </p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="tbl">
                  <thead><tr><th>Lokasi di file</th><th>Rider</th><th>Masuk ke DS</th></tr></thead>
                  <tbody>
                    {pgPeta.rows.map((p) => (
                      <tr key={p.lokasi}>
                        <td>{p.lokasi}</td>
                        <td>{p.jumlah}</td>
                        <td>
                          {p.ke ? <span className="badge bg-primary-soft text-primary-soft-foreground">{p.ke}</span>
                            : buatBaru ? <span className="badge bg-warning-soft text-warning">DS baru: {p.baru}</span>
                            : <span className="badge bg-muted text-muted-foreground">Belum punya DS</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination {...pgPeta} />
              </div>
              {peta.some((p) => !p.ke) && (
                <label className="mt-3 flex items-center gap-2">
                  <input type="checkbox" checked={buatBaru} onChange={(e) => setBuatBaru(e.target.checked)} />
                  Buat DS baru untuk lokasi yang belum ada (kuotanya diisi nanti di Kelola DS)
                </label>
              )}
            </div>
          )}
          <p className="text-sm mb-2"><b>{file}</b> — {rows.length} rider siap diimpor. Ini 5 baris pertama:</p>
          <div className="overflow-x-auto mb-3">
            <table className="tbl">
              <thead><tr><th>Baris</th><th>Kode MTR</th><th>Nama</th><th>No HP</th><th>DS</th><th>Status</th></tr></thead>
              <tbody>
                {rows.slice(0, 5).map((r) => (
                  <tr key={r.baris}><td>{r.baris}</td><td>{r.kode_mtr}</td><td>{r.nama}</td><td>{r.no_hp}</td><td>{r.ds}</td><td>{r.status}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn" disabled={busy} onClick={run}>{busy ? 'Mengimpor…' : `Import ${rows.length} rider`}</button>
          <button className="btn2 ml-2" disabled={busy} onClick={() => { setRows([]); setFile('') }}>Batal</button>
        </div>
      )}
      {hasil && (
        <div className="mt-4 text-sm">
          <p>
            Rider baru: <b>{hasil.inserted}</b> · Diperbarui: <b>{hasil.updated}</b> · Gagal: <b className={hasil.errors.length ? 'text-danger' : ''}>{hasil.errors.length}</b>
          </p>
          <ul className="text-danger">
            {hasil.errors.map((e, i) => (
              <li key={i}>baris {e.baris}: {e.pesan}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// Captain: cari rider di semua DS / kolam bebas, lalu tarik ke DS-nya
function Tarik({ ds, done }: { ds: Ds; done: () => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<{ id: string; nama: string; ds_id: string | null; ds_nama: string | null; status: string }[]>([])
  const pg = usePage(res, [res])
  const cari = async () => {
    const { data, error } = await sb.rpc('cari_rider', { p_q: q.trim() })
    if (error) return toast(error.message)
    setRes(data ?? [])
  }
  return (
    <div className="card">
      <b className="block mb-2">Tarik rider ke {ds.nama}</b>
      <div className="flex gap-2 mb-2">
        <input className="inp" placeholder="cari nama / Kode MTR (semua DS)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && q.trim().length >= 2 && cari()} />
        <button className="btn" disabled={q.trim().length < 2} onClick={cari}>Cari</button>
      </div>
      <ul className="text-sm divide-y">
        {pg.rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 py-1">
            <span>{r.nama}</span>
            <span className="text-muted-foreground/70">{r.ds_nama ?? 'belum punya DS'}</span>
            <button
              className="btn2 ml-auto"
              disabled={r.ds_id === ds.id}
              onClick={async () => {
                if ((await konfirmasi(`Tarik ${r.nama} dari ${r.ds_nama ?? 'belum punya DS'} ke ${ds.nama}?`, { judul: 'Tarik rider ke DS ini?', ya: 'Tarik' })) && (await ok(sb.rpc('tarik_rider', { p_rider: r.id })))) {
                  setRes([])
                  done()
                }
              }}
            >
              {r.ds_id === ds.id ? 'Sudah di DS Anda' : 'Tarik'}
            </button>
          </li>
        ))}
      </ul>
      <Pagination {...pg} />
    </div>
  )
}
