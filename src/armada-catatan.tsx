// Fleet management: catatan servis dan laporan kerusakan (form + daftar).
import { useState } from 'react'
import { sb, today, ok, toast, Field, Select, type Me, type Rider } from './lib'
import { angka, BadgeParah, BadgeRusak, FotoGaleri, FotoPicker, InputRupiah, JENIS_RUSAK, JENIS_SERVIS, namaJenis, PilihPart, rupiah, tgl, type Rusak, type Servis } from './armada-lib'
import { InputTanggal } from './tanggal'

const opsi = (l: string[]) => l.map((v) => ({ value: v, label: v }))

// Biaya + "ditanggung asuransi": kalau dicentang, biaya otomatis Rp 0
function BiayaAsuransi({ asuransi, setAsuransi, biaya, setBiaya }: { asuransi: boolean; setAsuransi: (v: boolean) => void; biaya: string; setBiaya: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={asuransi} onChange={(e) => { setAsuransi(e.target.checked); if (e.target.checked) setBiaya('') }} />
        Ditanggung asuransi (biaya Rp 0)
      </label>
      <span className="flex items-center gap-2 text-muted-foreground">Biaya <InputRupiah nilai={asuransi ? '' : biaya} ubah={setBiaya} disabled={asuransi} /></span>
    </div>
  )
}

const Biaya = ({ biaya, asuransi }: { biaya: number; asuransi: boolean }) => (
  <span className="inline-flex flex-wrap items-center gap-1.5">
    {rupiah(biaya)}
    {asuransi && <span className="badge bg-primary-soft text-primary-soft-foreground">Asuransi</span>}
  </span>
)

// ───────── servis ─────────
export function FormServis({ motorId, selesai }: { motorId: string; selesai: () => void }) {
  const [tanggal, setTanggal] = useState(today())
  const [jenis, setJenis] = useState('Servis rutin')
  const [lain, setLain] = useState('')
  const [bengkel, setBengkel] = useState('')
  const [km, setKm] = useState('')
  const [asuransi, setAsuransi] = useState(false)
  const [biaya, setBiaya] = useState('')
  const [catatan, setCatatan] = useState('')
  const [pekerjaan, setPekerjaan] = useState<string[]>([])
  const [foto, setFoto] = useState<string[]>([])

  async function simpan() {
    if (jenis === 'Lainnya' && !lain.trim()) return toast('Tulis jenis servisnya.')
    const sukses = await ok(
      sb.from('servis_motor').insert({
        motor_id: motorId, tanggal, jenis, jenis_lain: jenis === 'Lainnya' ? lain.trim() : null, bengkel: bengkel.trim() || null,
        kilometer: km ? angka(km) : null, biaya: asuransi ? 0 : angka(biaya), ditanggung_asuransi: asuransi, catatan: catatan.trim() || null, foto, pekerjaan,
      }),
    )
    if (!sukses) return
    toast.ok('Servis dicatat')
    selesai()
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Tanggal servis"><InputTanggal className="inp w-full" value={tanggal} max={today()} onChange={(e) => e.target.value && setTanggal(e.target.value)} /></Field>
        <Field label="Jenis servis" hint="Servis rutin memajukan jadwal servis berikutnya."><Select value={jenis} onChange={setJenis} opsi={opsi(JENIS_SERVIS)} /></Field>
        {jenis === 'Lainnya' && <Field label="Jenis servis (tulis)"><input className="inp w-full" value={lain} onChange={(e) => setLain(e.target.value)} placeholder="Mis. ganti lampu rem" /></Field>}
        <Field label="Bengkel"><input className="inp w-full" value={bengkel} onChange={(e) => setBengkel(e.target.value)} /></Field>
        <Field label="Kilometer (opsional)"><input className="inp w-full" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, '').slice(0, 7))} /></Field>
      </div>
      <BiayaAsuransi asuransi={asuransi} setAsuransi={setAsuransi} biaya={biaya} setBiaya={setBiaya} />
      <Field label="Part yang diganti (opsional)" hint="Centang part yang diganti pada servis ini."><PilihPart value={pekerjaan} ubah={setPekerjaan} /></Field>
      <Field label="Catatan (opsional)"><textarea className="inp w-full" rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} /></Field>
      <FotoPicker motorId={motorId} value={foto} ubah={setFoto} />
      <button className="btn" onClick={simpan}>Simpan servis</button>
    </div>
  )
}

