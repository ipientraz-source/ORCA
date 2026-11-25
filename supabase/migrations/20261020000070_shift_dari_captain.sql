-- Shift rider yang hanya sekali clock-in tidak lagi mengikuti jadwal Orca secara membabi buta (0067). Urutan acuannya sekarang:
--   1. laporan Captain (shift_dikerjakan): sudah mencakup tukar shift dan backup/pengganti, jadi jadwal yang meleset tidak menyesatkan
--   2. belum dilaporkan (mis. hari ini, absensi Captain belum diisi): jadwal Orca, tapi hanya bila clock-in wajar untuk shift itu,
--      yaitu tidak lebih dari 2 jam sebelum jam mulai shift tersebut
--   3. selain itu: dari jam clock-in
-- Contoh: rider terjadwal Siang (mulai 14:00) yang clock-in 06:07 dibaca Pagi, bukan mengisi Siang sebelum shift Siang dimulai.
-- Rider dengan dua clock-in atau lebih tetap dibaca dari jam (long shift). Bentuk hasil sama seperti 0067; aktual_bo_harian tidak berubah.

drop function if exists aktual_bo(date, date);

create or replace function aktual_bo(p_dari date, p_sampai date)
returns table (tanggal date, ds_id uuid, ds_nama text, kebutuhan int, terpenuhi int, hadir int, tepat int, captain int, diabsen int, tanpa_orca int,
               b_pagi int, h_pagi int, t_pagi int, b_tengah int, h_tengah int, t_tengah int, b_siang int, h_siang int, t_siang int)
