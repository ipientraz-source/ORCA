-- Daftar Jadwal masih "statement timeout" untuk Arcon walau aturan baca jadwal sudah dipercepat (0039).
-- Penyebab sebenarnya: ringkasan_jadwal berjalan sebagai SECURITY INVOKER, jadi setiap baris jadwal dan ds yang dibaca
-- masih diperiksa aturan RLS (fungsi peran dipanggil per baris). Kecepatannya bergantung pada rencana kueri dan ukuran data.
-- Perbaikan: fungsi berjalan sebagai SECURITY DEFINER dan membatasi DS sendiri, SEKALI di awal:
--   Super-admin = semua DS; Arcon = hanya DS yang dipegangnya (my_ds_ids()); peran lain ditolak seperti sebelumnya.
-- Hasil yang terlihat per peran sama persis dengan sebelumnya; hanya tidak ada lagi pengecekan per baris.
create or replace function ringkasan_jadwal(p_dari date, p_sampai date)
returns table (ds_id uuid, ds_nama text, minggu date, rider int, shift int, libur_kunci int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_super boolean := is_super();
  v_ds uuid[] := my_ds_ids();
begin
  if not (v_super or my_peran() = 'arcon') then
    raise exception 'Hanya Super-admin dan Arcon yang bisa melihat daftar jadwal semua DS';
  end if;
  if p_sampai < p_dari or p_sampai - p_dari > 400 then
    raise exception 'Rentang tanggal tidak valid (maks 400 hari)';
  end if;
  return query
    select j.ds_id, d.nama, date_trunc('week', j.tanggal)::date,
           (count(distinct j.rider_id) filter (where j.shift <> 'off'))::int,
           (count(*) filter (where j.shift <> 'off'))::int,
           (count(*) filter (where j.shift = 'off'))::int
    from jadwal j join ds d on d.id = j.ds_id
    where j.tanggal between p_dari and p_sampai
      and (v_super or j.ds_id = any (v_ds))
    group by j.ds_id, d.nama, date_trunc('week', j.tanggal)
    order by 3 desc, 2;
end $$;
