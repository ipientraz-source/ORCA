-- Riwayat budget untuk presentasi tren permintaan (kenaikan dan penurunan): layar Budget Trend.
-- Sumber data, tanpa tabel baru:
--   * perubahan budget bawaan DS: log_aktivitas (tabel 'ds', kolom kuota_*, nilai lama dan baru; dicatat trigger sejak awal pencatatan);
--   * perubahan budget per hari: simpan_kuota kini juga mencatat nilai lama dan baru per hari dan shift (sebelumnya hanya "N hari berbeda dari bawaan");
--   * kuota khusus hari itu (kuota_harian) dan foto harian (budget_snapshot) bila ada.
-- Budget tiap DS pada hari D dipulihkan mundur dari nilai sekarang: nilai akhir hari D = nilai LAMA dari perubahan pertama sesudah D, atau nilai sekarang bila tidak ada.
-- DS baru (catatan "tambah DS") baru dihitung mulai hari dibuatnya. Foto harian menang atas hasil pemulihan, lalu kuota khusus hari itu.
-- Hasilnya ringkasan (total harian, per DS, daftar perubahan), bukan data mentah per DS per hari, karena API membatasi 1.000 baris per permintaan.
-- Hanya Super-admin (semua DS) dan Arcon (DS yang dipegang) yang bisa memanggilnya.

-- 1. simpan_kuota (dari 0038) + catatan terstruktur lama → baru per hari dan shift di log_aktivitas.perubahan.
--    Tampilan Activity Log memakai kolom detail, jadi tidak berubah.
create or replace function simpan_kuota(p_ds uuid, p_dari date, p_sampai date, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int; v_ds ds%rowtype; v_diff jsonb;
begin
  -- is not distinct from: pemanggil tanpa DS membuat my_ds() NULL, dan NULL pada not(...) akan meloloskan pemeriksaan
  if not (is_super() or p_ds is not distinct from my_ds() or (my_peran() = 'arcon' and p_ds = any(my_ds_ids()))) then
    raise exception 'Hanya Captain DS ini, Arcon yang memegangnya, atau Super-admin yang bisa mengatur kuota';
  end if;
  if p_sampai < p_dari or p_sampai - p_dari > 62 then raise exception 'Rentang tanggal tidak valid (maks 63 hari)'; end if;
  select * into v_ds from ds where id = p_ds;
  if not found then raise exception 'DS tidak ditemukan'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as x(tanggal date, pagi int, siang int, tengah int, cadangan int)
    where x.tanggal not between p_dari and p_sampai or x.pagi is null or x.siang is null or x.pagi < 0 or x.siang < 0
       or coalesce(x.tengah, 0) < 0 or coalesce(x.cadangan, 0) < 0
  ) then raise exception 'Isian kuota tidak valid (di luar rentang tanggal atau bernilai negatif)'; end if;

  -- nilai efektif sebelum diubah (kuota khusus hari itu, kalau tidak ada kuota bawaan DS) dibandingkan dengan nilai baru
  select coalesce(jsonb_agg(q.e order by q.tanggal, q.urut), '[]'::jsonb) into v_diff
  from (
    select x.tanggal, s.urut,
           jsonb_build_object('kolom', 'kuota_' || s.shift, 'tanggal', x.tanggal, 'lama', s.lama::text, 'baru', s.baru::text) as e
    from jsonb_to_recordset(p_rows) as x(tanggal date, pagi int, siang int, tengah int, cadangan int)
    left join kuota_harian k on k.ds_id = p_ds and k.tanggal = x.tanggal
    cross join lateral (values
      (1, 'pagi', coalesce(k.kuota_pagi, v_ds.kuota_pagi), x.pagi),
      (2, 'tengah', coalesce(k.kuota_tengah, v_ds.kuota_tengah), coalesce(x.tengah, 0)),
      (3, 'siang', coalesce(k.kuota_siang, v_ds.kuota_siang), x.siang)
    ) as s(urut, shift, lama, baru)
    where s.lama is distinct from s.baru
  ) q;

  delete from kuota_harian where ds_id = p_ds and tanggal between p_dari and p_sampai;
  insert into kuota_harian (ds_id, tanggal, kuota_pagi, kuota_siang, kuota_tengah, cadangan)
    select p_ds, x.tanggal, x.pagi, x.siang, coalesce(x.tengah, 0), coalesce(x.cadangan, 0)
    from jsonb_to_recordset(p_rows) as x(tanggal date, pagi int, siang int, tengah int, cadangan int)
    where x.pagi <> v_ds.kuota_pagi or x.siang <> v_ds.kuota_siang or coalesce(x.tengah, 0) <> v_ds.kuota_tengah or coalesce(x.cadangan, 0) > 0
    on conflict (ds_id, tanggal) do update set kuota_pagi = excluded.kuota_pagi, kuota_siang = excluded.kuota_siang,
      kuota_tengah = excluded.kuota_tengah, cadangan = excluded.cadangan;
  get diagnostics v_n = row_count;
  insert into log_aktivitas (captain_id, aksi, detail, jenis, tabel, ds_id, perubahan)
    values (me(), 'ubah kuota', v_ds.nama || ': ' || p_dari || ' s/d ' || p_sampai || ', ' || v_n || ' hari berbeda dari bawaan',
            'ubah', 'kuota_harian', p_ds, case when jsonb_array_length(v_diff) > 0 then v_diff end);
  return v_n;
