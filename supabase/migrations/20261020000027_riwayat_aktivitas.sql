-- Riwayat aktivitas: setiap tambah / ubah / hapus pada data penting tercatat otomatis (siapa, kapan, apa, nilai lama → baru).
-- Dicatat oleh trigger di database, bukan oleh aplikasi, jadi fitur baru dan akses langsung ikut tercatat dan tidak ada yang terlewat.
-- Satu perintah yang mengubah banyak baris (impor CSV, kunci periode, dst.) jadi SATU catatan ringkasan, bukan ratusan baris.
-- Tidak dipasang pada jadwal, kuota harian, dan perpindahan: fungsi simpannya sudah mencatat sendiri. Penghapusan motor dan
-- pengajuan servis juga sudah dicatat fungsinya (dengan alasan), jadi tidak diulang di sini.

alter table log_aktivitas
  add column jenis text check (jenis in ('tambah', 'ubah', 'hapus')),
  add column tabel text,
  add column objek_id uuid,
  add column ds_id uuid, -- sengaja tanpa foreign key: riwayat DS yang sudah dihapus tetap harus bisa dibaca
  add column perubahan jsonb;
create index log_aktivitas_waktu_idx on log_aktivitas (waktu desc);
create index log_aktivitas_ds_idx on log_aktivitas (ds_id, waktu desc);

-- Super-admin semua; Captain dan Arcon: aktivitas di DS yang dipegang (catatan lama tanpa DS: seperti sebelumnya, lewat pelakunya)
drop policy log_read on log_aktivitas;
create policy log_read on log_aktivitas for select to authenticated
  using (is_super() or ds_id = any(my_ds_ids()) or captain_id = me()
         or captain_id in (select captain_id from ds where id = any(my_ds_ids()) and captain_id is not null));

-- ───────── pembantu ─────────
-- id rider / DS / motor diganti nama yang bisa dibaca; nilai kosong tampil "(kosong)"
create function riwayat_nilai(p_kolom text, p_nilai text) returns text
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if p_nilai is null then return '(kosong)'; end if;
  if p_kolom in ('rider_id', 'captain_id', 'arcon_id', 'dipegang_oleh', 'backup_untuk_id', 'pelapor_id', 'diinput_oleh', 'dikunci_oleh', 'perujuk_id') then
    select nama into v from riders where id = p_nilai::uuid;
  elsif p_kolom in ('ds_id', 'dari_ds', 'ke_ds') then
    select nama into v from ds where id = p_nilai::uuid;
  elsif p_kolom = 'motor_id' then
    select kode_motor into v from motor where id = p_nilai::uuid;
  end if;
  return coalesce(v, p_nilai);
exception when others then
  return p_nilai; -- bukan uuid yang valid: tampilkan apa adanya
end $$;

