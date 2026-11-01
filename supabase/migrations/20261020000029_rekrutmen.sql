-- Rekrutmen rider: kandidat dengan pipeline (baru → dihubungi → interview → training → diterima / ditolak), peran Recruiter,
-- "Terima jadi rider" dengan satu klik, dan kebutuhan rekrut per DS dari kuota dibanding rider aktif.
-- Hak: Super-admin dan Recruiter mengelola semua kandidat; Captain dan Arcon hanya MELIHAT kandidat untuk DS yang dipegang.
-- Jalankan SETELAH 20261020000028_recruiter_enum.sql.

-- Recruiter login dengan email: perlu bisa membaca baris dirinya sendiri (tanpa membuka daftar rider).
-- Sengaja hanya untuk Recruiter: rider biasa (mis. mantan Captain) tetap tidak bisa membaca apa pun.
create policy riders_read_self on riders for select to authenticated using (my_peran() = 'recruiter' and id = me());

create table kandidat (
  id uuid primary key default gen_random_uuid(),
  nama text not null check (length(trim(nama)) > 0),
  no_hp text,
  sumber text,
  ds_id uuid references ds(id) on delete set null, -- DS tujuan
  status text not null default 'baru' check (status in ('baru', 'dihubungi', 'interview', 'training', 'diterima', 'ditolak')),
  alasan_tolak text,
  catatan text,
  rider_id uuid references riders(id) on delete set null, -- terisi saat diterima
  dibuat timestamptz not null default now(),
  dibuat_oleh uuid references riders(id) on delete set null,
  status_berubah timestamptz not null default now(),
  ditutup timestamptz, -- saat diterima atau ditolak; dasar hitungan lama proses
  check (status <> 'ditolak' or length(trim(coalesce(alasan_tolak, ''))) > 0),
  check (status <> 'diterima' or rider_id is not null)
);
create index on kandidat (ds_id, status);
create index on kandidat (status, dibuat desc);
-- satu nomor HP tidak boleh ada dua kali selama masih diproses (mencegah kandidat dobel)
create unique index kandidat_hp_aktif on kandidat (no_hp) where no_hp is not null and status in ('baru', 'dihubungi', 'interview', 'training');

alter table kandidat enable row level security;
revoke all on kandidat from anon;
create policy kandidat_read on kandidat for select to authenticated
  using (is_super() or my_peran() = 'recruiter' or (my_peran() in ('captain', 'arcon') and ds_id = any(my_ds_ids())));
create policy kandidat_insert on kandidat for insert to authenticated with check (is_super() or my_peran() = 'recruiter');
create policy kandidat_update on kandidat for update to authenticated
  using (is_super() or my_peran() = 'recruiter') with check (is_super() or my_peran() = 'recruiter');
create policy kandidat_delete on kandidat for delete to authenticated using (is_super());

-- Penjaga: data dirapikan; waktu status dan waktu tutup diisi sistem; "diterima" hanya lewat terima_kandidat (membuat ridernya)
create function kandidat_guard() returns trigger language plpgsql as $$
begin
  new.nama := trim(new.nama);
  new.no_hp := nullif(regexp_replace(coalesce(new.no_hp, ''), '[^0-9+]', '', 'g'), '');
  new.sumber := nullif(trim(coalesce(new.sumber, '')), '');
  if tg_op = 'INSERT' then
    if current_user = 'authenticated' and (new.status = 'diterima' or new.rider_id is not null) then
      raise exception 'Kandidat baru tidak bisa langsung berstatus diterima';
    end if;
    new.dibuat_oleh := coalesce(new.dibuat_oleh, me());
    new.ditutup := case when new.status = 'ditolak' then now() end;
  else
    if current_user = 'authenticated' then
      if old.status = 'diterima' then raise exception 'Kandidat yang sudah diterima tidak bisa diubah lagi'; end if;
      if new.status = 'diterima' or new.rider_id is distinct from old.rider_id then raise exception 'Gunakan tombol "Terima jadi rider"'; end if;
    end if;
    if new.status is distinct from old.status then
      new.status_berubah := now();
      new.ditutup := case when new.status in ('diterima', 'ditolak') then now() end;
      if new.status <> 'ditolak' then new.alasan_tolak := null; end if;
    end if;
  end if;
  return new;
end $$;
create trigger kandidat_guard_t before insert or update on kandidat for each row execute function kandidat_guard();