end $$;

-- 2. Budget efektif tiap DS tiap hari (internal, tanpa pembatas pengguna; p_ds membatasi DS). Tidak bisa dipanggil lewat API.
create or replace function budget_harian_dasar(p_dari date, p_sampai date, p_ds uuid[] default null)
returns table (tanggal date, ds_id uuid, ds_nama text, pagi int, tengah int, siang int)
language sql stable security definer set search_path = public as $$
  with izin as (
    select d.id, d.nama, d.kuota_pagi, d.kuota_tengah, d.kuota_siang from ds d where p_ds is null or d.id = any(p_ds)
  ),
  hari as (
    select g::date as t from generate_series(p_dari::timestamp, least(p_sampai, today_wib())::timestamp, interval '1 day') g
    where p_sampai - p_dari between 0 and 400
  ),
  -- perubahan budget bawaan DS (log terstruktur: kolom, nilai lama, nilai baru)
  ub as (
    select l.ds_id, (l.waktu at time zone 'Asia/Jakarta')::date as tgl, l.waktu, substr(e ->> 'kolom', 7) as shift, (e ->> 'lama')::int as lama
    from log_aktivitas l
    cross join lateral jsonb_array_elements(case when jsonb_typeof(l.perubahan) = 'array' then l.perubahan else '[]'::jsonb end) e
    where l.tabel = 'ds' and l.jenis = 'ubah' and l.ds_id in (select id from izin)
      and e ->> 'kolom' in ('kuota_pagi', 'kuota_tengah', 'kuota_siang') and (e ->> 'lama') ~ '^[0-9]+$'
  ),
  lahir as (
    select l.ds_id, min((l.waktu at time zone 'Asia/Jakarta')::date) as tgl
    from log_aktivitas l where l.tabel = 'ds' and l.jenis = 'tambah' and l.ds_id in (select id from izin) group by l.ds_id
  ),
  x as (
    select h.t, i.id, i.nama,
      coalesce((select u.lama from ub u where u.ds_id = i.id and u.shift = 'pagi' and u.tgl > h.t order by u.waktu limit 1), i.kuota_pagi) as pagi,
      coalesce((select u.lama from ub u where u.ds_id = i.id and u.shift = 'tengah' and u.tgl > h.t order by u.waktu limit 1), i.kuota_tengah) as tengah,
      coalesce((select u.lama from ub u where u.ds_id = i.id and u.shift = 'siang' and u.tgl > h.t order by u.waktu limit 1), i.kuota_siang) as siang
    from hari h cross join izin i left join lahir lh on lh.ds_id = i.id
    where lh.tgl is null or lh.tgl <= h.t
  )
  select x.t, x.id, x.nama,
         coalesce(s.kuota_pagi, k.kuota_pagi, x.pagi), coalesce(s.kuota_tengah, k.kuota_tengah, x.tengah), coalesce(s.kuota_siang, k.kuota_siang, x.siang)
  from x
  left join kuota_harian k on k.ds_id = x.id and k.tanggal = x.t
  left join budget_snapshot s on s.ds_id = x.id and s.tanggal = x.t
$$;
revoke execute on function budget_harian_dasar(date, date, uuid[]) from public, anon, authenticated;

