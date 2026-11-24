// Sinkron kehadiran dari API backoffice Dash (BO) ke tabel kehadiran_bo. Dipanggil dua cara:
//   - tombol "Sinkron sekarang" di menu Kehadiran BO (Super-admin yang sedang login), mis. saat sinkron otomatis terputus
//   - jadwal otomatis (pg_cron) dengan header x-cron-secret = CRON_SECRET dan body {"otomatis":true}
// Token BO ada di secret BO_API_TOKEN (BO_PROVIDER_ID opsional, bawaan 446 = Alfagift). Yang dibawa hanya kode mitra, hub, jam masuk dan keluar, serta NAMA rider
// (dipakai menambah rider baru ke Orca, migrasi 0068). NIK, selfie, dan GPS dari BO tidak pernah dibawa keluar dari fungsi ini.
// Deploy: npx supabase functions deploy tarik-kehadiran-bo --no-verify-jwt
// Body JSON (semua opsional):
//   dari, sampai  YYYY-MM-DD menurut hari WIB; bawaan 3 hari ke belakang sampai hari ini (clock-out yang telat ikut terisi), maksimal 62 hari
//   peta          { "nama hub": "id DS" } memasangkan hub baru ke DS yang sudah ada; hub yang tidak dipetakan dibuatkan DS baru
//   otomatis      true: hub baru langsung dibuatkan DS (jadwal otomatis tidak bisa bertanya). Tanpa ini dan tanpa peta, hub baru ditanyakan dulu ({perlu_pasangan})
import { createClient } from 'npm:@supabase/supabase-js@2'

const BASE = 'https://api.dashelectric.co/v1/drivers/log-book/attendance/approval'
const UKURAN_HALAMAN = 200
const MAKS_HALAMAN = 250
const PEKERJA = 5
const ULANG = 3
const MAKS_HARI = 62
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const tidur = (ms: number) => new Promise((r) => setTimeout(r, ms))

function samaPersis(a: string, b: string) {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let beda = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) beda |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return beda === 0
}

const hariWib = (selisihHari = 0) => new Date(Date.now() + 7 * 3600e3 + selisihHari * 864e5).toISOString().slice(0, 10)
const norm = (h: string) => h.trim().replace(/\s+/g, ' ')

// Zona waktu hub dari BO (nama IANA, kode, atau selisih) menjadi WIB/WITA/WIT. Tidak dikenal = WIB, dan dihitung supaya terlihat di hasil.
const OFFSET = { WIB: 7, WITA: 8, WIT: 9 }
function bacaZona(tz: unknown): { zona: keyof typeof OFFSET; kenal: boolean } {
  const s = String(tz ?? '').trim()
  if (/^WIB$/i.test(s) || /Jakarta|Pontianak/i.test(s)) return { zona: 'WIB', kenal: true }
  if (/^WITA$/i.test(s) || /Makassar|Ujung_Pandang/i.test(s)) return { zona: 'WITA', kenal: true }
  if (/^WIT$/i.test(s) || /Jayapura/i.test(s)) return { zona: 'WIT', kenal: true }
  const m = /\+(\d{1,2})(?::?\d{2})?$/.exec(s)
  if (m && [7, 8, 9].includes(Number(m[1]))) return { zona: Number(m[1]) === 7 ? 'WIB' : Number(m[1]) === 8 ? 'WITA' : 'WIT', kenal: true }
  return { zona: 'WIB', kenal: false }
}

type Baris = { hub: string; kode_mtr: string; nama: string; tanggal: string; masuk_lokal: string; zona: string; masuk_wib: string; keluar_wib: string | null; sumber: 'api' }

