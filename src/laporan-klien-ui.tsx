// Laporan Performance bulanan klien: deretan slide 16:9 yang disusun di browser dari data asli (fungsi database yang sama dengan Dashboard Klien,
// jadi pembatasan per klien/DS tetap dijaga database). Dicetak/disimpan sebagai PDF lewat dialog cetak browser: satu slide satu halaman.
// Tidak ada server tambahan; angka dan kalimat catatan dihitung di laporan-klien.ts (diuji).
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { sb } from './lib'
import { teksAngka, teksDesimal, teksPct, poin, type Bo, type Hari } from './dashboard-klien.ts'
import { daftarBulan, namaBulan, rentangBulan, rentangBulanLalu, susunLaporan, teksRentang, teksTarget, type BarisToko, type Laporan, type TokoLap } from './laporan-klien.ts'
import './laporan-klien.css'

type Klien = { id: string; nama: string; target_ketepatan: number | null; logo?: string | null }
type Data = { kini: Hari[]; lalu: Hari[]; toko: BarisToko[]; bo: Bo[]; err: string }

const tgPendek = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const hrPendek = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('id-ID', { weekday: 'short', timeZone: 'UTC' })
const koma = (v: number, d = 1) => v.toFixed(d).replace('.', ',')
const hasil = (r: { data: unknown }) => (r.data ?? []) as never[]

export function LaporanBulanan({ klien, awal, akhir, totalToko, anda, onTutup }: { klien: Klien; awal: string; akhir: string; totalToko: number; anda: boolean; onTutup: () => void }) {
  const bulanAda = useMemo(() => daftarBulan(awal, akhir), [awal, akhir])
  const [bulan, setBulan] = useState(bulanAda[0])
  const [dari, sampai] = rentangBulan(bulan, awal, akhir)
  const [pd, ps] = rentangBulanLalu(bulan, dari, sampai)
  const [d, setD] = useState<Data | null>(null)
  const [z, setZ] = useState(1)

  useEffect(() => {
    let off = false
    setD(null)
    const arg = (a: string, b: string) => ({ p_klien: klien.id, p_dari: a, p_sampai: b, p_ds: null })
    Promise.all([
      sb.rpc('dashboard_klien_harian', arg(dari, sampai)), sb.rpc('dashboard_klien_harian', arg(pd, ps)),
      sb.rpc('dashboard_klien_toko', arg(dari, sampai)), sb.rpc('dashboard_klien_bo', arg(dari, sampai)),
    ]).then(([kini, lalu, toko, bo]) => {
      if (off) return
      // Data Dash (bo) pelengkap: bila gagal, laporan tetap jalan tanpa bagian itu
      setD({ kini: hasil(kini), lalu: hasil(lalu), toko: hasil(toko), bo: bo.error ? [] : hasil(bo), err: kini.error?.message || toko.error?.message || '' })
    })
    return () => { off = true }
  }, [klien.id, dari, sampai, pd, ps])

  // Halaman utama disembunyikan saat mencetak (lihat laporan-klien.css), dan slide mengecil mengikuti lebar layar
  useEffect(() => {
    document.body.classList.add('lap-cetak')
    const awalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const ukur = () => setZ(Math.min(1, (window.innerWidth - 32) / 1280))
    ukur()
    window.addEventListener('resize', ukur)
    return () => { document.body.classList.remove('lap-cetak'); document.body.style.overflow = awalOverflow; window.removeEventListener('resize', ukur) }
  }, [])

  const L = useMemo(() => (d && !d.err ? susunLaporan({ hari: d.kini, lalu: d.lalu, toko: d.toko, bo: d.bo, target: klien.target_ketepatan, totalToko }) : null), [d, klien.target_ketepatan, totalToko])

  const cetak = () => {
    const judul = document.title
    document.title = `Laporan Performance ${klien.nama} ${namaBulan(bulan)}`
    window.print()
    document.title = judul
  }

  const slide = L && L.a.hari > 0 ? buatSlide(L, { klien, dari, sampai, pd, ps, anda }) : []
  return createPortal(
    <div className="lap-overlay" role="dialog" aria-label="Laporan bulanan">
      <div className="lap-bar">
        <button className="lap-btn lap-sekunder" onClick={onTutup}>← Kembali</button>
        <b>Laporan bulanan</b>
        <select className="lap-pilih" value={bulan} onChange={(e) => setBulan(e.target.value)} aria-label="Bulan laporan">
          {bulanAda.map((b) => <option key={b} value={b}>{namaBulan(b)}</option>)}
        </select>
        <span className="lap-ket">Di dialog cetak pilih "Simpan sebagai PDF"; satu slide satu halaman.</span>
        <button className="lap-btn" onClick={cetak} disabled={!slide.length}>Cetak / Simpan PDF</button>
      </div>
      {!d ? <div className="lap-pesan">Menyusun laporan…</div>
        : d.err ? <div className="lap-pesan">Laporan belum bisa disusun: {d.err}</div>
        : !slide.length ? <div className="lap-pesan">Tidak ada data pada {namaBulan(bulan)}. Pilih bulan lain.</div>
        : (
          <div className="lap-daftar">
            {slide.map((s, i) => (
              <div key={i} className="lap-sw" style={{ zoom: z }}>
                <section className={`lap-slide ${s.gelap ? 'lap-gelap ' : ''}${s.kelas ?? ''}`}>
                  <div className="lap-merek"><i className="lap-logo" aria-hidden />{klien.logo && <><span className="lap-x" aria-hidden>×</span><img className="lap-logo-klien" src={klien.logo} alt={`Logo ${klien.nama}`} /></>}</div>
                  {s.node}
                  <div className="lap-foot lap-mono"><span>Dash Electric · Laporan Performance · {klien.nama}</span><span>{String(i + 1).padStart(2, '0')} / {String(slide.length).padStart(2, '0')}</span></div>
                </section>
              </div>
            ))}
          </div>
        )}
    </div>,
    document.body,
  )
}

