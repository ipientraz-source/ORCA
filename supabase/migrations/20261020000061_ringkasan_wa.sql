-- Ringkasan WhatsApp mingguan dan bulanan: budget (kebutuhan rider per hari), fulfillment rate, rider baru, dan churn, dengan tanda naik/turun
-- dibanding periode sebelumnya. Jenis pesan baru di pesan_wa: ringkasan_mingguan (periode = minggu Senin-Minggu terakhir yang sudah lewat) dan
-- ringkasan_bulanan (bulan kalender terakhir yang sudah lewat, dikirim pada tanggal_bulan).
-- Budget lama tidak bisa direkonstruksi persis karena kuota bawaan DS tidak berversi, jadi kuota efektif dicatat tiap hari di budget_snapshot
-- (diperbarui oleh kirim-laporan tiap kali cron berjalan); sebelum ada foto, dipakai kuota hari itu atau kuota DS saat ini.

alter table pesan_wa drop constraint if exists pesan_wa_jenis_check;
alter table pesan_wa add constraint pesan_wa_jenis_check
  check (jenis in ('fulfillment_shift', 'fulfillment_hari', 'pengingat_captain', 'budget', 'ringkasan_mingguan', 'ringkasan_bulanan'));
alter table pesan_wa add column if not exists tanggal_bulan int check (tanggal_bulan between 1 and 28);
alter table pesan_wa drop constraint if exists pesan_wa_bulan_check;
alter table pesan_wa add constraint pesan_wa_bulan_check check ((jenis = 'ringkasan_bulanan') = (tanggal_bulan is not null));

create table if not exists budget_snapshot (
  tanggal date not null,
  ds_id uuid not null references ds(id) on delete cascade,
  kuota_pagi int not null,
  kuota_tengah int not null default 0,
  kuota_siang int not null,
  dicatat timestamptz not null default now(),
  primary key (tanggal, ds_id)
);
alter table budget_snapshot enable row level security;
drop policy if exists budget_snapshot_baca on budget_snapshot;
create policy budget_snapshot_baca on budget_snapshot for select to authenticated using ((select is_super()));

-- Catat kuota efektif satu hari (kuota khusus hari itu menang atas kuota bawaan DS). Aman dipanggil berulang: hanya menulis bila nilainya berubah.
create or replace function catat_budget_snapshot(p_tanggal date default today_wib()) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into budget_snapshot (tanggal, ds_id, kuota_pagi, kuota_tengah, kuota_siang)
  select p_tanggal, s.id, coalesce(k.kuota_pagi, s.kuota_pagi), coalesce(k.kuota_tengah, s.kuota_tengah), coalesce(k.kuota_siang, s.kuota_siang)
  from ds s left join kuota_harian k on k.ds_id = s.id and k.tanggal = p_tanggal
  on conflict (tanggal, ds_id) do update
    set kuota_pagi = excluded.kuota_pagi, kuota_tengah = excluded.kuota_tengah, kuota_siang = excluded.kuota_siang, dicatat = now()
    where (budget_snapshot.kuota_pagi, budget_snapshot.kuota_tengah, budget_snapshot.kuota_siang)
          is distinct from (excluded.kuota_pagi, excluded.kuota_tengah, excluded.kuota_siang);
  get diagnostics n = row_count;
  return n;
end $$;
select catat_budget_snapshot();

-- Kuota efektif tiap DS tiap hari dalam rentang: foto harian bila ada, kalau tidak kuota khusus hari itu, kalau tidak kuota DS saat ini
create or replace function budget_pada(p_dari date, p_sampai date)
returns table (tanggal date, ds_id uuid, kp int, kt int, ks int)
language sql stable security definer set search_path = public as $$
  select d::date, s.id,
         coalesce(b.kuota_pagi, k.kuota_pagi, s.kuota_pagi), coalesce(b.kuota_tengah, k.kuota_tengah, s.kuota_tengah), coalesce(b.kuota_siang, k.kuota_siang, s.kuota_siang)
  from generate_series(p_dari::timestamp, p_sampai::timestamp, interval '1 day') d
  cross join ds s
  left join budget_snapshot b on b.tanggal = d::date and b.ds_id = s.id
  left join kuota_harian k on k.tanggal = d::date and k.ds_id = s.id
