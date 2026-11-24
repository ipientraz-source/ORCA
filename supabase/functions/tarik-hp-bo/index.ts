// Isi nomor HP rider Orca yang masih kosong dari daftar mitra di BO (Masterdata, Mitra: GET /v3/drivers?type=RIDER, field "code" dan "phone_number").
// Dipanggil tombol "Isi nomor HP dari BO" di menu Clock-in BO (Super-admin yang sedang login) atau dengan header x-cron-secret = CRON_SECRET.
// Hanya rider aktif yang nomornya KOSONG yang dicari; nomor yang sudah ada tidak pernah ditimpa. Nomor dan data pribadi lain dari BO tidak ikut ke respons:
// yang dikembalikan hanya jumlah. Token BO ada di secret BO_API_TOKEN (sama dengan sinkron clock-in).
// Deploy: npx supabase functions deploy tarik-hp-bo --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2'

const BASE = 'https://api.dashelectric.co/v3/drivers'
const UKURAN = 100
const MAKS_HALAMAN = 300
const PEKERJA = 5
const ULANG = 3
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

// Galat yang tidak ada gunanya diulang (token salah, alamat salah)
class Tetap extends Error {}

type Respons = Record<string, unknown>
async function ambilHalaman(token: string, halaman: number): Promise<Respons> {
  const q = new URLSearchParams({ page: String(halaman), size: String(UKURAN), type: 'RIDER', sort: 'created_at', order: 'desc', search: '' })
  let galat: unknown = null
  for (let i = 0; i < ULANG; i++) {
    try {
      const res = await fetch(`${BASE}?${q}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'x-client-time-zone': 'Asia/Jakarta' } })
      if (res.ok) return await res.json()
      if (res.status === 401 || res.status === 403) throw new Tetap(`Token BO tidak punya izin ke daftar mitra (${res.status}). Daftar mitra di BO memakai izin yang berbeda dari data absensi`)
      if (![408, 429, 500, 502, 503, 504].includes(res.status)) throw new Tetap(`API BO membalas ${res.status} untuk daftar mitra`)
      galat = new Error(`API BO membalas ${res.status}`)
    } catch (e) {
      if (e instanceof Tetap) throw e
      galat = e
    }
    await tidur(600 * (i + 1))
  }
  throw new Error(`API BO tidak bisa dihubungi: ${String(galat).slice(0, 120)}`)
}

// Bentuk respons tidak dijamin: baris bisa di data.data, data.items, data, atau items; jumlah halaman di data.pagination atau pagination
function baris(r: Respons): Record<string, unknown>[] {
  const d = r.data as Respons | Respons[] | undefined
  const kandidat = [(d as Respons | undefined)?.data, (d as Respons | undefined)?.items, d, r.items, r.rows]
  const a = kandidat.find((x) => Array.isArray(x))
  return (a as Record<string, unknown>[] | undefined) ?? []
}
function halamanTerakhir(r: Respons): number | null {
  const p = ((r.data as Respons | undefined)?.pagination ?? r.pagination) as Record<string, unknown> | undefined
  const n = Number(p?.lastPage ?? p?.last_page ?? p?.totalPages ?? p?.total_pages)
  return Number.isFinite(n) && n > 0 ? n : null
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

  try {
    // 1. Rider aktif yang nomornya kosong: hanya kode mitra ini yang dicari di BO
    const { data: kosong, error: eKosong } = await admin.from('riders').select('kode_mtr').eq('peran', 'rider').eq('status', 'aktif').not('kode_mtr', 'is', null).or('no_hp.is.null,no_hp.eq.')
    if (eKosong) throw new Error(`Gagal membaca rider: ${eKosong.message}`)
    const butuh = new Set((kosong ?? []).map((r) => String(r.kode_mtr).trim().toUpperCase()))
    if (!butuh.size) return json({ butuh: 0, dibaca: 0, ditemukan: 0, terisi: 0 })

    // 2. Tarik daftar mitra BO. Halaman pertama memberi jumlah halaman (bila ada); sisanya ditarik bersamaan.
    const ditemukan = new Map<string, string>() // kode mitra -> nomor, hanya untuk yang dibutuhkan
    let dibaca = 0
    const proses = (r: Respons) => {
      for (const x of baris(r)) {
        dibaca++
        const kode = typeof x.code === 'string' ? x.code.trim().toUpperCase() : ''
        const hp = typeof x.phone_number === 'string' ? x.phone_number.trim() : ''
        if (kode && hp && butuh.has(kode) && !ditemukan.has(kode)) ditemukan.set(kode, hp)
      }
    }
    const pertama = await ambilHalaman(token, 1)
    proses(pertama)
    const terakhir = Math.min(halamanTerakhir(pertama) ?? (baris(pertama).length >= UKURAN ? MAKS_HALAMAN : 1), MAKS_HALAMAN)
    if (terakhir > 1) {
      const sisa = Array.from({ length: terakhir - 1 }, (_, i) => i + 2)
      let n = 0
      await Promise.all(Array.from({ length: Math.min(PEKERJA, sisa.length) }, async () => {
        while (n < sisa.length) proses(await ambilHalaman(token, sisa[n++]))
      }))
    }
    if (!dibaca) return json({ error: 'Daftar mitra dari BO kosong atau bentuknya tidak dikenali. Periksa izin token BO.' })

    // 3. Isi lewat isi_no_hp_bo (aturan rapikan nomor dan "hanya yang kosong" ada di database)
    const rows = [...ditemukan.entries()].map(([kode, hp]) => ({ kode, hp }))
    let terisi = 0
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await admin.rpc('isi_no_hp_bo', { p_baris: rows.slice(i, i + 500) })
      if (error) throw new Error(`Gagal menyimpan: ${error.message}`)
      terisi += (data as { terisi?: number })?.terisi ?? 0
    }
    return json({ butuh: butuh.size, dibaca, ditemukan: ditemukan.size, terisi })
  } catch (e) {
    return json({ error: (e as Error).message || 'Gagal mengisi nomor HP' })
  }
})
