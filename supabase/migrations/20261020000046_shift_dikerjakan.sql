-- Satu definisi "shift yang dikerjakan": siapa benar-benar bekerja di shift apa pada tanggal berapa.
-- Sebelumnya tiap laporan menghitungnya sendiri (Fulfillment dengan tiga ekspresi CASE yang sama), sehingga setiap aturan baru
-- (long shift, tukar dua arah) harus ditambal di beberapa tempat dan beberapa kali meleset. Sekarang satu fungsi, dipakai bersama.
--
-- Satu baris per shift yang dikerjakan (long shift = dua baris untuk satu rider di satu hari):
--   hadir      : mengerjakan shift terjadwalnya sendiri (tanpa jadwal: shift kosong = "lain")
--   pengganti  : mengerjakan shift rider yang digantikannya (tanpa yang digantikan atau tanpa jadwalnya: shift kosong = "lain")
--   tukar      : data lama tanpa rekan: shift sendiri (seperti dulu);
--                dengan rekan terjadwal (tukar dua arah): shift rekannya;
--                dengan rekan yang tidak terjadwal (libur): TIDAK bekerja. Dulu tercatat sebagai "lain", itu salah.
-- alpha, izin, dan sakit tidak bekerja.
-- Fulfillment dan laporan per rider membaca dari sini. Angka Fulfillment tanggal lama tidak berubah, kecuali tukar dengan rekan
-- yang tidak terjadwal (rider yang libur tidak lagi dihitung sebagai tambahan).

create or replace function shift_dikerjakan(p_dari date, p_sampai date)
returns table (tanggal date, ds_id uuid, rider_id uuid, shift shift_t, sumber text)
language sql stable as $$
  select a.tanggal, a.ds_id, a.rider_id, j.shift, 'jadwal'::text
  from actual_harian a
  left join jadwal j on j.tanggal = a.tanggal and j.rider_id = a.rider_id and j.shift <> 'off'
  where a.tanggal between p_dari and p_sampai and a.status = 'hadir'
  union all
  select a.tanggal, a.ds_id, a.rider_id, j.shift, 'pengganti'::text
  from actual_harian a
  left join jadwal j on j.tanggal = a.tanggal and j.rider_id = a.backup_untuk_id and j.shift <> 'off'
  where a.tanggal between p_dari and p_sampai and a.status = 'pengganti'
  union all
  select a.tanggal, a.ds_id, a.rider_id, j.shift, 'tukar'::text
  from actual_harian a
  left join jadwal j on j.tanggal = a.tanggal and j.rider_id = a.rider_id and j.shift <> 'off'
  where a.tanggal between p_dari and p_sampai and a.status = 'tukar' and a.backup_untuk_id is null
  union all
  select a.tanggal, a.ds_id, a.rider_id, j.shift, 'tukar'::text
  from actual_harian a
  join jadwal j on j.tanggal = a.tanggal and j.rider_id = a.backup_untuk_id and j.shift <> 'off'
  where a.tanggal between p_dari and p_sampai and a.status = 'tukar' and a.backup_untuk_id is not null
$$;
revoke execute on function shift_dikerjakan(date, date) from public, anon;
grant execute on function shift_dikerjakan(date, date) to authenticated;

-- Fulfillment: tiga hitungan terpenuhi dibaca dari shift_dikerjakan (diagregasi sekali, bukan per DS per hari)
create or replace function laporan_fulfillment(p_dari date, p_sampai date)
returns table (tanggal date, ds_id uuid, ds_nama text, kebutuhan_pagi int, kebutuhan_siang int,
               terpenuhi_pagi int, terpenuhi_siang int, terpenuhi_lain int, lapor_pagi boolean, lapor_siang boolean, siang_jatuh_tempo boolean)
