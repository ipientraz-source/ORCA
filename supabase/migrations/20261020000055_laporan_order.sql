-- Laporan order harian rider: jumlah order yang dibawa hari itu + screenshot order sebagai bukti.
-- Rider login memakai Kode MTR (tanpa akun Supabase), jadi rider TIDAK menulis langsung: Edge Function laporan-order-rider memeriksa Kode MTR
-- lalu menulis tabel dan Storage dengan hak server. Captain, Arcon, dan Super-admin punya akun, jadi mereka MEMBACA lewat RLS biasa.
-- Foto disimpan di bucket privat 'order-ss' dengan nama {rider_id}/{tanggal}/{uuid}.jpg; yang masuk tabel hanya alamatnya. Foto lebih dari 90 hari
-- dihapus oleh Edge Function bersihkan-foto-order (menghapus lewat SQL tidak menghapus berkas aslinya di Storage); angka laporannya tetap.

create table if not exists laporan_order (
  id uuid primary key default gen_random_uuid(),
  tanggal date not null,
  rider_id uuid not null references riders(id) on delete cascade,
  ds_id uuid references ds(id) on delete set null,
  jumlah_order int not null check (jumlah_order between 0 and 999),
  catatan text check (char_length(catatan) <= 500),
  foto text[] not null default '{}' check (cardinality(foto) <= 10),
  dibuat timestamptz not null default now(),
  diubah timestamptz not null default now(),
  unique (tanggal, rider_id)
);
create index if not exists laporan_order_ds_tanggal on laporan_order (ds_id, tanggal);
create index if not exists laporan_order_foto_lama on laporan_order (tanggal) where cardinality(foto) > 0;

-- Hanya dibaca: Super-admin semua, Captain dan Arcon DS yang dipegang. Tanpa kebijakan tulis, jadi tidak ada yang bisa menulis langsung lewat API.
alter table laporan_order enable row level security;
drop policy if exists laporan_order_baca on laporan_order;
create policy laporan_order_baca on laporan_order for select to authenticated
  using ((select is_super()) or ds_id = any ((select my_ds_ids())::uuid[]));

-- Dipakai Edge Function bersihkan-foto-order (service role): daftar laporan yang fotonya sudah kedaluwarsa, lalu kosongkan setelah berkasnya terhapus.
create or replace function foto_order_kedaluwarsa(p_hari int default 90)
returns table (id uuid, foto text[])
language sql stable security definer set search_path = public as $$
  select l.id, l.foto from laporan_order l
  where cardinality(l.foto) > 0 and l.tanggal < today_wib() - greatest(p_hari, 1)
  order by l.tanggal
  limit 500
$$;
create or replace function kosongkan_foto_order(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update laporan_order set foto = '{}' where id = any(p_ids) and cardinality(foto) > 0;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function foto_order_kedaluwarsa(int), kosongkan_foto_order(uuid[]) from public, anon, authenticated;

-- Hak baca foto: nama berkas diawali id rider. Super-admin, Captain, dan Arcon yang memegang DS rider itu boleh melihat (rider sendiri tidak
-- membaca lewat Storage: Edge Function yang memberinya tautan sementara).
create or replace function order_foto_boleh(p_nama text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_id text := split_part(p_nama, '/', 1);
begin
  if v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return is_super() or exists (select 1 from riders r where r.id = v_id::uuid and r.ds_id = any(my_ds_ids()));
end $$;
revoke execute on function order_foto_boleh(text) from public, anon;
grant execute on function order_foto_boleh(text) to authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function foto_order_kedaluwarsa(int), kosongkan_foto_order(uuid[]) to service_role;
  end if;
end $$;

-- ───────── Storage: bucket privat 'order-ss' (hanya di Supabase; dilewati di database uji yang tidak punya schema storage) ─────────
do $storage$
begin
  if to_regnamespace('storage') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('order-ss', 'order-ss', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    drop policy if exists order_ss_baca on storage.objects;
    create policy order_ss_baca on storage.objects for select to authenticated
      using (bucket_id = 'order-ss' and public.order_foto_boleh(name));
  end if;
end
$storage$;
