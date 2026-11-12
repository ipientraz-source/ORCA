-- Arcon boleh menghapus motor, tetapi hanya motor di DS yang dipegangnya. Super-admin tetap boleh semua motor.
-- Syarat lain tidak berubah: alasan wajib, dan tercatat di motor_dihapus (dilihat Super-admin) serta log aktivitas.
-- Hapus langsung lewat tabel tetap tertutup; satu-satunya jalan adalah hapus_motor(motor, alasan).
create or replace function hapus_motor(p_motor uuid, p_alasan text) returns void
language plpgsql security definer set search_path = public as $$
declare m motor%rowtype;
begin
  if not (is_super() or my_peran() = 'arcon') then raise exception 'Hanya Super-admin atau Arcon yang bisa menghapus motor'; end if;
  if length(trim(coalesce(p_alasan, ''))) = 0 then raise exception 'Alasan penghapusan wajib diisi'; end if;
  select * into m from motor where id = p_motor;
  if not found then raise exception 'Motor tidak ditemukan'; end if;
  if not is_super() and not (m.ds_id = any(my_ds_ids())) then raise exception 'Arcon hanya bisa menghapus motor di DS yang dipegang'; end if;
  insert into motor_dihapus (motor_id, kode_motor, plat_nomor, ds_id, alasan, jumlah_servis, jumlah_kerusakan, data, dihapus_oleh)
    values (m.id, m.kode_motor, m.plat_nomor, m.ds_id, trim(p_alasan),
            (select count(*) from servis_motor where motor_id = m.id), (select count(*) from kerusakan_motor where motor_id = m.id), to_jsonb(m), me());
  insert into log_aktivitas (captain_id, aksi, detail) values (me(), 'hapus motor', m.kode_motor || ': ' || trim(p_alasan));
  delete from motor where id = m.id;
end $$;
