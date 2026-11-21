// Edge function: rider melaporkan order harian (jumlah + screenshot) dan melihat laporannya sendiri.
// Rider login memakai Kode MTR tanpa akun Supabase, jadi Kode MTR diperiksa di sini lalu tabel laporan_order dan bucket order-ss ditulis dengan
// service role (kunci itu hanya ada di server). Deploy: npx supabase functions deploy laporan-order-rider
// Aksi (multipart/form-data atau JSON):
//   ambil  : kode                                  -> laporan 8 hari terakhir milik rider itu, beserta tautan foto sementara
//   simpan : kode, tanggal, jumlah, catatan, simpan (JSON daftar alamat foto lama yang dipertahankan), foto (berkas baru, boleh banyak)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cekBerkas, cekIsi, cekTanggal, fotoMilik, geserHari, hariIniWib, HARI_MUNDUR, pathFoto } from './validasi.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const tidur = (ms: number) => new Promise((r) => setTimeout(r, ms))
const BUCKET = 'order-ss'

type Baris = { tanggal: string; jumlah_order: number; catatan: string | null; foto: string[]; diubah: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Gunakan POST' }, 405)

  // masukan: multipart (simpan, ada berkas) atau JSON (ambil)
  let kolom: Record<string, unknown> = {}
  let berkas: File[] = []
  if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    const f = await req.formData().catch(() => null)
    if (!f) return json({ error: 'Data tidak terbaca' }, 400)
    for (const [k, v] of f.entries()) if (typeof v === 'string') kolom[k] = v
    berkas = f.getAll('foto').filter((x): x is File => x instanceof File)
  } else {
    kolom = await req.json().catch(() => ({}))
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const kode = String(kolom.kode ?? '').trim().toUpperCase()
  const { data: rider } = kode
    ? await admin.from('riders').select('id,nama,ds_id,status').eq('kode_mtr', kode).eq('status', 'aktif').maybeSingle()
    : { data: null }
  if (!rider) {
    await tidur(700) // memperlambat tebak-tebakan Kode MTR
    return json({ error: 'Kode MTR tidak ditemukan atau rider tidak aktif' }, 401)
  }
  const hariIni = hariIniWib()

  // laporan beserta tautan foto sementara (1 jam)
  const muat = async (baris: Baris[]) => {
    const semua = baris.flatMap((b) => b.foto)
    const url: Record<string, string> = {}
    if (semua.length) {
      const { data } = await admin.storage.from(BUCKET).createSignedUrls(semua, 3600)
      for (const d of data ?? []) if (d.path && d.signedUrl) url[d.path] = d.signedUrl
    }
    return baris.map((b) => ({ ...b, foto: b.foto.map((p) => ({ path: p, url: url[p] ?? null })) }))
  }
  const ambil = async (dari: string) => {
    const { data } = await admin.from('laporan_order').select('tanggal,jumlah_order,catatan,foto,diubah').eq('rider_id', rider.id).gte('tanggal', dari).order('tanggal', { ascending: false })
    return muat((data ?? []) as Baris[])
  }
  const { data: ds } = rider.ds_id ? await admin.from('ds').select('nama').eq('id', rider.ds_id).maybeSingle() : { data: null }
  const profil = { nama: rider.nama, ds_nama: ds?.nama ?? null }

  if (kolom.aksi === 'ambil') {
    return json({ rider: profil, hari_ini: hariIni, laporan: await ambil(geserHari(hariIni, -HARI_MUNDUR)) })
  }

  if (kolom.aksi === 'simpan') {
    const tanggal = kolom.tanggal
    const salahTanggal = cekTanggal(tanggal, hariIni)
    if (salahTanggal) return json({ error: salahTanggal }, 400)
    const tgl = tanggal as string
    if (!rider.ds_id) return json({ error: 'Anda belum masuk DS mana pun. Hubungi Captain.' }, 400)

    const jumlah = typeof kolom.jumlah === 'string' && kolom.jumlah.trim() !== '' ? Number(kolom.jumlah) : kolom.jumlah
    const catatan = typeof kolom.catatan === 'string' && kolom.catatan.trim() ? kolom.catatan.trim() : null
    let simpan: unknown = []
    try { simpan = typeof kolom.simpan === 'string' ? JSON.parse(kolom.simpan) : kolom.simpan ?? [] } catch { return json({ error: 'Daftar foto tidak valid' }, 400) }
    const { data: lama } = await admin.from('laporan_order').select('foto').eq('rider_id', rider.id).eq('tanggal', tgl).maybeSingle()
    const ada: string[] = lama?.foto ?? []
    // hanya foto milik rider ini di tanggal ini yang sudah tersimpan di laporannya yang boleh dipertahankan
    const tahan = (Array.isArray(simpan) ? simpan : []).filter((p): p is string => fotoMilik(p, rider.id, tgl) && ada.includes(p as string))

    const salahIsi = cekIsi(jumlah, catatan, tahan.length + berkas.length)
    if (salahIsi) return json({ error: salahIsi }, 400)
    for (const f of berkas) {
      const salah = cekBerkas(f)
      if (salah) return json({ error: salah }, 400)
    }

    // unggah foto baru, kalau ada yang gagal batalkan yang sudah terunggah supaya tidak ada berkas yatim
    const baru: string[] = []
    for (const f of berkas) {
      const path = pathFoto(rider.id, tgl, crypto.randomUUID())
      const { error } = await admin.storage.from(BUCKET).upload(path, f, { contentType: f.type })
      if (error) {
        if (baru.length) await admin.storage.from(BUCKET).remove(baru)
        return json({ error: `Foto gagal diunggah: ${error.message}` }, 500)
      }
      baru.push(path)
    }
    const { error } = await admin.from('laporan_order').upsert(
      { tanggal: tgl, rider_id: rider.id, ds_id: rider.ds_id, jumlah_order: jumlah, catatan, foto: [...tahan, ...baru], diubah: new Date().toISOString() },
      { onConflict: 'tanggal,rider_id' },
    )
    if (error) {
      if (baru.length) await admin.storage.from(BUCKET).remove(baru)
      return json({ error: error.message }, 500)
    }
    const dibuang = ada.filter((p) => !tahan.includes(p))
    if (dibuang.length) await admin.storage.from(BUCKET).remove(dibuang) // foto yang dihapus rider dari laporannya
    return json({ ok: true, rider: profil, laporan: await ambil(tgl) })
  }

  return json({ error: 'aksi harus ambil atau simpan' }, 400)
})
