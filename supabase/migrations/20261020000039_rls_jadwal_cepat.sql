-- Perbaikan performa: halaman Daftar Jadwal (dan pembacaan jadwal luas lainnya) kena "statement timeout" untuk Arcon.
-- Penyebab: aturan baca jadwal dan actual_harian memanggil is_super(), my_peran(), my_ds_ids(), dan me() DI SETIAP BARIS,
-- dan tiap panggilan itu sendiri membaca tabel riders/ds. Untuk Arcon, semua cabang OR harus dievaluasi, jadi ribuan baris
-- jadwal berarti puluhan ribu panggilan. Super-admin lolos di pemeriksaan pertama, itulah kenapa hanya Arcon yang kena.
-- Perbaikan: bungkus fungsi dengan (select ...) agar dievaluasi SEKALI per kueri (InitPlan). Arti aturannya tidak berubah:
-- siapa yang boleh melihat baris apa persis sama (diuji di test/arcon.test.mjs dan test/db.test.mjs).
-- Pengukuran lokal (18.000 baris jadwal, Arcon memegang 2 DS): 69 detik menjadi 0,08 detik, hasil identik.

drop policy jadwal_read on jadwal;
create policy jadwal_read on jadwal for select to authenticated
  using ((select is_super()) or ((select my_peran()) in ('captain', 'arcon') and ds_id = any ((select my_ds_ids())::uuid[])) or rider_id = (select me()));

drop policy actual_read on actual_harian;
create policy actual_read on actual_harian for select to authenticated
  using ((select is_super()) or ((select my_peran()) in ('captain', 'arcon') and ds_id = any ((select my_ds_ids())::uuid[])));
