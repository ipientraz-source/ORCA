-- Sumber data pesan Fulfillment WhatsApp bisa dipilih: absensi Captain (bawaan, seperti sebelumnya) atau clock-in BO (angka yang sama dengan Dashboard BO).
-- Pesan Pengingat Captain tetap dari absensi Captain karena isinya memang rider yang belum diabsen.
--  1. aktual_bo_semua: isi aktual_bo (0073) tanpa pembatas pengguna, hanya untuk fungsi database dan service role; p_ds opsional membatasi DS.
--  2. aktual_bo: pembungkus yang membatasi per pengguna (Super-admin semua DS, Arcon DS miliknya); hasilnya sama persis dengan 0073.
--  3. pesan_wa.sumber: 'captain' atau 'bo'; 'bo' hanya untuk pesan Fulfillment.
--  4. laporan_wa_bo: pesan Fulfillment dari clock-in BO, dengan kolom yang sama seperti laporan_wa. laporan_wa_pilih memilih salah satunya.
--  5. laporan_wa_gabung: parameter baru p_sumber (bawaan 'captain'), judul pesan gabungan menyebut Clock-in BO.

create or replace function aktual_bo_semua(p_dari date, p_sampai date, p_ds uuid[] default null)
returns table (tanggal date, ds_id uuid, ds_nama text, kebutuhan int, terpenuhi int, hadir int, tepat int, captain int, diabsen int, tanpa_orca int,
               b_pagi int, h_pagi int, t_pagi int, b_tengah int, h_tengah int, t_tengah int, b_siang int, h_siang int, t_siang int)
