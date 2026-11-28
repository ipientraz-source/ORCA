// Memperbaiki nama, Kode MTR, dan no HP rider yang salah ketik. Aturan (hak akses, Kode MTR unik, clock-in BO) dijaga fungsi ubah_rider di database.
import { useState } from 'react'
import { Field, ok, sb, toast, type Rider } from './lib'

export function DialogUbahRider({ rider, tutup, selesai }: { rider: Rider; tutup: () => void; selesai: () => void }) {
  const [f, setF] = useState({ nama: rider.nama, kode: rider.kode_mtr ?? '', hp: rider.no_hp ?? '' })
  const [proses, setProses] = useState(false)
  const berubah = f.nama !== rider.nama || f.kode !== (rider.kode_mtr ?? '') || f.hp !== (rider.no_hp ?? '')
  const lengkap = f.nama.trim() && (rider.peran !== 'rider' || f.kode.trim())
  const kirim = async () => {
    setProses(true)
    const hasil = await ok(sb.rpc('ubah_rider', { p_rider: rider.id, p_nama: f.nama, p_kode: f.kode, p_hp: f.hp }))
    setProses(false)
    if (hasil) {
      toast.ok(`Data ${f.nama.trim()} diperbarui`)
      selesai()
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={`Ubah data ${rider.nama}`} onClick={tutup}>
      <form className="card !mb-0 w-full max-w-md" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (berubah && lengkap && !proses) void kirim() }}>
        <h3 className="mb-1 text-lg font-bold">Ubah data {rider.nama}</h3>
        <p className="mb-4 text-sm text-muted-foreground">Untuk memperbaiki salah ketik. Setiap perubahan dicatat di Riwayat. Pindah DS dan status diatur dari tabel.</p>
        <div className="grid gap-4">
          <Field label="Nama rider (wajib)">
            <input className="inp w-full" value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} autoFocus />
          </Field>
          <Field label={rider.peran === 'rider' ? 'Kode MTR (wajib)' : 'Kode MTR'} hint="Tidak boleh sama dengan rider lain. Rider masuk memakai kode ini, jadi setelah diganti ia harus masuk ulang dengan kode baru. Kode yang sudah punya clock-in BO tidak bisa diganti.">
            <input className="inp w-full" value={f.kode} onChange={(e) => setF({ ...f, kode: e.target.value })} />
          </Field>
          <Field label="No HP" hint="8 sampai 15 angka, boleh diawali +. Boleh dikosongkan.">
            <input className="inp w-full" placeholder="Contoh: 08123456789" value={f.hp} onChange={(e) => setF({ ...f, hp: e.target.value })} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn2" onClick={tutup}>Batal</button>
          <button type="submit" className="btn" disabled={!berubah || !lengkap || proses}>{proses ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </form>
    </div>
  )
}
