-- Angka rekrutmen yang bisa dipertanggungjawabkan: rider direkrut, yang betul-betul aktif, turnover mingguan/bulanan, retensi, kualitas sumber.
-- Dasarnya riwayat bergabung / berhenti / kembali tiap rider (tabel rider_peristiwa), dicatat OTOMATIS oleh trigger di tabel riders,
-- plus alasan berhenti yang wajib diisi saat menonaktifkan rider (lewat nonaktifkan_rider). Jalankan SETELAH 20261020000029.
--
-- Rider hasil rekrutmen "mulai aktif" saat pertama kali masuk jadwal atau tercatat di laporan Captain (tanpa persetujuan tambahan).
-- "Betul-betul aktif" = berstatus aktif DAN hadir (atau menggantikan) paling lambat 14 hari lalu. Yang diterima tapi belum masuk jadwal
-- dihitung terpisah (belum_dijadwalkan); yang sudah dijadwalkan, diterima < 14 hari, dan belum hadir disebut "baru" agar tidak dianggap gagal.
-- Turnover = rider berhenti pada periode ÷ rata-rata jumlah rider (awal + akhir) / 2 × 100.

create table rider_peristiwa (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references riders(id) on delete cascade,
  jenis text not null check (jenis in ('bergabung', 'berhenti', 'kembali')),
  tanggal date, -- null = bergabung sebelum pencatatan dimulai
  kategori text check (kategori in ('mengundurkan_diri', 'diberhentikan', 'kontrak_selesai', 'tidak_diketahui')),
  alasan text,
  sumber text not null default 'sistem' check (sumber in ('awal', 'sistem', 'impor')),
  dicatat timestamptz not null default now(),
  dicatat_oleh uuid references riders(id) on delete set null,
  check (jenis = 'berhenti' or kategori is null),
  check (tanggal is not null or jenis = 'bergabung')
);
create index on rider_peristiwa (rider_id, tanggal);
create index on rider_peristiwa (jenis, tanggal);
alter table rider_peristiwa enable row level security;
revoke all on rider_peristiwa from anon;
create policy peristiwa_read on rider_peristiwa for select to authenticated using (is_super()); -- yang lain membaca lewat fungsi kpi_*

-- Rider yang sudah aktif saat fitur ini dipasang: dianggap bergabung "sebelum pencatatan". Yang nonaktif tidak punya tanggal berhenti
-- yang bisa dipercaya, jadi tidak dimasukkan (bisa dilengkapi lewat impor riwayat).
insert into rider_peristiwa (rider_id, jenis, tanggal, sumber) select id, 'bergabung', null, 'awal' from riders where peran = 'rider' and status = 'aktif';

-- Pencatat otomatis: rider baru = bergabung; aktif → nonaktif = berhenti (alasan dari nonaktifkan_rider); nonaktif → aktif = kembali
create function catat_peristiwa_rider() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.peran = 'rider' and new.status = 'aktif' then
      insert into rider_peristiwa (rider_id, jenis, tanggal, dicatat_oleh) values (new.id, 'bergabung', today_wib(), me());
    end if;
  elsif new.peran = 'rider' and old.peran = 'rider' and new.status is distinct from old.status then
    if new.status = 'nonaktif' then
      insert into rider_peristiwa (rider_id, jenis, tanggal, kategori, alasan, dicatat_oleh)
        values (new.id, 'berhenti', coalesce(nullif(current_setting('orca.tgl_berhenti', true), '')::date, today_wib()),
                coalesce(nullif(current_setting('orca.kategori_berhenti', true), ''), 'tidak_diketahui'),
                nullif(current_setting('orca.alasan_berhenti', true), ''), me());
    else
      insert into rider_peristiwa (rider_id, jenis, tanggal, dicatat_oleh) values (new.id, 'kembali', today_wib(), me());
    end if;
  end if;
  return null;
end $$;
create trigger riders_peristiwa_t after insert or update of status on riders for each row execute function catat_peristiwa_rider();