language sql stable security definer set search_path = public as $$
  with a as (select * from pengaturan_kehadiran where id = 1),
  izin as (
    select d.id, d.nama, d.kuota_pagi, d.kuota_tengah, d.kuota_siang from ds d
    where p_ds is null or d.id = any(p_ds)
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
              and (j.shift::text = 'siang' or o.masuk_lokal <= (case j.shift::text when 'pagi' then a.batas_pagi else a.batas_tengah end)::time)
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
           case when hr.tanggal < today_wib() or w.t >= a.mulai_pagi::time then coalesce(kh.kuota_pagi, d.kuota_pagi) else 0 end as bp,
           case when hr.tanggal < today_wib() or w.t >= a.mulai_tengah::time then coalesce(kh.kuota_tengah, d.kuota_tengah) else 0 end as bt,
           case when hr.tanggal < today_wib() or w.t >= a.mulai_siang::time then coalesce(kh.kuota_siang, d.kuota_siang) else 0 end as bs,
           coalesce(h.hp, 0) as hp, coalesce(h.tp, 0) as tp, coalesce(h.ht, 0) as ht, coalesce(h.tt, 0) as tt, coalesce(h.hs, 0) as hs, coalesce(h.ts, 0) as ts,
           coalesce(c.n, 0) as cap, coalesce(ab.n, 0) as dia, coalesce(h.tanpa, 0) as tanpa
    from hari hr cross join izin d cross join a
    cross join (select (now() at time zone 'Asia/Jakarta')::time as t) w
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
revoke execute on function aktual_bo_semua(date, date, uuid[]) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function aktual_bo_semua(date, date, uuid[]) to service_role;
  end if;
end $$;

create or replace function aktual_bo(p_dari date, p_sampai date)
returns table (tanggal date, ds_id uuid, ds_nama text, kebutuhan int, terpenuhi int, hadir int, tepat int, captain int, diabsen int, tanpa_orca int,
               b_pagi int, h_pagi int, t_pagi int, b_tengah int, h_tengah int, t_tengah int, b_siang int, h_siang int, t_siang int)
language sql stable security definer set search_path = public as $$
  select * from aktual_bo_semua(p_dari, p_sampai,
    case when is_super() then null
         when my_peran() = 'arcon' then coalesce(my_ds_ids(), '{}'::uuid[])
         else '{}'::uuid[] end)
$$;
revoke execute on function aktual_bo(date, date) from public, anon;
grant execute on function aktual_bo(date, date) to authenticated;

alter table pesan_wa add column if not exists sumber text not null default 'captain';
alter table pesan_wa drop constraint if exists pesan_wa_sumber_check;
alter table pesan_wa add constraint pesan_wa_sumber_check
  check (sumber in ('captain', 'bo') and (sumber = 'captain' or jenis in ('fulfillment_shift', 'fulfillment_hari')));

create or replace function laporan_wa_bo(p_sesi text, p_tanggal date default today_wib())
returns table (ds_id uuid, ds_nama text, group_wa_id text, pesan text, n_terpenuhi int, n_kebutuhan int, n_belum int, n_pagi int, k_pagi int, n_siang int, k_siang int, n_tengah int, k_tengah int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_jenis text := split_part(p_sesi, '_', 1);
  v_shift text := split_part(p_sesi, '_', 2);
  v_label text;
  v_hari text;
  a record;
  v_keb int; v_t int; v_h int; v_tw int; v_tp int; v_tt int; v_ts int;
  v_teks text;
begin
  if v_jenis <> 'laporan' or v_shift not in ('pagi', 'tengah', 'siang', 'hari') then
    raise exception 'Sesi tidak dikenal: %', p_sesi;
  end if;
  v_label := case v_shift when 'tengah' then 'Middle' when 'hari' then 'Seharian' else initcap(v_shift) end;
  v_hari := wa_hari_tgl(p_tanggal);
  for a in
    select s.*, d.group_wa_id as gid from aktual_bo_semua(p_tanggal, p_tanggal) s join ds d on d.id = s.ds_id order by s.ds_nama
  loop
    -- terpenuhi per shift dibatasi budget (rider lebih tidak dihitung), sama seperti Dashboard BO
    v_tp := least(a.h_pagi, a.b_pagi); v_tt := least(a.h_tengah, a.b_tengah); v_ts := least(a.h_siang, a.b_siang);
    v_keb := case v_shift when 'pagi' then a.b_pagi when 'tengah' then a.b_tengah when 'siang' then a.b_siang else a.kebutuhan end;
    v_t   := case v_shift when 'pagi' then v_tp when 'tengah' then v_tt when 'siang' then v_ts else a.terpenuhi end;
    v_h   := case v_shift when 'pagi' then a.h_pagi when 'tengah' then a.h_tengah when 'siang' then a.h_siang else a.hadir end;
    v_tw  := case v_shift when 'pagi' then a.t_pagi when 'tengah' then a.t_tengah when 'siang' then a.t_siang else a.tepat end;
    -- DS yang tidak punya budget maupun clock-in di shift ini tidak perlu dilaporkan
    continue when v_keb = 0 and v_h = 0;
    v_teks := '*Fulfillment ' || case when v_shift = 'hari' then 'Seharian' else 'Shift ' || v_label end || E' (Clock-in BO)*\n' || a.ds_nama || ' · ' || v_hari || E'\n\n'
           || 'Terpenuhi: ' || v_t || ' dari ' || v_keb || ' rider' || case when v_keb > 0 then ' (' || round(100.0 * v_t / v_keb) || '%)' else '' end
           || E'\nClock-in BO: ' || v_h || ' · Tepat waktu: ' || v_tw;
    if v_shift = 'siang' then
      v_teks := v_teks || E'\n\n*Rekap hari ini*\nPagi: ' || v_tp || '/' || a.b_pagi
             || case when a.b_tengah > 0 or a.h_tengah > 0 then ' · Middle: ' || v_tt || '/' || a.b_tengah else '' end || ' · Siang: ' || v_ts || '/' || a.b_siang;
    end if;
    ds_id := a.ds_id; ds_nama := a.ds_nama; group_wa_id := nullif(trim(a.gid), ''); pesan := v_teks;
    n_terpenuhi := v_t; n_kebutuhan := v_keb; n_belum := 0;
    n_pagi := v_tp; k_pagi := a.b_pagi; n_siang := v_ts; k_siang := a.b_siang; n_tengah := v_tt; k_tengah := a.b_tengah;
    return next;
  end loop;
end $$;
revoke execute on function laporan_wa_bo(text, date) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function laporan_wa_bo(text, date) to service_role;
  end if;
end $$;

create or replace function laporan_wa_pilih(p_sesi text, p_tanggal date, p_sumber text)
returns table (ds_id uuid, ds_nama text, group_wa_id text, pesan text, n_terpenuhi int, n_kebutuhan int, n_belum int, n_pagi int, k_pagi int, n_siang int, k_siang int, n_tengah int, k_tengah int)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_sumber = 'bo' and split_part(p_sesi, '_', 1) = 'laporan' then
    return query select * from laporan_wa_bo(p_sesi, p_tanggal);
  else
    return query select * from laporan_wa(p_sesi, p_tanggal);
  end if;
end $$;
revoke execute on function laporan_wa_pilih(text, date, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function laporan_wa_pilih(text, date, text) to service_role;
  end if;
end $$;

drop function if exists laporan_wa_gabung(text, date, text, uuid, text, uuid[]);
create or replace function laporan_wa_gabung(p_sesi text, p_tanggal date default today_wib(), p_url text default 'https://asched.vercel.app', p_ds uuid default null, p_grup_semua text default null, p_ds_ids uuid[] default null, p_sumber text default 'captain')
returns table (group_wa_id text, ds_ids uuid[], ds_namas text[], pesan text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_jenis text := split_part(p_sesi, '_', 1);
  v_shift text := split_part(p_sesi, '_', 2);
  v_label text := case split_part(p_sesi, '_', 2) when 'tengah' then 'MIDDLE' else upper(split_part(p_sesi, '_', 2)) end;
  v_hari text;
  v_tautan text;
  v_garis text := '━━━━━━━━━━━━━━';
  v_judul text;
  v_ringkas text;
  g record;
begin
  if p_sumber not in ('captain', 'bo') then raise exception 'Sumber tidak dikenal: %', p_sumber; end if;
  v_hari := wa_hari_tgl(p_tanggal);
  -- laporan: rekap kehadiran hari itu; pengingat: halaman absensi untuk mengisi
  v_tautan := case when v_jenis = 'laporan' then '🔗 Detail per rider:' || E'\n' || p_url || '/?tab=rekap&tgl=' || p_tanggal
                   else '🔗 Isi absensi:' || E'\n' || p_url || '/?tab=absensi' end;
  for g in
    with k as (
      select coalesce(coalesce(p_grup_semua, l.group_wa_id), l.ds_id::text) as kunci, coalesce(p_grup_semua, l.group_wa_id) as gid_efektif, l.*,
             l.n_terpenuhi as t, l.n_kebutuhan as b -- laporan seharian: laporan_wa sudah menjumlahkan semua shift
      from laporan_wa_pilih(p_sesi, p_tanggal, p_sumber) l
      where (p_ds is null or l.ds_id = p_ds) and (p_ds_ids is null or l.ds_id = any(p_ds_ids))
    ), r as (
      select k.*, (k.b > 0 and k.t >= k.b and k.n_belum = 0) as penuh, case when k.b > 0 then k.t::numeric / k.b else 0 end as laju
      from k
    )
    select r.kunci,
           max(r.gid_efektif) as gid,
           array_agg(r.ds_id order by r.ds_nama) as ids,
           array_agg(r.ds_nama order by r.ds_nama) as namas,
           count(*) as n,
           min(r.pesan) as satu,
           sum(r.t) as sum_t, sum(r.b) as sum_b,
           sum(r.n_pagi) as sum_np, sum(r.k_pagi) as sum_kp, sum(r.n_siang) as sum_ns, sum(r.k_siang) as sum_ks, sum(r.n_tengah) as sum_nt, sum(r.k_tengah) as sum_kt,
           sum(r.n_belum) as sum_belum,
           -- yang bermasalah di atas (belum penuh, laju terendah dulu), yang penuh di bawah
           string_agg(case when v_jenis = 'laporan' then
                             (case when r.penuh then '✅ ' else '⚠️ ' end) || '*' || r.ds_nama || '*' || E'\n    '
                             || r.t || ' dari ' || r.b || case when r.b > 0 then ' (' || round(100.0 * r.laju) || '%)' else '' end
                             || case when v_shift = 'hari' then E'\n    Pagi ' || r.n_pagi || '/' || r.k_pagi || case when r.k_tengah > 0 or r.n_tengah > 0 then ' · Middle ' || r.n_tengah || '/' || r.k_tengah else '' end || ' · Siang ' || r.n_siang || '/' || r.k_siang else '' end
                             || case when r.n_belum > 0 then E'\n    ' || r.n_belum || ' belum diabsen' else '' end
                           else '⚠️ *' || r.ds_nama || '*' || E'\n    ' || r.n_belum || ' rider belum diabsen' end,
                      E'\n\n' order by r.penuh, r.laju, r.ds_nama) as baris
    from r
    group by r.kunci
    order by min(r.ds_nama)
  loop
    group_wa_id := g.gid; ds_ids := g.ids; ds_namas := g.namas;
    if g.gid is null then
      pesan := g.satu;                                   -- tanpa grup: tidak dikirim, hanya dicatat dilewati
    elsif g.n = 1 then
      pesan := g.satu || E'\n\n' || v_tautan;            -- satu DS di grupnya sendiri: pesan rinci
    elsif v_jenis = 'laporan' then
      v_judul := case when p_sumber = 'bo' and v_shift = 'hari' then '📋 *FULFILLMENT SEHARIAN · CLOCK-IN BO*'
                       when p_sumber = 'bo' then '📋 *FULFILLMENT · SHIFT ' || v_label || ' · CLOCK-IN BO*'
                       when v_shift = 'hari' then '📋 *FULFILLMENT SEHARIAN*'
                       else '📋 *LAPORAN ABSENSI · SHIFT ' || v_label || '*' end;
      v_ringkas := case when v_shift = 'hari' then '*Fulfillment hari ini:* ' else '*Ringkasan:* ' end
                   || g.sum_t || ' dari ' || g.sum_b || case when g.sum_b > 0 then ' (' || round(100.0 * g.sum_t / g.sum_b) || '%)' else '' end || ' · ' || g.n || ' DS'
                   || case when v_shift = 'hari' then E'\nPagi ' || g.sum_np || '/' || g.sum_kp || case when g.sum_kt > 0 or g.sum_nt > 0 then ' · Middle ' || g.sum_nt || '/' || g.sum_kt else '' end || ' · Siang ' || g.sum_ns || '/' || g.sum_ks else '' end
                   || case when g.sum_belum > 0 then E'\n' || g.sum_belum || ' rider belum diabsen' else '' end;
      pesan := v_judul || E'\n' || v_hari || E'\n\n' || v_ringkas || E'\n' || v_garis || E'\n\n' || g.baris || E'\n\n' || v_garis || E'\n' || v_tautan;
    else
      pesan := '⏰ *PENGINGAT ABSENSI · SHIFT ' || v_label || '*' || E'\n' || v_hari || E'\n\n*Belum diabsen:* ' || g.sum_belum || ' rider di ' || g.n || ' DS'
               || E'\n' || v_garis || E'\n\n' || g.baris || E'\n\n' || v_garis || E'\n' || v_tautan;
    end if;
    return next;
  end loop;
end $$;
revoke execute on function laporan_wa_gabung(text, date, text, uuid, text, uuid[], text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function laporan_wa_gabung(text, date, text, uuid, text, uuid[], text) to service_role;
  end if;
end $$;