type Konteks = { klien: Klien; dari: string; sampai: string; pd: string; ps: string; anda: boolean }
type Isi = { node: ReactNode; gelap?: boolean; kelas?: string }

function buatSlide(L: Laporan, c: Konteks): Isi[] {
  const { a } = L
  const target = c.klien.target_ketepatan
  const periode = teksRentang(c.dari, c.sampai)
  const lalu = teksRentang(c.pd, c.ps)
  const sumber = c.anda ? 'Data Anda' : 'Data klien'
  const banding = (v: number | null, satuan: string) => v === null || !L.b ? 'Belum ada bulan pembanding' : Math.abs(v) < 0.05 ? `Sama dengan ${lalu}` : `${v > 0 ? 'Naik' : 'Turun'} ${koma(Math.abs(v))}${satuan} dibanding ${lalu}`

  const kpi: { k: string; v: string; s: string; dari: string; bad?: boolean }[] = [
    { k: 'Pesanan selesai', v: teksAngka(a.selesai), s: banding(L.ubahSelesai, '%'), dari: sumber },
    { k: 'Ketepatan antar', v: teksPct(L.kete), s: [banding(poin(L.kete, L.keteLalu), ' poin'), target !== null && L.kete !== null ? `${L.kete >= target ? 'Mencapai' : 'Di bawah'} target ${teksTarget(target)}` : ''].filter(Boolean).join('. '), dari: sumber, bad: target !== null && L.kete !== null && L.kete < target },
    { k: 'Pesanan terlambat', v: teksAngka(a.late), s: `${teksPct(a.selesai ? (a.late * 100) / a.selesai : null)} dari pesanan selesai`, dari: sumber },
    { k: 'POD sesuai', v: teksPct(L.pod), s: banding(poin(L.pod, L.podLalu), ' poin'), dari: sumber },
    { k: 'Pesanan per rider per hari', v: teksDesimal(L.perRider), s: banding(poin(L.perRider, L.perRiderLalu), ''), dari: sumber },
    target !== null && L.tokoDiBawah !== null
      ? { k: 'Toko di bawah target', v: `${L.tokoDiBawah} dari ${L.tokoBerdata}`, s: `Ketepatan antar kurang dari ${teksTarget(target)}`, dari: sumber }
      : { k: 'Toko berdata', v: `${L.tokoBerdata} dari ${L.totalToko}`, s: 'Toko yang punya data pada bulan ini', dari: sumber },
  ]
  if (L.bo.ada) {
    kpi.push({ k: 'Fulfillment rider', v: teksPct(L.bo.fulf), s: `${teksAngka(L.bo.terpenuhi)} dari ${teksAngka(L.bo.kebutuhan)} rider yang dibutuhkan`, dari: 'Data Dash' })
    kpi.push({ k: 'Tepat waktu masuk', v: teksPct(L.bo.masuk), s: `${teksAngka(L.bo.tepat)} dari ${teksAngka(L.bo.hadir)} rider yang hadir`, dari: 'Data Dash' })
  }

  const rataHarian = a.hari ? a.selesai / a.hari : 0
  const puncak = L.harian.reduce((m, h) => (h.selesai > m.selesai ? h : m), L.harian[0])
  const bagianTerbesar = L.lainnya ? (L.terbesar.reduce((s, t) => s + t.selesai, 0) * 100) / a.selesai : null

  const s: Isi[] = []
  s.push({
    gelap: true, kelas: 'lap-cover', node: (
      <>
        <div className="lap-eyebrow lap-mono">{c.klien.nama} · Laporan Performance</div>
        <h1>{L.kete !== null ? <>Ketepatan antar <span className="lap-pur">{teksPct(L.kete)}.</span> POD sesuai <span className="lap-pur">{teksPct(L.pod)}.</span></> : 'Belum ada data pada periode ini.'}</h1>
        <div className="lap-meta"><div className="lap-marka"><b>Dash Electric</b> · Laporan Performance</div><div className="lap-mono">{periode} · {L.tokoBerdata} toko · {teksAngka(a.selesai)} pesanan</div></div>
      </>
    ),
  })
  s.push({
    node: (
      <>
        <div className="lap-eyebrow lap-mono">Ringkasan · {periode}</div>
        <h1>{teksAngka(a.selesai)} pesanan selesai, {L.kete !== null ? `${teksPct(L.kete)} tepat waktu` : 'belum ada data ketepatan'}.</h1>
        <div className={`lap-grid ${kpi.length > 6 ? 'k4' : 'k3'}`}>
          {kpi.map((x) => (
            <div key={x.k} className="lap-kpi">
              <span className="lap-k">{x.k}</span>
              <span className={`lap-v ${x.bad ? 'lap-bad' : ''}`}>{x.v}</span>
              <span className="lap-s">{x.s}</span>
              <span className="lap-sumber lap-mono">{x.dari}</span>
            </div>
          ))}
        </div>
      </>
    ),
  })
  s.push({
    node: (
      <>
        <div className="lap-eyebrow lap-mono">Ketepatan antar · per hari</div>
        <h1>{target !== null && L.hariDiAtas !== null
          ? <>Ketepatan antar mencapai target {teksTarget(target)} pada <span className="lap-pur">{L.hariDiAtas} dari {a.hari}</span> hari.</>
          : L.hariTerendah && L.hariTertinggi ? <>Ketepatan antar harian berkisar {teksPct(L.hariTerendah.kete)} sampai {teksPct(L.hariTertinggi.kete)}.</> : 'Ketepatan antar per hari.'}</h1>
        <div className="lap-chart"><GrafikTren h={L.harian} target={target} /></div>
        <div className="lap-stats">
          <div className="lap-stat"><div className="lap-sl lap-mono">Hari terendah</div><div className="lap-sv">{L.hariTerendah ? teksPct(L.hariTerendah.kete) : '–'}</div><div className="lap-sd">{L.hariTerendah ? tgPendek(L.hariTerendah.tanggal) : ''}</div></div>
          <div className="lap-stat"><div className="lap-sl lap-mono">Hari tertinggi</div><div className="lap-sv">{L.hariTertinggi ? teksPct(L.hariTertinggi.kete) : '–'}</div><div className="lap-sd">{L.hariTertinggi ? tgPendek(L.hariTertinggi.tanggal) : ''}</div></div>
          <div className="lap-stat"><div className="lap-sl lap-mono">Pesanan terlambat</div><div className="lap-sv">{teksAngka(a.late)}</div><div className="lap-sd">{teksPct(a.selesai ? (a.late * 100) / a.selesai : null)} dari pesanan selesai</div></div>
        </div>
        <div className="lap-catatan">Periode: {periode}. Hari tanpa unggahan tidak ditampilkan dan tidak dihitung sebagai 0%.</div>
      </>
    ),
  })
  s.push({
    node: (
      <>
        <div className="lap-eyebrow lap-mono">Volume · per hari</div>
        <h1>Rata-rata <span className="lap-pur">{teksAngka(rataHarian)}</span> pesanan selesai per hari, tertinggi {teksAngka(puncak.selesai)} pada {tgPendek(puncak.tanggal)}.</h1>
        <div className="lap-chart"><GrafikVolume h={L.harian} /></div>
        <div className="lap-catatan">Periode: {periode}. Jumlah toko yang melapor bisa berbeda tiap hari ({L.tokoLengkap} dari {L.tokoBerdata} toko berdata penuh {a.hari} hari), jadi naik-turun volume sebagian mengikuti cakupan toko.</div>
      </>
    ),
  })
  s.push({
    node: (
      <>
        <div className="lap-eyebrow lap-mono">Komposisi</div>
        <h1>{L.pod !== null && L.kete !== null && L.pod < L.kete ? 'Ketepatan antar lebih baik daripada bukti serah terima.' : 'Komposisi pesanan bulan ini.'}</h1>
        <div className="lap-2k">
          <div>
            <h2 className="lap-mono">Pesanan</h2>
            <Prop judul="Ketepatan antar" a={a.ontime} b={a.late} namaA="Ontime" namaB="Late" />
            <Prop judul="Bukti serah terima (POD)" a={a.podSesuai} b={a.podTidak} namaA="Sesuai" namaB="Tidak sesuai" />
          </div>
          {L.bo.ada && (
            <div>
              <h2 className="lap-mono">Rider · Data Dash</h2>
              <Prop judul="Fulfillment rider" a={L.bo.terpenuhi} b={Math.max(0, L.bo.kebutuhan - L.bo.terpenuhi)} namaA="Terpenuhi" namaB="Belum terpenuhi" />
              <Prop judul="Tepat waktu masuk" a={L.bo.tepat} b={Math.max(0, L.bo.hadir - L.bo.tepat)} namaA="Tepat waktu" namaB="Terlambat" />
            </div>
          )}
        </div>
        <div className="lap-catatan">Periode: {periode}.</div>
      </>
    ),
  })
  if (L.terendah.length) {
    s.push({
      node: (
        <>
          <div className="lap-eyebrow lap-mono">Toko · ketepatan antar terendah</div>
          <h1>{target !== null && L.tokoDiBawah !== null
            ? L.tokoDiBawah === 0 ? `Semua ${L.tokoBerdata} toko mencapai target ketepatan antar.` : `${L.tokoDiBawah} dari ${L.tokoBerdata} toko di bawah target ketepatan antar.`
            : 'Toko dengan ketepatan antar terendah.'}</h1>
          <TabelToko rows={L.terendah} target={target} />
          <div className="lap-catatan">Periode: {periode}. Toko dengan kurang dari 50 pesanan tidak diperingkat karena persentasenya terlalu goyah.</div>
        </>
      ),
    })
  }
  s.push({
    node: (
      <>
        <div className="lap-eyebrow lap-mono">Toko · pesanan terbanyak</div>
        <h1>{bagianTerbesar !== null ? <>Delapan toko terbesar menyumbang <span className="lap-pur">{teksPct(bagianTerbesar).replace(',0%', '%')}</span> dari seluruh pesanan.</> : 'Pesanan per toko.'}</h1>
        <TabelToko rows={L.lainnya ? [...L.terbesar, L.lainnya] : L.terbesar} target={target} />
        <div className="lap-catatan">Periode: {periode}.{L.lainnya ? ' Toko lainnya digabung; angkanya dihitung dari totalnya.' : ''}</div>
      </>
    ),
  })
  if (L.catatan.length) {
    s.push({
      node: (
        <>
          <div className="lap-eyebrow lap-mono">Catatan</div>
          <h1>Yang perlu diperhatikan bulan ini.</h1>
          <div className="lap-list">
            {L.catatan.map((t, i) => <div key={i} className="lap-li lap-teks"><span className="lap-no">{String(i + 1).padStart(2, '0')}</span><span>{t}</span></div>)}
          </div>
        </>
      ),
    })
  }
  const def: [string, string][] = [
    ['Ketepatan antar = pesanan ontime ÷ pesanan selesai.', 'Dihitung dari seluruh toko dan hari yang punya data, bukan rata-rata persentase tiap toko.'],
    ['POD sesuai = bukti serah terima yang sesuai ÷ pesanan selesai.', 'POD tidak sesuai berarti bukti serah terima belum memenuhi ketentuan.'],
    ['Pesanan per rider per hari = pesanan selesai ÷ jumlah hari kerja rider.', 'Satu rider yang bekerja satu hari dihitung satu hari kerja.'],
    ['Hari tanpa data tidak dihitung sebagai 0%.', 'Rata-rata hanya memakai hari yang ada datanya, supaya toko yang tidak melapor tidak menurunkan angka.'],
  ]
  if (L.bo.ada) def.push(['Fulfillment rider = rider yang bekerja ÷ rider yang dibutuhkan; tepat waktu masuk = rider yang masuk tepat waktu ÷ rider yang hadir.', 'Data Dash: dicatat dari kehadiran rider, bukan dari file klien.'])
  s.push({
    node: (
      <>
        <div className="lap-eyebrow lap-mono">Definisi</div>
        <h1>Cara membaca angka di laporan ini.</h1>
        <div className="lap-list">
          {def.map(([j, p], i) => <div key={i} className="lap-li" style={{ padding: '12px 0' }}><span className="lap-no">{String(i + 1).padStart(2, '0')}</span><div><h3 style={{ fontSize: 16 }}>{j}</h3><p>{p}</p></div></div>)}
        </div>
      </>
    ),
  })
  return s
}