-- Menonaktifkan rider dengan alasan. Hak sama seperti sebelumnya: Super-admin; Captain untuk DS-nya; Arcon untuk DS yang dipegang.
create function nonaktifkan_rider(p_rider uuid, p_kategori text, p_alasan text default null, p_tanggal date default null) returns void
language plpgsql security definer set search_path = public as $$
declare r riders%rowtype;
begin
  select * into r from riders where id = p_rider for update;
  if not found then raise exception 'Rider tidak ditemukan'; end if;
  if r.peran <> 'rider' then raise exception 'Hanya rider biasa yang dinonaktifkan dari sini. Status Captain dan Arcon diubah Super-admin lewat Pengguna'; end if;
  if not (is_super() or (my_peran() = 'captain' and r.ds_id = my_ds()) or (my_peran() = 'arcon' and r.ds_id = any(my_ds_ids()))) then
    raise exception 'Tidak berwenang menonaktifkan rider ini';
  end if;
  if r.status = 'nonaktif' then raise exception 'Rider ini sudah nonaktif'; end if;
  if p_kategori not in ('mengundurkan_diri', 'diberhentikan', 'kontrak_selesai') then raise exception 'Pilih alasan berhenti'; end if;
  if p_tanggal > today_wib() then raise exception 'Tanggal berhenti tidak boleh di masa depan'; end if;
  perform set_config('orca.kategori_berhenti', p_kategori, true);
  perform set_config('orca.alasan_berhenti', coalesce(trim(p_alasan), ''), true);
  perform set_config('orca.tgl_berhenti', coalesce(p_tanggal, today_wib())::text, true);
  update riders set status = 'nonaktif' where id = p_rider;
end $$;

-- Apakah rider aktif pada tanggal tertentu (menurut peristiwa terakhir sampai tanggal itu)
create function rider_aktif_pada(p_rider uuid, p_tgl date) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select e.jenis <> 'berhenti' from rider_peristiwa e
                   where e.rider_id = p_rider and (e.tanggal is null or e.tanggal <= p_tgl)
                   order by coalesce(e.tanggal, '-infinity'::date) desc, e.dicatat desc limit 1), false)
$$;

-- Sejak kapan angka turnover lengkap: sebelum itu berhentinya rider tidak tercatat (atau belum diimpor)
create function kpi_valid_sejak() returns date language sql stable security definer set search_path = public as $$
  select coalesce((select min(tanggal) from rider_peristiwa where sumber = 'impor' and tanggal is not null),
                  (select min(dicatat)::date from rider_peristiwa where sumber = 'awal'), today_wib())
$$;

-- Angkatan rekrutmen: tiap kandidat yang diterima dalam rentang, dengan kelasnya sekarang.
-- Rider dinyatakan MULAI AKTIF saat pertama kali masuk jadwal (shift selain libur) atau tercatat di laporan Captain (hadir/pengganti).
-- Kelas: berhenti | aktif (hadir ≤ 14 hari lalu) | aktif_tidak_hadir | belum_dijadwalkan (belum masuk jadwal maupun laporan) |
--        baru (sudah masuk jadwal, belum hadir, diterima < 14 hari) | tidak_pernah_hadir (sudah dijadwalkan tapi tak pernah hadir)
create function kpi_kohort(p_dari date, p_sampai date, p_ds uuid default null)
returns table (kandidat_id uuid, rider_id uuid, ds_id uuid, sumber text, masuk date, kelas text, pertama_hadir date, mulai_aktif date)
language sql stable security definer set search_path = public as $$
  with c as (
    select k.id as kid, k.rider_id as rid, k.ds_id as dsid, coalesce(k.sumber, 'Tanpa sumber') as sumber,
           (k.ditutup at time zone 'Asia/Jakarta')::date as masuk, r.status as rstatus,
           (select min(a.tanggal) from actual_harian a where a.rider_id = k.rider_id and a.status in ('hadir', 'pengganti')) as pertama,
           (select max(a.tanggal) from actual_harian a where a.rider_id = k.rider_id and a.status in ('hadir', 'pengganti')) as terakhir,
           (select min(j.tanggal) from jadwal j where j.rider_id = k.rider_id and j.shift <> 'off') as jadwal_pertama
    from kandidat k left join riders r on r.id = k.rider_id
    where k.status = 'diterima' and k.ditutup is not null
      and (k.ditutup at time zone 'Asia/Jakarta')::date between p_dari and p_sampai
      and (p_ds is null or k.ds_id = p_ds)
      and (is_super() or my_peran() = 'recruiter' or k.ds_id = any(my_ds_ids()))
  )
  select kid, rid, dsid, sumber, masuk,
         case when rstatus is distinct from 'aktif' then 'berhenti'
              when terakhir >= today_wib() - 14 then 'aktif'
              when terakhir is not null then 'aktif_tidak_hadir'
              when jadwal_pertama is null then 'belum_dijadwalkan'
              when masuk > today_wib() - 14 then 'baru'
              else 'tidak_pernah_hadir' end,
         pertama, least(jadwal_pertama, pertama)
  from c
