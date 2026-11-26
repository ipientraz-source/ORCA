-- Judul pesan Fulfillment bersumber clock-in BO diganti ke gaya yang lebih startup (hanya teks, angka tidak berubah):
--   seharian: "DAILY UPDATE FULFILLMENT", per shift: "SHIFT PAGI FULFILLMENT UPDATE", dengan keterangan "Live dari Dash Attendance" di baris tanggal.
-- Pesan bersumber absensi Captain tidak berubah. Isi fungsi diambil dari migrasi 0074, hanya bagian judul yang berbeda.

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
    v_teks := '*' || case when v_shift = 'hari' then 'Daily Update Fulfillment' else 'Shift ' || v_label || ' Fulfillment Update' end || E'*\n' || a.ds_nama || ' · ' || v_hari || ' · Live dari Dash Attendance' || E'\n\n'
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
      v_judul := case when p_sumber = 'bo' and v_shift = 'hari' then '📊 *DAILY UPDATE FULFILLMENT*'
                       when p_sumber = 'bo' then '📊 *SHIFT ' || v_label || ' FULFILLMENT UPDATE*'
                       when v_shift = 'hari' then '📋 *FULFILLMENT SEHARIAN*'
                       else '📋 *LAPORAN ABSENSI · SHIFT ' || v_label || '*' end;
      v_ringkas := case when v_shift = 'hari' then '*Fulfillment hari ini:* ' else '*Ringkasan:* ' end
                   || g.sum_t || ' dari ' || g.sum_b || case when g.sum_b > 0 then ' (' || round(100.0 * g.sum_t / g.sum_b) || '%)' else '' end || ' · ' || g.n || ' DS'
                   || case when v_shift = 'hari' then E'\nPagi ' || g.sum_np || '/' || g.sum_kp || case when g.sum_kt > 0 or g.sum_nt > 0 then ' · Middle ' || g.sum_nt || '/' || g.sum_kt else '' end || ' · Siang ' || g.sum_ns || '/' || g.sum_ks else '' end
                   || case when g.sum_belum > 0 then E'\n' || g.sum_belum || ' rider belum diabsen' else '' end;
      pesan := v_judul || E'\n' || v_hari || case when p_sumber = 'bo' then ' · Live dari Dash Attendance' else '' end || E'\n\n' || v_ringkas || E'\n' || v_garis || E'\n\n' || g.baris || E'\n\n' || v_garis || E'\n' || v_tautan;
    else
      pesan := '⏰ *PENGINGAT ABSENSI · SHIFT ' || v_label || '*' || E'\n' || v_hari || E'\n\n*Belum diabsen:* ' || g.sum_belum || ' rider di ' || g.n || ' DS'
               || E'\n' || v_garis || E'\n\n' || g.baris || E'\n\n' || v_garis || E'\n' || v_tautan;
    end if;
    return next;
  end loop;
end $$;