const WL = 1120
function GrafikTren({ h, target }: { h: Laporan['harian']; target: number | null }) {
  const n = h.length, L = 56, top = 24, base = 236
  const vs = h.map((x) => x.kete).filter((v): v is number => v !== null)
  const lo = Math.floor((Math.min(...vs, target ?? 100) - 1) / 2) * 2, hi = 100
  const lebar = (WL - L) / n
  const x = (i: number) => L + (i + 0.5) * lebar
  const y = (v: number) => top + (base - top) * (1 - (v - lo) / (hi - lo))
  const titik = h.map((p, i) => ({ ...p, i })).filter((p): p is { tanggal: string; selesai: number; kete: number; i: number } => p.kete !== null)
  const tick = [0, 1, 2, 3, 4].map((k) => lo + ((hi - lo) * k) / 4)
  return (
    <svg viewBox={`0 0 ${WL} 290`} role="figure" aria-label="Ketepatan antar per hari">
      {tick.map((v) => <g key={v}><line x1={L} x2={WL} y1={y(v)} y2={y(v)} stroke="#e4e3de" /><text className="lap-ax" x={L - 10} y={y(v) + 4} textAnchor="end">{koma(v, Number.isInteger(v) ? 0 : 1)}%</text></g>)}
      <line x1={L} x2={WL} y1={base} y2={base} stroke="#1a1a1a" strokeWidth="1.5" />
      {target !== null && <line x1={L} x2={WL} y1={y(target)} y2={y(target)} stroke="#9a9a96" strokeWidth="1.6" strokeDasharray="6 5" />}
      <polyline points={titik.map((p) => `${x(p.i)},${y(p.kete)}`).join(' ')} fill="none" stroke="#5e2aac" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      {titik.map((p) => <circle key={p.tanggal} cx={x(p.i)} cy={y(p.kete)} r={n > 24 ? 3 : 4.5} fill="#5e2aac" />)}
      {n <= 24 && titik.map((p) => <text key={p.tanggal} className="lap-val" x={x(p.i)} y={y(p.kete) - 11}>{koma(p.kete)}</text>)}
      {h.map((p, i) => <g key={p.tanggal}><text className="lap-axd" x={x(i)} y={base + 20} textAnchor="middle">{Number(p.tanggal.slice(8))}</text>{n <= 16 && <text className="lap-ax" x={x(i)} y={base + 36} textAnchor="middle">{hrPendek(p.tanggal)}</text>}</g>)}
      <g transform={`translate(${WL - 330},8)`}>
        <line x1="0" x2="26" y1="0" y2="0" stroke="#5e2aac" strokeWidth="3" /><text className="lap-ann" x="34" y="4">Ketepatan antar</text>
        {target !== null && <><line x1="170" x2="196" y1="0" y2="0" stroke="#9a9a96" strokeWidth="1.6" strokeDasharray="6 5" /><text className="lap-ann" x="204" y="4" style={{ fill: '#6b6b68' }}>Target {teksTarget(target)}</text></>}
      </g>
    </svg>
  )
}