$$;

-- Status penempatan tiap kandidat yang sudah diterima (semua waktu, sesuai hak lihat): untuk ditampilkan di daftar kandidat
create function kandidat_penempatan() returns table (kandidat_id uuid, kelas text, mulai_aktif date)
language sql stable security definer set search_path = public as $$
  select k.kandidat_id, k.kelas, k.mulai_aktif from kpi_kohort(date '2000-01-01', today_wib()) k
$$;

-- 1 dan 2: berapa yang direkrut, berapa yang sudah mulai aktif (masuk jadwal / laporan), dan berapa yang betul-betul aktif
create function kpi_rekrut(p_dari date, p_sampai date, p_ds uuid default null)
returns table (direkrut int, berhenti int, aktif int, aktif_tidak_hadir int, tidak_pernah_hadir int, belum_dijadwalkan int, baru int,
               sudah_mulai int, hari_ke_mulai numeric, hari_ke_hadir_pertama numeric)
language sql stable security definer set search_path = public as $$
  select count(*)::int,
         count(*) filter (where kelas = 'berhenti')::int,
         count(*) filter (where kelas = 'aktif')::int,
         count(*) filter (where kelas = 'aktif_tidak_hadir')::int,
         count(*) filter (where kelas = 'tidak_pernah_hadir')::int,
         count(*) filter (where kelas = 'belum_dijadwalkan')::int,
         count(*) filter (where kelas = 'baru')::int,
         count(*) filter (where mulai_aktif is not null)::int,
         round(avg(mulai_aktif - masuk) filter (where mulai_aktif is not null), 1),
         round(avg(pertama_hadir - masuk) filter (where pertama_hadir is not null), 1)
  from kpi_kohort(p_dari, p_sampai, p_ds)
$$;

-- Kualitas per sumber: bukan hanya sumber mana yang paling banyak, tapi yang ridernya betul-betul bertahan dan hadir
create function kpi_sumber(p_dari date, p_sampai date, p_ds uuid default null)
returns table (sumber text, direkrut int, aktif int, berhenti int, baru int, aktif_tidak_hadir int, tidak_pernah_hadir int, belum_dijadwalkan int)
language sql stable security definer set search_path = public as $$
  select k.sumber, count(*)::int,
         count(*) filter (where kelas = 'aktif')::int, count(*) filter (where kelas = 'berhenti')::int, count(*) filter (where kelas = 'baru')::int,
         count(*) filter (where kelas = 'aktif_tidak_hadir')::int, count(*) filter (where kelas = 'tidak_pernah_hadir')::int,
         count(*) filter (where kelas = 'belum_dijadwalkan')::int
  from kpi_kohort(p_dari, p_sampai, p_ds) k group by k.sumber order by count(*) desc, k.sumber
$$;

