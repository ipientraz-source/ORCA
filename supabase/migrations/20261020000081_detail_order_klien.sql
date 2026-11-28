-- Detail order klien: baris per rider per hari (kode mitra) dan ringkasan per hari per toko, dengan paginasi dari database.
-- Hanya membaca, dibatasi ke toko milik satu klien, Super-admin saja untuk sekarang (login klien menyusul dan memakai fungsi yang sama).
-- Nama rider tidak pernah disimpan, jadi yang tampil hanya kode mitra. p_cari mencari sebagian kode mitra (huruf besar-kecil tidak berpengaruh).
-- Urutan tetap: tanggal terbaru dulu, lalu toko, lalu kode mitra. p_limit dibatasi 1 sampai 200 per panggilan. kolom total = jumlah seluruh baris
-- yang cocok (bukan hanya halaman ini), dipakai untuk paginasi dan unduhan.

create function dashboard_klien_detail_rider(p_klien uuid, p_dari date, p_sampai date, p_ds uuid[] default null, p_cari text default null,
                                             p_limit int default 50, p_offset int default 0)
returns table (tanggal date, ds_id uuid, ds_nama text, kode_toko text, kode_mtr text, selesai int, ontime int, late int, pod_sesuai int, pod_tidak int, total bigint)
language sql stable as $$
  select o.tanggal, d.id, d.nama, d.kode_toko, o.kode_mtr, o.selesai, o.ontime, o.late, o.pod_sesuai, o.pod_tidak, count(*) over ()
  from order_klien o join ds d on d.id = o.ds_id
  where d.klien_id = p_klien and (select is_super()) and p_sampai - p_dari between 0 and 400
    and o.tanggal between p_dari and p_sampai and (p_ds is null or o.ds_id = any(p_ds))
    and (coalesce(btrim(p_cari), '') = ''
         or o.kode_mtr ilike '%' || replace(replace(replace(btrim(p_cari), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by o.tanggal desc, d.nama, o.kode_mtr
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
$$;

create function dashboard_klien_detail_hari(p_klien uuid, p_dari date, p_sampai date, p_ds uuid[] default null,
                                            p_limit int default 50, p_offset int default 0)
returns table (tanggal date, ds_id uuid, ds_nama text, kode_toko text, selesai bigint, ontime bigint, late bigint, pod_sesuai bigint, pod_tidak bigint,
               rider bigint, total bigint)
language sql stable as $$
  select o.tanggal, d.id, d.nama, d.kode_toko, sum(o.selesai), sum(o.ontime), sum(o.late), sum(o.pod_sesuai), sum(o.pod_tidak), count(*), count(*) over ()
  from order_klien o join ds d on d.id = o.ds_id
  where d.klien_id = p_klien and (select is_super()) and p_sampai - p_dari between 0 and 400
    and o.tanggal between p_dari and p_sampai and (p_ds is null or o.ds_id = any(p_ds))
  group by o.tanggal, d.id, d.nama, d.kode_toko
  order by o.tanggal desc, d.nama
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
$$;

revoke execute on function dashboard_klien_detail_rider(uuid, date, date, uuid[], text, int, int), dashboard_klien_detail_hari(uuid, date, date, uuid[], int, int) from public, anon;
grant execute on function dashboard_klien_detail_rider(uuid, date, date, uuid[], text, int, int), dashboard_klien_detail_hari(uuid, date, date, uuid[], int, int) to authenticated;
