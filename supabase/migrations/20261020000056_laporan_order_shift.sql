-- Laporan order per shift: satu rider bisa melapor sekali per shift per hari (Pagi, Middle, Siang).
-- Shift dipilih rider sendiri dan tidak dicocokkan dengan jadwal (rider bisa saja menggantikan atau tukar shift).
-- Laporan yang sudah masuk sebelum migrasi ini otomatis bershift 'pagi'.

alter table laporan_order add column if not exists shift text not null default 'pagi' check (shift in ('pagi', 'tengah', 'siang'));
alter table laporan_order drop constraint if exists laporan_order_tanggal_rider_id_key;
create unique index if not exists laporan_order_tanggal_rider_shift on laporan_order (tanggal, rider_id, shift);