function GrafikVolume({ h }: { h: Laporan['harian'] }) {
  const n = h.length, L = 56, base = 236, tinggi = 190
  const maks = Math.max(...h.map((p) => p.selesai), 1)
  const lebar = (WL - L) / n, bw = Math.min(40, lebar * 0.62)
  const x = (i: number) => L + (i + 0.5) * lebar
  return (
    <svg viewBox={`0 0 ${WL} 290`} role="figure" aria-label="Pesanan selesai per hari">
      {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={WL} y1={base - tinggi * f} y2={base - tinggi * f} stroke="#e4e3de" /><text className="lap-ax" x={L - 10} y={base - tinggi * f + 4} textAnchor="end">{teksAngka(maks * f)}</text></g>)}
      {h.map((p, i) => { const t = (p.selesai / maks) * tinggi; return <rect key={p.tanggal} x={x(i) - bw / 2} y={base - t} width={bw} height={t} fill="#5e2aac" /> })}
      {n <= 24 && h.map((p, i) => <text key={p.tanggal} className="lap-val" x={x(i)} y={base - (p.selesai / maks) * tinggi - 7}>{teksAngka(p.selesai)}</text>)}
      <line x1={L} x2={WL} y1={base} y2={base} stroke="#1a1a1a" strokeWidth="1.5" />
      {h.map((p, i) => <g key={p.tanggal}><text className="lap-axd" x={x(i)} y={base + 20} textAnchor="middle">{Number(p.tanggal.slice(8))}</text>{n <= 16 && <text className="lap-ax" x={x(i)} y={base + 36} textAnchor="middle">{hrPendek(p.tanggal)}</text>}</g>)}
    </svg>
  )
}