-- Terima jadi rider: membuat rider aktif di DS tujuan, lalu menandai kandidat diterima. Kode MTR boleh diisi nanti di Data Rider.
create function terima_kandidat(p_id uuid, p_kode text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare k kandidat%rowtype; v_rider uuid;
begin
  if not (is_super() or my_peran() = 'recruiter') then raise exception 'Hanya Super-admin atau Recruiter'; end if;
  select * into k from kandidat where id = p_id for update;
  if not found then raise exception 'Kandidat tidak ditemukan'; end if;
  if k.status = 'diterima' then raise exception 'Kandidat ini sudah diterima'; end if;
  if k.status = 'ditolak' then raise exception 'Kandidat ini sudah ditolak. Kembalikan ke tahap lain dulu kalau mau diterima'; end if;
  if k.ds_id is null then raise exception 'Pilih DS tujuan dulu sebelum menerima kandidat'; end if;
  begin
    insert into riders (nama, no_hp, ds_id, kode_mtr, peran, status)
      values (k.nama, k.no_hp, k.ds_id, nullif(trim(coalesce(p_kode, '')), ''), 'rider', 'aktif') returning id into v_rider;
  exception when unique_violation then
    raise exception 'Kode MTR % sudah dipakai rider lain', upper(trim(p_kode));
  end;
  update kandidat set status = 'diterima', rider_id = v_rider where id = p_id;
  return v_rider;
end $$;

-- Kebutuhan rekrut per DS. Rider yang dibutuhkan = kuota harian (pagi + siang) × 7 / 6, dibulatkan ke atas, karena penyusun
-- jadwal memberi minimal 1 hari libur per minggu (maks 6 hari kerja). Super-admin dan Recruiter: semua DS; Captain dan Arcon: DS-nya.
create function ds_rekrut() returns table (ds_id uuid, ds_nama text, kuota int, perlu int, rider_aktif int, kandidat_proses int, kurang int)
language sql stable security definer set search_path = public as $$
  with t as (
    select d.id, d.nama, d.kuota_pagi + d.kuota_siang as kuota,
           ceil((d.kuota_pagi + d.kuota_siang) * 7 / 6.0)::int as perlu,
           (select count(*) from riders r where r.ds_id = d.id and r.peran in ('rider', 'captain') and r.status = 'aktif')::int as aktif,
           (select count(*) from kandidat k where k.ds_id = d.id and k.status in ('baru', 'dihubungi', 'interview', 'training'))::int as proses
    from ds d
    where is_super() or my_peran() = 'recruiter' or d.id = any(my_ds_ids())
  )
  select id, nama, kuota, perlu, aktif, proses, greatest(0, perlu - aktif) from t order by nama
$$;

-- kandidat ikut tercatat di Riwayat (trigger pernyataan dari 20261020000027); nama objeknya ditambahkan di sini
create or replace function riwayat_objek(p_tabel text, j jsonb) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(case p_tabel
    when 'riders' then j ->> 'nama'
    when 'ds' then j ->> 'nama'
    when 'motor' then j ->> 'kode_motor'
    when 'kandidat' then j ->> 'nama'
    when 'actual_harian' then coalesce((select nama from riders where id = (j ->> 'rider_id')::uuid), '?') || ' · ' || (j ->> 'tanggal')
    when 'servis_motor' then coalesce((select kode_motor from motor where id = (j ->> 'motor_id')::uuid), '?') || ' · ' || (j ->> 'jenis')
    when 'kerusakan_motor' then coalesce((select kode_motor from motor where id = (j ->> 'motor_id')::uuid), '?') || ' · ' || (j ->> 'jenis')
    when 'permintaan_servis' then j ->> 'judul'
    when 'periode_kunci' then coalesce((select nama from ds where id = (j ->> 'ds_id')::uuid), '?') || ' · minggu ' || (j ->> 'minggu_mulai')
  end, '?')
$$;
create trigger riwayat_tambah after insert on kandidat referencing new table as new_rows for each statement execute function catat_tambah('kandidat');
create trigger riwayat_ubah after update on kandidat referencing old table as old_rows new table as new_rows for each statement execute function catat_ubah('kandidat');
create trigger riwayat_hapus after delete on kandidat referencing old table as old_rows for each statement execute function catat_hapus('kandidat');

-- fungsi baru default-nya bisa dieksekusi anon di Supabase → cabut
revoke execute on function terima_kandidat(uuid, text), ds_rekrut() from public, anon;
grant execute on function terima_kandidat(uuid, text), ds_rekrut() to authenticated;
revoke execute on function riwayat_objek(text, jsonb) from public, anon, authenticated;
