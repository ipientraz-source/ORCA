-- Status baru: tukar_libur (dipisah dari migrasi berikutnya karena nilai enum baru baru bisa dipakai setelah transaksinya selesai).
alter type actual_status_t add value if not exists 'tukar_libur';