function Prop({ judul, a, b, namaA, namaB }: { judul: string; a: number; b: number; namaA: string; namaB: string }) {
  const total = a + b
  const pa = total ? (a * 100) / total : 0
  return (
    <div className="lap-prop">
      <div className="lap-ph"><span>{judul}</span><span className="lap-pur">{total ? `${koma(pa)}%` : '–'}</span></div>
      <div className="lap-pb"><div className="lap-pa" style={{ width: `${pa}%` }} /><div className="lap-pc" style={{ width: `${total ? 100 - pa : 0}%` }} /></div>
      <div className="lap-pk lap-mono"><span>{namaA} {teksAngka(a)}</span><span>{namaB} {teksAngka(b)}</span></div>
    </div>
  )
}

function TabelToko({ rows, target }: { rows: TokoLap[]; target: number | null }) {
  return (
    <div className="lap-tbl">
      <div className="lap-tr lap-th"><div>Toko</div><div>Hari data</div><div>Pesanan</div><div>Ketepatan antar</div><div>Late</div><div>POD sesuai</div></div>
      {rows.map((t) => (
        <div key={t.nama} className="lap-tr">
          <div className="lap-n">{t.nama}{t.kode && <span>{t.kode}</span>}</div>
          <div>{t.hari || '–'}</div>
          <div>{teksAngka(t.selesai)}</div>
          <div className={target !== null && t.kete !== null && t.kete < target ? 'lap-bad' : ''}>{teksPct(t.kete)}</div>
          <div>{teksAngka(t.late)}</div>
          <div>{teksPct(t.pod)}</div>
        </div>
      ))}
    </div>
  )
}
