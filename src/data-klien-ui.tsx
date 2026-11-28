// Data Klien (Super-admin): unggah Data Performance dari file klien (.xlsx atau .csv), pasangkan toko klien ke DS, dan lihat riwayat unggahan.
// Berkas dibaca di browser. Yang dikirim ke database hanya tanggal, kode toko, kode mitra, dan angka; nama rider dipakai di layar untuk
// pencocokan lalu dibuang. Semua pemeriksaan "boleh disimpan atau tidak" ada di database (simpan_order_klien, migrasi 0079).
import { useEffect, useMemo, useState } from 'react'
import { Download, FileUp, Link2, Plus } from 'lucide-react'
import { sb, ok, toast, konfirmasi, Field, Select, Err, Kosong, useRows, usePage, Pagination, parseCsv, toCsv, download, tanggal } from './lib'
import { ambilSemua } from './laporan-order'
import { bacaXlsx } from './xlsx-baca'
import { bacaTabelKlien, cocokkanMitra, ringkas, sarankanDs, type CocokMitra, type HasilBaca, type RiderOrca, type StatusMitra } from './data-klien.ts'

type Klien = { id: string; nama: string; target_ketepatan: number | null }
type DsK = { id: string; nama: string; klien_id: string | null; kode_toko: string | null; aktif: boolean }
type Unggahan = { id: string; waktu: string; oleh: string | null; berkas: string | null; tgl_awal: string | null; tgl_akhir: string | null; baris_total: number; baris_baru: number; baris_ubah: number; baris_sama: number; baris_tolak: number; baris_lewat: number; baris_tahan: number }
type AkunKlien = { id: string; email: string; nama: string | null; aktif: boolean }
type Tahan = { id: string; tanggal: string; ds_id: string; kode_mtr: string; selesai: number; lama_selesai: number; dibuat: string }
type HasilSimpan = { unggahan: string; total: number; baru: number; ubah: number; sama: number; tolak: number; lewat: number; tahan: number; ditolak: { baris: number; alasan: string }[]; toko_dilewati: { kode_toko: string; nama_toko: string; baris: number }[] }

const waktu = (s: string) => new Date(s).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const rentang = (a: string | null, b: string | null) => (!a ? '–' : a === b ? tanggal(a) : `${tanggal(a)} – ${tanggal(b ?? a)}`)
const NAMA_STATUS: Record<StatusMitra, { judul: string; arti: string; warna: string }> = {
  cocok: { judul: 'Cocok', arti: 'Nama dan kode MTR sama dengan rider di ORCA.', warna: 'bg-success-soft text-success' },
  kode_beda: { judul: 'Kode beda', arti: 'Nama ada di ORCA tetapi kode MTR-nya berbeda atau kosong. Perbaiki kode di ORCA atau minta klien membetulkan.', warna: 'bg-warning-soft text-warning' },
  nama_beda: { judul: 'Nama beda', arti: 'Kode MTR ada di ORCA tetapi namanya berbeda: salah ketik, atau kode dipakai orang lain.', warna: 'bg-warning-soft text-warning' },
  ambigu: { judul: 'Nama kembar', arti: 'Ada beberapa rider ORCA dengan nama sama dan tidak ada yang berkode sama.', warna: 'bg-warning-soft text-warning' },
  belum: { judul: 'Belum terdaftar', arti: 'Tidak ada rider ORCA dengan nama maupun kode ini.', warna: 'bg-danger-soft text-danger' },
}

async function sidikBerkas(buf: ArrayBuffer): Promise<string> {
  try {
    const h = await crypto.subtle.digest('SHA-256', buf)
    return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('')
  } catch {
    return '' // konteks tidak aman: jejak sidik dilewati, unggahan tetap jalan
  }
}

