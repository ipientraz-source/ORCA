// Armada: impor data molis dari CSV (mis. kolom "DS Location, License Plate, VIN"). Pratinjau dulu, baru disimpan.
import { useState } from 'react'
import { X } from 'lucide-react'
import { sb, ok, toast, Field, parseCsv, usePage, Pagination, type Ds } from './lib'
import { bacaCsvMotor, siapkanMotor, type HasilMotor } from './impor'
import type { Motor } from './armada-lib'

const tebakMerek = (nama: string) => {
  const m = nama.match(/^ev\s+([a-z]+)/i)
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : ''
}

export function ImporMotor({ dsBoleh, motors, bisaBuatDs, selesai, tutup }: { dsBoleh: Ds[]; motors: Motor[]; bisaBuatDs: boolean; selesai: () => void; tutup: () => void }) {
  const [berkas, setBerkas] = useState('')
  const [baris, setBaris] = useState<ReturnType<typeof bacaCsvMotor>['baris']>([])
  const [galat, setGalat] = useState('')
  const [merek, setMerek] = useState('')
  const [model, setModel] = useState('')
  const [buatDs, setBuatDs] = useState(bisaBuatDs)
  const [sibuk, setSibuk] = useState(false)

  const hasil: HasilMotor[] = siapkanMotor(
    baris,
    dsBoleh.map((d) => d.nama),
    { plat: motors.map((m) => m.plat_nomor ?? '').filter(Boolean), vin: motors.map((m) => m.no_rangka ?? '').filter(Boolean), kode: motors.map((m) => m.kode_motor) },
    buatDs,
  )
  const siap = hasil.filter((h) => !h.masalah)
  const bermasalah = hasil.length - siap.length
  const dsBaru = [...new Set(siap.filter((h) => h.dsBaru).map((h) => h.dsBaru as string))]
  const pg = usePage(hasil, [baris.length, buatDs])

  async function baca(f: File | undefined) {
    if (!f) return
    const { baris: b, galat: g } = bacaCsvMotor(parseCsv((await f.text()).replace(/^﻿/, '')))
    setBerkas(f.name)
    setBaris(b)
    setGalat(g)
    setMerek(tebakMerek(f.name))
  }

  async function impor() {
    setSibuk(true)
    try {
      const idDs = new Map(dsBoleh.map((d) => [d.nama, d.id]))
      if (dsBaru.length) {
        const { data, error } = await sb.from('ds').insert(dsBaru.map((nama) => ({ nama }))).select('id,nama')
        if (error) return toast(error.message)
        for (const d of data ?? []) idDs.set(d.nama as string, d.id as string)
      }
      const isi = siap.map((h) => ({
        kode_motor: h.kode, ds_id: idDs.get(h.ds ?? h.dsBaru ?? ''), plat_nomor: h.plat, no_rangka: h.vin || null,
        merek: merek.trim() || null, model: model.trim() || null, tahun: h.tahun,
      }))
      for (let i = 0; i < isi.length; i += 200) {
        if (!(await ok(sb.from('motor').insert(isi.slice(i, i + 200))))) return
      }
      toast.ok(`${isi.length} motor diimpor${dsBaru.length ? `, ${dsBaru.length} DS baru dibuat` : ''}`)
      selesai()
    } finally {
      setSibuk(false)
    }
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between"><b>Impor data molis dari CSV</b><button className="btn2" onClick={tutup}><X size={14} />Tutup</button></div>
      <p className="mb-3 text-sm text-muted-foreground">
        Kolom yang dibaca: <b>DS Location</b> (atau Lokasi), <b>License Plate</b> (atau Plat), dan <b>VIN</b> (nomor rangka, opsional). Kode motor memakai plat nomor, tahun diambil dari VIN, dan baris "Grand Total" diabaikan.
        Lokasi dicocokkan ke DS yang sudah ada (mis. "Dark Store Alfagift - Galaxy" ke DS GALAXY).
      </p>
      <label className="flex max-w-full cursor-pointer items-center gap-3 rounded-xl border border-dashed border-input p-4 text-sm text-muted-foreground hover:border-primary/50 hover:bg-muted/40">
        <span className="btn2 shrink-0">Pilih file CSV</span>
        {berkas || 'Belum ada file dipilih — klik di sini untuk unggah'}
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => baca(e.target.files?.[0])} />
      </label>
      {galat && <p className="mt-3 text-sm text-danger">{galat}</p>}

      {baris.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Merek" hint={berkas ? `Ditebak dari nama berkas "${berkas}". Berlaku untuk semua motor di file.` : 'Berlaku untuk semua motor di file.'}><input className="inp w-full" value={merek} onChange={(e) => setMerek(e.target.value)} /></Field>
            <Field label="Model (opsional)" hint="Berlaku untuk semua motor di file."><input className="inp w-full" value={model} onChange={(e) => setModel(e.target.value)} /></Field>
            {bisaBuatDs ? (
              <label className="flex cursor-pointer items-start gap-2 pt-6 text-sm"><input type="checkbox" className="mt-1" checked={buatDs} onChange={(e) => setBuatDs(e.target.checked)} />Buat DS baru untuk lokasi yang belum ada ({dsBaru.length ? dsBaru.join(', ') : 'tidak ada'})</label>
            ) : (
              <p className="pt-6 text-sm text-muted-foreground">Lokasi yang bukan DS Anda tidak bisa diimpor. Minta Super-admin membuat DS-nya.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="badge bg-success-soft text-success">{siap.length} siap diimpor</span>
            {bermasalah > 0 && <span className="badge bg-danger-soft text-danger">{bermasalah} bermasalah (dilewati)</span>}
            <button className="btn ml-auto" disabled={!siap.length || sibuk} onClick={impor}>{sibuk ? 'Mengimpor…' : `Impor ${siap.length} motor`}</button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="tbl">
              <thead><tr><th>Baris</th><th>Lokasi di file</th><th>DS di sistem</th><th>Plat</th><th>VIN</th><th>Tahun</th><th>Status</th></tr></thead>
              <tbody>
                {pg.rows.map((h) => (
                  <tr key={h.baris}>
                    <td className="font-mono text-xs">{h.baris}</td>
                    <td className="text-xs text-muted-foreground">{h.lokasi}</td>
                    <td>{h.ds ?? (h.dsBaru ? <span className="badge bg-warning-soft text-warning">Baru: {h.dsBaru}</span> : '–')}</td>
                    <td className="font-medium">{h.plat}</td>
                    <td className="font-mono text-xs">{h.vin || '–'}</td>
                    <td>{h.tahun ?? '–'}</td>
                    <td>{h.masalah ? <span className="badge bg-danger-soft text-danger">{h.masalah}</span> : <span className="badge bg-success-soft text-success">Siap</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...pg} />
        </div>
      )}
    </div>
  )
}
