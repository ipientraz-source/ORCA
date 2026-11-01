-- Peran baru: Recruiter (tim rekrutmen rider).
-- Dipisah dari migrasi berikutnya karena nilai enum baru tidak boleh dipakai dalam transaksi yang sama
-- dengan penambahannya. Jalankan file ini LEBIH DULU dan sendirian, baru jalankan 20261020000029_rekrutmen.sql.
alter type peran_t add value if not exists 'recruiter';