export function DataKlien() {
  const klien = useRows<Klien>(() => sb.from('klien').select('*').order('nama'), [])
  const [id, setId] = useState('')
  const [sub, setSub] = useState<'unggah' | 'toko' | 'riwayat' | 'tahan' | 'akun'>('unggah')
  const pilih = klien.rows.find((k) => k.id === (id || klien.rows[0]?.id))
  // Perubahan besar dari unggahan klien yang menunggu keputusan Super-admin (jumlahnya tampil di tab)
  const tahan = useRows<Tahan>(() => (pilih ? sb.from('order_klien_tahan').select('id,tanggal,ds_id,kode_mtr,selesai,lama_selesai,dibuat').eq('klien_id', pilih.id).eq('status', 'menunggu').order('dibuat', { ascending: false }).limit(1000) : Promise.resolve({ data: [], error: null })), [pilih?.id])
  if (klien.err) return <Err msg={klien.err} />
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        {klien.rows.length > 0 && (
          <Field label="Klien">
            <Select className="w-64 max-w-full" value={pilih?.id ?? ''} onChange={setId} placeholder="Pilih klien" opsi={klien.rows.map((k) => ({ value: k.id, label: k.nama }))} />
          </Field>
        )}
        <KlienBaru selesai={klien.reload} />
        {pilih && <Target key={pilih.id} klien={pilih} />}
      </div>
      {!pilih ? <Kosong teks="Belum ada klien" hint="Tambahkan klien pertama (mis. Alfagift), lalu pasangkan tokonya ke DS dan unggah datanya." /> : (
        <>
          <div role="tablist" aria-label="Bagian data klien" className="flex gap-2">
            {([['unggah', 'Unggah data'], ['toko', 'Toko klien'], ['tahan', `Perlu persetujuan${tahan.rows.length ? ` (${tahan.rows.length})` : ''}`], ['riwayat', 'Riwayat unggahan'], ['akun', 'Akun klien']] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={sub === k} onClick={() => setSub(k)} className={`tab !px-3 ${sub === k ? 'tab-on' : tahan.rows.length && k === 'tahan' ? 'border border-warning bg-card text-warning' : 'border border-border bg-card'}`}>{label}</button>
            ))}
          </div>
          {sub === 'unggah' && <Unggah key={pilih.id} klien={pilih} />}
          {sub === 'toko' && <TokoKlien key={pilih.id} klien={pilih} />}
          {sub === 'tahan' && <Tahanan key={pilih.id} rows={tahan.rows} err={tahan.err} selesai={tahan.reload} />}
          {sub === 'riwayat' && <Riwayat key={pilih.id} klien={pilih} />}
          {sub === 'akun' && <AkunKlienDaftar key={pilih.id} klien={pilih} />}
        </>
      )}
    </div>
  )
}

function KlienBaru({ selesai }: { selesai: () => void }) {
  const [buka, setBuka] = useState(false) // tertutup dulu: saat pertama dirender, daftar klien belum termuat
  const [nama, setNama] = useState('')
  const [sibuk, setSibuk] = useState(false)
  async function tambah() {
    if (!nama.trim()) return toast('Nama klien wajib diisi')
    setSibuk(true)
    try {
      if (await ok(sb.from('klien').insert({ nama: nama.trim() }))) { toast.ok('Klien ditambahkan'); setNama(''); setBuka(false); selesai() }
    } finally { setSibuk(false) }
  }
  if (!buka) return <button className="btn2" onClick={() => setBuka(true)}><Plus size={14} />Klien baru</button>
  return (
    <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); tambah() }}>
      <Field label="Nama klien baru"><input className="inp w-56" value={nama} maxLength={80} onChange={(e) => setNama(e.target.value)} placeholder="mis. Alfagift" /></Field>
      <button className="btn" disabled={sibuk}>{sibuk ? 'Menyimpan…' : 'Tambah'}</button>
      <button type="button" className="btn2" onClick={() => setBuka(false)}>Batal</button>
    </form>
  )
}

// Target ketepatan antar (%) yang ditampilkan di Dashboard Klien nanti; boleh kosong
function Target({ klien }: { klien: Klien }) {
  const [v, setV] = useState(klien.target_ketepatan?.toString() ?? '')
  async function simpan() {
    const n = v.trim() === '' ? null : Number(v.replace(',', '.'))
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) return toast('Target harus angka 0 sampai 100')
    if (n === klien.target_ketepatan) return
    if (await ok(sb.from('klien').update({ target_ketepatan: n }).eq('id', klien.id))) { toast.ok('Target disimpan'); klien.target_ketepatan = n }
  }
  return (
    <Field label="Target ketepatan antar (%)" hint="Kosongkan bila belum ada target">
      <input className="inp w-32" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onBlur={simpan} placeholder="mis. 95" />
    </Field>
  )
}

// ───────── toko klien ─────────
// Super-admin membaca tabel ds langsung. Akun klien tidak boleh (tabel itu memuat data internal): ia memberi klienSaja dan membaca lewat toko_klien,
// yang hanya mengembalikan toko milik klien itu.
function useDs(klienSaja?: string) {
  return useRows<DsK>(() => (klienSaja ? sb.rpc('toko_klien', { p_klien: klienSaja }) : sb.from('ds').select('id,nama,klien_id,kode_toko,aktif').order('nama')), [klienSaja])
}

async function pasang(d: DsK, klienId: string | null, kode: string | null): Promise<boolean> {
  return ok(sb.from('ds').update({ klien_id: klienId, kode_toko: kode }).eq('id', d.id))
}

