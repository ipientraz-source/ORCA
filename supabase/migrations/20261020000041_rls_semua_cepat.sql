-- Pola yang sama seperti 0039, diterapkan ke SEMUA aturan baca yang masih memanggil fungsi peran per baris.
-- Di Postgres, is_super(), my_peran(), is_admin(), me(), my_ds_ids() yang ditulis telanjang di aturan RLS dievaluasi ulang
-- untuk setiap baris, dan tiap panggilan membaca tabel riders/ds. Waktu baca tabel besar (riders, notifikasi, log_aktivitas,
-- motor, kandidat, ...) naik sebanding jumlah SELURUH baris di tabel, bukan hanya baris milik pemanggil. Di data uji 2.000 rider,
-- Arcon butuh 4,8 detik hanya untuk membuka daftar rider, dan laporan per rider 4,5 detik; di data produksi yang lebih besar
-- ini berujung "statement timeout" seperti Daftar Jadwal.
-- Perbaikan: bungkus dengan (select ...) agar dievaluasi sekali per kueri. Arti aturan TIDAK berubah (siapa boleh melihat
-- baris apa persis sama); hanya cara evaluasinya. Teks di bawah dihasilkan dari definisi aturan yang berlaku setelah 0040.

drop policy ds_read on ds;
create policy ds_read on ds for select to authenticated
  using ((select is_admin()));

drop policy ds_write on ds;
create policy ds_write on ds for all to authenticated
  using ((select is_super()))
  with check ((select is_super()));

drop policy kandidat_read on kandidat;
create policy kandidat_read on kandidat for select to authenticated
  using (((select is_super()) OR ((select my_peran()) = 'recruiter'::peran_t) OR (((select my_peran()) = ANY (ARRAY['captain'::peran_t, 'arcon'::peran_t])) AND (ds_id = ANY (((select my_ds_ids())::uuid[]))))));

drop policy kuota_read on kuota_harian;
create policy kuota_read on kuota_harian for select to authenticated
  using (((select is_super()) OR (ds_id = ANY (((select my_ds_ids())::uuid[])))));

drop policy log_read on log_aktivitas;
create policy log_read on log_aktivitas for select to authenticated
  using (((select is_super()) OR (ds_id = ANY (((select my_ds_ids())::uuid[]))) OR (captain_id = (select me())) OR (captain_id IN ( SELECT ds.captain_id FROM ds WHERE ((ds.id = ANY (((select my_ds_ids())::uuid[]))) AND (ds.captain_id IS NOT NULL))))));

drop policy motor_read on motor;
create policy motor_read on motor for select to authenticated
  using (((select is_super()) OR (ds_id = ANY (((select my_ds_ids())::uuid[])))));

drop policy motor_dihapus_read on motor_dihapus;
create policy motor_dihapus_read on motor_dihapus for select to authenticated
  using ((select is_super()));

drop policy notif_read on notifikasi;
create policy notif_read on notifikasi for select to authenticated
  using ((penerima_id = (select me())));

drop policy pengajuan_read on pengajuan_arcon;
create policy pengajuan_read on pengajuan_arcon for select to authenticated
  using (((select is_super()) OR (pemohon_id = (select me()))));

drop policy kunci_read on periode_kunci;
create policy kunci_read on periode_kunci for select to authenticated
  using (((select is_super()) OR (ds_id = ANY (((select my_ds_ids())::uuid[])))));

drop policy permintaan_dihapus_read on permintaan_dihapus;
create policy permintaan_dihapus_read on permintaan_dihapus for select to authenticated
  using ((select is_super()));

drop policy pindah_read on perpindahan_motor;
create policy pindah_read on perpindahan_motor for select to authenticated
  using (((select is_super()) OR (dari_ds = ANY (((select my_ds_ids())::uuid[]))) OR (ke_ds = ANY (((select my_ds_ids())::uuid[])))));

drop policy pindah_read on perpindahan_rider;
create policy pindah_read on perpindahan_rider for select to authenticated
  using (((select is_super()) OR (dari_ds = ANY (((select my_ds_ids())::uuid[]))) OR (ke_ds = ANY (((select my_ds_ids())::uuid[])))));

drop policy peristiwa_read on rider_peristiwa;
create policy peristiwa_read on rider_peristiwa for select to authenticated
  using ((select is_super()));

drop policy riders_read on riders;
create policy riders_read on riders for select to authenticated
  using (((select is_super()) OR (((select my_peran()) = ANY (ARRAY['captain'::peran_t, 'arcon'::peran_t])) AND ((ds_id = ANY (((select my_ds_ids())::uuid[]))) OR (id = (select me()))))));

drop policy riders_read_self on riders;
create policy riders_read_self on riders for select to authenticated
  using ((((select my_peran()) = 'recruiter'::peran_t) AND (id = (select me()))));
