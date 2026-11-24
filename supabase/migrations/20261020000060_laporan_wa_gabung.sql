-- Pesan WhatsApp gabungan: DS yang memakai ID grup yang sama dijadikan satu pesan ringkas (satu baris per DS) berisi tautan ke Orca untuk detailnya.
-- DS dengan grup sendiri tetap dapat pesan rinci seperti sebelumnya, ditambah tautan. laporan_wa mendapat tiga kolom angka (terpenuhi, kebutuhan,
-- belum diabsen) yang dipakai untuk baris ringkas, jadi fungsinya dibuat ulang (kolom keluaran tidak bisa diubah lewat create or replace).

drop function if exists laporan_wa(text, date);

create or replace function laporan_wa(p_sesi text, p_tanggal date default today_wib())
returns table (ds_id uuid, ds_nama text, group_wa_id text, pesan text, n_terpenuhi int, n_kebutuhan int, n_belum int, n_pagi int, k_pagi int, n_siang int, k_siang int, n_tengah int, k_tengah int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_jenis text := split_part(p_sesi, '_', 1);
  v_shift text := split_part(p_sesi, '_', 2);
  v_label text;
  v_hari text;
  d record;
  v_hadir int; v_terpenuhi int; v_pengganti int; v_tpagi int; v_tsiang int; v_ttengah int; v_kpagi int; v_ksiang int; v_ktengah int; v_keb int;
  v_belum text[]; v_tidak text[];
  v_teks text;
begin
  if v_jenis not in ('laporan', 'ingat') or not (v_shift in ('pagi', 'tengah', 'siang') or (v_jenis = 'laporan' and v_shift = 'hari')) then
    raise exception 'Sesi tidak dikenal: %', p_sesi;
  end if;
  v_label := case v_shift when 'tengah' then 'Middle' when 'hari' then 'Seharian' else initcap(v_shift) end;
  v_hari := (array['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'])[extract(dow from p_tanggal)::int + 1] || ', '
         || extract(day from p_tanggal)::int || ' '
         || (array['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'])[extract(month from p_tanggal)::int] || ' '
         || extract(year from p_tanggal)::int;

  for d in
    select s.id, s.nama, s.group_wa_id,
           coalesce(k.kuota_pagi, s.kuota_pagi) as kpagi, coalesce(k.kuota_siang, s.kuota_siang) as ksiang,
           coalesce(k.kuota_tengah, s.kuota_tengah) as ktengah
    from ds s left join kuota_harian k on k.ds_id = s.id and k.tanggal = p_tanggal
    order by s.nama
  loop
    -- DS yang hari itu belum ada jadwalnya di Orca tidak dilaporkan dulu (kebutuhan saja belum cukup)
    continue when not exists (select 1 from jadwal j where j.tanggal = p_tanggal and j.ds_id = d.id and j.shift <> 'off');
    -- rider terjadwal hari itu: shift yang dikerjakan (tukar: shift rekannya, juga bila ia sendiri tidak hadir) dan isian miliknya
    with rid as (
      select j.rider_id, r.nama, a.status, a.tukar_dikonfirmasi,
             coalesce((select j2.shift from jadwal j2
                        where j2.tanggal = j.tanggal and j2.shift <> 'off'
                          and j2.rider_id = coalesce(case when a.status = 'tukar' then a.backup_untuk_id end,
                                                     (select t.rider_id from actual_harian t
                                                       where t.tanggal = j.tanggal and t.status = 'tukar' and t.backup_untuk_id = j.rider_id limit 1))),
                      j.shift)::text as eff
      from jadwal j
      join riders r on r.id = j.rider_id
      left join actual_harian a on a.tanggal = j.tanggal and a.rider_id = j.rider_id and a.status <> 'pengganti'
      where j.tanggal = p_tanggal and j.ds_id = d.id and j.shift <> 'off'
    )
    select
      count(*) filter (where (v_shift = 'hari' or eff = v_shift) and (status = 'hadir' or (status = 'tukar' and tukar_dikonfirmasi))),
      array_agg(nama order by nama) filter (where (v_shift = 'hari' or eff = v_shift) and (status is null or (status = 'tukar' and not tukar_dikonfirmasi))),
      array_agg(nama || ' (' || replace(status::text, '_', ' ') || '), '
                || coalesce('diganti ' || (select rp.nama from actual_harian p join riders rp on rp.id = p.rider_id
                                            where p.tanggal = p_tanggal and p.status = 'pengganti' and p.backup_untuk_id = rid.rider_id limit 1),
                            'tanpa pengganti') order by nama)
        filter (where (v_shift = 'hari' or eff = v_shift) and status in ('alpha', 'izin', 'sakit', 'tukar_libur'))
    into v_hadir, v_belum, v_tidak
    from rid;

    select count(*) filter (where (v_shift = 'hari' or s.shift::text = v_shift)),
           count(*) filter (where (v_shift = 'hari' or s.shift::text = v_shift) and s.sumber = 'pengganti'),
           count(*) filter (where s.shift::text = 'pagi'),
           count(*) filter (where s.shift::text = 'siang'),
           count(*) filter (where s.shift::text = 'tengah')
    into v_terpenuhi, v_pengganti, v_tpagi, v_tsiang, v_ttengah
    from shift_dikerjakan(p_tanggal, p_tanggal) s where s.ds_id = d.id;
    v_kpagi := coalesce(d.kpagi, 0); v_ksiang := coalesce(d.ksiang, 0); v_ktengah := coalesce(d.ktengah, 0);
    v_keb := case v_shift when 'pagi' then v_kpagi when 'tengah' then v_ktengah when 'hari' then v_kpagi + v_ktengah + v_ksiang else v_ksiang end;

    if v_jenis = 'ingat' then
      continue when coalesce(cardinality(v_belum), 0) = 0;
      v_teks := '*Pengingat Absensi Shift ' || v_label || E'*\n' || d.nama || ' · ' || v_hari || E'\n\n'
             || 'Masih ada ' || cardinality(v_belum) || E' rider yang belum diabsen:\n'
             || (select string_agg('- ' || x, E'\n') from unnest(v_belum) x)
             || E'\n\nMohon segera diisi di aplikasi sebelum laporan dikirim.';
    else
      -- DS yang tidak punya kebutuhan maupun rider di shift ini tidak perlu dilaporkan
      continue when v_keb = 0 and v_terpenuhi = 0 and v_hadir = 0 and coalesce(cardinality(v_belum), 0) = 0 and coalesce(cardinality(v_tidak), 0) = 0;
      v_teks := '*Laporan Absensi ' || case when v_shift = 'hari' then 'Seharian' else 'Shift ' || v_label end || E'*\n' || d.nama || ' · ' || v_hari || E'\n\n'
             || 'Terpenuhi: ' || v_terpenuhi || ' dari ' || v_keb || ' rider'
             || case when v_keb > 0 then ' (' || round(100.0 * v_terpenuhi / v_keb) || '%)' else '' end
             || E'\nHadir: ' || v_hadir || ' · Pengganti: ' || v_pengganti
             || E'\nTidak hadir: ' || coalesce(cardinality(v_tidak), 0)
             || coalesce(E'\n' || (select string_agg('- ' || x, E'\n') from unnest(v_tidak) x), '')
             || E'\nBelum diabsen: ' || coalesce(cardinality(v_belum), 0)
             || coalesce(E'\n' || (select string_agg('- ' || x, E'\n') from unnest(v_belum) x), '');
      if v_shift = 'siang' then
        v_teks := v_teks || E'\n\n*Rekap hari ini*\nPagi: ' || v_tpagi || '/' || v_kpagi || case when v_ktengah > 0 or v_ttengah > 0 then ' · Middle: ' || v_ttengah || '/' || v_ktengah else '' end || ' · Siang: ' || v_tsiang || '/' || v_ksiang;
      end if;
    end if;

    ds_id := d.id; ds_nama := d.nama; group_wa_id := nullif(trim(d.group_wa_id), ''); pesan := v_teks;
    n_terpenuhi := v_terpenuhi; n_kebutuhan := v_keb; n_belum := coalesce(cardinality(v_belum), 0);
    n_pagi := v_tpagi; k_pagi := v_kpagi; n_siang := v_tsiang; k_siang := v_ksiang; n_tengah := v_ttengah; k_tengah := v_ktengah;
    return next;
  end loop;
end $$;
revoke execute on function laporan_wa(text, date) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function laporan_wa(text, date) to service_role;
  end if;
end $$;

create or replace function laporan_wa_gabung(p_sesi text, p_tanggal date default today_wib(), p_url text default 'https://asched.vercel.app', p_ds uuid default null, p_grup_semua text default null, p_ds_ids uuid[] default null)
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
  v_hari := (array['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'])[extract(dow from p_tanggal)::int + 1] || ', '
         || extract(day from p_tanggal)::int || ' '
         || (array['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'])[extract(month from p_tanggal)::int] || ' '
         || extract(year from p_tanggal)::int;
  -- laporan: rekap kehadiran hari itu; pengingat: halaman absensi untuk mengisi
  v_tautan := case when v_jenis = 'laporan' then '🔗 Detail per rider:' || E'\n' || p_url || '/?tab=rekap&tgl=' || p_tanggal
                   else '🔗 Isi absensi:' || E'\n' || p_url || '/?tab=absensi' end;
  for g in
    with k as (
      select coalesce(coalesce(p_grup_semua, l.group_wa_id), l.ds_id::text) as kunci, coalesce(p_grup_semua, l.group_wa_id) as gid_efektif, l.*,
             l.n_terpenuhi as t, l.n_kebutuhan as b -- laporan seharian: laporan_wa sudah menjumlahkan semua shift
      from laporan_wa(p_sesi, p_tanggal) l
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
      v_judul := case when v_shift = 'hari' then '📋 *FULFILLMENT SEHARIAN*' else '📋 *LAPORAN ABSENSI · SHIFT ' || v_label || '*' end;
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
revoke execute on function laporan_wa_gabung(text, date, text, uuid, text, uuid[]) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function laporan_wa_gabung(text, date, text, uuid, text, uuid[]) to service_role;
  end if;
end $$;

-- Budget = kebutuhan rider per shift (kuota DS, atau kuota khusus hari itu). Satu pesan untuk semua DS terpilih yang hari itu punya jadwal, dikirim ke p_grup.
create or replace function laporan_budget_wa(p_tanggal date default today_wib(), p_url text default 'https://asched.vercel.app', p_ds_ids uuid[] default null, p_grup text default null)
returns table (group_wa_id text, ds_ids uuid[], ds_namas text[], pesan text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_hari text;
  v_baris text;
  v_ids uuid[]; v_namas text[];
  v_p int; v_t int; v_s int; v_n int;
begin
  v_hari := (array['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'])[extract(dow from p_tanggal)::int + 1] || ', '
         || extract(day from p_tanggal)::int || ' '
         || (array['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'])[extract(month from p_tanggal)::int] || ' '
         || extract(year from p_tanggal)::int;
  with b as (
    select s.id, s.nama,
           coalesce(k.kuota_pagi, s.kuota_pagi) as kp, coalesce(k.kuota_tengah, s.kuota_tengah) as kt, coalesce(k.kuota_siang, s.kuota_siang) as ks
    from ds s left join kuota_harian k on k.ds_id = s.id and k.tanggal = p_tanggal
    where (p_ds_ids is null or s.id = any(p_ds_ids))
      and exists (select 1 from jadwal j where j.tanggal = p_tanggal and j.ds_id = s.id and j.shift <> 'off')
  )
  select array_agg(b.id order by b.nama), array_agg(b.nama order by b.nama), count(*)::int, coalesce(sum(b.kp), 0)::int, coalesce(sum(b.kt), 0)::int, coalesce(sum(b.ks), 0)::int,
         string_agg('*' || b.nama || E'*\n    Pagi ' || b.kp || case when b.kt > 0 then ' · Middle ' || b.kt else '' end || ' · Siang ' || b.ks || ' = ' || (b.kp + b.kt + b.ks),
                    E'\n\n' order by b.nama)
    into v_ids, v_namas, v_n, v_p, v_t, v_s, v_baris
  from b where b.kp + b.kt + b.ks > 0;
  if v_n is null or v_n = 0 then return; end if;
  group_wa_id := p_grup; ds_ids := v_ids; ds_namas := v_namas;
  pesan := '💰 *BUDGET KEBUTUHAN RIDER*' || E'\n' || v_hari || E'\n\n*Total:* ' || (v_p + v_t + v_s) || ' rider · ' || v_n || ' DS'
           || E'\nPagi ' || v_p || case when v_t > 0 then ' · Middle ' || v_t else '' end || ' · Siang ' || v_s
           || E'\n━━━━━━━━━━━━━━\n\n' || v_baris || E'\n\n━━━━━━━━━━━━━━\n🔗 Atur kebutuhan di Orca:' || E'\n' || p_url || '/?tab=absensi';
  return next;
end $$;
revoke execute on function laporan_budget_wa(date, text, uuid[], text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function laporan_budget_wa(date, text, uuid[], text) to service_role;
  end if;
end $$;

-- Pengaturan pengiriman WhatsApp, diubah Super-admin dari menu Laporan WhatsApp di Orca.
--   pengaturan_wa  satu baris: saklar utama (aktif). Mati = tidak ada pesan terjadwal yang dikirim; pengiriman manual Super-admin tetap bisa.
--   pesan_wa       daftar pesan terjadwal, masing-masing dengan isi (jenis), jam (WIB), hari, cakupan DS, dan grup tujuannya sendiri.
--                  grup kosong = laporan dikirim ke grup tiap DS (kolom group_wa_id di Kelola DS).
--   Cron cukup satu pekerjaan tiap 5 menit yang memanggil kirim-laporan dengan sesi 'auto'.
create table if not exists pengaturan_wa (
  id int primary key default 1 check (id = 1),
  aktif boolean not null default true,
  diubah timestamptz not null default now()
);
insert into pengaturan_wa (id) values (1) on conflict (id) do nothing;
alter table pengaturan_wa enable row level security;
drop policy if exists pengaturan_wa_super on pengaturan_wa;
create policy pengaturan_wa_super on pengaturan_wa for all to authenticated using ((select is_super())) with check ((select is_super()));

create table if not exists pesan_wa (
  id uuid primary key default gen_random_uuid(),
  nama text not null check (length(trim(nama)) > 0),
  jenis text not null check (jenis in ('fulfillment_shift', 'fulfillment_hari', 'pengingat_captain', 'budget')),
  shift text check (shift in ('pagi', 'tengah', 'siang')),
  jam text not null check (jam ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  hari int[] not null default '{1,2,3,4,5,6,7}' check (hari <@ array[1,2,3,4,5,6,7] and cardinality(hari) > 0),
  cakupan text not null default 'semua' check (cakupan in ('semua', 'arcon', 'ds')),
  cakupan_ids uuid[] not null default '{}',
  grup text[] not null default '{}',
  aktif boolean not null default true,
  dibuat timestamptz not null default now(),
  diubah timestamptz not null default now(),
  check ((jenis in ('fulfillment_shift', 'pengingat_captain')) = (shift is not null)),
  check (cakupan = 'semua' or cardinality(cakupan_ids) > 0)
);
alter table pesan_wa enable row level security;
drop policy if exists pesan_wa_super on pesan_wa;
create policy pesan_wa_super on pesan_wa for all to authenticated using ((select is_super())) with check ((select is_super()));

-- Contoh awal, semuanya MATI sampai Super-admin menyalakan dan mengisi grup tujuannya
insert into pesan_wa (nama, jenis, shift, jam, aktif)
select * from (values
  ('Pengingat captain pagi', 'pengingat_captain', 'pagi', '07:00', false),
  ('Fulfillment pagi', 'fulfillment_shift', 'pagi', '09:00', false),
  ('Pengingat captain Middle', 'pengingat_captain', 'tengah', '11:00', false),
  ('Fulfillment Middle', 'fulfillment_shift', 'tengah', '13:00', false),
  ('Pengingat captain siang', 'pengingat_captain', 'siang', '14:00', false),
  ('Fulfillment seharian', 'fulfillment_hari', null, '16:00', false)
) as v(nama, jenis, shift, jam, aktif)
where not exists (select 1 from pesan_wa);

-- Riwayat per pesan: satu pesan terkirim per DS per tanggal. Pengiriman manual lama (tanpa pesan_id) tetap memakai aturan per sesi.
alter table log_wa add column if not exists pesan_id uuid references pesan_wa(id) on delete set null;
drop index if exists log_wa_terkirim;
create unique index log_wa_terkirim on log_wa (tanggal, ds_id, sesi) where status = 'terkirim' and pesan_id is null;
create unique index if not exists log_wa_terkirim_pesan on log_wa (tanggal, pesan_id, ds_id) where status = 'terkirim' and pesan_id is not null;

-- Pesan yang jamnya sudah tiba: dari jam yang diatur sampai p_jendela_menit sesudahnya, pada hari yang dipilih, bila saklar utama dan pesannya hidup.
-- Jendela 30 menit membuat pesan tetap terkirim bila cron sempat terlambat; DS yang sudah tercatat terkirim dilewati oleh kirim-laporan, jadi tidak ada pesan dobel.
create or replace function pesan_wa_jatuh_tempo(p_sekarang timestamptz default now(), p_jendela_menit int default 30)
returns table (id uuid, tanggal date)
language sql stable security definer set search_path = public as $$
  with w as (select p_sekarang at time zone 'Asia/Jakarta' as lokal)
  select p.id, w.lokal::date
  from pesan_wa p cross join w
  where p.aktif and (select g.aktif from pengaturan_wa g where g.id = 1)
    and extract(isodow from w.lokal)::int = any(p.hari)
    and w.lokal::time >= p.jam::time
    and w.lokal::time < p.jam::time + make_interval(mins => p_jendela_menit)
$$;
revoke execute on function pesan_wa_jatuh_tempo(timestamptz, int) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function pesan_wa_jatuh_tempo(timestamptz, int) to service_role;
  end if;
end $$;