function TokoKlien({ klien }: { klien: Klien }) {
  const ds = useDs()
  const [cari, setCari] = useState('')
  const [semuaDs, setSemuaDs] = useState(false)
  const daftar = useMemo(() => ds.rows.filter((d) => (semuaDs ? !d.klien_id || d.klien_id === klien.id : d.klien_id === klien.id) && d.nama.toLowerCase().includes(cari.toLowerCase())), [ds.rows, klien.id, cari, semuaDs])
  const pg = usePage(daftar, [cari, semuaDs, klien.id])
  if (ds.err) return <Err msg={ds.err} />
  const terpasang = ds.rows.filter((d) => d.klien_id === klien.id).length
  return (
    <div className="card space-y-3">
      <p className="text-sm text-muted-foreground">
        Kode toko di file klien dikenali lewat <b>Kode Toko</b> yang dipasang pada DS, bukan lewat nama. {terpasang} DS terpasang ke klien ini. Toko yang kodenya belum dipasang <b>dilewati</b> saat unggah.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input className="inp w-64 max-w-full" placeholder="Cari DS…" value={cari} onChange={(e) => setCari(e.target.value)} aria-label="Cari DS" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={semuaDs} onChange={(e) => setSemuaDs(e.target.checked)} />Tampilkan DS yang belum dipasang ke klien mana pun</label>
      </div>
      {daftar.length === 0 ? <Kosong teks="Tidak ada DS" hint="Pasang DS dari penanda di atas, atau lewat pratinjau saat mengunggah file." /> : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="tbl">
              <thead><tr><th>DS</th><th>Kode toko di file klien</th><th /></tr></thead>
              <tbody>{pg.rows.map((d) => <BarisToko key={d.id + (d.kode_toko ?? '')} d={d} klien={klien} semua={ds.rows} selesai={ds.reload} />)}</tbody>
            </table>
          </div>
          <Pagination {...pg} />
        </>
      )}
    </div>
  )
}

function BarisToko({ d, klien, semua, selesai }: { d: DsK; klien: Klien; semua: DsK[]; selesai: () => void }) {
  const [kode, setKode] = useState(d.kode_toko ?? '')
  const milik = d.klien_id === klien.id
  const bersih = kode.trim().toUpperCase()
  async function simpan() {
    if (!bersih) return toast('Kode toko wajib diisi')
    if (semua.some((x) => x.id !== d.id && x.klien_id === klien.id && x.kode_toko === bersih)) return toast(`Kode ${bersih} sudah dipakai DS lain milik klien ini`)
    if (await pasang(d, klien.id, bersih)) { toast.ok('Kode toko disimpan'); selesai() }
  }
  async function lepas() {
    if (await pasang(d, null, null)) { toast.ok('DS dilepas dari klien'); selesai() }
  }
  return (
    <tr>
      <td>{d.nama}{d.aktif === false && <span className="badge ml-2 bg-muted text-muted-foreground">nonaktif</span>}</td>
      <td><input className="inp w-40 font-mono" value={kode} maxLength={30} onChange={(e) => setKode(e.target.value)} aria-label={`Kode toko ${d.nama}`} placeholder="mis. 1GCL" /></td>
      <td className="whitespace-nowrap text-right">
        <button className="btn2" disabled={!bersih || (milik && bersih === (d.kode_toko ?? ''))} onClick={simpan}><Link2 size={14} />{milik ? 'Simpan' : 'Pasang'}</button>
        {milik && <button className="btn2 ml-2" onClick={lepas}>Lepas</button>}
      </td>
    </tr>
  )
}

// ───────── unggah ─────────
type Berkas = { nama: string; sidik: string; hasil: HasilBaca }