export function TabelServis({ rows, motorNama }: { rows: Servis[]; motorNama?: (id: string) => string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Belum ada catatan servis.</p>
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>Tanggal</th>{motorNama && <th>Motor</th>}<th>Jenis</th><th>Bengkel</th><th>KM</th><th>Biaya</th><th>Catatan</th></tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td>{tgl(s.tanggal)}</td>
              {motorNama && <td className="font-mono text-xs">{motorNama(s.motor_id)}</td>}
              <td>
                <div className="font-medium">{namaJenis(s)}</div>
                {s.pekerjaan?.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{s.pekerjaan.map((p) => <span key={p} className="badge bg-muted text-foreground/80">{p}</span>)}</div>}
              </td>
              <td>{s.bengkel ?? '–'}</td>
              <td className="font-mono">{s.kilometer?.toLocaleString('id-ID') ?? '–'}</td>
              <td><Biaya biaya={s.biaya} asuransi={s.ditanggung_asuransi} /></td>
              <td>
                {s.catatan && <div className="text-sm">{s.catatan}</div>}
                {s.foto.length > 0 && <div className="mt-1"><FotoGaleri paths={s.foto} kecil /></div>}
                {!s.catatan && !s.foto.length && '–'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ───────── kerusakan ─────────
export function FormLapor({ motorId, me, selesai }: { motorId: string; me: Me; selesai: () => void }) {
  const [jenis, setJenis] = useState(JENIS_RUSAK[0])
  const [lain, setLain] = useState('')
  const [parah, setParah] = useState('sedang')
  const [deskripsi, setDeskripsi] = useState('')
  const [foto, setFoto] = useState<string[]>([])

  async function kirim() {
    if (jenis === 'Lainnya' && !lain.trim()) return toast('Tulis jenis kerusakannya.')
    if (!deskripsi.trim()) return toast('Jelaskan kerusakannya dulu.')
    const sukses = await ok(
      sb.from('kerusakan_motor').insert({ motor_id: motorId, jenis, jenis_lain: jenis === 'Lainnya' ? lain.trim() : null, keparahan: parah, deskripsi: deskripsi.trim(), pelapor_id: me.id, foto }),
    )
    if (!sukses) return
    toast.ok('Laporan kerusakan terkirim')
    selesai()
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Jenis kerusakan"><Select value={jenis} onChange={setJenis} opsi={opsi(JENIS_RUSAK)} /></Field>
        {jenis === 'Lainnya' && <Field label="Jenis kerusakan (tulis)"><input className="inp w-full" value={lain} onChange={(e) => setLain(e.target.value)} placeholder="Mis. layar dashboard mati" /></Field>}
        <Field label="Tingkat keparahan" hint="Berat = motor tidak bisa dipakai.">
          <Select value={parah} onChange={setParah} opsi={[{ value: 'ringan', label: 'Ringan' }, { value: 'sedang', label: 'Sedang' }, { value: 'berat', label: 'Berat' }]} />
        </Field>
      </div>
      <Field label="Penjelasan" hint="Apa yang rusak, kapan, dan bagaimana kejadiannya."><textarea className="inp w-full" rows={3} value={deskripsi} onChange={(e) => setDeskripsi(e.target.value)} /></Field>
      <FotoPicker motorId={motorId} value={foto} ubah={setFoto} />
      <button className="btn" onClick={kirim}>Kirim laporan</button>
    </div>
  )
}

function Proses({ r, reload }: { r: Rusak; reload: () => void }) {
  const [status, setStatus] = useState<string>(r.status)
  const [asuransi, setAsuransi] = useState(r.ditanggung_asuransi)
  const [biaya, setBiaya] = useState(r.biaya ? String(r.biaya) : '')
  const [catatan, setCatatan] = useState(r.catatan_perbaikan ?? '')

  async function simpan() {
    const sukses = await ok(
      sb.from('kerusakan_motor').update({ status, ditanggung_asuransi: asuransi, biaya: asuransi ? 0 : angka(biaya), catatan_perbaikan: catatan.trim() || null }).eq('id', r.id),
    )
    if (!sukses) return
    toast.ok('Laporan diperbarui')
    reload()
  }

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Status laporan" hint="Diproses = motor berstatus perbaikan." className="w-full sm:w-56">
          <Select value={status} onChange={setStatus} opsi={[{ value: 'dilaporkan', label: 'Dilaporkan' }, { value: 'diproses', label: 'Diproses' }, { value: 'selesai', label: 'Selesai' }]} />
        </Field>
        <Field label="Catatan perbaikan" className="min-w-[min(16rem,100%)] flex-1"><input className="inp w-full" value={catatan} onChange={(e) => setCatatan(e.target.value)} /></Field>
      </div>
      <BiayaAsuransi asuransi={asuransi} setAsuransi={setAsuransi} biaya={biaya} setBiaya={setBiaya} />
      <button className="btn2" onClick={simpan}>Simpan perubahan</button>
    </div>
  )
}

export function ListRusak({ rows, motorNama, pelapor, bisaProses, reload }: { rows: Rusak[]; motorNama?: (id: string) => string; pelapor: (id: string | null) => string; bisaProses: boolean; reload: () => void }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Belum ada laporan kerusakan.</p>
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.id} className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <b>{namaJenis(r)}</b>
            <BadgeRusak s={r.status} />
            <BadgeParah s={r.keparahan} />
            {motorNama && <span className="font-mono text-xs text-muted-foreground">{motorNama(r.motor_id)}</span>}
            <span className="ml-auto text-xs text-muted-foreground">{tgl(r.tanggal)} · dilaporkan {pelapor(r.pelapor_id)}</span>
          </div>
          <p className="mt-2 text-sm">{r.deskripsi}</p>
          {r.foto.length > 0 && <div className="mt-2"><FotoGaleri paths={r.foto} kecil /></div>}
          {(r.status !== 'dilaporkan' || r.biaya > 0 || r.ditanggung_asuransi) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>Biaya: <Biaya biaya={r.biaya} asuransi={r.ditanggung_asuransi} /></span>
              {r.tanggal_selesai && <span>Selesai {tgl(r.tanggal_selesai)}</span>}
              {r.catatan_perbaikan && <span>Catatan: {r.catatan_perbaikan}</span>}
            </div>
          )}
          {bisaProses && <Proses key={r.id + r.status} r={r} reload={reload} />}
        </div>
      ))}
    </div>
  )
}

export const namaPelapor = (riders: Rider[]) => (id: string | null) => riders.find((r) => r.id === id)?.nama ?? 'tanpa nama'