$$;

-- Angka satu periode. Hanya DS-hari yang punya jadwal yang dihitung (sama seperti laporan harian). Rider lebih dari kebutuhan tidak menambah terpenuhi
-- (sama seperti Dashboard). Hasil berupa jsonb: hari, jumlah budget dan terpenuhi per shift, dan daftar DS dengan terpenuhi/kebutuhan.
create or replace function ringkasan_data_wa(p_dari date, p_sampai date, p_ds_ids uuid[] default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  with hd as (
    select bp.tanggal, bp.ds_id, bp.kp, bp.kt, bp.ks
    from budget_pada(p_dari, p_sampai) bp
    where (p_ds_ids is null or bp.ds_id = any(p_ds_ids))
      and exists (select 1 from jadwal j where j.tanggal = bp.tanggal and j.ds_id = bp.ds_id and j.shift <> 'off')
  ), dik as (
    select s.tanggal, s.ds_id,
           count(*) filter (where s.shift::text = 'pagi') as np, count(*) filter (where s.shift::text = 'tengah') as nt, count(*) filter (where s.shift::text = 'siang') as ns
    from shift_dikerjakan(p_dari, p_sampai) s
    group by s.tanggal, s.ds_id
  ), x as (
    select hd.tanggal, hd.ds_id, hd.kp, hd.kt, hd.ks,
           least(coalesce(dik.np, 0), hd.kp) as tp, least(coalesce(dik.nt, 0), hd.kt) as tt, least(coalesce(dik.ns, 0), hd.ks) as ts
    from hd left join dik on dik.tanggal = hd.tanggal and dik.ds_id = hd.ds_id
  )
  select jsonb_build_object(
    'hari', (select count(distinct x2.tanggal) from x x2),
    'kp', coalesce(sum(x.kp), 0), 'kt', coalesce(sum(x.kt), 0), 'ks', coalesce(sum(x.ks), 0),
    'tp', coalesce(sum(x.tp), 0), 'tt', coalesce(sum(x.tt), 0), 'ts', coalesce(sum(x.ts), 0),
    'ds', (select coalesce(jsonb_agg(jsonb_build_object('id', a.ds_id, 'nama', s.nama, 't', a.t, 'b', a.b) order by s.nama), '[]'::jsonb)
           from (select x3.ds_id, sum(x3.tp + x3.tt + x3.ts) as t, sum(x3.kp + x3.kt + x3.ks) as b from x x3 group by x3.ds_id) a
           join ds s on s.id = a.ds_id)
  ) into v
  from x;
  return v;
end $$;

-- Rider baru, kembali, berhenti (per kategori), dan jumlah rider aktif di awal dan akhir periode
create or replace function ringkasan_rider_wa(p_dari date, p_sampai date, p_ds_ids uuid[] default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'baru', count(*) filter (where e.jenis = 'bergabung'),
    'kembali', count(*) filter (where e.jenis = 'kembali'),
    'berhenti', count(*) filter (where e.jenis = 'berhenti'),
    'mundur', count(*) filter (where e.jenis = 'berhenti' and e.kategori = 'mengundurkan_diri'),
    'dipecat', count(*) filter (where e.jenis = 'berhenti' and e.kategori = 'diberhentikan'),
    'kontrak', count(*) filter (where e.jenis = 'berhenti' and e.kategori = 'kontrak_selesai'),
    'awal', (select count(*) from riders r where r.peran = 'rider' and (p_ds_ids is null or r.ds_id = any(p_ds_ids)) and rider_aktif_pada(r.id, p_dari - 1)),
    'akhir', (select count(*) from riders r where r.peran = 'rider' and (p_ds_ids is null or r.ds_id = any(p_ds_ids)) and rider_aktif_pada(r.id, p_sampai))
  )
  from rider_peristiwa e join riders r on r.id = e.rider_id
  where e.tanggal between p_dari and p_sampai and r.peran = 'rider' and (p_ds_ids is null or r.ds_id = any(p_ds_ids))
$$;

-- Teks bantu: tanda naik/turun, tanggal pendek, persen bulat
create or replace function wa_selisih(p_a numeric, p_b numeric, p_satuan text default '') returns text
language sql immutable as $$
  select case when p_a is null or p_b is null then ''
              when round(p_a) = round(p_b) then '= sama'
              when round(p_a) > round(p_b) then '▲ +' || (round(p_a) - round(p_b)) || p_satuan
              else '▼ -' || (round(p_b) - round(p_a)) || p_satuan end
$$;
create or replace function wa_tgl(p_d date) returns text language sql immutable as $$
  select extract(day from p_d)::int || ' ' || (array['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'])[extract(month from p_d)::int] || ' ' || extract(year from p_d)::int
$$;
create or replace function wa_persen(p_a numeric, p_b numeric) returns numeric language sql immutable as $$
  select case when coalesce(p_b, 0) > 0 then round(100.0 * p_a / p_b) end
$$;

-- Pesan ringkasan. p_periode: 'mingguan' (minggu Senin-Minggu terakhir yang sudah lewat dari p_tanggal) atau 'bulanan' (bulan kalender terakhir yang sudah lewat).
-- Tidak ada pesan bila periode itu tidak punya data (belum ada DS berjadwal).
create or replace function laporan_ringkasan_wa(p_periode text, p_tanggal date default today_wib(), p_url text default 'https://asched.vercel.app', p_ds_ids uuid[] default null, p_grup text default null)
returns table (group_wa_id text, ds_ids uuid[], ds_namas text[], pesan text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_pf date; v_pt date; v_qf date; v_qt date;
  v_bulan text[] := array['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  v_judul text; v_label text; v_banding text;
  a jsonb; b jsonb; ra jsonb; rb jsonb;
  ha numeric; hb numeric;
  v_ba numeric[]; v_bb numeric[];  -- budget rata-rata per hari: pagi, middle, siang, total
  v_tengah boolean;
  v_pesan text; v_perhatian text; v_valid date;
  v_fa numeric; v_fb numeric;
  v_bersih int; v_turn numeric;
begin
  if p_periode = 'mingguan' then
    v_pt := date_trunc('week', p_tanggal)::date - 1; v_pf := v_pt - 6; v_qt := v_pf - 1; v_qf := v_qt - 6;
    v_judul := '📊 *RINGKASAN MINGGUAN*';
    v_label := wa_tgl(v_pf) || ' s/d ' || wa_tgl(v_pt);
    v_banding := 'dibanding ' || wa_tgl(v_qf) || ' s/d ' || wa_tgl(v_qt);
  elsif p_periode = 'bulanan' then
    v_pf := (date_trunc('month', p_tanggal) - interval '1 month')::date; v_pt := date_trunc('month', p_tanggal)::date - 1;
    v_qf := (date_trunc('month', v_pf) - interval '1 month')::date; v_qt := v_pf - 1;
    v_judul := '📊 *RINGKASAN BULANAN · ' || upper(v_bulan[extract(month from v_pf)::int]) || ' ' || extract(year from v_pf)::int || '*';
    v_label := '';
    v_banding := 'dibanding ' || v_bulan[extract(month from v_qf)::int] || ' ' || extract(year from v_qf)::int;
  else
    raise exception 'Periode tidak dikenal: %', p_periode;
  end if;

  a := ringkasan_data_wa(v_pf, v_pt, p_ds_ids);
  ha := (a->>'hari')::numeric;
  if ha = 0 then return; end if;
  b := ringkasan_data_wa(v_qf, v_qt, p_ds_ids);
  hb := (b->>'hari')::numeric;
  ra := ringkasan_rider_wa(v_pf, v_pt, p_ds_ids);
  rb := ringkasan_rider_wa(v_qf, v_qt, p_ds_ids);

  -- budget rata-rata per hari berjadwal
  v_ba := array[(a->>'kp')::numeric / ha, (a->>'kt')::numeric / ha, (a->>'ks')::numeric / ha, ((a->>'kp')::numeric + (a->>'kt')::numeric + (a->>'ks')::numeric) / ha];
  if hb > 0 then
    v_bb := array[(b->>'kp')::numeric / hb, (b->>'kt')::numeric / hb, (b->>'ks')::numeric / hb, ((b->>'kp')::numeric + (b->>'kt')::numeric + (b->>'ks')::numeric) / hb];
  end if;
  v_tengah := (a->>'kt')::numeric > 0 or coalesce((b->>'kt')::numeric, 0) > 0;

  v_pesan := v_judul || E'\n' || case when v_label <> '' then v_label || E'\n' else '' end || v_banding || E'\n━━━━━━━━━━━━━━\n\n'
    || '*Budget* (kebutuhan rider per hari, rata-rata)' || E'\n'
    || '  Pagi ' || round(v_ba[1]) || coalesce(' ' || nullif(wa_selisih(v_ba[1], v_bb[1]), ''), '')
    || case when v_tengah then ' · Middle ' || round(v_ba[2]) || coalesce(' ' || nullif(wa_selisih(v_ba[2], v_bb[2]), ''), '') else '' end
    || ' · Siang ' || round(v_ba[3]) || coalesce(' ' || nullif(wa_selisih(v_ba[3], v_bb[3]), ''), '') || E'\n'
    || '  Total ' || round(v_ba[4]) || coalesce(' ' || nullif(wa_selisih(v_ba[4], v_bb[4]), ''), '')
    || case when v_bb is not null and round(v_bb[4]) > 0 then ' (' || case when v_ba[4] >= v_bb[4] then '+' else '' end || replace(round(100.0 * (v_ba[4] - v_bb[4]) / v_bb[4], 1)::text, '.', ',') || '%)' else '' end;

  -- fulfillment rate: terpenuhi / kebutuhan seluruh DS-hari berjadwal
  v_fa := wa_persen((a->>'tp')::numeric + (a->>'tt')::numeric + (a->>'ts')::numeric, (a->>'kp')::numeric + (a->>'kt')::numeric + (a->>'ks')::numeric);
  v_fb := wa_persen((b->>'tp')::numeric + (b->>'tt')::numeric + (b->>'ts')::numeric, (b->>'kp')::numeric + (b->>'kt')::numeric + (b->>'ks')::numeric);
  v_pesan := v_pesan || E'\n\n*Fulfillment rate*' || E'\n'
    || '  ' || coalesce(v_fa::text, '–') || '%' || case when hb > 0 and v_fb is not null then ' ' || wa_selisih(v_fa, v_fb, ' poin') || ' (sebelumnya ' || v_fb || '%)' else '' end || E'\n'
    || '  Pagi ' || coalesce(wa_persen((a->>'tp')::numeric, (a->>'kp')::numeric)::text, '–') || '%'
    || case when v_tengah then ' · Middle ' || coalesce(wa_persen((a->>'tt')::numeric, (a->>'kt')::numeric)::text, '–') || '%' else '' end
    || ' · Siang ' || coalesce(wa_persen((a->>'ts')::numeric, (a->>'ks')::numeric)::text, '–') || '%';

  -- rider baru dan churn
  v_bersih := (ra->>'baru')::int + (ra->>'kembali')::int - (ra->>'berhenti')::int;
  v_turn := case when (ra->>'awal')::numeric + (ra->>'akhir')::numeric > 0
                 then round(100.0 * (ra->>'berhenti')::numeric / (((ra->>'awal')::numeric + (ra->>'akhir')::numeric) / 2), 1) end;
  v_pesan := v_pesan || E'\n\n*Rider*' || E'\n'
    || '  Baru ' || (ra->>'baru') || ' · Kembali ' || (ra->>'kembali') || ' · Berhenti ' || (ra->>'berhenti')
    || case when hb > 0 then ' ' || wa_selisih((ra->>'berhenti')::numeric, (rb->>'berhenti')::numeric) else '' end || E'\n'
    || '  Bersih ' || case when v_bersih > 0 then '▲ +' || v_bersih when v_bersih < 0 then '▼ ' || v_bersih else '= 0' end
    || coalesce(' · Turnover ' || replace(v_turn::text, '.', ',') || '%', '')
    || case when (ra->>'berhenti')::int > 0 then E'\n  Berhenti: mengundurkan diri ' || (ra->>'mundur') || ', diberhentikan ' || (ra->>'dipecat') || ', kontrak selesai ' || (ra->>'kontrak') else '' end;
  v_valid := kpi_valid_sejak();
  if v_pf < v_valid then
    v_pesan := v_pesan || E'\n  ℹ️ Data rider berhenti lengkap sejak ' || wa_tgl(v_valid);
  end if;

  -- DS yang perlu perhatian: fulfillment di bawah 95%, paling rendah dulu, maksimal lima
  select string_agg('  ' || z.nama || ' · ' || wa_persen(z.t, z.b) || '%' || coalesce(' ' || nullif(wa_selisih(wa_persen(z.t, z.b), wa_persen(z.tq, z.bq), ' poin'), ''), ''), E'\n' order by z.t / z.b, z.nama)
    into v_perhatian
  from (
    select x.nama, x.t, x.b, y.t as tq, y.b as bq
    from (select e->>'nama' as nama, (e->>'t')::numeric as t, (e->>'b')::numeric as b from jsonb_array_elements(a->'ds') e) x
    left join (select e->>'nama' as nama, (e->>'t')::numeric as t, (e->>'b')::numeric as b from jsonb_array_elements(b->'ds') e) y on y.nama = x.nama
    where x.b > 0 and x.t / x.b < 0.95
    order by x.t / x.b, x.nama
    limit 5
  ) z;
  if v_perhatian is not null then
    v_pesan := v_pesan || E'\n\n⚠️ *Perlu perhatian* (fulfillment di bawah 95%)' || E'\n' || v_perhatian;
  end if;

  v_pesan := v_pesan || E'\n\n━━━━━━━━━━━━━━\n🔗 Detail lengkap:' || E'\n' || p_url || '/?tab=rekap&tgl=' || v_pt;

  group_wa_id := p_grup;
  ds_ids := (select array_agg((e->>'id')::uuid order by e->>'nama') from jsonb_array_elements(a->'ds') e);
  ds_namas := (select array_agg(e->>'nama' order by e->>'nama') from jsonb_array_elements(a->'ds') e);
  pesan := v_pesan;
  return next;
end $$;

-- Pesan yang jamnya sudah tiba. Ringkasan bulanan memakai tanggal_bulan (hari dalam bulan), selain itu memakai hari dalam minggu.
create or replace function pesan_wa_jatuh_tempo(p_sekarang timestamptz default now(), p_jendela_menit int default 30)
returns table (id uuid, tanggal date)
language sql stable security definer set search_path = public as $$
  with w as (select p_sekarang at time zone 'Asia/Jakarta' as lokal)
  select p.id, w.lokal::date
  from pesan_wa p cross join w
  where p.aktif and (select g.aktif from pengaturan_wa g where g.id = 1)
    and case when p.jenis = 'ringkasan_bulanan' then extract(day from w.lokal)::int = p.tanggal_bulan
             else extract(isodow from w.lokal)::int = any(p.hari) end
    and w.lokal::time >= p.jam::time
    and w.lokal::time < p.jam::time + make_interval(mins => p_jendela_menit)
$$;

revoke execute on function catat_budget_snapshot(date), budget_pada(date, date), ringkasan_data_wa(date, date, uuid[]), ringkasan_rider_wa(date, date, uuid[]),
  laporan_ringkasan_wa(text, date, text, uuid[], text), wa_selisih(numeric, numeric, text), wa_tgl(date), wa_persen(numeric, numeric) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function catat_budget_snapshot(date), laporan_ringkasan_wa(text, date, text, uuid[], text) to service_role;
  end if;
end $$;