-- Retensi per bulan angkatan: yang masih bertahan 30 / 60 / 90 hari setelah diterima. Hanya yang sudah cukup umur ikut dihitung.
create function kpi_retensi(p_dari date, p_sampai date, p_ds uuid default null)
returns table (bulan date, direkrut int, eval30 int, tetap30 int, eval60 int, tetap60 int, eval90 int, tetap90 int)
language sql stable security definer set search_path = public as $$
  with k as (
    select date_trunc('month', c.masuk)::date as bln, c.masuk,
           case when r.id is null then c.masuk
                else (select min(e.tanggal) from rider_peristiwa e where e.rider_id = c.rider_id and e.jenis = 'berhenti' and e.tanggal is not null and e.tanggal >= c.masuk)
           end as keluar
    from kpi_kohort(p_dari, p_sampai, p_ds) c left join riders r on r.id = c.rider_id
  )
  select bln, count(*)::int,
    count(*) filter (where today_wib() >= masuk + 30)::int, count(*) filter (where today_wib() >= masuk + 30 and (keluar is null or keluar > masuk + 30))::int,
    count(*) filter (where today_wib() >= masuk + 60)::int, count(*) filter (where today_wib() >= masuk + 60 and (keluar is null or keluar > masuk + 60))::int,
    count(*) filter (where today_wib() >= masuk + 90)::int, count(*) filter (where today_wib() >= masuk + 90 and (keluar is null or keluar > masuk + 90))::int
  from k group by bln order by bln
$$;

-- Alasan rider berhenti pada rentang
create function kpi_alasan(p_dari date, p_sampai date, p_ds uuid default null) returns table (kategori text, jumlah int)
language sql stable security definer set search_path = public as $$
  select coalesce(e.kategori, 'tidak_diketahui'), count(*)::int
  from rider_peristiwa e join riders r on r.id = e.rider_id
  where e.jenis = 'berhenti' and e.tanggal between p_dari and p_sampai and r.peran = 'rider'
    and (p_ds is null or r.ds_id = p_ds) and (is_super() or my_peran() = 'recruiter' or r.ds_id = any(my_ds_ids()))
  group by 1 order by 2 desc
$$;

