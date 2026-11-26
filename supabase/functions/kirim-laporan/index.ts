// Edge function: kirim pesan WhatsApp (laporan absensi, fulfillment, pengingat captain, budget) lewat Fonnte (https://fonnte.com).
// Pemanggil:
//   1. pg_cron tiap 5 menit dengan header x-cron-secret dan body { sesi: 'auto' }: mengirim pesan terjadwal (tabel pesan_wa) yang jamnya sudah tiba.
//   2. Menu Laporan WhatsApp dan Kelola DS di Orca, dengan login Super-admin (Authorization: Bearer <JWT>).
// Teks pesan disusun di database (laporan_wa_gabung dan laporan_budget_wa); fungsi ini hanya mengirim dan mencatat ke log_wa.
// Secret yang harus diisi (Supabase Dashboard > Edge Functions > Secrets, atau `npx supabase secrets set ...`), jangan ditulis di kode:
//   FONNTE_TOKEN  token device Fonnte
//   CRON_SECRET   kata sandi acak yang sama dengan yang dipakai pg_cron di header x-cron-secret (hanya untuk jalur cron)
// Deploy tanpa verifikasi JWT bawaan, karena pengamannya dicek di sini (CRON_SECRET atau Super-admin):
//   npx supabase functions deploy kirim-laporan --no-verify-jwt
//
// Body JSON (salah satu):
//   { sesi: 'auto' }                      cron: kirim pesan terjadwal yang jamnya tiba (hanya bila saklar utama dan pesannya hidup)
//   { pesan_id, tanggal?, ulang? }        Super-admin: kirim satu pesan terjadwal sekarang ('ulang' = kirim lagi walau sudah terkirim)
//   { aksi: 'daftar_grup' }               Super-admin: daftar grup WhatsApp dari akun Fonnte (untuk dipilih di Orca)
//   { sesi, tanggal?, ds_id?, ulang? }    cara lama: sesi ingat_/laporan_ untuk grup tiap DS; ds_id = satu DS saja (tombol Kirim manual di Kelola DS)
import { createClient } from 'npm:@supabase/supabase-js@2'

const SESI = ['ingat_pagi', 'laporan_pagi', 'ingat_tengah', 'laporan_tengah', 'ingat_siang', 'laporan_siang']
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

