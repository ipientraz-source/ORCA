// Edge function: kirim laporan absensi dan pengingat ke grup WhatsApp tiap DS lewat Fonnte (https://fonnte.com).
// Dua pemanggil:
//   1. pg_cron (lihat supabase/jalankan_wa_cron.sql) dengan header x-cron-secret.
//   2. Tombol "Kirim sekarang" di menu Kelola DS & Captain, dengan login Super-admin (Authorization: Bearer <JWT>).
// Teks pesan disusun di database (fungsi laporan_wa).
// Secret yang harus diisi (Supabase Dashboard > Edge Functions > Secrets, atau `npx supabase secrets set ...`), jangan ditulis di kode:
//   FONNTE_TOKEN  token device Fonnte
//   CRON_SECRET   kata sandi acak yang sama dengan yang dipakai pg_cron di header x-cron-secret (hanya untuk jalur cron)
// Deploy tanpa verifikasi JWT bawaan, karena pengamannya dicek di sini (CRON_SECRET atau Super-admin):
//   npx supabase functions deploy kirim-laporan --no-verify-jwt
//
// Body JSON: { sesi, tanggal?, ds_id?, ulang? }
//   sesi     ingat_pagi | laporan_pagi | ingat_siang | laporan_siang
//   tanggal  YYYY-MM-DD, bawaan hari ini (WIB)
//   ds_id    kirim hanya untuk satu DS (dipakai tombol manual dan untuk uji coba)
//   ulang    true = kirim lagi walau sesi itu sudah terkirim hari itu (hanya untuk Super-admin, bukan cron)
import { createClient } from 'npm:@supabase/supabase-js@2'

const SESI = ['ingat_pagi', 'laporan_pagi', 'ingat_siang', 'laporan_siang']
const JEDA_MS = 1500 // jeda antar pesan supaya tidak terkesan spam ke WhatsApp
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const tidur = (ms: number) => new Promise((r) => setTimeout(r, ms))
const hariIniWib = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Perbandingan yang waktunya tidak bergantung pada seberapa banyak karakter yang cocok
function samaPersis(a: string, b: string) {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let beda = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) beda |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return beda === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const token = Deno.env.get('FONNTE_TOKEN')
  if (!token) return json({ error: 'FONNTE_TOKEN belum diisi di secrets' }, 500)

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Siapa yang memanggil: cron (rahasia cocok) atau Super-admin yang sedang login
  const rahasia = Deno.env.get('CRON_SECRET')
  const kiriman = req.headers.get('x-cron-secret')
  const dariCron = !!rahasia && !!kiriman && samaPersis(kiriman, rahasia)
  let dariSuper = false
  if (!dariCron) {
    const auth = req.headers.get('Authorization') ?? ''
    if (auth) {
      const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
      const { data: { user } } = await caller.auth.getUser()
      if (user?.email) {
        const { data: me } = await admin.from('riders').select('peran,status').eq('email', user.email.toLowerCase()).maybeSingle()
        dariSuper = me?.peran === 'super_admin' && me.status === 'aktif'
      }
    }
  }
  if (!dariCron && !dariSuper) return json({ error: 'Unauthorized' }, 401)

  const { sesi, tanggal, ds_id, ulang } = await req.json().catch(() => ({}))
  if (!SESI.includes(sesi)) return json({ error: `sesi harus salah satu dari: ${SESI.join(', ')}` }, 400)
  if (tanggal !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return json({ error: 'tanggal harus berformat YYYY-MM-DD' }, 400)
  if (ds_id !== undefined && ds_id !== null && !(typeof ds_id === 'string' && UUID.test(ds_id))) return json({ error: 'ds_id tidak valid' }, 400)
  const tgl: string = tanggal ?? hariIniWib()
  const kirimUlang = dariSuper && ulang === true

  const { data: rows, error } = await admin.rpc('laporan_wa', { p_sesi: sesi, p_tanggal: tgl })
  if (error) return json({ error: error.message }, 500)

  const hasil: { ds: string; status: string; alasan?: string }[] = []
  const daftar = ((rows ?? []) as { ds_id: string; ds_nama: string; group_wa_id: string | null; pesan: string }[]).filter((r) => !ds_id || r.ds_id === ds_id)
  for (const r of daftar) {
    if (!r.group_wa_id) { hasil.push({ ds: r.ds_nama, status: 'dilewati', alasan: 'group_wa_id belum diisi di Kelola DS' }); continue }
    if (!kirimUlang) {
      const { data: sudah } = await admin.from('log_wa').select('id').eq('tanggal', tgl).eq('ds_id', r.ds_id).eq('sesi', sesi).eq('status', 'terkirim').maybeSingle()
      if (sudah) { hasil.push({ ds: r.ds_nama, status: 'dilewati', alasan: 'sudah terkirim' }); continue }
    }

    let ok = false
    let respons = ''
    try {
      const f = new FormData()
      f.append('target', r.group_wa_id)
      f.append('message', r.pesan)
      const res = await fetch('https://api.fonnte.com/send', { method: 'POST', headers: { Authorization: token }, body: f })
      const teks = await res.text()
      respons = teks.slice(0, 500)
      try { ok = res.ok && JSON.parse(teks).status === true } catch { ok = false }
    } catch (e) {
      respons = String(e).slice(0, 500)
    }
    // Kirim ulang: catatan terkirim yang lama diganti, karena hanya satu baris terkirim per DS per sesi per hari yang diizinkan
    if (ok && kirimUlang) await admin.from('log_wa').delete().eq('tanggal', tgl).eq('ds_id', r.ds_id).eq('sesi', sesi).eq('status', 'terkirim')
    await admin.from('log_wa').insert({ tanggal: tgl, ds_id: r.ds_id, sesi, status: ok ? 'terkirim' : 'gagal', respons })
    hasil.push(ok ? { ds: r.ds_nama, status: 'terkirim' } : { ds: r.ds_nama, status: 'gagal', alasan: respons })
    await tidur(JEDA_MS)
  }
  return json({ sesi, tanggal: tgl, hasil })
})
