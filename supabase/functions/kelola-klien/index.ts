// Edge function: Super-admin membuat akun login klien (atau mengganti password-nya) dan memasangkannya ke satu klien.
// Service role key hanya ada di sini (server). Deploy: npx supabase functions deploy kelola-klien
// Akun klien disimpan di tabel akun_klien (BUKAN riders). Email yang sudah dipakai orang di ORCA ditolak: orang itu tidak boleh sekaligus jadi klien.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: { user } } = await caller.auth.getUser()
  if (!user?.email) return json({ error: 'Unauthorized' }, 401)

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: me } = await admin.from('riders').select('peran,status').eq('email', user.email.toLowerCase()).maybeSingle()
  if (me?.peran !== 'super_admin' || me.status !== 'aktif') return json({ error: 'Hanya Super-admin' }, 403)

  const { email, password, klien_id, nama } = await req.json().catch(() => ({}))
  if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) || typeof password !== 'string' || password.length < 8)
    return json({ error: 'Email yang valid dan password (min 8 karakter) wajib' }, 400)
  if (typeof klien_id !== 'string' || !UUID.test(klien_id)) return json({ error: 'Klien wajib dipilih' }, 400)
  const e = email.trim().toLowerCase()

  const { data: klien } = await admin.from('klien').select('id').eq('id', klien_id).maybeSingle()
  if (!klien) return json({ error: 'Klien tidak ditemukan' }, 400)

  // Email milik orang di ORCA (rider, Captain, Arcon, Super-admin) tidak boleh jadi akun klien
  const { data: orang } = await admin.from('riders').select('id').eq('email', e).maybeSingle()
  if (orang) return json({ error: 'Email ini sudah dipakai orang di ORCA, jadi tidak bisa jadi akun klien' }, 400)

  // Pasang ke klien lebih dulu (pemicu database juga menolak email yang dipakai riders). Gagal di sini = belum ada akun login yang dibuat.
  const { error: eAkun } = await admin.from('akun_klien').upsert(
    { email: e, klien_id, nama: typeof nama === 'string' && nama.trim() ? nama.trim().slice(0, 80) : null, aktif: true },
    { onConflict: 'email' },
  )
  if (eAkun) return json({ error: eAkun.message }, 400)

  const { error } = await admin.auth.admin.createUser({ email: e, password, email_confirm: true })
  if (!error) return json({ ok: true, created: true })

  // Sudah ada → ganti password
  for (let page = 1; ; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    const u = data?.users.find((x) => x.email?.toLowerCase() === e)
    if (u) {
      const r = await admin.auth.admin.updateUserById(u.id, { password })
      return r.error ? json({ error: r.error.message }, 400) : json({ ok: true, created: false })
    }
    if (!data || data.users.length < 1000) break
  }
  return json({ error: error.message }, 400)
})