type Baris = { group_wa_id: string | null; ds_ids: string[]; ds_namas: string[]; pesan: string }
type Pesan = { id: string; nama: string; jenis: string; shift: string | null; cakupan: string; cakupan_ids: string[]; grup: string[]; sumber?: string }
type Hasil = { ds: string; status: string; alasan?: string }

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

  const { sesi, tanggal, ds_id, ulang, pesan_id, aksi } = await req.json().catch(() => ({}))
  if (tanggal !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return json({ error: 'tanggal harus berformat YYYY-MM-DD' }, 400)
  if (ds_id !== undefined && ds_id !== null && !(typeof ds_id === 'string' && UUID.test(ds_id))) return json({ error: 'ds_id tidak valid' }, 400)
  if (pesan_id !== undefined && !(typeof pesan_id === 'string' && UUID.test(pesan_id))) return json({ error: 'pesan_id tidak valid' }, 400)
  const tgl: string = tanggal ?? hariIniWib()
  const kirimUlang = dariSuper && ulang === true

  // ── Daftar grup dari Fonnte, untuk dipilih di Orca ──
  if (aksi === 'daftar_grup') {
    if (!dariSuper) return json({ error: 'Hanya Super-admin' }, 403)
    try {
      const res = await fetch('https://api.fonnte.com/get-whatsapp-group', { method: 'POST', headers: { Authorization: token } })
      const teks = await res.text()
      let j: Record<string, unknown> = {}
      try { j = JSON.parse(teks) } catch { /* bukan JSON */ }
      const mentah = (Array.isArray(j.data) ? j.data : Array.isArray(j.groups) ? j.groups : []) as Record<string, unknown>[]
      const grup = mentah
        .map((g) => ({ id: String(g.id ?? g.groupId ?? g.jid ?? ''), nama: String(g.name ?? g.subject ?? g.nama ?? '') }))
        .filter((g) => g.id.endsWith('@g.us'))
      return json({ grup, ...(grup.length ? {} : { keterangan: 'Fonnte tidak mengembalikan daftar grup. Isi ID grup secara manual.', respons: teks.slice(0, 300) }) })
    } catch (e) {
      return json({ grup: [], keterangan: 'Daftar grup tidak bisa diambil dari Fonnte. Isi ID grup secara manual.', respons: String(e).slice(0, 200) })
    }
  }

  // ── Kirim baris pesan ke tujuan, catat ke log_wa ──
  // tujuan tetap (grup yang dipilih di pesan) menggantikan grup tiap DS. Terkirim bila SEMUA grup tujuan menerima; bila ada yang gagal, dicatat gagal
  // dan percobaan berikutnya mengulang ke semua grup (ponytail: belum dicatat per grup).
  const kirimBaris = async (rows: Baris[], o: { tgl: string; sesi: string; pesanId: string | null; tujuan: string[]; ulang: boolean }): Promise<Hasil[]> => {
    const hasil: Hasil[] = []
    for (const r of rows) {
      const nama = r.ds_namas.join(', ')
      const tujuan = o.tujuan.length ? o.tujuan : r.group_wa_id ? [r.group_wa_id] : []
      if (!tujuan.length) { hasil.push({ ds: nama, status: 'dilewati', alasan: 'grup tujuan belum diisi' }); continue }
      // DS yang sudah tercatat terkirim tidak dicatat dua kali; bila semuanya sudah, pesan tidak dikirim lagi
      const dasar = admin.from('log_wa').select('ds_id').eq('tanggal', o.tgl).eq('status', 'terkirim').in('ds_id', r.ds_ids)
      const { data: sudah } = await (o.pesanId ? dasar.eq('pesan_id', o.pesanId) : dasar.eq('sesi', o.sesi).is('pesan_id', null))
      const sudahId = new Set((sudah ?? []).map((x: { ds_id: string }) => x.ds_id))
      if (!o.ulang && r.ds_ids.every((id) => sudahId.has(id))) { hasil.push({ ds: nama, status: 'dilewati', alasan: 'sudah terkirim' }); continue }

      let ok = true
      const respons: string[] = []
      for (const t of tujuan) {
        try {
          const f = new FormData()
          f.append('target', t)
          f.append('message', r.pesan)
          const res = await fetch('https://api.fonnte.com/send', { method: 'POST', headers: { Authorization: token }, body: f })
          const teks = await res.text()
          let sukses = false
          try { sukses = res.ok && JSON.parse(teks).status === true } catch { sukses = false }
          if (!sukses) { ok = false; respons.push(`${t}: ${teks.slice(0, 200)}`) }
        } catch (e) {
          ok = false
          respons.push(`${t}: ${String(e).slice(0, 200)}`)
        }
      }
      // Kirim ulang: catatan terkirim yang lama diganti, karena hanya satu baris terkirim per DS per pesan (atau sesi) per hari yang diizinkan
      if (ok && o.ulang) {
        const hapus = admin.from('log_wa').delete().eq('tanggal', o.tgl).eq('status', 'terkirim').in('ds_id', r.ds_ids)
        await (o.pesanId ? hapus.eq('pesan_id', o.pesanId) : hapus.eq('sesi', o.sesi).is('pesan_id', null))
      }
      await admin.from('log_wa').insert(
        r.ds_ids.filter((id) => !(ok && !o.ulang && sudahId.has(id))).map((ds_id) => ({ tanggal: o.tgl, ds_id, sesi: o.sesi, pesan_id: o.pesanId, status: ok ? 'terkirim' : 'gagal', respons: respons.join(' | ') || null })),
      )
      hasil.push(ok ? { ds: nama, status: 'terkirim' } : { ds: nama, status: 'gagal', alasan: respons.join(' | ') })
      await tidur(JEDA_MS)
    }
    return hasil
  }

  // ── Satu pesan terjadwal (tabel pesan_wa) untuk satu tanggal ──
  const kirimPesan = async (id: string, tgl: string, ulang: boolean) => {
    // select('*') supaya fungsi tetap jalan sebelum migrasi 0074 (kolom sumber) dijalankan; tanpa kolom itu pesan diperlakukan bersumber Captain
    const { data: p } = await admin.from('pesan_wa').select('*').eq('id', id).maybeSingle()
    if (!p) return { error: 'Pesan tidak ditemukan' }
    const m = p as Pesan
    // Pesan terjadwal dikirim sekali per tanggal. Sebelumnya hanya dicek per DS, jadi DS yang baru ikut di tick berikutnya (jendela 30 menit,
    // cron tiap 5 menit) memicu pesan kedua ke grup yang sama. "Kirim sekarang" (ulang) sengaja melewati pengecekan ini.
    if (!ulang) {
      const { count } = await admin.from('log_wa').select('id', { count: 'exact', head: true }).eq('pesan_id', id).eq('tanggal', tgl).eq('status', 'terkirim')
      if ((count ?? 0) > 0) return { pesan: m.nama, tanggal: tgl, hasil: [], dilewati: 'Sudah terkirim hari ini' }
    }
    const sesiPesan = m.jenis === 'fulfillment_shift' ? `laporan_${m.shift}` : m.jenis === 'pengingat_captain' ? `ingat_${m.shift}` : m.jenis === 'fulfillment_hari' ? 'laporan_hari' : m.jenis
    // cakupan DS: semua (null), DS tertentu, atau semua DS milik Arcon tertentu
    let dsIds: string[] | null = null
    if (m.cakupan === 'ds') dsIds = m.cakupan_ids
    if (m.cakupan === 'arcon') dsIds = ((await admin.from('ds').select('id').in('arcon_id', m.cakupan_ids)).data ?? []).map((x: { id: string }) => x.id)
    if (dsIds && !dsIds.length) return { pesan: m.nama, tanggal: tgl, hasil: [], dilewati: 'Cakupan pesan ini tidak punya DS' }
    const grup = (m.grup ?? []).map((x) => x.trim()).filter(Boolean)
    // budget dan ringkasan satu pesan untuk semua DS terpilih; selebihnya laporan_wa_gabung (grup tiap DS bila tidak ada grup pilihan)
    const { data: rows, error } = m.jenis === 'budget'
      ? await admin.rpc('laporan_budget_wa', { p_tanggal: tgl, p_ds_ids: dsIds, p_grup: grup[0] ?? null })
      : m.jenis === 'ringkasan_mingguan' || m.jenis === 'ringkasan_bulanan'
        ? await admin.rpc('laporan_ringkasan_wa', { p_periode: m.jenis === 'ringkasan_mingguan' ? 'mingguan' : 'bulanan', p_tanggal: tgl, p_ds_ids: dsIds, p_grup: grup[0] ?? null })
        : await admin.rpc('laporan_wa_gabung', { p_sesi: sesiPesan, p_tanggal: tgl, p_ds_ids: dsIds, p_grup_semua: grup[0] ?? null, ...(m.sumber === 'bo' ? { p_sumber: 'bo' } : {}) })
    if (error) return { error: error.message }
    return { pesan: m.nama, tanggal: tgl, hasil: await kirimBaris((rows ?? []) as Baris[], { tgl, sesi: sesiPesan, pesanId: m.id, tujuan: grup, ulang }) }
  }

  // ── 'auto': dipanggil cron tiap 5 menit. Database (pesan_wa_jatuh_tempo) menjawab pesan mana yang jamnya sudah tiba; saklar utama mati = tidak ada ──
  if (sesi === 'auto') {
    // Foto budget harian (kuota efektif hari ini) untuk riwayat naik-turun budget di ringkasan; hanya menulis bila berubah, jadi murah dipanggil tiap 5 menit
    await admin.rpc('catat_budget_snapshot')
    const { data: jatuh, error: e } = await admin.rpc('pesan_wa_jatuh_tempo')
    if (e) return json({ error: e.message }, 500)
    const semua = []
    for (const d of (jatuh ?? []) as { id: string; tanggal: string }[]) semua.push(await kirimPesan(d.id, d.tanggal, false))
    return json({ sesi: 'auto', jatuh_tempo: semua.length, hasil: semua })
  }

  // ── Kirim sekarang satu pesan terjadwal (tombol di menu Laporan WhatsApp) ──
  if (pesan_id) {
    if (!dariSuper) return json({ error: 'Hanya Super-admin' }, 403)
    const h = await kirimPesan(pesan_id, tgl, kirimUlang)
    return json(h, 'error' in h ? 500 : 200)
  }

  // ── Cara lama: sesi untuk grup tiap DS (cron lama dan tombol Kirim manual di Kelola DS). Saklar utama mati menghentikan cron, bukan tombol manual ──
  if (!SESI.includes(sesi)) return json({ error: `sesi harus salah satu dari: auto, ${SESI.join(', ')}` }, 400)
  if (dariCron) {
    const { data: cfg } = await admin.from('pengaturan_wa').select('aktif').eq('id', 1).maybeSingle()
    if (cfg?.aktif === false) return json({ sesi, tanggal: tgl, hasil: [], dilewati: 'Pengiriman otomatis dimatikan di menu Laporan WhatsApp' })
  }
  const { data: rows, error } = await admin.rpc('laporan_wa_gabung', { p_sesi: sesi, p_tanggal: tgl, p_ds: ds_id ?? null })
  if (error) return json({ error: error.message }, 500)
  return json({ sesi, tanggal: tgl, hasil: await kirimBaris((rows ?? []) as Baris[], { tgl, sesi, pesanId: null, tujuan: [], ulang: kirimUlang }) })
})