-- 3. Daftar perubahan budget (internal): bawaan DS dan per hari, dengan nilai lama → baru dan pelakunya.
create or replace function budget_perubahan_dasar(p_dari date, p_sampai date, p_ds uuid[] default null)
returns table (waktu timestamptz, ds_id uuid, ds_nama text, shift text, tanggal date, lama int, baru int, oleh text, jenis text)
language sql stable security definer set search_path = public as $$
  select l.waktu, l.ds_id, d.nama, substr(e ->> 'kolom', 7),
         case when l.tabel = 'kuota_harian' then (e ->> 'tanggal')::date end,
         (e ->> 'lama')::int, (e ->> 'baru')::int,
         coalesce(l.pelaku_nama, r.nama, 'Sistem'),
         case when l.tabel = 'kuota_harian' then 'harian' else 'bawaan' end
  from log_aktivitas l
  join ds d on d.id = l.ds_id
  left join riders r on r.id = l.captain_id
  cross join lateral jsonb_array_elements(case when jsonb_typeof(l.perubahan) = 'array' then l.perubahan else '[]'::jsonb end) e
  where l.tabel in ('ds', 'kuota_harian') and l.jenis = 'ubah'
    and e ->> 'kolom' in ('kuota_pagi', 'kuota_tengah', 'kuota_siang')
    and (e ->> 'lama') ~ '^[0-9]+$' and (e ->> 'baru') ~ '^[0-9]+$'
    and (l.waktu at time zone 'Asia/Jakarta')::date between p_dari and p_sampai
    and (p_ds is null or l.ds_id = any(p_ds))
$$;
revoke execute on function budget_perubahan_dasar(date, date, uuid[]) from public, anon, authenticated;

-- 4. Fungsi untuk layar Budget Trend: Super-admin semua DS, Arcon DS yang dipegang, selain itu kosong.
create or replace function budget_trend_harian(p_dari date, p_sampai date)
returns table (tanggal date, pagi int, tengah int, siang int, jml_ds int)
language sql stable security definer set search_path = public as $$
  select b.tanggal, sum(b.pagi)::int, sum(b.tengah)::int, sum(b.siang)::int, (count(*) filter (where b.pagi + b.tengah + b.siang > 0))::int
  from budget_harian_dasar(p_dari, p_sampai,
         case when is_super() then null when my_peran() = 'arcon' then coalesce(my_ds_ids(), '{}'::uuid[]) else '{}'::uuid[] end) b
  group by b.tanggal order by b.tanggal
$$;

create or replace function budget_trend_ds(p_dari date, p_sampai date)
returns table (ds_id uuid, ds_nama text, lahir date, awal_pagi int, awal_tengah int, awal_siang int,
               akhir_pagi int, akhir_tengah int, akhir_siang int, jml_perubahan int)
language sql stable security definer set search_path = public as $$
  with izin as (
    select case when is_super() then null when my_peran() = 'arcon' then coalesce(my_ds_ids(), '{}'::uuid[]) else '{}'::uuid[] end as arr
  ),
  b as (select * from budget_harian_dasar(p_dari, p_sampai, (select arr from izin))),
  akhir as (select distinct on (b.ds_id) b.ds_id, b.ds_nama, b.pagi, b.tengah, b.siang from b order by b.ds_id, b.tanggal desc),
  awal as (select b.ds_id, b.pagi, b.tengah, b.siang from b where b.tanggal = p_dari),
  lahir as (
    select l.ds_id, min((l.waktu at time zone 'Asia/Jakarta')::date) as tgl from log_aktivitas l
    where l.tabel = 'ds' and l.jenis = 'tambah' and (l.waktu at time zone 'Asia/Jakarta')::date between p_dari and p_sampai group by l.ds_id
  ),
  ev as (select e.ds_id, count(*)::int as n from budget_perubahan_dasar(p_dari, p_sampai, (select arr from izin)) e group by e.ds_id)
  select a.ds_id, a.ds_nama, lh.tgl, aw.pagi, aw.tengah, aw.siang, a.pagi, a.tengah, a.siang, coalesce(ev.n, 0)
  from akhir a
  left join awal aw on aw.ds_id = a.ds_id
  left join lahir lh on lh.ds_id = a.ds_id
  left join ev on ev.ds_id = a.ds_id
  order by a.ds_nama
$$;

create or replace function budget_trend_perubahan(p_dari date, p_sampai date)
returns table (waktu timestamptz, ds_id uuid, ds_nama text, shift text, tanggal date, lama int, baru int, oleh text, jenis text)
language sql stable security definer set search_path = public as $$
  select * from budget_perubahan_dasar(p_dari, p_sampai,
         case when is_super() then null when my_peran() = 'arcon' then coalesce(my_ds_ids(), '{}'::uuid[]) else '{}'::uuid[] end)
  order by waktu desc, ds_nama, shift
  limit 2000
$$;

revoke execute on function budget_trend_harian(date, date), budget_trend_ds(date, date), budget_trend_perubahan(date, date) from public, anon;
grant execute on function budget_trend_harian(date, date), budget_trend_ds(date, date), budget_trend_perubahan(date, date) to authenticated;