-- kolom yang berubah: [{kolom, lama, baru}]. Kolom teknis (jam input, penanda kunci) diabaikan supaya simpan ulang tanpa perubahan tidak tercatat.
create function riwayat_diff(p_lama jsonb, p_baru jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'kolom', e.key,
           'lama', riwayat_nilai(e.key, p_lama ->> e.key),
           'baru', riwayat_nilai(e.key, e.value #>> '{}'))), '[]'::jsonb)
  from jsonb_each(p_baru) e
  where e.value is distinct from p_lama -> e.key
    and e.key <> all (array['jam_input', 'dibuat', 'periode_terkunci', 'status_berubah', 'ditutup', 'perujuk_nama'])
$$;

-- "kuota siang 1 → 2, nama A → B" (maksimal 4 kolom)
create function riwayat_teks(p_diff jsonb) returns text
language sql immutable as $$
  select string_agg(replace(e ->> 'kolom', '_', ' ') || ' ' || (e ->> 'lama') || ' → ' || (e ->> 'baru'), ', ')
         || case when jsonb_array_length(p_diff) > 4 then ', dst.' else '' end
  from (select e from jsonb_array_elements(p_diff) with ordinality t(e, i) where i <= 4 order by i) s
$$;

-- nama objek yang dicatat
create function riwayat_objek(p_tabel text, j jsonb) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(case p_tabel
    when 'riders' then j ->> 'nama'
    when 'ds' then j ->> 'nama'
    when 'motor' then j ->> 'kode_motor'
    when 'actual_harian' then coalesce((select nama from riders where id = (j ->> 'rider_id')::uuid), '?') || ' · ' || (j ->> 'tanggal')
    when 'servis_motor' then coalesce((select kode_motor from motor where id = (j ->> 'motor_id')::uuid), '?') || ' · ' || (j ->> 'jenis')
    when 'kerusakan_motor' then coalesce((select kode_motor from motor where id = (j ->> 'motor_id')::uuid), '?') || ' · ' || (j ->> 'jenis')
    when 'permintaan_servis' then j ->> 'judul'
    when 'periode_kunci' then coalesce((select nama from ds where id = (j ->> 'ds_id')::uuid), '?') || ' · minggu ' || (j ->> 'minggu_mulai')
  end, '?')
$$;

-- DS tempat kejadian (null untuk yang tidak terikat DS)
create function riwayat_ds(p_tabel text, j jsonb) returns uuid
language sql stable security definer set search_path = public as $$
  select case p_tabel
    when 'ds' then (j ->> 'id')::uuid
    when 'servis_motor' then (select ds_id from motor where id = (j ->> 'motor_id')::uuid)
    when 'kerusakan_motor' then (select ds_id from motor where id = (j ->> 'motor_id')::uuid)
    when 'permintaan_servis' then null
    else nullif(j ->> 'ds_id', '')::uuid
  end
$$;

create function catat_riwayat(p_op text, p_tabel text, p_label text, p_contoh jsonb, p_n int, p_diff jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_detail text;
begin
  v_detail := case when p_n > 1 then p_n || ' data, mis. ' else '' end || riwayat_objek(p_tabel, p_contoh)
              || case when p_op = 'ubah' and p_diff is not null then ': ' || riwayat_teks(p_diff) else '' end;
  insert into log_aktivitas (captain_id, aksi, detail, jenis, tabel, objek_id, ds_id, perubahan)
    values (me(), p_op || ' ' || p_label, v_detail, p_op, p_tabel,
            case when p_n = 1 then nullif(p_contoh ->> 'id', '')::uuid end, riwayat_ds(p_tabel, p_contoh), p_diff);
end $$;

-- ───────── trigger per pernyataan (tabel transisi), argumen = nama yang tampil di riwayat ─────────
create function catat_tambah() returns trigger language plpgsql security definer set search_path = public as $$
declare n int; contoh jsonb;
begin
  select count(*), (array_agg(to_jsonb(x)))[1] into n, contoh from new_rows x;
  if n > 0 then perform catat_riwayat('tambah', tg_table_name, tg_argv[0], contoh, n, null); end if;
  return null;
end $$;

create function catat_hapus() returns trigger language plpgsql security definer set search_path = public as $$
declare n int; contoh jsonb;
begin
  select count(*), (array_agg(to_jsonb(x)))[1] into n, contoh from old_rows x;
  if n > 0 then perform catat_riwayat('hapus', tg_table_name, tg_argv[0], contoh, n, null); end if;
  return null;
end $$;

create function catat_ubah() returns trigger language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; d jsonb; contoh jsonb; diff1 jsonb;
begin
  for r in select to_jsonb(o) as lama, to_jsonb(x) as baru from old_rows o join new_rows x on x.id = o.id loop
    d := riwayat_diff(r.lama, r.baru);
    if jsonb_array_length(d) > 0 then
      n := n + 1;
      if n = 1 then contoh := r.baru; diff1 := d; end if;
    end if;
  end loop;
  if n > 0 then perform catat_riwayat('ubah', tg_table_name, tg_argv[0], contoh, n, diff1); end if;
  return null;
end $$;

do $$
declare t record;
begin
  for t in select * from (values
    ('riders', 'rider', 'tambah,ubah,hapus'),
    ('ds', 'DS', 'tambah,ubah,hapus'),
    ('actual_harian', 'absensi', 'tambah,ubah,hapus'),
    ('motor', 'motor', 'tambah,ubah'),
    ('servis_motor', 'servis', 'tambah,ubah,hapus'),
    ('kerusakan_motor', 'kerusakan', 'tambah,ubah,hapus'),
    ('permintaan_servis', 'pengajuan servis', 'ubah'),
    ('periode_kunci', 'kunci periode', 'tambah')
  ) as x(tabel, label, op) loop
    if t.op like '%tambah%' then
      execute format('create trigger riwayat_tambah after insert on %I referencing new table as new_rows for each statement execute function catat_tambah(%L)', t.tabel, t.label);
    end if;
    if t.op like '%ubah%' then
      execute format('create trigger riwayat_ubah after update on %I referencing old table as old_rows new table as new_rows for each statement execute function catat_ubah(%L)', t.tabel, t.label);
    end if;
    if t.op like '%hapus%' then
      execute format('create trigger riwayat_hapus after delete on %I referencing old table as old_rows for each statement execute function catat_hapus(%L)', t.tabel, t.label);
    end if;
  end loop;
end $$;

-- fungsi baru default-nya bisa dieksekusi anon di Supabase → cabut (trigger tetap jalan tanpa hak eksekusi)
revoke execute on function riwayat_nilai(text, text), riwayat_diff(jsonb, jsonb), riwayat_teks(jsonb), riwayat_objek(text, jsonb),
  riwayat_ds(text, jsonb), catat_riwayat(text, text, text, jsonb, int, jsonb), catat_tambah(), catat_hapus(), catat_ubah() from public, anon, authenticated;