// modeKlien (akun klien): tanpa pemasangan toko dan tanpa pencocokan rider ORCA. Keduanya data internal Dash; klien hanya diberi tahu toko mana yang belum terdaftar.
function Unggah({ klien, modeKlien = false }: { klien: Klien; modeKlien?: boolean }) {
  const ds = useDs(modeKlien ? klien.id : undefined)
  const [berkas, setBerkas] = useState<Berkas | null>(null)
  const [galat, setGalat] = useState('')
  const [sibuk, setSibuk] = useState(false)
  const [laporan, setLaporan] = useState<HasilSimpan | null>(null)
  const [riders, setRiders] = useState<RiderOrca[] | null>(null)

  useEffect(() => {
    if (!berkas || riders || modeKlien) return
    let batal = false
    ambilSemua<RiderOrca>((a, b) => sb.from('riders').select('kode_mtr,nama,ds_id').eq('peran', 'rider').range(a, b))
      .then((r) => {
        if (batal) return
        if (r.error) toast(`Daftar rider ORCA belum bisa dimuat: ${r.error.message}`)
        setRiders(r.data)
      })
    return () => { batal = true }
  }, [berkas, riders, modeKlien])

  // mode klien: toko_klien sudah hanya berisi toko kliennya (tanpa kolom klien_id)
  const dsPerToko = useMemo(() => new Map(ds.rows.filter((d) => (modeKlien || d.klien_id === klien.id) && d.kode_toko).map((d) => [d.kode_toko as string, d.id])), [ds.rows, klien.id, modeKlien])
  const ring = useMemo(() => (berkas ? ringkas(berkas.hasil.baris) : null), [berkas])
  const belum = ring?.toko.filter((t) => !dsPerToko.has(t.kode)) ?? []
  const siap = berkas ? berkas.hasil.baris.filter((b) => dsPerToko.has(b.kode_toko.toUpperCase())) : []
  const cocok = useMemo(() => (berkas && riders ? cocokkanMitra(berkas.hasil.mitra, riders, dsPerToko) : []), [berkas, riders, dsPerToko])

  async function baca(f: File | undefined) {
    if (!f) return
    setLaporan(null)
    setGalat('')
    setRiders(null)
    try {
      const buf = await f.arrayBuffer()
      const tabel = /\.xlsx$/i.test(f.name) ? await bacaXlsx(buf, { sheet: 'data', maxKolom: 17 }) : parseCsv(new TextDecoder().decode(buf).replace(/^﻿/, ''))
      const hasil = bacaTabelKlien(tabel)
      if (hasil.galat) { setBerkas(null); setGalat(hasil.galat); return }
      setBerkas({ nama: f.name, sidik: await sidikBerkas(buf), hasil })
    } catch (e) {
      setBerkas(null)
      setGalat((e as Error).message)
    }
  }
  async function simpan() {
    if (!berkas || !siap.length) return
    setSibuk(true)
    try {
      const { data, error } = await sb.rpc('simpan_order_klien', { p_klien: klien.id, p_baris: siap, p_berkas: berkas.nama, p_sidik: berkas.sidik || null })
      if (error) return toast(error.message)
      const h = data as HasilSimpan
      setLaporan(h)
      toast.ok(`${h.baru} baris baru, ${h.ubah} diperbarui${h.tahan ? `, ${h.tahan} menunggu persetujuan` : ''}`)
      setBerkas(null)
    } finally { setSibuk(false) }
  }
  const unduhDitolak = () => laporan && download('baris-ditolak.csv', toCsv(laporan.ditolak.map((x) => ({ 'Baris di file': x.baris, Alasan: x.alasan }))))

  return (
    <div className="card space-y-3">
      <p className="text-sm text-muted-foreground">
        {modeKlien ? 'Unggah Data Performance harian apa adanya' : 'Unggah Data Performance klien apa adanya'} (.xlsx sheet <b>data</b>, atau .csv). Kolom wajib: Tgl Periode, Nik (kode mitra), Kode Toko, Pesanan Selesai, Ontime, Late, Pod Sesuai, Pod Tidak Sesuai.
        Nama rider <b>tidak ikut dikirim</b>. File yang sama boleh diunggah ulang: baris yang sama tidak berubah, nilai yang berbeda {modeKlien ? 'diperbarui' : 'ditimpa'} dan nilai lamanya disimpan.
      </p>
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); baca(e.dataTransfer.files?.[0]) }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors hover:bg-primary-soft/60 ${berkas ? 'border-success/60 bg-success/5' : 'border-primary/60 bg-primary-soft/30'}`}
      >
        <FileUp size={28} className={berkas ? 'text-success' : 'text-primary'} />
        <span className="text-sm font-semibold text-foreground">{berkas ? `Terpilih: ${berkas.nama}` : 'UNGGAH DATA PERFORMANCE DI SINI'}</span>
        <span className="text-xs text-muted-foreground">{berkas ? 'Klik untuk mengganti berkas' : 'Klik area ini atau seret berkas .xlsx atau .csv ke sini'}</span>
        <input key={berkas?.nama ?? (laporan ? 'x' : '')} type="file" accept=".xlsx,.csv,text/csv" aria-label="Berkas klien" className="hidden" onChange={(e) => baca(e.target.files?.[0])} />
      </label>
      {galat && <p className="text-sm text-danger">{galat}</p>}

      {laporan && (
        <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <span className="badge bg-success-soft text-success">{laporan.baru} baru</span>
            <span className="badge bg-primary-soft text-primary">{laporan.ubah} diperbarui</span>
            <span className="badge bg-muted text-muted-foreground">{laporan.sama} tidak berubah</span>
            {laporan.tahan > 0 && <span className="badge bg-warning-soft text-warning">{laporan.tahan} menunggu persetujuan</span>}
            {laporan.tolak > 0 && <span className="badge bg-danger-soft text-danger">{laporan.tolak} ditolak</span>}
          </div>
          {laporan.tahan > 0 && (
            <p className="text-xs text-muted-foreground">
              Perubahan besar pada data yang sudah tersimpan (lebih dari 10% dan sedikitnya 5 pesanan) <b>ditahan</b> sampai {modeKlien ? 'tim Dash menyetujuinya' : 'Super-admin menyetujuinya, lihat tab Perlu persetujuan'}.
              Selama menunggu, data lama tetap berlaku.
            </p>
          )}
          {laporan.ditolak.length > 0 && (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2"><b>{modeKlien ? 'Baris yang ditolak' : 'Baris ditolak database'}</b> (tidak disimpan){laporan.tolak > laporan.ditolak.length && ` · ${laporan.ditolak.length} pertama dari ${laporan.tolak}`}
                <button className="btn2" onClick={unduhDitolak}><Download size={14} />Unduh daftar</button></div>
              <ul className="list-disc pl-5 text-xs text-muted-foreground">{laporan.ditolak.slice(0, 8).map((x) => <li key={x.baris}>Baris {x.baris}: {x.alasan}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {berkas && ring && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="badge bg-primary-soft text-primary">{ring.jumlah.toLocaleString('id-ID')} baris</span>
            <span className="badge bg-muted text-muted-foreground">{rentang(ring.awal || null, ring.akhir || null)}</span>
            <span className="badge bg-success-soft text-success">{ring.toko.length - belum.length} toko {modeKlien ? 'terdaftar' : 'terpasang'}</span>
            {belum.length > 0 && <span className="badge bg-warning-soft text-warning">{belum.length} toko belum {modeKlien ? 'terdaftar' : 'terpasang'} (dilewati)</span>}
            <button className="btn ml-auto" disabled={!siap.length || sibuk || siap.length > 20000} onClick={simpan}>{sibuk ? 'Menyimpan…' : `Simpan ${siap.length.toLocaleString('id-ID')} baris`}</button>
          </div>
          {siap.length > 20000 && <p className="text-sm text-danger">Satu unggahan maksimal 20.000 baris. Bagi file menjadi beberapa bagian per tanggal.</p>}
          {!siap.length && <p className="text-sm text-warning">{modeKlien ? 'Belum ada toko di file ini yang terdaftar di Dash. Hubungi tim Dash untuk mendaftarkannya.' : 'Belum ada toko di file ini yang kodenya terpasang ke klien ini. Pasangkan tokonya di bawah atau di tab Toko klien.'}</p>}
          {belum.length > 0 && (modeKlien ? <TokoBelumTerdaftar belum={belum} /> : <PasangToko belum={belum} klien={klien} ds={ds.rows} selesai={ds.reload} />)}
          {!modeKlien && <Mitra cocok={cocok} memuat={riders === null} />}
        </>
      )}
    </div>
  )
}

function TokoBelumTerdaftar({ belum }: { belum: { kode: string; nama: string; baris: number }[] }) {
  const pg = usePage(belum, [belum.length])
  return (
    <div className="space-y-2">
      <div className="text-sm"><b>Toko ini belum terdaftar di Dash</b> dan dilewati (tidak disimpan). Hubungi tim Dash untuk mendaftarkannya, lalu unggah ulang file yang sama.</div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="tbl">
          <thead><tr><th>Kode toko</th><th>Nama di file</th><th>Baris</th></tr></thead>
          <tbody>{pg.rows.map((t) => <tr key={t.kode}><td className="font-mono text-xs">{t.kode}</td><td>{t.nama || '–'}</td><td>{t.baris}</td></tr>)}</tbody>
        </table>
      </div>
      <Pagination {...pg} />
    </div>
  )
}

function PasangToko({ belum, klien, ds, selesai }: { belum: { kode: string; nama: string; baris: number }[]; klien: Klien; ds: DsK[]; selesai: () => void }) {
  const pg = usePage(belum, [belum.length])
  const bebas = ds.filter((d) => !d.klien_id || d.klien_id === klien.id)
  return (
    <div className="space-y-2">
      <div className="text-sm"><b>Toko di file yang belum terpasang ke DS.</b> Toko ini dilewati dan tidak disimpan sampai dipasang.</div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="tbl">
          <thead><tr><th>Kode toko</th><th>Nama di file</th><th>Baris</th><th>Pasang ke DS</th></tr></thead>
          <tbody>{pg.rows.map((t) => <PasangSatu key={t.kode} t={t} klien={klien} bebas={bebas} selesai={selesai} />)}</tbody>
        </table>
      </div>
      <Pagination {...pg} />
    </div>
  )
}

function PasangSatu({ t, klien, bebas, selesai }: { t: { kode: string; nama: string; baris: number }; klien: Klien; bebas: DsK[]; selesai: () => void }) {
  const saran = sarankanDs(t.nama, bebas)
  const [pilih, setPilih] = useState(saran.length === 1 ? saran[0].id : '')
  async function kirim() {
    const d = bebas.find((x) => x.id === pilih)
    if (d && (await pasang(d, klien.id, t.kode))) { toast.ok(`${t.kode} dipasang ke ${d.nama}`); selesai() }
  }
  return (
    <tr>
      <td className="font-mono text-xs">{t.kode}</td>
      <td>{t.nama || '–'}</td>
      <td>{t.baris}</td>
      <td className="flex items-center gap-2">
        <Select className="w-64 max-w-full" value={pilih} onChange={setPilih} placeholder={saran.length ? 'Pilih DS (ada saran)' : 'Pilih DS'} opsi={[...saran, ...bebas.filter((d) => !saran.includes(d))].map((d) => ({ value: d.id, label: d.nama }))} />
        <button className="btn2" disabled={!pilih} onClick={kirim}><Link2 size={14} />Pasang</button>
      </td>
    </tr>
  )
}

function Mitra({ cocok, memuat }: { cocok: CocokMitra[]; memuat: boolean }) {
  const hitung = (s: StatusMitra) => cocok.filter((c) => c.status === s).length
  const [saring, setSaring] = useState<StatusMitra | 'perhatian'>('perhatian')
  const tampil = cocok.filter((c) => (saring === 'perhatian' ? c.status !== 'cocok' : c.status === saring))
  const pg = usePage(tampil, [saring, cocok.length])
  if (memuat) return <p className="text-sm text-muted-foreground">Mencocokkan mitra dengan rider ORCA…</p>
  return (
    <div className="space-y-2">
      <div className="text-sm"><b>Pencocokan mitra dengan rider ORCA</b> <span className="text-muted-foreground">(urutan: nama, kode MTR, lalu pitstop). Hanya informasi; tidak menahan penyimpanan.</span></div>
      <div className="flex flex-wrap gap-2 text-sm">
        {(Object.keys(NAMA_STATUS) as StatusMitra[]).map((s) => (
          <button key={s} title={NAMA_STATUS[s].arti} onClick={() => setSaring(s)} className={`badge ${NAMA_STATUS[s].warna} ${saring === s ? 'ring-2 ring-primary' : ''}`}>{NAMA_STATUS[s].judul}: {hitung(s)}</button>
        ))}
        <button onClick={() => setSaring('perhatian')} className={`badge bg-muted text-muted-foreground ${saring === 'perhatian' ? 'ring-2 ring-primary' : ''}`}>Perlu dicek: {cocok.length - hitung('cocok')}</button>
      </div>
      {saring !== 'perhatian' && <p className="text-xs text-muted-foreground">{NAMA_STATUS[saring].arti}</p>}
      {tampil.length === 0 ? <p className="text-sm text-muted-foreground">Tidak ada mitra di kategori ini.</p> : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="tbl">
              <thead><tr><th>Kode MTR</th><th>Toko di file</th><th>Hasil</th><th>Pitstop</th></tr></thead>
              <tbody>{pg.rows.map((c) => (
                <tr key={c.kode_mtr}>
                  <td className="font-mono text-xs">{c.kode_mtr}</td>
                  <td className="text-xs">{c.toko.join(', ') || '–'}</td>
                  <td><span className={`badge ${NAMA_STATUS[c.status].warna}`}>{NAMA_STATUS[c.status].judul}</span></td>
                  <td className="text-xs text-muted-foreground">{c.pitstop === 'sama' ? 'DS sama dengan toko' : c.pitstop === 'beda' ? 'DS berbeda dari toko' : '–'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Pagination {...pg} />
        </>
      )}
    </div>
  )
}

// ───────── perubahan besar yang ditahan (Super-admin memutuskan) ─────────
function Tahanan({ rows, err, selesai }: { rows: Tahan[]; err: string; selesai: () => void }) {
  const ds = useDs()
  const nama = (id: string) => ds.rows.find((d) => d.id === id)?.nama ?? '–'
  const pg = usePage(rows, [rows.length])
  async function putuskan(t: Tahan, setuju: boolean) {
    const pesan = setuju
      ? `Setujui perubahan ${t.kode_mtr} pada ${tanggal(t.tanggal)}? Pesanan selesai diganti dari ${t.lama_selesai} menjadi ${t.selesai}. Nilai lamanya tetap tersimpan di riwayat penimpaan.`
      : `Tolak perubahan ${t.kode_mtr} pada ${tanggal(t.tanggal)}? Angka lama (${t.lama_selesai}) tetap dipakai.`
    if (!(await konfirmasi(pesan, { ya: setuju ? 'Setujui' : 'Tolak', bahaya: !setuju }))) return
    if (await ok(sb.rpc('putuskan_tahan', { p_id: t.id, p_setuju: setuju }))) { toast.ok(setuju ? 'Perubahan disetujui' : 'Perubahan ditolak'); selesai() }
  }
  if (err) return <Err msg={err} />
  if (!rows.length) return <Kosong teks="Tidak ada perubahan yang menunggu" hint="Perubahan besar dari unggahan klien (lebih dari 10% dan sedikitnya 5 pesanan) muncul di sini untuk disetujui atau ditolak." />
  return (
    <div className="card space-y-3">
      <p className="text-sm text-muted-foreground">
        Perubahan di bawah ini mengubah angka yang sudah tersimpan lebih dari 10% dan sedikitnya 5 pesanan. <b>Data lama tetap berlaku</b> sampai kamu menyetujuinya.
      </p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="tbl">
          <thead><tr><th>Tanggal</th><th>Toko</th><th>Kode mitra</th><th>Angka lama</th><th>Angka baru</th><th>Selisih</th><th>Diunggah</th><th /></tr></thead>
          <tbody>
            {pg.rows.map((t) => {
              const beda = t.selesai - t.lama_selesai
              return (
                <tr key={t.id}>
                  <td className="whitespace-nowrap">{tanggal(t.tanggal)}</td>
                  <td>{nama(t.ds_id)}</td>
                  <td className="font-mono text-xs">{t.kode_mtr}</td>
                  <td>{t.lama_selesai}</td>
                  <td>{t.selesai}</td>
                  <td className={beda > 0 ? 'text-success' : 'text-danger'}>{beda > 0 ? '+' : ''}{beda}{t.lama_selesai ? ` (${beda > 0 ? '+' : ''}${Math.round((beda * 100) / t.lama_selesai)}%)` : ''}</td>
                  <td className="whitespace-nowrap text-xs">{waktu(t.dibuat)}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn2" onClick={() => putuskan(t, true)}>Setujui</button>
                    <button className="btn2 ml-2" onClick={() => putuskan(t, false)}>Tolak</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Pagination {...pg} />
    </div>
  )
}

// ───────── akun klien (Super-admin) ─────────
const HURUF_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789' // tanpa karakter yang mudah tertukar (I, l, 1, O, 0)
function passwordAcak(): string {
  let out = ''
  const batas = 256 - (256 % HURUF_PASSWORD.length) // buang nilai di atas batas supaya setiap huruf sama peluangnya
  while (out.length < 14) for (const b of crypto.getRandomValues(new Uint8Array(24))) if (b < batas && out.length < 14) out += HURUF_PASSWORD[b % HURUF_PASSWORD.length]
  return out
}

function AkunKlienDaftar({ klien }: { klien: Klien }) {
  const akun = useRows<AkunKlien>(() => sb.from('akun_klien').select('id,email,nama,aktif').eq('klien_id', klien.id).order('dibuat'), [klien.id])
  const [email, setEmail] = useState('')
  const [nama, setNama] = useState('')
  const [pw, setPw] = useState('')
  const [sibuk, setSibuk] = useState(false)
  const [hasil, setHasil] = useState<{ email: string; password: string; baru: boolean } | null>(null)

  async function buat() {
    const e = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return toast('Isi email yang valid')
    if (pw.length < 8) return toast('Password minimal 8 karakter. Pakai tombol "Buat acak" bila perlu.')
    setSibuk(true)
    try {
      const { data, error } = await sb.functions.invoke('kelola-klien', { body: { email: e, password: pw, klien_id: klien.id, nama: nama.trim() } })
      if (error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detail = await (error as any).context?.json?.().then((j: any) => j.error).catch(() => null)
        return toast(`Akun klien gagal dibuat: ${detail ?? error.message}`)
      }
      setHasil({ email: e, password: pw, baru: Boolean((data as { created?: boolean } | null)?.created) })
      setEmail(''); setNama(''); setPw('')
      akun.reload()
    } finally { setSibuk(false) }
  }
  async function ubahStatus(a: AkunKlien) {
    if (a.aktif && !(await konfirmasi(`Nonaktifkan akun ${a.email}? Klien ini tidak bisa melihat data lagi sampai diaktifkan kembali.`, { ya: 'Nonaktifkan', bahaya: true }))) return
    if (await ok(sb.from('akun_klien').update({ aktif: !a.aktif }).eq('id', a.id))) { toast.ok(a.aktif ? 'Akun dinonaktifkan' : 'Akun diaktifkan'); akun.reload() }
  }
  const salin = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.ok('Disalin'), () => toast('Tidak bisa menyalin, salin manual'))

  return (
    <div className="space-y-3">
      <div className="card space-y-3">
        <b>Buat akun login klien atau atur ulang password</b>
        <p className="text-sm text-muted-foreground">
          Klien masuk lewat tab <b>Email</b> di layar login dan hanya melihat data <b>{klien.nama}</b>. Email yang sudah dipakai orang di ORCA (rider, Captain, Arcon, Super-admin) ditolak.
          Email yang sudah punya akun: password-nya diganti.
        </p>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(ev) => { ev.preventDefault(); buat() }}>
          <Field label="Email klien"><input className="inp w-full" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@perusahaan.com" autoComplete="off" /></Field>
          <Field label="Nama (opsional)"><input className="inp w-full" value={nama} maxLength={80} onChange={(e) => setNama(e.target.value)} placeholder="mis. Tim Alfagift" /></Field>
          <Field label="Password (min. 8 karakter)"><input className="inp w-full font-mono" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" /></Field>
          <div className="flex items-end gap-2">
            <button type="button" className="btn2" onClick={() => setPw(passwordAcak())}>Buat acak</button>
            <button className="btn" disabled={sibuk}>{sibuk ? 'Menyimpan…' : 'Simpan akun'}</button>
          </div>
        </form>
        {hasil && (
          <div className="space-y-2 rounded-xl border border-success/40 bg-success/5 p-3 text-sm">
            <div><b>{hasil.baru ? 'Akun dibuat.' : 'Password diganti.'}</b> Berikan data ini ke klien lewat jalur yang aman. <b>Password tidak bisa dilihat lagi</b> setelah kotak ini ditutup.</div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs"><span>{hasil.email}</span><button className="btn2" onClick={() => salin(hasil.email)}>Salin email</button></div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs"><span>{hasil.password}</span><button className="btn2" onClick={() => salin(hasil.password)}>Salin password</button></div>
            <button className="btn2" onClick={() => setHasil(null)}>Tutup</button>
          </div>
        )}
      </div>
      {akun.err ? <Err msg={akun.err} /> : !akun.rows.length ? <Kosong teks="Belum ada akun untuk klien ini" hint="Buat akun pertama di atas." /> : (
        <div className="card">
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="tbl">
              <thead><tr><th>Email</th><th>Nama</th><th>Status</th><th /></tr></thead>
              <tbody>
                {akun.rows.map((a) => (
                  <tr key={a.id}>
                    <td className="font-mono text-xs">{a.email}</td>
                    <td>{a.nama ?? '–'}</td>
                    <td><span className={`badge ${a.aktif ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground'}`}>{a.aktif ? 'Aktif' : 'Nonaktif'}</span></td>
                    <td className="whitespace-nowrap text-right">
                      <button className="btn2" onClick={() => { setEmail(a.email); setNama(a.nama ?? ''); setPw(passwordAcak()) }}>Atur ulang password</button>
                      <button className="btn2 ml-2" onClick={() => ubahStatus(a)}>{a.aktif ? 'Nonaktifkan' : 'Aktifkan'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// Dipakai akun klien: hanya klien miliknya sendiri
const klienSaya = (klienId: string): Klien => ({ id: klienId, nama: '', target_ketepatan: null })
export const UnggahKlien = ({ klienId }: { klienId: string }) => <Unggah klien={klienSaya(klienId)} modeKlien />
export const RiwayatKlien = ({ klienId }: { klienId: string }) => <Riwayat klien={klienSaya(klienId)} />

// ───────── riwayat ─────────
function Riwayat({ klien }: { klien: Klien }) {
  const u = useRows<Unggahan>(() => sb.from('unggahan_klien').select('id,waktu,oleh,berkas,tgl_awal,tgl_akhir,baris_total,baris_baru,baris_ubah,baris_sama,baris_tolak,baris_lewat,baris_tahan').eq('klien_id', klien.id).order('waktu', { ascending: false }).limit(500), [klien.id])
  const pg = usePage(u.rows, [klien.id])
  if (u.err) return <Err msg={u.err} />
  if (!u.rows.length) return <Kosong teks="Belum ada unggahan" hint="Riwayat muncul setelah file pertama diunggah." />
  return (
    <div className="card space-y-3">
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="tbl">
          <thead><tr><th>Waktu</th><th>Oleh</th><th>Berkas</th><th>Periode data</th><th>Baru</th><th>Diperbarui</th><th>Tidak berubah</th><th>Ditahan</th><th>Ditolak</th><th>Dilewati</th></tr></thead>
          <tbody>{pg.rows.map((x) => (
            <tr key={x.id}>
              <td className="whitespace-nowrap">{waktu(x.waktu)}</td><td className="text-xs">{x.oleh ?? '–'}</td><td className="text-xs">{x.berkas ?? '–'}</td>
              <td className="whitespace-nowrap">{rentang(x.tgl_awal, x.tgl_akhir)}</td>
              <td>{x.baris_baru}</td><td>{x.baris_ubah}</td><td>{x.baris_sama}</td><td>{x.baris_tahan}</td><td>{x.baris_tolak}</td><td>{x.baris_lewat}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <Pagination {...pg} />
    </div>
  )
}
