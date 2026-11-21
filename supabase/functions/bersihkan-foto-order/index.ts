// Edge function: hapus screenshot laporan order yang sudah lebih dari 90 hari (angka laporannya tetap tersimpan).
// Menghapus lewat Storage API, karena menghapus baris storage.objects lewat SQL tidak menghapus berkas aslinya.
// Dipanggil pg_cron sekali sehari (lihat supabase/jalankan_order_cron.sql). Secret: CRON_SECRET (kata sandi acak yang sama dengan di cron).
// Deploy tanpa verifikasi JWT, karena pemanggilnya cron dan pengamannya CRON_SECRET:
//   npx supabase functions deploy bersihkan-foto-order --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2'

const BUCKET = 'order-ss'
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const rahasia = Deno.env.get('CRON_SECRET')
  if (!rahasia) return json({ error: 'CRON_SECRET belum diisi di secrets' }, 500)
  if (req.headers.get('x-cron-secret') !== rahasia) return json({ error: 'Unauthorized' }, 401)

  const { hari } = await req.json().catch(() => ({}))
  const batas = Number.isInteger(hari) && hari >= 30 ? hari : 90 // tidak bisa diperpendek di bawah 30 hari lewat panggilan luar
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let laporan = 0
  let berkas = 0
  // satu putaran memproses sampai 500 laporan; cron harian cukup untuk menyusul bila sempat menumpuk
  const { data, error } = await admin.rpc('foto_order_kedaluwarsa', { p_hari: batas })
  if (error) return json({ error: error.message }, 500)
  const bersih: string[] = []
  for (const r of (data ?? []) as { id: string; foto: string[] }[]) {
    const { error: e } = await admin.storage.from(BUCKET).remove(r.foto)
    if (e) continue // dicoba lagi besok; jangan kosongkan alamat bila berkasnya belum terhapus
    berkas += r.foto.length
    bersih.push(r.id)
  }
  if (bersih.length) {
    const { data: n, error: e } = await admin.rpc('kosongkan_foto_order', { p_ids: bersih })
    if (e) return json({ error: e.message, berkas_terhapus: berkas }, 500)
    laporan = n as number
  }
  return json({ ok: true, batas_hari: batas, laporan_dibersihkan: laporan, berkas_terhapus: berkas })
})
