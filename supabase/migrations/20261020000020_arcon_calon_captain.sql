-- Arcon boleh menunjuk Captain dari rider di DS itu ATAU rider aktif yang belum punya DS (mis. rider baru yang belum ditempatkan).
-- Rider yang sudah di DS lain tetap tidak bisa ditarik oleh Arcon (itu hak Super-admin), supaya tidak mengambil rider dari Captain lain.
-- Menggantikan tunjuk_captain dari migrasi 0018; selain pemeriksaan calon Captain, isinya sama.

create or replace function tunjuk_captain(p_ds uuid, p_rider uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare v_old uuid;
begin
  if not (is_super() or (my_peran() = 'arcon' and p_ds = any(my_ds_ids()))) then
    raise exception 'Hanya Super-admin, atau Arcon yang memegang DS ini';
  end if;
  if not is_super() and not exists (select 1 from riders where id = p_rider and status = 'aktif' and (ds_id = p_ds or ds_id is null)) then
    raise exception 'Arcon hanya bisa memilih Captain dari rider aktif di DS itu atau rider yang belum punya DS';
  end if;
  if coalesce(trim(p_email), '') = '' then raise exception 'Email Captain wajib diisi'; end if;
  select captain_id into v_old from ds where id = p_ds;
  if not found then raise exception 'DS tidak ditemukan'; end if;
  if exists (select 1 from ds where captain_id = p_rider and id <> p_ds) then
    raise exception 'Rider ini sudah menjadi Captain DS lain';
  end if;
  update riders set peran = 'captain', email = p_email, ds_id = p_ds, status = 'aktif'
    where id = p_rider and peran in ('rider', 'captain');
  if not found then raise exception 'Rider tidak ditemukan (Super-admin tidak bisa dijadikan Captain)'; end if;
  update ds set captain_id = p_rider where id = p_ds;
  -- Captain lama yang tak memegang DS lain kembali jadi rider biasa
  if v_old is not null and v_old <> p_rider and not exists (select 1 from ds where captain_id = v_old) then
    update riders set peran = 'rider' where id = v_old and peran = 'captain';
  end if;
end $$;
