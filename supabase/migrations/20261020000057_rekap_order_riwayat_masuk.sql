-- Rekap order untuk dashboard Captain, Arcon, dan Super-admin, serta riwayat masuk (absensi) untuk rider.
-- Tiga fungsi rekap berhak pemanggil (security invoker): RLS laporan_order, jadwal, dan riders tetap berlaku, ditambah filter DS eksplisit.
-- Rentang maksimal 93 hari supaya satu panggilan tidak menyapu seluruh tabel.

-- Perbandingan antar DS: total order, jumlah rider yang melapor, dan kepatuhan (hari-rider terjadwal yang sudah ada laporannya).
create or replace function rekap_order_ds(p_dari date, p_sampai date)
returns table (ds_id uuid, ds_nama text, total_order bigint, rider_lapor bigint, hari_rider_jadwal bigint, hari_rider_lapor bigint)
language sql stable as $$
  select d.id, d.nama,
    coalesce((select sum(o.jumlah_order) from laporan_order o where o.ds_id = d.id and o.tanggal between p_dari and p_sampai), 0)::bigint,
    (select count(distinct o.rider_id) from laporan_order o where o.ds_id = d.id and o.tanggal between p_dari and p_sampai),
    (select count(*) from (select distinct j.tanggal, j.rider_id from jadwal j
       where j.ds_id = d.id and j.shift <> 'off' and j.tanggal between p_dari and p_sampai) x),
    (select count(*) from (select distinct j.tanggal, j.rider_id from jadwal j
       where j.ds_id = d.id and j.shift <> 'off' and j.tanggal between p_dari and p_sampai
         and exists (select 1 from laporan_order o where o.tanggal = j.tanggal and o.rider_id = j.rider_id)) x)
  from ds d
  where p_sampai - p_dari between 0 and 92
    and ((select is_super()) or d.id = any ((select my_ds_ids())::uuid[]))
  order by 3 desc, d.nama
$$;

-- Per rider di satu DS: total order, hari melapor, hari terjadwal.
create or replace function rekap_order_rider(p_dari date, p_sampai date, p_ds uuid)
returns table (rider_id uuid, nama text, kode_mtr text, total_order bigint, hari_lapor bigint, hari_jadwal bigint)
language sql stable as $$
  select r.id, r.nama, r.kode_mtr,
    coalesce((select sum(o.jumlah_order) from laporan_order o where o.rider_id = r.id and o.tanggal between p_dari and p_sampai), 0)::bigint,
    (select count(distinct o.tanggal) from laporan_order o where o.rider_id = r.id and o.tanggal between p_dari and p_sampai),
    (select count(distinct j.tanggal) from jadwal j where j.rider_id = r.id and j.shift <> 'off' and j.tanggal between p_dari and p_sampai)
  from riders r
  where r.ds_id = p_ds and r.peran = 'rider' and p_sampai - p_dari between 0 and 92
    and ((select is_super()) or p_ds = any ((select my_ds_ids())::uuid[]))
    and (r.status = 'aktif' or exists (select 1 from laporan_order o where o.rider_id = r.id and o.tanggal between p_dari and p_sampai))
  order by 4 desc, r.nama
$$;

-- Tren harian per shift (p_ds kosong = semua DS yang boleh dilihat pemanggil).
create or replace function rekap_order_hari(p_dari date, p_sampai date, p_ds uuid default null)
returns table (tanggal date, shift text, total_order bigint, pelapor bigint)
language sql stable as $$
  select o.tanggal, o.shift, sum(o.jumlah_order)::bigint, count(*)
  from laporan_order o
  where o.tanggal between p_dari and p_sampai and p_sampai - p_dari between 0 and 92 and (p_ds is null or o.ds_id = p_ds)
  group by 1, 2
  order by 1, 2
$$;

revoke execute on function rekap_order_ds(date, date), rekap_order_rider(date, date, uuid), rekap_order_hari(date, date, uuid) from public, anon;
grant execute on function rekap_order_ds(date, date), rekap_order_rider(date, date, uuid), rekap_order_hari(date, date, uuid) to authenticated;

-- Riwayat masuk untuk rider (login Kode MTR, tanpa akun, sama seperti jadwal_rider): status absensi per hari beserta shift,
-- plus hari terjadwal yang belum dicatat Captain ('belum'). Hanya data rider itu sendiri; catatan penjelasan Captain tidak ikut.
create or replace function riwayat_absensi_rider(p_kode text, p_hari int default 60)
returns table (tanggal date, status text, shift text)
language sql stable security definer set search_path = public as $$
  with r as (select id from riders where kode_mtr = upper(trim(p_kode)) and status = 'aktif'),
  h as (select today_wib() - least(greatest(coalesce(p_hari, 60), 1), 90) as dari)
  select a.tanggal, a.status::text,
    coalesce((select sd.shift::text from shift_dikerjakan(a.tanggal, a.tanggal) sd where sd.rider_id = a.rider_id and (sd.sumber = 'pengganti') = (a.status = 'pengganti') limit 1),
             (select j.shift::text from jadwal j where j.tanggal = a.tanggal and j.rider_id = a.rider_id and j.shift <> 'off' limit 1))
  from actual_harian a, r, h
  where a.rider_id = r.id and a.tanggal between h.dari and today_wib()
  union all
  select j.tanggal, 'belum', j.shift::text
  from jadwal j, r, h
  where j.rider_id = r.id and j.shift <> 'off' and j.tanggal between h.dari and today_wib() - 1
    and not exists (select 1 from actual_harian a where a.tanggal = j.tanggal and a.rider_id = j.rider_id)
  order by 1 desc
  limit 120
$$;
revoke execute on function riwayat_absensi_rider(text, int) from public;
grant execute on function riwayat_absensi_rider(text, int) to anon, authenticated;

-- Hari ketika rider tercatat sebagai pengganti (hari ini dan ke depan), untuk penanda di Jadwal Saya. Jadwalnya bisa Libur atau kosong; shift = shift yang ia tutup.
create or replace function pengganti_rider(p_kode text)
returns table (tanggal date, shift text)
language sql stable security definer set search_path = public as $$
  select a.tanggal,
    (select sd.shift::text from shift_dikerjakan(a.tanggal, a.tanggal) sd where sd.rider_id = a.rider_id and sd.sumber = 'pengganti' limit 1)
  from actual_harian a
  where a.status = 'pengganti' and a.tanggal >= today_wib() and a.tanggal <= today_wib() + 14
    and a.rider_id = (select id from riders where kode_mtr = upper(trim(p_kode)) and status = 'aktif')
  order by a.tanggal
$$;
revoke execute on function pengganti_rider(text) from public;
grant execute on function pengganti_rider(text) to anon, authenticated;