language sql stable security definer set search_path = public as $$
  with a as (select * from pengaturan_kehadiran where id = 1),
  izin as (
    select d.id, d.nama, d.kuota_pagi, d.kuota_tengah, d.kuota_siang from ds d
    where is_super() or (my_peran() = 'arcon' and d.id = any(my_ds_ids()))
  ),
  -- Clock-in dibaca per mitra DAN per shift. Clock-in pertama tiap rider per DS per hari selalu dihitung; clock-in berikutnya dihitung bila jaraknya
  -- 5 jam atau lebih dari yang pertama (rider yang jalan dua shift atau long shift). Clock-in ulang dalam waktu singkat (mis. 06:00 lalu 06:01) diabaikan.
  k as (
    select b.tanggal, b.ds_id, b.kode_mtr, b.masuk_lokal,
           min(b.masuk_lokal) over (partition by b.tanggal, b.ds_id, b.kode_mtr) as pertama
    from kehadiran_bo b join izin on izin.id = b.ds_id
    where b.tanggal between p_dari and least(p_sampai, today_wib())
  ),
  o as (
    select k.*, count(*) over (partition by k.tanggal, k.ds_id, k.kode_mtr) as n
    from k where k.masuk_lokal = k.pertama or k.masuk_lokal >= k.pertama + interval '5 hours'
  ),
  -- Shift laporan Captain per rider per DS per hari; dipakai hanya bila Captain mencatat satu shift saja untuk rider itu.
  sk as (
    select sd.tanggal, sd.ds_id, r.kode_mtr, min(sd.shift::text) as shift
    from shift_dikerjakan(p_dari, least(p_sampai, today_wib())) sd join riders r on r.id = sd.rider_id
    where sd.shift::text in ('pagi', 'tengah', 'siang') and r.kode_mtr is not null
    group by sd.tanggal, sd.ds_id, r.kode_mtr having count(distinct sd.shift::text) = 1
  ),
  -- Shift tiap clock-in: rider yang hanya sekali clock-in mengikuti laporan Captain, lalu jadwal bila clock-in wajar (paling awal 2 jam sebelum jam mulai), selain itu jam masuk.
  -- Satu rider dihitung sekali per shift (clock-in paling awal di shift itu); tepat waktu dinilai dari clock-in tersebut.
  s as (
    select distinct on (o.tanggal, o.ds_id, o.kode_mtr, sh.shift)
           o.tanggal, o.ds_id, o.kode_mtr, sh.shift,
           o.masuk_lokal <= (case sh.shift when 'pagi' then a.mulai_pagi when 'tengah' then a.mulai_tengah else a.mulai_siang end)::time + make_interval(mins => a.toleransi_menit) as tepat,
           not exists (select 1 from riders r where r.kode_mtr = o.kode_mtr) as tanpa
    from o cross join a
    cross join lateral (
      select case when o.n = 1 then coalesce(
          (select sk.shift from sk where sk.tanggal = o.tanggal and sk.ds_id = o.ds_id and sk.kode_mtr = o.kode_mtr),
          (select j.shift::text from riders r join jadwal j on j.rider_id = r.id
            where r.kode_mtr = o.kode_mtr and j.tanggal = o.tanggal and j.ds_id = o.ds_id and j.shift <> 'off'
              and o.masuk_lokal >= (case j.shift::text when 'pagi' then a.mulai_pagi when 'tengah' then a.mulai_tengah else a.mulai_siang end)::time - interval '2 hours'
            limit 1),
          case when o.masuk_lokal <= a.batas_pagi::time then 'pagi' when o.masuk_lokal <= a.batas_tengah::time then 'tengah' else 'siang' end)
        else case when o.masuk_lokal <= a.batas_pagi::time then 'pagi' when o.masuk_lokal <= a.batas_tengah::time then 'tengah' else 'siang' end
      end as shift
    ) sh
    order by o.tanggal, o.ds_id, o.kode_mtr, sh.shift, o.masuk_lokal
  ),
  h as (
    select s.tanggal, s.ds_id,
           (count(*) filter (where s.shift = 'pagi'))::int as hp, (count(*) filter (where s.shift = 'pagi' and s.tepat))::int as tp,
           (count(*) filter (where s.shift = 'tengah'))::int as ht, (count(*) filter (where s.shift = 'tengah' and s.tepat))::int as tt,
           (count(*) filter (where s.shift = 'siang'))::int as hs, (count(*) filter (where s.shift = 'siang' and s.tepat))::int as ts,
           (count(distinct s.kode_mtr) filter (where s.tanpa))::int as tanpa
    from s group by s.tanggal, s.ds_id
  ),
  c as (
    select sd.tanggal, sd.ds_id, count(*)::int as n
    from shift_dikerjakan(p_dari, least(p_sampai, today_wib())) sd join izin on izin.id = sd.ds_id
    group by sd.tanggal, sd.ds_id
  ),
  ab as (
    select ah.tanggal, ah.ds_id, count(*)::int as n
    from actual_harian ah join izin on izin.id = ah.ds_id
    where ah.tanggal between p_dari and least(p_sampai, today_wib())
    group by ah.tanggal, ah.ds_id
  ),
  hari as (
    select g::date as tanggal from generate_series(p_dari::timestamp, least(p_sampai, today_wib())::timestamp, interval '1 day') g
    where p_sampai - p_dari between 0 and 92
  ),
  x as (
    select hr.tanggal, d.id as ds_id, d.nama,
           coalesce(kh.kuota_pagi, d.kuota_pagi) as bp, coalesce(kh.kuota_tengah, d.kuota_tengah) as bt, coalesce(kh.kuota_siang, d.kuota_siang) as bs,
           coalesce(h.hp, 0) as hp, coalesce(h.tp, 0) as tp, coalesce(h.ht, 0) as ht, coalesce(h.tt, 0) as tt, coalesce(h.hs, 0) as hs, coalesce(h.ts, 0) as ts,
           coalesce(c.n, 0) as cap, coalesce(ab.n, 0) as dia, coalesce(h.tanpa, 0) as tanpa
    from hari hr cross join izin d
    left join kuota_harian kh on kh.ds_id = d.id and kh.tanggal = hr.tanggal
    left join h on h.tanggal = hr.tanggal and h.ds_id = d.id
    left join c on c.tanggal = hr.tanggal and c.ds_id = d.id
    left join ab on ab.tanggal = hr.tanggal and ab.ds_id = d.id
    where h.ds_id is not null or exists (select 1 from jadwal j where j.tanggal = hr.tanggal and j.ds_id = d.id and j.shift <> 'off')
  )
  select x.tanggal, x.ds_id, x.nama, x.bp + x.bt + x.bs, least(x.hp, x.bp) + least(x.ht, x.bt) + least(x.hs, x.bs), x.hp + x.ht + x.hs, x.tp + x.tt + x.ts, x.cap, x.dia, x.tanpa,
         x.bp, x.hp, x.tp, x.bt, x.ht, x.tt, x.bs, x.hs, x.ts
  from x order by x.tanggal, x.nama
$$;
revoke execute on function aktual_bo(date, date) from public, anon;
grant execute on function aktual_bo(date, date) to authenticated;