// Satu baris BO -> baris kehadiran, atau null bila tidak lengkap. Waktu dibulatkan ke menit ke bawah, sama dengan data yang dulu diunggah dari CSV
// (jam clock-in yang sama tidak tercatat dua kali).
function ubah(x: Record<string, unknown>): { baris: Baris; zonaKenal: boolean } | null {
  const hub = typeof x.hubNames === 'string' ? norm(x.hubNames) : ''
  const kode = typeof x.driverCode === 'string' ? x.driverCode.trim().toUpperCase() : ''
  const masuk = Date.parse(String(x.clockInAt ?? ''))
  if (!hub || !kode || Number.isNaN(masuk)) return null
  const keluar = x.clockOutAt ? Date.parse(String(x.clockOutAt)) : NaN
  const { zona, kenal } = bacaZona(x.clockInAtPitstopTimezone)
  const menit = (t: number) => Math.floor(t / 60000) * 60000
  const lokal = new Date(menit(masuk) + OFFSET[zona] * 3600e3).toISOString()
  return {
    zonaKenal: kenal,
    baris: {
      hub, kode_mtr: kode, nama: typeof x.driverName === 'string' ? x.driverName.trim() : '', tanggal: lokal.slice(0, 10), masuk_lokal: lokal.slice(11, 16), zona,
      masuk_wib: new Date(menit(masuk)).toISOString(), keluar_wib: Number.isNaN(keluar) ? null : new Date(menit(keluar)).toISOString(), sumber: 'api',
    },
  }
}

// Galat yang tidak ada gunanya diulang (token salah, alamat salah)
class Tetap extends Error {}