-- 3: turnover per minggu (Senin–Minggu) atau per bulan. DS memakai DS rider saat ini.
create function kpi_turnover(p_dari date, p_sampai date, p_per text, p_ds uuid default null)
returns table (mulai date, selesai date, berjalan boolean, awal int, akhir int, bergabung int, berhenti int, mengundurkan_diri int,
               diberhentikan int, kontrak_selesai int, tidak_diketahui int, berhenti_dini int, persen numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if p_per not in ('minggu', 'bulan') then raise exception 'Periode harus minggu atau bulan'; end if;
  if p_sampai - p_dari > 800 then raise exception 'Rentang terlalu panjang (maksimal sekitar 2 tahun)'; end if;
  return query
  with r0 as (
    select r.id as rid from riders r
    where r.peran = 'rider' and (p_ds is null or r.ds_id = p_ds) and (is_super() or my_peran() = 'recruiter' or r.ds_id = any(my_ds_ids()))
  ), p as (
    select s::date as m,
           case when p_per = 'minggu' then s::date + 6 else (s::date + interval '1 month' - interval '1 day')::date end as sel
    from generate_series(date_trunc(case when p_per = 'minggu' then 'week' else 'month' end, p_dari)::date, p_sampai,
                         case when p_per = 'minggu' then interval '1 week' else interval '1 month' end) s
  ), ev as (
    select p.m, e.jenis, e.kategori, e.tanggal,
           e.tanggal - (select max(j.tanggal) from rider_peristiwa j where j.rider_id = e.rider_id and j.jenis in ('bergabung', 'kembali')
                        and j.tanggal is not null and j.tanggal <= e.tanggal) as umur
    from p join rider_peristiwa e on e.tanggal between p.m and p.sel join r0 on r0.rid = e.rider_id
  ), h as (
    select p.m, p.sel,
           (select count(*) from r0 where rider_aktif_pada(r0.rid, p.m - 1))::int as a0,
           (select count(*) from r0 where rider_aktif_pada(r0.rid, least(p.sel, today_wib())))::int as a1,
           (select count(*) from ev where ev.m = p.m and ev.jenis in ('bergabung', 'kembali'))::int as gabung,
           (select count(*) from ev where ev.m = p.m and ev.jenis = 'berhenti')::int as henti,
           (select count(*) from ev where ev.m = p.m and ev.jenis = 'berhenti' and ev.kategori = 'mengundurkan_diri')::int as k1,
           (select count(*) from ev where ev.m = p.m and ev.jenis = 'berhenti' and ev.kategori = 'diberhentikan')::int as k2,
           (select count(*) from ev where ev.m = p.m and ev.jenis = 'berhenti' and ev.kategori = 'kontrak_selesai')::int as k3,
           (select count(*) from ev where ev.m = p.m and ev.jenis = 'berhenti' and ev.kategori = 'tidak_diketahui')::int as k4,
           (select count(*) from ev where ev.m = p.m and ev.jenis = 'berhenti' and ev.umur <= 30)::int as dini
    from p
  )
  select h.m, h.sel, h.sel >= today_wib(), h.a0, h.a1, h.gabung, h.henti, h.k1, h.k2, h.k3, h.k4, h.dini,
         round(100.0 * h.henti / nullif((h.a0 + h.a1) / 2.0, 0), 1)
  from h order by h.m;
end $$;

-- Impor riwayat rider lama (sekali jalan): menimpa seluruh riwayat bergabung/berhenti rider yang ADA di berkas, berdasarkan Kode MTR.
-- p_rows: [{"kode_mtr":"MTR001","bergabung":"2025-03-10","berhenti":"2026-01-05","kategori":"mengundurkan_diri","alasan":"pindah kota"}]
create function impor_riwayat_rider(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x record; v_id uuid; v_st status_rider_t; v_ok int := 0; v_hilang text[] := '{}'; v_konflik text[] := '{}'; v_kat text;
begin
  if not is_super() then raise exception 'Hanya Super-admin'; end if;
  for x in select * from jsonb_to_recordset(p_rows) as t(kode_mtr text, bergabung date, berhenti date, kategori text, alasan text) loop
    select id, status into v_id, v_st from riders where kode_mtr = upper(trim(x.kode_mtr)) and peran = 'rider';
    if v_id is null then v_hilang := v_hilang || coalesce(x.kode_mtr, '?'); continue; end if;
    -- tanggal berhenti hanya masuk akal untuk rider yang sekarang nonaktif, dan tidak boleh sebelum tanggal bergabung
    if (x.berhenti is not null and v_st = 'aktif') or (x.bergabung is not null and x.berhenti is not null and x.berhenti < x.bergabung) then
      v_konflik := v_konflik || x.kode_mtr; continue;
    end if;
    delete from rider_peristiwa where rider_id = v_id;
    insert into rider_peristiwa (rider_id, jenis, tanggal, sumber, dicatat_oleh) values (v_id, 'bergabung', x.bergabung, 'impor', me());
    if x.berhenti is not null then
      v_kat := case when x.kategori in ('mengundurkan_diri', 'diberhentikan', 'kontrak_selesai') then x.kategori else 'tidak_diketahui' end;
      insert into rider_peristiwa (rider_id, jenis, tanggal, kategori, alasan, sumber, dicatat_oleh)
        values (v_id, 'berhenti', x.berhenti, v_kat, nullif(trim(coalesce(x.alasan, '')), ''), 'impor', me());
    end if;
    v_ok := v_ok + 1;
  end loop;
  insert into log_aktivitas (captain_id, aksi, detail) values (me(), 'impor riwayat rider', v_ok || ' rider diproses');
  return jsonb_build_object('diproses', v_ok, 'tidak_ditemukan', to_jsonb(v_hilang), 'konflik', to_jsonb(v_konflik));
end $$;

-- fungsi baru default-nya bisa dieksekusi anon di Supabase → cabut
revoke execute on function nonaktifkan_rider(uuid, text, text, date), kpi_valid_sejak(), kpi_rekrut(date, date, uuid), kpi_sumber(date, date, uuid),
  kpi_retensi(date, date, uuid), kpi_alasan(date, date, uuid), kpi_turnover(date, date, text, uuid), impor_riwayat_rider(jsonb), kandidat_penempatan() from public, anon;
grant execute on function nonaktifkan_rider(uuid, text, text, date), kpi_valid_sejak(), kpi_rekrut(date, date, uuid), kpi_sumber(date, date, uuid),
  kpi_retensi(date, date, uuid), kpi_alasan(date, date, uuid), kpi_turnover(date, date, text, uuid), impor_riwayat_rider(jsonb), kandidat_penempatan() to authenticated;
revoke execute on function catat_peristiwa_rider(), rider_aktif_pada(uuid, date), kpi_kohort(date, date, uuid) from public, anon, authenticated;
