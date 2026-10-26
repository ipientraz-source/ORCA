-- Hapus motor hanya Super-admin (motor salah input, mis. salah plat). Arcon tetap boleh menambah dan mengubah motor DS yang dipegang.
-- Servis, kerusakan, perpindahan, dan item pengajuan motor itu ikut terhapus (on delete cascade).
drop policy motor_write on motor;
create policy motor_insert on motor for insert to authenticated
  with check (is_super() or (my_peran() = 'arcon' and ds_id = any(my_ds_ids())));
create policy motor_update on motor for update to authenticated
  using (is_super() or (my_peran() = 'arcon' and ds_id = any(my_ds_ids())))
  with check (is_super() or (my_peran() = 'arcon' and ds_id = any(my_ds_ids())));
create policy motor_delete on motor for delete to authenticated using (is_super());

-- Item pengajuan yang terhapus (motornya dihapus) bisa membuat pengajuan induknya selesai: sinkronkan juga saat delete
create trigger permintaan_sinkron_hapus_t after delete on permintaan_servis_item for each row execute function permintaan_sinkron();