type Halaman = { data?: { data?: Record<string, unknown>[]; pagination?: { lastPage?: number; last_page?: number } } }
async function ambilHalaman(token: string, provider: string, dari: string, sampai: string, halaman: number): Promise<Halaman> {
  const q = new URLSearchParams({ page: String(halaman), size: String(UKURAN_HALAMAN), startDate: dari, endDate: sampai, providerIDs: provider, driverTypes: 'RIDER,DRIVER' })
  let galat: unknown = null
  for (let i = 0; i < ULANG; i++) {
    try {
      const res = await fetch(`${BASE}?${q}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'x-client-time-zone': 'Asia/Jakarta' } })
      if (res.ok) return await res.json()
      if (res.status === 401 || res.status === 403) throw new Tetap(`Token BO ditolak atau kedaluwarsa (${res.status})`)
      if (![408, 429, 500, 502, 503, 504].includes(res.status)) throw new Tetap(`API BO membalas ${res.status}`)
      galat = new Error(`API BO membalas ${res.status}`)
    } catch (e) {
      if (e instanceof Tetap) throw e
      galat = e
    }
    await tidur(600 * (i + 1))
  }
  throw new Error(`API BO tidak bisa dihubungi: ${String(galat).slice(0, 120)}`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const rahasia = Deno.env.get('CRON_SECRET')
  const kiriman = req.headers.get('x-cron-secret')
  let boleh = !!rahasia && !!kiriman && samaPersis(kiriman, rahasia)
  if (!boleh) {
    const auth = req.headers.get('Authorization') ?? ''
    if (auth) {
      const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
      const { data: { user } } = await caller.auth.getUser()
      if (user?.email) {
        const { data: me } = await admin.from('riders').select('peran,status').eq('email', user.email.toLowerCase()).maybeSingle()
        boleh = me?.peran === 'super_admin' && me.status === 'aktif'
      }
    }
  }
  if (!boleh) return json({ error: 'Unauthorized' }, 401)

  const token = (Deno.env.get('BO_API_TOKEN') ?? '').replace(/^\s*Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Secret BO_API_TOKEN belum diisi di Supabase' })
  const provider = (Deno.env.get('BO_PROVIDER_ID') ?? '446').trim()

  const b = await req.json().catch(() => ({})) as { dari?: string; sampai?: string; peta?: Record<string, string>; otomatis?: boolean }
  const dari = b.dari ?? hariWib(-3)
  const sampai = b.sampai ?? hariWib()
  const tgl = /^\d{4}-\d{2}-\d{2}$/
  if (!tgl.test(dari) || !tgl.test(sampai) || dari > sampai) return json({ error: 'Rentang tanggal tidak valid' })
  if ((Date.parse(sampai) - Date.parse(dari)) / 864e5 + 1 > MAKS_HARI) return json({ error: `Rentang maksimal ${MAKS_HARI} hari` })

  const catat = (status: 'berhasil' | 'gagal', pesan: string) =>
    admin.from('pengaturan_kehadiran').update({ sinkron_terakhir: new Date().toISOString(), sinkron_status: status, sinkron_pesan: pesan.slice(0, 300) }).eq('id', 1)

  try {
    // 1. Tarik semua halaman. Halaman pertama memberi jumlah halaman; sisanya ditarik bersamaan oleh beberapa pekerja.
    const pertama = await ambilHalaman(token, provider, dari, sampai, 1)
    const mentah = [...(pertama.data?.data ?? [])]
    const pg = pertama.data?.pagination ?? {}
    const terakhir = Math.min(pg.lastPage ?? pg.last_page ?? 1, MAKS_HALAMAN)
    if (terakhir > 1) {
      const sisa = Array.from({ length: terakhir - 1 }, (_, i) => i + 2)
      const hasil: Record<number, Record<string, unknown>[]> = {}
      let n = 0
      await Promise.all(Array.from({ length: Math.min(PEKERJA, sisa.length) }, async () => {
        while (n < sisa.length) {
          const h = sisa[n++]
          hasil[h] = (await ambilHalaman(token, provider, dari, sampai, h)).data?.data ?? []
        }
      }))
      for (const h of sisa) mentah.push(...(hasil[h] ?? []))
    }

    // 2. Ubah dan buang duplikat (hub + kode mitra + jam masuk)
    const unik = new Map<string, Baris>()
    let zonaTakDikenal = 0, dilewati = 0
    for (const x of mentah) {
      const u = ubah(x)
      if (!u) { dilewati++; continue }
      if (!u.zonaKenal) zonaTakDikenal++
      unik.set(`${u.baris.hub}|${u.baris.kode_mtr}|${u.baris.masuk_wib}`, u.baris)
    }
    const baris = [...unik.values()]

    // 3. Hub yang belum punya DS: ditanyakan dulu kecuali jadwal otomatis atau pemanggil sudah mengirim peta
    const hubs = [...new Set(baris.map((r) => r.hub))]
    if (!b.otomatis && b.peta === undefined) {
      const { data: dsl } = await admin.from('ds').select('nama,hub_bo')
      const kenal = new Set<string>()
      for (const d of dsl ?? []) kenal.add(d.hub_bo ? d.hub_bo : `nama:${String(d.nama).toLowerCase()}`)
      const baru = hubs.filter((h) => !kenal.has(h) && !kenal.has(`nama:${h.toLowerCase()}`))
      if (baru.length) return json({ perlu_pasangan: baru.map((h) => ({ hub: h, baris: baris.filter((r) => r.hub === h).length })), rentang: { dari, sampai }, ditarik: baris.length })
    }

    // 4. Simpan lewat impor_kehadiran_bo (satu aturan pencocokan hub, sama untuk semua sumber)
    const total = { baris_baru: 0, baris_diperbarui: 0, ds_dibuat: 0, ds_dipasang: 0, rider_baru: 0 }
    for (let i = 0; i < baris.length; i += 1000) {
      const { data, error } = await admin.rpc('impor_kehadiran_bo', { p_baris: baris.slice(i, i + 1000), p_peta: b.peta ?? {} })
      if (error) throw new Error(`Gagal menyimpan: ${error.message}`)
      const r = data as typeof total
      total.baris_baru += r.baris_baru; total.baris_diperbarui += r.baris_diperbarui; total.ds_dibuat += r.ds_dibuat; total.ds_dipasang += r.ds_dipasang; total.rider_baru += r.rider_baru ?? 0
    }
    const ringkas = `${dari} s/d ${sampai}: ${baris.length} baris dari BO, ${total.baris_baru} baru, ${total.baris_diperbarui} diperbarui, ${Math.max(0, baris.length - total.baris_baru - total.baris_diperbarui)} tanpa perubahan, ${total.rider_baru} rider baru${zonaTakDikenal ? `, ${zonaTakDikenal} zona waktu tidak dikenal (dianggap WIB)` : ''}`
    await catat('berhasil', ringkas)
    return json({ rentang: { dari, sampai }, ditarik: baris.length, dilewati, hub: hubs.length, zona_tak_dikenal: zonaTakDikenal, ...total })
  } catch (e) {
    const pesan = (e as Error).message || 'Sinkron gagal'
    await catat('gagal', pesan)
    return json({ error: pesan })
  }
})
