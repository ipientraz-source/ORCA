-- Rider dengan produktivitas order tertinggi, lintas DS yang boleh dilihat pemanggil (untuk kartu "Rider teratas" di Dashboard).
-- Produktivitas = rata-rata order per HARI LAPOR (total order dibagi jumlah hari yang ada laporan order). Rider baru melapor sehari dua hari tidak
-- boleh jadi juara palsu, jadi ada batas minimal hari lapor (p_min_hari, bawaan 5). Rentang maksimal 92 hari seperti rekap order lainnya.
-- Hak pemanggil sama dengan rekap_order_rider: Super-admin semua DS, Captain dan Arcon hanya DS yang dipegang. Hanya membaca.

create or replace function rekap_order_rider_teratas(p_dari date, p_sampai date, p_min_hari int default 5, p_limit int default 5)
returns table (rider_id uuid, nama text, kode_mtr text, ds_id uuid, ds_nama text, total_order bigint, hari_lapor bigint, rata numeric)
language sql stable as $$
  select r.id, r.nama, r.kode_mtr, r.ds_id, d.nama, s.total, s.hari, round(s.total::numeric / s.hari, 1)
  from riders r
  join ds d on d.id = r.ds_id
  cross join lateral (
    select coalesce(sum(o.jumlah_order), 0)::bigint as total, count(distinct o.tanggal)::bigint as hari
    from laporan_order o where o.rider_id = r.id and o.tanggal between p_dari and p_sampai
  ) s
  where r.peran = 'rider' and p_sampai - p_dari between 0 and 92
    and ((select is_super()) or r.ds_id = any ((select my_ds_ids())::uuid[]))
    and s.hari >= greatest(coalesce(p_min_hari, 5), 1)
  order by 8 desc, 6 desc, r.nama
  limit least(greatest(coalesce(p_limit, 5), 1), 50)
$$;

revoke execute on function rekap_order_rider_teratas(date, date, int, int) from public, anon;
grant execute on function rekap_order_rider_teratas(date, date, int, int) to authenticated;
