// Menonaktifkan rider wajib menyebut alasan dan tanggal berhenti: dasar angka turnover yang bisa dipertanggungjawabkan.
import { useState } from 'react'
import { Field, ok, sb, toast, today, type Rider } from './lib'

export const KATEGORI_BERHENTI: Record<string, string> = {
  mengundurkan_diri: 'Mengundurkan diri',
  diberhentikan: 'Diberhentikan',
  kontrak_selesai: 'Kontrak selesai',
  tidak_diketahui: 'Tidak diketahui',
}

export function DialogBerhenti({ rider, tutup, selesai }: { rider: Rider; tutup: () => void; selesai: () => void }) {
  const [kat, setKat] = useState('')
  const [tgl, setTgl] = useState(today())
  const [alasan, setAlasan] = useState('')
  const [proses, setProses] = useState(false)
  const kirim = async () => {
    setProses(true)
    const hasil = await ok(sb.rpc('nonaktifkan_rider', { p_rider: rider.id, p_kategori: kat, p_alasan: alasan.trim() || null, p_tanggal: tgl }))
    setProses(false)
    if (hasil) {
      toast.ok(`${rider.nama} dinonaktifkan`)
      selesai()
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={`Nonaktifkan ${rider.nama}`} onClick={tutup}>
      <div className="card !mb-0 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-lg font-bold">Nonaktifkan {rider.nama}?</h3>
        <p className="mb-4 text-sm text-muted-foreground">Tidak akan muncul di jadwal baru dan tidak bisa masuk dengan Kode MTR. Bisa diaktifkan lagi kapan saja. Alasan dicatat untuk angka turnover.</p>
        <div className="grid gap-4">
          <Field label="Alasan berhenti">
            <select className="inp w-full" value={kat} onChange={(e) => setKat(e.target.value)} autoFocus>
              <option value="">— pilih alasan —</option>
              {['mengundurkan_diri', 'diberhentikan', 'kontrak_selesai'].map((k) => <option key={k} value={k}>{KATEGORI_BERHENTI[k]}</option>)}
            </select>
          </Field>
          <Field label="Tanggal terakhir bekerja" hint="Boleh diisi tanggal yang sudah lewat. Tidak boleh di masa depan.">
            <input type="date" className="inp w-full" value={tgl} max={today()} onChange={(e) => e.target.value && setTgl(e.target.value)} />
          </Field>
          <Field label="Keterangan (opsional)">
            <input className="inp w-full" placeholder="mis. pindah kota, sering alpha" value={alasan} onChange={(e) => setAlasan(e.target.value)} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn2" onClick={tutup}>Batal</button>
          <button className="btn !bg-danger" disabled={!kat || proses} onClick={kirim}>{proses ? 'Menyimpan…' : 'Nonaktifkan'}</button>
        </div>
      </div>
    </div>
  )
}