language sql stable as $$
  with w as (
    select s.tanggal, s.ds_id,
           (count(*) filter (where s.shift = 'pagi'))::int as pagi,
           (count(*) filter (where s.shift = 'siang'))::int as siang,
           (count(*) filter (where s.shift is null or s.shift not in ('pagi', 'siang')))::int as lain
    from shift_dikerjakan(p_dari, least(p_sampai, today_wib())) s
    group by s.tanggal, s.ds_id
  )
  select g.tgl::date, d.id, d.nama,
    coalesce(k.kuota_pagi, d.kuota_pagi), coalesce(k.kuota_siang, d.kuota_siang),
    coalesce(w.pagi, 0), coalesce(w.siang, 0), coalesce(w.lain, 0),
    exists (select 1 from jadwal j join actual_harian a on a.tanggal = j.tanggal and a.rider_id = j.rider_id and absensi_sendiri(a.status, a.tanggal, a.backup_untuk_id)
            where j.ds_id = d.id and j.tanggal = g.tgl::date and j.shift = 'pagi'),
    exists (select 1 from jadwal j join actual_harian a on a.tanggal = j.tanggal and a.rider_id = j.rider_id and absensi_sendiri(a.status, a.tanggal, a.backup_untuk_id)
            where j.ds_id = d.id and j.tanggal = g.tgl::date and j.shift = 'siang'),
    (g.tgl::date < today_wib() or (now() at time zone 'Asia/Jakarta')::time >= time '22:00')
  from ds d
  cross join generate_series(p_dari::timestamp, least(p_sampai, today_wib())::timestamp, interval '1 day') g(tgl)
  left join kuota_harian k on k.ds_id = d.id and k.tanggal = g.tgl::date
  left join w on w.tanggal = g.tgl::date and w.ds_id = d.id
  where is_super() or d.id = any(my_ds_ids())
  order by g.tgl, d.nama
$$;

-- Laporan per rider: kolom baru shift_kerja = jumlah shift yang dikerjakan (hadir + pengganti + tukar shift; long shift terhitung 2).
-- Dasar menghitung hari kerja untuk gaji. Kolom lain tidak berubah.
drop function laporan_rider(date, date);
create function laporan_rider(p_dari date, p_sampai date)
returns table (rider_id uuid, kode_mtr text, nama text, ds_nama text, dijadwalkan int, hadir int,
               alpha int, izin int, sakit int, tukar int, pengganti int, belum_diisi int, potongan int, insentif bigint, shift_kerja int)
language sql stable as $$
  with x as (
    select coalesce(s.rider_id, a.rider_id) rid, coalesce(s.tanggal, a.tanggal) tgl,
           s.rider_id is not null as sched, a.status, a.potongan, a.insentif
    from (select rider_id, tanggal from jadwal where shift <> 'off' and tanggal between p_dari and p_sampai) s
    full join (select rider_id, tanggal, status, backup_untuk_id, potongan, insentif from actual_harian where tanggal between p_dari and p_sampai) a
      on a.rider_id = s.rider_id and a.tanggal = s.tanggal and absensi_sendiri(a.status, a.tanggal, a.backup_untuk_id)
  ),
  kerja as (
    select s.rider_id, count(*)::int as n from shift_dikerjakan(p_dari, p_sampai) s group by s.rider_id
  )
  select r.id, r.kode_mtr, r.nama, d.nama,
    (count(*) filter (where x.sched))::int,
    (count(*) filter (where x.status = 'hadir'))::int,
    (count(*) filter (where x.status = 'alpha'))::int,
    (count(*) filter (where x.status = 'izin'))::int,
    (count(*) filter (where x.status = 'sakit'))::int,
    (count(*) filter (where x.status = 'tukar'))::int,
    (count(*) filter (where x.status = 'pengganti'))::int,
    (count(*) filter (where x.sched and x.status is null and x.tgl <= today_wib()))::int,
    (count(*) filter (where x.potongan))::int,
    (coalesce(sum(x.insentif) filter (where x.status = 'pengganti'), 0))::bigint,
    coalesce(max(k.n), 0)::int
  from x join riders r on r.id = x.rid left join ds d on d.id = r.ds_id left join kerja k on k.rider_id = r.id
  group by r.id, r.kode_mtr, r.nama, d.nama
  order by r.nama
$$;
revoke execute on function laporan_rider(date, date) from public, anon;
grant execute on function laporan_rider(date, date) to authenticated;
