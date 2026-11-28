-- Bahan Dashboard Klien: angka kinerja antar dari unggahan klien (order_klien) dan angka kehadiran dari clock-in BO (aktual_bo), dibatasi ke toko milik satu klien.
-- Semua hanya membaca. Untuk saat ini hanya Super-admin ("Lihat sebagai klien"); login klien menyusul dan akan memakai fungsi yang sama.
-- Satu angka resmi per ukuran: ketepatan antar = ontime / pesanan selesai, POD sesuai = POD sesuai / pesanan selesai. Hari tanpa unggahan tidak muncul
-- (bukan 0), supaya tidak terbaca sebagai kinerja nol. Rentang maksimal 400 hari; di luar itu hasilnya kosong.
-- p_ds (opsional) menyaring ke beberapa toko saja; toko yang bukan milik klien itu tetap tidak ikut.

-- Rentang tanggal yang sudah punya data untuk klien ini (kosong bila belum ada unggahan)
create function dashboard_klien_rentang(p_klien uuid)
returns table (awal date, akhir date, hari int)
language sql stable as $$
  select min(o.tanggal), max(o.tanggal), count(distinct o.tanggal)::int
  from order_klien o join ds d on d.id = o.ds_id
  where d.klien_id = p_klien and (select is_super())
  having count(*) > 0
$$;

-- Total per hari. rider_hari = jumlah baris rider-hari (satu rider satu toko satu hari), dasar "pesanan per rider per hari".
create function dashboard_klien_harian(p_klien uuid, p_dari date, p_sampai date, p_ds uuid[] default null)
returns table (tanggal date, selesai bigint, ontime bigint, late bigint, pod_sesuai bigint, pod_tidak bigint, rider_hari bigint)
language sql stable as $$
  select o.tanggal, sum(o.selesai), sum(o.ontime), sum(o.late), sum(o.pod_sesuai), sum(o.pod_tidak), count(*)
  from order_klien o join ds d on d.id = o.ds_id
  where d.klien_id = p_klien and (select is_super()) and p_sampai - p_dari between 0 and 400
    and o.tanggal between p_dari and p_sampai and (p_ds is null or o.ds_id = any(p_ds))
  group by o.tanggal order by o.tanggal
$$;

-- Total per toko selama rentang
create function dashboard_klien_toko(p_klien uuid, p_dari date, p_sampai date, p_ds uuid[] default null)
returns table (ds_id uuid, ds_nama text, kode_toko text, selesai bigint, ontime bigint, late bigint, pod_sesuai bigint, pod_tidak bigint, rider_hari bigint, hari bigint)
language sql stable as $$
  select d.id, d.nama, d.kode_toko, sum(o.selesai), sum(o.ontime), sum(o.late), sum(o.pod_sesuai), sum(o.pod_tidak), count(*), count(distinct o.tanggal)
  from order_klien o join ds d on d.id = o.ds_id
  where d.klien_id = p_klien and (select is_super()) and p_sampai - p_dari between 0 and 400
    and o.tanggal between p_dari and p_sampai and (p_ds is null or o.ds_id = any(p_ds))
  group by d.id, d.nama, d.kode_toko
  order by d.nama
$$;

-- Angka dari Dash (clock-in BO) untuk toko klien ini: kebutuhan rider, yang terpenuhi, hadir, dan tepat waktu masuk, per hari.
-- Sama dengan angka di Dashboard ORCA (aktual_bo), hanya dibatasi ke toko klien.
create function dashboard_klien_bo(p_klien uuid, p_dari date, p_sampai date, p_ds uuid[] default null)
returns table (tanggal date, kebutuhan bigint, terpenuhi bigint, hadir bigint, tepat bigint)
language sql stable as $$
  select a.tanggal, sum(a.kebutuhan), sum(a.terpenuhi), sum(a.hadir), sum(a.tepat)
  from aktual_bo(p_dari, p_sampai) a
  where a.ds_id in (select d.id from ds d where d.klien_id = p_klien) and (select is_super()) and p_sampai - p_dari between 0 and 400
    and (p_ds is null or a.ds_id = any(p_ds))
  group by a.tanggal order by a.tanggal
$$;

revoke execute on function dashboard_klien_rentang(uuid), dashboard_klien_harian(uuid, date, date, uuid[]), dashboard_klien_toko(uuid, date, date, uuid[]),
  dashboard_klien_bo(uuid, date, date, uuid[]) from public, anon;
grant execute on function dashboard_klien_rentang(uuid), dashboard_klien_harian(uuid, date, date, uuid[]), dashboard_klien_toko(uuid, date, date, uuid[]),
  dashboard_klien_bo(uuid, date, date, uuid[]) to authenticated;
