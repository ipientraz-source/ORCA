// Pembaca .xlsx minimal untuk dijalankan di browser, tanpa pustaka tambahan: .xlsx = zip berisi XML, dibuka dengan DecompressionStream bawaan browser.
// Hanya membaca nilai sel (teks, angka, string bersama); rumus, gaya, dan sheet lain diabaikan. Murni (tanpa React), jadi bisa diuji di Node.
// Berkas klien dibaca seluruhnya di browser pengguna dan TIDAK PERNAH dikirim ke server; yang dikirim hanya kolom yang dibutuhkan (lihat data-klien.ts).

const u16 = (d: DataView, o: number) => d.getUint16(o, true)
const u32 = (d: DataView, o: number) => d.getUint32(o, true)

async function buka(data: Uint8Array, metode: number): Promise<Uint8Array> {
  if (metode === 0) return data
  if (metode !== 8) throw new Error('Berkas Excel memakai kompresi yang tidak didukung')
  const hasil = await new Response(new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()
  return new Uint8Array(hasil)
}

// Daftar entri zip (nama → posisi data) lewat central directory di ujung berkas
function daftarZip(buf: Uint8Array): Map<string, { metode: number; ukuran: number; mulai: number }> {
  const d = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (u32(d, i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('Bukan berkas .xlsx yang valid (zip tidak terbaca)')
  const jumlah = u16(d, eocd + 10)
  let p = u32(d, eocd + 16)
  const out = new Map<string, { metode: number; ukuran: number; mulai: number }>()
  for (let i = 0; i < jumlah; i++) {
    if (u32(d, p) !== 0x02014b50) throw new Error('Berkas .xlsx rusak (daftar isi zip)')
    const metode = u16(d, p + 10), ukuran = u32(d, p + 20), nama = u16(d, p + 28), extra = u16(d, p + 30), kom = u16(d, p + 32), lokal = u32(d, p + 42)
    const namaTeks = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nama))
    out.set(namaTeks, { metode, ukuran, mulai: lokal })
    p += 46 + nama + extra + kom
  }
  return out
}

async function teksDari(buf: Uint8Array, zip: ReturnType<typeof daftarZip>, nama: string): Promise<string | null> {
  const e = zip.get(nama)
  if (!e) return null
  const d = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (u32(d, e.mulai) !== 0x04034b50) throw new Error('Berkas .xlsx rusak (kepala entri zip)')
  const awal = e.mulai + 30 + u16(d, e.mulai + 26) + u16(d, e.mulai + 28)
  return new TextDecoder().decode(await buka(buf.subarray(awal, awal + e.ukuran), e.metode))
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const dekode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, k: string) => (k[0] === '#' ? String.fromCodePoint(k[1].toLowerCase() === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)) : (ENT[k] ?? m)))
const teksDalam = (xml: string) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => dekode(m[1])).join('')
const atribut = (tag: string, nama: string) => tag.match(new RegExp(`\\b${nama}="([^"]*)"`))?.[1] ?? ''
const kolomKe = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1

// Baca satu sheet (bernama `sheet`, tanpa memperhatikan huruf besar-kecil; bila tidak ada, sheet pertama) menjadi tabel teks.
// Angka dikembalikan apa adanya sebagai teks (tanggal Excel = nomor seri, diterjemahkan oleh pemanggil). Hanya `maxKolom` kolom pertama dibaca.
export async function bacaXlsx(isi: ArrayBuffer, o: { sheet?: string; maxKolom?: number } = {}): Promise<string[][]> {
  const buf = new Uint8Array(isi)
  const zip = daftarZip(buf)
  const wb = await teksDari(buf, zip, 'xl/workbook.xml')
  if (!wb) throw new Error('Bukan berkas Excel (.xlsx). Simpan ulang sebagai .xlsx atau .csv')
  const rel = new Map([...((await teksDari(buf, zip, 'xl/_rels/workbook.xml.rels')) ?? '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [atribut(m[0], 'Id'), atribut(m[0], 'Target')]))
  const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ nama: dekode(atribut(m[0], 'name')), rid: atribut(m[0], 'r:id') }))
  const pilih = sheets.find((s) => o.sheet && s.nama.trim().toLowerCase() === o.sheet.toLowerCase()) ?? sheets[0]
  if (!pilih) throw new Error('Berkas Excel tidak punya sheet')
  const target = (rel.get(pilih.rid) ?? '').replace(/^\//, '')
  const xml = await teksDari(buf, zip, target.startsWith('xl/') ? target : `xl/${target}`)
  if (!xml) throw new Error(`Sheet "${pilih.nama}" tidak terbaca`)
  const bersama = [...((await teksDari(buf, zip, 'xl/sharedStrings.xml')) ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => teksDalam(m[1]))

  const maks = o.maxKolom ?? 64
  const hasil: string[][] = []
  for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const nomor = parseInt(atribut(r[1], 'r'), 10) || hasil.length + 1
    const baris: string[] = []
    for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const k = kolomKe(atribut(c[1], 'r'))
      if (k < 0 || k >= maks) continue
      const jenis = atribut(c[1], 't'), isi = c[2] ?? ''
      let nilai = ''
      if (jenis === 's') nilai = bersama[parseInt(isi.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '', 10)] ?? ''
      else if (jenis === 'inlineStr') nilai = teksDalam(isi)
      else nilai = dekode(isi.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '')
      while (baris.length < k) baris.push('')
      baris[k] = nilai
    }
    while (hasil.length < nomor - 1) hasil.push([])
    hasil[nomor - 1] = baris
  }
  return hasil
}
