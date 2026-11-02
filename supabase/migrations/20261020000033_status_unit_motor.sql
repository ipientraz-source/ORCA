-- Status unit motor: active (masih dipakai armada) atau return (sudah dikembalikan).
-- Terpisah dari kolom "status" yang sudah ada (dipakai / di gudang / perbaikan) karena itu diturunkan otomatis dari pemegang dan laporan kerusakan.
alter table motor add column status_unit text not null default 'active' check (status_unit in ('active', 'return'));
