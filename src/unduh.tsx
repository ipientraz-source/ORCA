// Unduh jadwal sebagai gambar (PNG) atau PDF.
// Semuanya dibuat di browser lalu langsung diunduh: tidak ada yang diunggah atau disimpan di database.
import { useEffect, useRef } from 'react'
import { Lock } from 'lucide-react'

export type DataCetak = {
  judul: string
  days: string[]
  riders: { id: string; nama: string; kode_mtr: string | null }[]
  g: Record<string, string> // "riderId|tanggal" -> pagi | tengah | siang | off (libur terkunci)
  kuota: Record<string, { pagi: number; siang: number; tengah?: number; cadangan: number }> // kebutuhan client per tanggal
}

const NAMA_HARI = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const namaHari = (d: string) => NAMA_HARI[(new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7]
const bulanDi = (d: string) => NAMA_BULAN[+d.slice(5, 7) - 1]
const tanggalPanjang = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const potong = <T,>(l: T[], n: number) => (l.length ? Array.from({ length: Math.ceil(l.length / n) }, (_, i) => l.slice(i * n, (i + 1) * n)) : [[] as T[]])

// Hijau = pas, kuning = kurang; kelebihan: biru bila masih dalam jatah cadangan, merah bila melebihi
const warnaKuota = (n: number, q: number, lebihTotal: number, cad: number) => (n === q ? 'text-success' : n < q ? 'text-warning' : lebihTotal <= cad ? 'text-primary' : 'text-danger')

const TEPI_PAGI = '0 2px 0 #d97706'
const TEPI_SIANG = '0 2px 0 var(--purple-800)'
const TEPI_TENGAH = '0 2px 0 #0f9488'

function Sel({ v, padat }: { v: string; padat: boolean }) {
  if (!v) return padat ? <span className="text-muted-foreground/40">·</span> : <span className="text-xs font-medium text-muted-foreground/60">Off</span>
  if (v === 'off')
    return padat ? (
      <span className="inline-flex size-6 items-center justify-center rounded-md bg-muted text-[10px] font-bold text-muted-foreground">O</span>
    ) : (
      <span className="inline-flex w-[4.5rem] items-center justify-center gap-1 rounded-lg border border-border bg-muted px-2 py-1.5 text-xs font-bold text-foreground/70"><Lock size={11} />Off</span>
    )
  const pagi = v === 'pagi'
  const tengah = v === 'tengah'
  const warna = pagi ? 'bg-[var(--amber-400)] text-[#451a03]' : tengah ? 'bg-[#38e8d8] text-[#04332f]' : 'bg-primary text-primary-foreground'
  const tepi = pagi ? TEPI_PAGI : tengah ? TEPI_TENGAH : TEPI_SIANG
  if (padat) return <span style={{ boxShadow: tepi }} className={`inline-flex size-6 items-center justify-center rounded-md text-[11px] font-bold ${warna}`}>{pagi ? 'P' : tengah ? 'M' : 'S'}</span>
  return (
    <span style={{ boxShadow: tepi }} className={`inline-block w-[4.5rem] rounded-lg px-2 py-1.5 text-xs font-bold ${warna}`}>
      {pagi ? 'Pagi' : tengah ? 'Middle' : 'Siang'}
    </span>
  )
}

export function Cetak({ data, mode, onSelesai }: { data: DataCetak; mode: 'png' | 'pdf'; onSelesai: (galat?: string) => void }) {
  const { days, riders, g } = data
  const akar = useRef<HTMLDivElement>(null)
  const padat = days.length > 10 // periode panjang: sel ringkas (huruf P / S)
  const lebarSel = padat ? 30 : 84
  const lebar = Math.max(1000, 56 + 330 + 84 + days.length * lebarSel)
  const tinggiPdf = Math.round((lebar * 210) / 297) // rasio A4 landscape
  const barisH = padat ? 42 : 52 // dua baris: nama + kode MTR (tidak dipotong)
  const sisa = tinggiPdf - 150 - (padat ? 92 : 70) - 78 - 40 - 56
  const perHalaman = Math.max(4, Math.floor(sisa / barisH))
  const halaman = mode === 'pdf' ? potong(riders, perHalaman) : [riders] // PNG: satu gambar utuh; PDF: dibagi per halaman
  const awal = days[0]
  const akhir = days[days.length - 1]
  const dicetak = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'short' })
  const hitung = (d: string, s: string) => riders.filter((r) => g[`${r.id}|${d}`] === s).length

  useEffect(() => {
    let batal = false
    ;(async () => {
      try {
        // library berat dimuat hanya saat tombol unduh diklik, supaya tidak membebani halaman utama
        const [{ toJpeg, toPng }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')])
        const lembar = [...(akar.current?.querySelectorAll<HTMLElement>('[data-lembar]') ?? [])]
        const gambar: string[] = []
        const opsi = { pixelRatio: 2, backgroundColor: '#ffffff', skipFonts: true, cacheBust: true }
        // PDF memakai JPEG: jsPDF memasukkannya apa adanya (cepat, berkas kecil); PNG harus dikompres ulang dan lambat
        for (const n of lembar) gambar.push(mode === 'pdf' ? await toJpeg(n, { ...opsi, quality: 0.92 }) : await toPng(n, opsi))
        if (batal) return
        const nama = `${slug(data.judul)}_${awal}_${akhir}`
        if (mode === 'png') {
          const a = document.createElement('a')
          a.href = gambar[0]
          a.download = nama + '.png'
          a.click()
        } else {
          const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
          gambar.forEach((url, i) => {
            if (i) pdf.addPage()
            pdf.addImage(url, 'JPEG', 0, 0, 297, 210)
          })
          pdf.save(nama + '.pdf')
        }
        onSelesai()
      } catch (e) {
        onSelesai((e as Error).message)
      }
    })()
    return () => {
      batal = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nPagi = riders.reduce((n, r) => n + days.filter((d) => g[`${r.id}|${d}`] === 'pagi').length, 0)
  const nSiang = riders.reduce((n, r) => n + days.filter((d) => g[`${r.id}|${d}`] === 'siang').length, 0)
  const nTengah = riders.reduce((n, r) => n + days.filter((d) => g[`${r.id}|${d}`] === 'tengah').length, 0)
  const adaTengah = nTengah > 0 || days.some((d) => (data.kuota[d]?.tengah ?? 0) > 0) // kolom/baris tengah hanya muncul bila dipakai
  const ringkas: [string, number][] = [['Rider', riders.length], ['Shift pagi', nPagi], ...(adaTengah ? [['Shift middle', nTengah] as [string, number]] : []), ['Shift siang', nSiang], ['Total shift', nPagi + nSiang + nTengah]]

  return (
    <div ref={akar} aria-hidden style={{ position: 'fixed', left: -100000, top: 0, pointerEvents: 'none' }}>
      {halaman.map((rows, hal) => (
        <div key={hal} data-lembar className="cetak flex flex-col" style={{ width: lebar, height: mode === 'pdf' ? tinggiPdf : undefined, padding: 28, boxSizing: 'border-box', background: '#f4f4f7' }}>
          <div className="flex items-center justify-between rounded-2xl px-6 py-5 text-white" style={{ background: 'linear-gradient(120deg, var(--purple-600), var(--purple-900))', height: 96, boxSizing: 'border-box' }}>
            <div>
              <div className="text-2xl font-extrabold leading-tight">{data.judul}</div>
              <div className="mt-1 text-sm text-white/80">
                Periode {tanggalPanjang(awal)} – {tanggalPanjang(akhir)} · {days.length} hari
              </div>
            </div>
            <div className="text-right">
              <div className="flex justify-end gap-2">
                {ringkas.map(([k, n]) => (
                  <div key={k} className="rounded-lg bg-white/15 px-3 py-1 text-center">
                    <div className="font-mono text-base font-bold leading-tight">{n}</div>
                    <div className="text-[10px] text-white/80">{k}</div>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 text-[11px] text-white/70">Dash ORCA · Dicetak {dicetak}{halaman.length > 1 ? ` · Hal. ${hal + 1}/${halaman.length}` : ''}</div>
            </div>
          </div>
          <div className="mb-3 mt-4 flex items-center gap-5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Sel v="pagi" padat={false} /> shift pagi</span>
            {adaTengah && <span className="flex items-center gap-1.5"><Sel v="tengah" padat={false} /> shift middle</span>}
            <span className="flex items-center gap-1.5"><Sel v="siang" padat={false} /> shift siang</span>
            <span className="flex items-center gap-1.5"><Sel v="off" padat={false} /> libur terkunci (cuti/izin)</span>
            <span className="flex items-center gap-1.5"><Sel v="" padat={false} /> libur</span>
          </div>

          <div className="overflow-hidden rounded-2xl border-2 border-[#aeb3c4] bg-card">
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }} className="text-sm">
            <colgroup>
              <col style={{ width: 330 }} />
              {days.map((d) => <col key={d} style={{ width: lebarSel }} />)}
              <col style={{ width: 84 }} />
            </colgroup>
            <thead>
              <tr className="bg-muted" style={{ borderBottom: '2px solid #aeb3c4' }}>
                <th className="py-2 pl-4 text-left font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Rider</th>
                {days.map((d, i) => {
                  const akhirPekan = ['Sab', 'Min'].includes(namaHari(d))
                  const tandaBulan = i === 0 || d.slice(8) === '01'
                  return (
                    <th key={d} className={`border-l border-[#c9ccd8] py-1.5 text-center ${akhirPekan ? 'bg-primary-soft' : ''}`}>
                      <div className="h-3 text-[9px] font-bold uppercase text-primary">{tandaBulan ? bulanDi(d) : ''}</div>
                      <div className={`font-mono font-semibold uppercase ${akhirPekan ? 'text-primary' : 'text-muted-foreground'} ${padat ? 'text-[9px]' : 'text-[10px]'}`}>{namaHari(d)}</div>
                      <div className={`font-bold ${padat ? 'text-xs' : 'text-base'}`}>{d.slice(8)}</div>
                    </th>
                  )
                })}
                <th className="border-l border-[#c9ccd8] py-2 text-center font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Hari kerja</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={`border-b border-[#c3c7d4] ${i % 2 ? 'bg-muted/60' : ''}`} style={{ height: barisH }}>
                  <td className="py-1 pl-4 pr-2">
                    <div className="flex items-center gap-2.5"><span className="inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[10px] font-bold text-muted-foreground">{hal * perHalaman + i + 1}</span>
                    <div className="leading-tight"><div className="font-semibold">{r.nama}</div><div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{r.kode_mtr}</div></div></div>
                  </td>
                  {days.map((d) => (
                    <td key={d} className={`border-l border-[#dcdfe8] text-center ${['Sab', 'Min'].includes(namaHari(d)) ? 'bg-primary-soft/60' : ''}`}>
                      <Sel v={g[`${r.id}|${d}`] ?? ''} padat={padat} />
                    </td>
                  ))}
                  <td className="border-l border-[#dcdfe8] text-center">
                    <span className="inline-block min-w-8 rounded-full bg-primary-soft px-2 py-0.5 font-mono text-xs font-bold text-primary-soft-foreground">{days.filter((d) => ['pagi', 'tengah', 'siang'].includes(g[`${r.id}|${d}`])).length}</span>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={days.length + 2} className="py-8 text-center text-muted-foreground">Belum ada rider aktif di DS ini.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-muted" style={{ borderTop: '2px solid #aeb3c4' }}>
                <td className="py-2 pl-4 text-xs font-semibold">
                  Terisi / kebutuhan client
                  <div className="text-[10px] font-normal text-muted-foreground">Kebutuhan bisa berbeda tiap hari; +cad = rider cadangan</div>
                </td>
                {days.map((d) => {
                  const p = hitung(d, 'pagi')
                  const s = hitung(d, 'siang')
                  const t = hitung(d, 'tengah')
                  const k = data.kuota[d] ?? { pagi: 0, siang: 0, cadangan: 0 }
                  const kt = k.tengah ?? 0
                  const lebih = Math.max(0, p - k.pagi) + Math.max(0, s - k.siang) + (adaTengah ? Math.max(0, t - kt) : 0)
                  return (
                    <td key={d} className="border-l border-[#dcdfe8] py-1.5 text-center font-mono text-[10px] font-semibold leading-snug">
                      <div className={warnaKuota(p, k.pagi, lebih, k.cadangan)}>{padat ? `P${p}` : `P ${p}/${k.pagi}`}</div>
                      {adaTengah && <div className={warnaKuota(t, kt, lebih, k.cadangan)}>{padat ? `M${t}` : `M ${t}/${kt}`}</div>}
                      <div className={warnaKuota(s, k.siang, lebih, k.cadangan)}>{padat ? `S${s}` : `S ${s}/${k.siang}`}</div>
                      {k.cadangan > 0 && !padat && <div className="text-[9px] font-normal text-muted-foreground">+{k.cadangan} cad</div>}
                    </td>
                  )
                })}
                <td />
              </tr>
            </tfoot>
          </table>
          </div>
          <div className="mt-auto pt-3 text-[10px] text-muted-foreground">Dibuat dengan Dash ORCA. Angka kuota: hijau berarti rider pas, kuning kurang, merah kelebihan.</div>
        </div>
      ))}
    </div>
  )
}
