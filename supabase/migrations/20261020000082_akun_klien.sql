-- Akun klien: klien login sendiri, hanya melihat datanya sendiri, dan boleh mengunggah Data Performance sendiri dengan aturan aman.
--
-- IDENTITAS: akun klien disimpan di tabel terpisah (akun_klien), BUKAN di riders. Semua kebijakan akses yang ada mengenali orang lewat riders
-- (me, my_peran, is_super, my_ds_ids), jadi akun klien otomatis tidak punya hak apa pun di sana. Hak klien hanya yang diberikan di bawah ini.
-- Email tidak boleh sekaligus ada di riders dan akun_klien (dijaga pemicu di kedua sisi). Akun klien dinonaktifkan lewat aktif = false.
--
-- KLIEN TIDAK MEMBACA TABEL ds: tabel itu memuat data internal (Captain, Arcon, grup WA, budget). Toko klien dibaca lewat toko_klien(), dan semua
-- fungsi dashboard dan detail kini SECURITY DEFINER dengan syarat akses eksplisit di tiap baris: Super-admin (semua toko klien), Arcon (hanya DS
-- yang dipegang), atau akun klien (hanya klien miliknya). p_klien yang bukan milik klien itu menghasilkan kosong. Data Dash (clock-in BO, angka harian
-- fulfillment dan tepat waktu masuk) juga boleh dilihat klien untuk tokonya sendiri lewat dashboard_klien_bo.
--
-- UNGGAH MANDIRI (simpan_order_klien): klien hanya bisa mengunggah untuk klien miliknya. Aturan tambahan khusus klien (Super-admin tidak terkena):
--   KUNCI    tanggal yang bulannya sudah lewat tanggal 5 bulan berikutnya terkunci: baris yang berbeda dari data tersimpan ditolak, yang sama dilewati.
--   TAHAN    baris yang mengubah angka lama (Pesanan Selesai) lebih dari 10 persen DAN sedikitnya 5 pesanan tidak langsung dipakai: ditahan di
--            order_klien_tahan sampai Super-admin menyetujui atau menolak (putuskan_tahan). Data lama tetap berlaku selama menunggu.
--   BATAS    maksimal 30 unggahan per jam per klien.

-- ───────── akun klien ─────────
create table akun_klien (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  klien_id uuid not null references klien(id) on delete cascade,
  nama text check (nama is null or char_length(btrim(nama)) between 1 and 80),
  aktif boolean not null default true,
  dibuat timestamptz not null default now()
);
create unique index akun_klien_email_uq on akun_klien (email);

create function akun_klien_jaga() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.email := lower(btrim(new.email));
  if exists (select 1 from riders where email = new.email) then
    raise exception 'Email % sudah dipakai orang di ORCA (rider, Captain, Arcon, atau Super-admin), jadi tidak bisa jadi akun klien', new.email;
  end if;
  return new;
end $$;
create trigger akun_klien_jaga_t before insert or update of email on akun_klien for each row execute function akun_klien_jaga();

create function riders_tolak_email_klien() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and exists (select 1 from akun_klien where email = lower(btrim(new.email))) then
    raise exception 'Email % sudah dipakai akun klien, jadi tidak bisa dipakai orang di ORCA', new.email;
  end if;
  return new;
end $$;
create trigger riders_tolak_email_klien_t before insert or update of email on riders for each row execute function riders_tolak_email_klien();

-- Klien milik akun yang sedang login (null bila bukan akun klien aktif), dan DS-nya
create function klien_saya() returns uuid language sql stable security definer set search_path = public as $$
  select klien_id from akun_klien where email = lower(auth.jwt() ->> 'email') and aktif limit 1
$$;
create function ds_klien_saya() returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(d.id), '{}'::uuid[]) from ds d where d.klien_id = klien_saya()
$$;

alter table akun_klien enable row level security;
create policy akun_klien_super on akun_klien for all to authenticated using ((select is_super())) with check ((select is_super()));
create policy akun_klien_sendiri on akun_klien for select to authenticated using (email = lower(auth.jwt() ->> 'email'));

-- Hak baca klien: barisnya sendiri saja
create policy klien_sendiri on klien for select to authenticated using (id = (select klien_saya()));
create policy order_klien_klien on order_klien for select to authenticated using (ds_id = any ((select ds_klien_saya())::uuid[]));
create policy unggahan_klien_klien on unggahan_klien for select to authenticated using (klien_id = (select klien_saya()));

-- Kebijakan lama pengaturan_rekrut terbuka untuk SEMUA pengguna login (using true), termasuk klien. Pengaturan rekrutmen internal: hanya orang
-- yang terdaftar di ORCA (punya peran). Yang membacanya (Super-admin, Arcon, Captain, perekrut) semuanya punya peran, jadi tidak ada yang kehilangan akses.
drop policy pengaturan_rekrut_read on pengaturan_rekrut;
create policy pengaturan_rekrut_read on pengaturan_rekrut for select to authenticated using ((select my_peran()) is not null);

-- ───────── penahanan perubahan besar ─────────
alter table unggahan_klien add column baris_tahan int not null default 0;

create table order_klien_tahan (
  id uuid primary key default gen_random_uuid(),
  unggahan_id uuid references unggahan_klien(id) on delete set null,
  klien_id uuid not null references klien(id) on delete cascade,
  tanggal date not null,
  ds_id uuid not null references ds(id) on delete cascade,
  kode_mtr text not null,
  selesai int not null check (selesai between 0 and 999),
  ontime int not null check (ontime >= 0),
  late int not null check (late >= 0),
  pod_sesuai int not null check (pod_sesuai >= 0),
  pod_tidak int not null check (pod_tidak >= 0),
  lama_selesai int not null, -- Pesanan Selesai yang tersimpan saat baris ini ditahan
  status text not null default 'menunggu' check (status in ('menunggu', 'disetujui', 'ditolak')),
  dibuat timestamptz not null default now(),
  diputuskan timestamptz,
  oleh text,
  check (ontime + late = selesai),
  check (pod_sesuai + pod_tidak = selesai)
);
-- satu baris menunggu per kunci: unggahan ulang yang masih ditahan menggantikan yang lama
create unique index order_klien_tahan_menunggu_uq on order_klien_tahan (tanggal, ds_id, kode_mtr) where status = 'menunggu';
create index order_klien_tahan_klien on order_klien_tahan (klien_id, status, dibuat desc);
alter table order_klien_tahan enable row level security;
create policy order_klien_tahan_baca on order_klien_tahan for select to authenticated using ((select is_super()));

-- ───────── fungsi baca: SECURITY DEFINER dengan syarat akses eksplisit ─────────
-- Syarat per toko (d): Super-admin, atau Arcon yang memegang DS itu, atau akun klien yang memiliki klien itu. my_ds_ids() juga berisi DS Captain,
-- jadi peran Arcon disebut eksplisit. Fungsi ini melewati RLS, jadi syarat ini SATU-SATUNYA penjaga: jangan dilonggarkan.
create or replace function dashboard_klien_rentang(p_klien uuid)
returns table (awal date, akhir date, hari int)
language sql stable security definer set search_path = public as $$
  select min(o.tanggal), max(o.tanggal), count(distinct o.tanggal)::int
  from order_klien o join ds d on d.id = o.ds_id
  where d.klien_id = p_klien
    and ((select is_super()) or ((select my_peran()) = 'arcon' and d.id = any ((select my_ds_ids())::uuid[])) or p_klien = (select klien_saya()))
  having count(*) > 0
$$;

create or replace function dashboard_klien_harian(p_klien uuid, p_dari date, p_sampai date, p_ds uuid[] default null)
returns table (tanggal date, selesai bigint, ontime bigint, late bigint, pod_sesuai bigint, pod_tidak bigint, rider_hari bigint)
language sql stable security definer set search_path = public as $$
  select o.tanggal, sum(o.selesai), sum(o.ontime), sum(o.late), sum(o.pod_sesuai), sum(o.pod_tidak), count(*)
  from order_klien o join ds d on d.id = o.ds_id
  where d.klien_id = p_klien and p_sampai - p_dari between 0 and 400
    and ((select is_super()) or ((select my_peran()) = 'arcon' and d.id = any ((select my_ds_ids())::uuid[])) or p_klien = (select klien_saya()))
    and o.tanggal between p_dari and p_sampai and (p_ds is null or o.ds_id = any(p_ds))
  group by o.tanggal order by o.tanggal
$$;

create or replace function dashboard_klien_toko(p_klien uuid, p_dari date, p_sampai date, p_ds uuid[] default null)
returns table (ds_id uuid, ds_nama text, kode_toko text, selesai bigint, ontime bigint, late bigint, pod_sesuai bigint, pod_tidak bigint, rider_hari bigint, hari bigint)
language sql stable security definer set search_path = public as $$
  select d.id, d.nama, d.kode_toko, sum(o.selesai), sum(o.ontime), sum(o.late), sum(o.pod_sesuai), sum(o.pod_tidak), count(*), count(distinct o.tanggal)
  from order_klien o join ds d on d.id = o.ds_id
  where d.klien_id = p_klien and p_sampai - p_dari between 0 and 400
    and ((select is_super()) or ((select my_peran()) = 'arcon' and d.id = any ((select my_ds_ids())::uuid[])) or p_klien = (select klien_saya()))
    and o.tanggal between p_dari and p_sampai and (p_ds is null or o.ds_id = any(p_ds))
  group by d.id, d.nama, d.kode_toko
  order by d.nama
$$;

create or replace function dashboard_klien_detail_rider(p_klien uuid, p_dari date, p_sampai date, p_ds uuid[] default null, p_cari text default null,
                                                        p_limit int default 50, p_offset int default 0)
returns table (tanggal date, ds_id uuid, ds_nama text, kode_toko text, kode_mtr text, selesai int, ontime int, late int, pod_sesuai int, pod_tidak int, total bigint)
language sql stable security definer set search_path = public as $$
  select o.tanggal, d.id, d.nama, d.kode_toko, o.kode_mtr, o.selesai, o.ontime, o.late, o.pod_sesuai, o.pod_tidak, count(*) over ()
  from order_klien o join ds d on d.id = o.ds_id
  where d.klien_id = p_klien and p_sampai - p_dari between 0 and 400
    and ((select is_super()) or ((select my_peran()) = 'arcon' and d.id = any ((select my_ds_ids())::uuid[])) or p_klien = (select klien_saya()))
    and o.tanggal between p_dari and p_sampai and (p_ds is null or o.ds_id = any(p_ds))
    and (coalesce(btrim(p_cari), '') = ''
         or o.kode_mtr ilike '%' || replace(replace(replace(btrim(p_cari), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by o.tanggal desc, d.nama, o.kode_mtr
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
$$;

create or replace function dashboard_klien_detail_hari(p_klien uuid, p_dari date, p_sampai date, p_ds uuid[] default null,
                                                       p_limit int default 50, p_offset int default 0)
returns table (tanggal date, ds_id uuid, ds_nama text, kode_toko text, selesai bigint, ontime bigint, late bigint, pod_sesuai bigint, pod_tidak bigint,
               rider bigint, total bigint)
language sql stable security definer set search_path = public as $$
  select o.tanggal, d.id, d.nama, d.kode_toko, sum(o.selesai), sum(o.ontime), sum(o.late), sum(o.pod_sesuai), sum(o.pod_tidak), count(*), count(*) over ()
  from order_klien o join ds d on d.id = o.ds_id
  where d.klien_id = p_klien and p_sampai - p_dari between 0 and 400
    and ((select is_super()) or ((select my_peran()) = 'arcon' and d.id = any ((select my_ds_ids())::uuid[])) or p_klien = (select klien_saya()))
    and o.tanggal between p_dari and p_sampai and (p_ds is null or o.ds_id = any(p_ds))
  group by o.tanggal, d.id, d.nama, d.kode_toko
  order by o.tanggal desc, d.nama
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
$$;

-- Daftar toko (DS) klien untuk pemilih toko; klien tidak membaca tabel ds langsung
create function toko_klien(p_klien uuid)
returns table (id uuid, nama text, kode_toko text)
language sql stable security definer set search_path = public as $$
  select d.id, d.nama, d.kode_toko from ds d
  where d.klien_id = p_klien
    and ((select is_super()) or ((select my_peran()) = 'arcon' and d.id = any ((select my_ds_ids())::uuid[])) or p_klien = (select klien_saya()))
  order by d.nama
$$;

-- Data Dash (clock-in BO) untuk toko klien: kebutuhan rider, yang terpenuhi, hadir, dan tepat waktu masuk, per hari. Klien boleh melihatnya (untuk
-- cek harian), hanya untuk tokonya sendiri. Memakai aktual_bo_semua (tanpa pembatas pengguna, hanya bisa dipanggil fungsi database) dengan daftar
-- toko yang SUDAH disaring syarat akses yang sama dengan fungsi lain; kolom internal (captain, tanpa_orca) tidak ikut dikembalikan.
-- aktual_bo_semua hanya menghitung rentang sampai 92 hari, jadi untuk rentang lebih panjang yang dihitung 92 hari terakhir.
create or replace function dashboard_klien_bo(p_klien uuid, p_dari date, p_sampai date, p_ds uuid[] default null)
returns table (tanggal date, kebutuhan bigint, terpenuhi bigint, hadir bigint, tepat bigint)
language sql stable security definer set search_path = public as $$
  select a.tanggal, sum(a.kebutuhan), sum(a.terpenuhi), sum(a.hadir), sum(a.tepat)
  from aktual_bo_semua(
         greatest(p_dari, p_sampai - 91), p_sampai,
         coalesce((select array_agg(d.id) from ds d
                   where d.klien_id = p_klien and (p_ds is null or d.id = any(p_ds))
                     and ((select is_super()) or ((select my_peran()) = 'arcon' and d.id = any ((select my_ds_ids())::uuid[])) or p_klien = (select klien_saya()))),
                 '{}'::uuid[])) a
  where p_sampai - p_dari between 0 and 400
  group by a.tanggal order by a.tanggal
$$;

-- ───────── unggah: Super-admin atau akun klien yang bersangkutan ─────────
create or replace function simpan_order_klien(p_klien uuid, p_baris jsonb, p_berkas text default null, p_sidik text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_n int; v_id uuid := gen_random_uuid(); v_hari date := today_wib();
  v_super boolean := coalesce(is_super(), false);
  v_klien boolean := coalesce(p_klien = klien_saya(), false);
  v_baru int; v_ubah int; v_ok int; v_tolak int; v_lewat int; v_tahan int; v_awal date; v_akhir date;
  v_tolak_daftar jsonb; v_lewat_daftar jsonb;
begin
  if not (v_super or v_klien) then raise exception 'Hanya Super-admin atau akun klien yang bersangkutan yang boleh mengunggah data order'; end if;
  perform 1 from klien where id = p_klien;
  if not found then raise exception 'Klien tidak ditemukan'; end if;
  if not v_super and (select count(*) from unggahan_klien where klien_id = p_klien and waktu > now() - interval '1 hour') >= 30 then
    raise exception 'Terlalu banyak unggahan dalam satu jam (maksimal 30). Coba lagi nanti';
  end if;
  if p_baris is null or jsonb_typeof(p_baris) <> 'array' then raise exception 'Data unggahan harus berupa daftar baris'; end if;
  v_n := jsonb_array_length(p_baris);
  if v_n = 0 then raise exception 'Tidak ada baris untuk disimpan'; end if;
  if v_n > 20000 then raise exception 'Maksimal 20.000 baris per unggahan (file ini % baris). Bagi file menjadi beberapa unggahan', v_n; end if;
  if exists (select 1 from jsonb_array_elements(p_baris) e where jsonb_typeof(e) <> 'object') then
    raise exception 'Setiap baris unggahan harus berupa objek';
  end if;

  insert into unggahan_klien (id, klien_id, oleh, berkas, sidik)
  values (v_id, p_klien, nullif(auth.jwt() ->> 'email', ''), left(p_berkas, 200), left(p_sidik, 128));

  drop table if exists _unggah_klien;
  create temp table _unggah_klien on commit drop as
  with s as (
    select
      case when btrim(x.baris) ~ '^\d{1,7}$' then btrim(x.baris)::int else e.o::int end as nomor,
      e.o::int as urut,
      tanggal_aman(btrim(x.tanggal)) as tgl,
      upper(btrim(x.kode_toko)) as kode_toko, btrim(x.nama_toko) as nama_toko, upper(btrim(x.kode_mtr)) as kode_mtr,
      case when btrim(x.selesai) ~ '^\d{1,6}$' then btrim(x.selesai)::int end as selesai,
      case when btrim(x.ontime) ~ '^\d{1,6}$' then btrim(x.ontime)::int end as ontime,
      case when btrim(x.late) ~ '^\d{1,6}$' then btrim(x.late)::int end as late,
      case when btrim(x.pod_sesuai) ~ '^\d{1,6}$' then btrim(x.pod_sesuai)::int end as pod_sesuai,
      case when btrim(x.pod_tidak) ~ '^\d{1,6}$' then btrim(x.pod_tidak)::int end as pod_tidak
    from jsonb_array_elements(p_baris) with ordinality as e(j, o)
    cross join lateral jsonb_to_record(e.j) as x(baris text, tanggal text, kode_toko text, nama_toko text, kode_mtr text,
                                                 selesai text, ontime text, late text, pod_sesuai text, pod_tidak text)
  )
  select s.*, d.id as ds_id,
    case
      when s.tgl is null then 'Tanggal tidak valid (pakai tahun-bulan-tanggal, mis. 2026-11-24)'
      when s.tgl > v_hari then 'Tanggal di masa depan'
      when s.tgl < v_hari - 400 then 'Tanggal lebih dari 400 hari ke belakang'
      when coalesce(s.kode_toko, '') = '' then 'Kode toko kosong'
      when coalesce(s.kode_mtr, '') = '' then 'Kode mitra kosong'
      when char_length(s.kode_mtr) > 30 then 'Kode mitra terlalu panjang'
      when s.selesai is null or s.ontime is null or s.late is null or s.pod_sesuai is null or s.pod_tidak is null
        then 'Angka tidak valid (harus bilangan bulat 0 atau lebih)'
      when s.selesai > 999 then 'Pesanan selesai satu rider dalam sehari lebih dari 999'
      when s.ontime + s.late <> s.selesai then 'Ontime + Late tidak sama dengan Pesanan Selesai'
      when s.pod_sesuai + s.pod_tidak <> s.selesai then 'POD sesuai + tidak sesuai tidak sama dengan Pesanan Selesai'
    end as alasan
  from s
  left join ds d on d.klien_id = p_klien and d.kode_toko = s.kode_toko;

  -- baris kembar dalam satu file (tanggal, toko, kode mitra sama): yang pertama dipakai, sisanya ditolak
  update _unggah_klien t set alasan = 'Baris kembar dalam file (tanggal, toko, dan kode mitra sama dengan baris sebelumnya)'
  from (select urut, row_number() over (partition by tgl, ds_id, kode_mtr order by urut) as rn
        from _unggah_klien where alasan is null and ds_id is not null) k
  where k.urut = t.urut and k.rn > 1;

  -- bandingkan dengan data tersimpan: ada, sama persis, dan nilai lama (untuk aturan khusus klien)
  alter table _unggah_klien add column ada boolean not null default false, add column sama boolean not null default false,
    add column lama int, add column tahan boolean not null default false;
  update _unggah_klien t set ada = true, lama = e.selesai,
         sama = ((e.selesai, e.ontime, e.late, e.pod_sesuai, e.pod_tidak) = (t.selesai, t.ontime, t.late, t.pod_sesuai, t.pod_tidak))
  from order_klien e
  where t.alasan is null and t.ds_id is not null and e.tanggal = t.tgl and e.ds_id = t.ds_id and e.kode_mtr = t.kode_mtr;

  if not v_super then
    -- KUNCI: bulan sudah lewat tanggal 5 bulan berikutnya
    update _unggah_klien set alasan = 'Tanggal sudah terkunci (koreksi hanya sampai tanggal 5 bulan berikutnya). Hubungi tim Dash untuk mengubahnya'
    where alasan is null and ds_id is not null and not sama
      and v_hari > (date_trunc('month', tgl)::date + interval '1 month' + interval '4 days')::date;
    -- TAHAN: ubah angka lama lebih dari 10 persen dan sedikitnya 5 pesanan
    update _unggah_klien set tahan = true
    where alasan is null and ds_id is not null and ada and not sama and abs(selesai - lama) >= 5 and abs(selesai - lama) * 10 > lama;
  end if;

  with masuk as (
    insert into order_klien as o (tanggal, ds_id, kode_mtr, selesai, ontime, late, pod_sesuai, pod_tidak, unggahan_id)
    select tgl, ds_id, kode_mtr, selesai, ontime, late, pod_sesuai, pod_tidak, v_id
    from _unggah_klien where alasan is null and ds_id is not null and not tahan
    on conflict (tanggal, ds_id, kode_mtr) do update
      set selesai = excluded.selesai, ontime = excluded.ontime, late = excluded.late,
          pod_sesuai = excluded.pod_sesuai, pod_tidak = excluded.pod_tidak, unggahan_id = excluded.unggahan_id
      where (o.selesai, o.ontime, o.late, o.pod_sesuai, o.pod_tidak)
            is distinct from (excluded.selesai, excluded.ontime, excluded.late, excluded.pod_sesuai, excluded.pod_tidak)
    returning (xmax = 0) as baru
  )
  select count(*) filter (where baru), count(*) filter (where not baru) into v_baru, v_ubah from masuk;

  insert into order_klien_tahan (unggahan_id, klien_id, tanggal, ds_id, kode_mtr, selesai, ontime, late, pod_sesuai, pod_tidak, lama_selesai)
  select v_id, p_klien, tgl, ds_id, kode_mtr, selesai, ontime, late, pod_sesuai, pod_tidak, lama from _unggah_klien where tahan
  on conflict (tanggal, ds_id, kode_mtr) where status = 'menunggu' do update
    set unggahan_id = excluded.unggahan_id, selesai = excluded.selesai, ontime = excluded.ontime, late = excluded.late,
        pod_sesuai = excluded.pod_sesuai, pod_tidak = excluded.pod_tidak, lama_selesai = excluded.lama_selesai, dibuat = now();

  select count(*) filter (where alasan is null and ds_id is not null and not tahan), count(*) filter (where alasan is not null),
         count(*) filter (where alasan is null and ds_id is null), count(*) filter (where tahan),
         min(tgl) filter (where alasan is null), max(tgl) filter (where alasan is null)
    into v_ok, v_tolak, v_lewat, v_tahan, v_awal, v_akhir from _unggah_klien;

  select coalesce(jsonb_agg(jsonb_build_object('baris', nomor, 'alasan', alasan) order by urut), '[]') into v_tolak_daftar
    from (select * from _unggah_klien where alasan is not null order by urut limit 100) q;
  select coalesce(jsonb_agg(jsonb_build_object('kode_toko', kode_toko, 'nama_toko', nama_toko, 'baris', baris) order by kode_toko), '[]') into v_lewat_daftar
    from (select kode_toko, max(nama_toko) as nama_toko, count(*) as baris from _unggah_klien
          where alasan is null and ds_id is null group by kode_toko order by kode_toko limit 100) q;

  update unggahan_klien set tgl_awal = v_awal, tgl_akhir = v_akhir, baris_total = v_n, baris_baru = v_baru, baris_ubah = v_ubah,
         baris_sama = v_ok - v_baru - v_ubah, baris_tolak = v_tolak, baris_lewat = v_lewat, baris_tahan = v_tahan
  where id = v_id;

  return jsonb_build_object('unggahan', v_id, 'total', v_n, 'baru', v_baru, 'ubah', v_ubah, 'sama', v_ok - v_baru - v_ubah,
                            'tolak', v_tolak, 'lewat', v_lewat, 'tahan', v_tahan, 'ditolak', v_tolak_daftar, 'toko_dilewati', v_lewat_daftar);
end $$;

-- Super-admin menyetujui (angka baru dipakai, nilai lama masuk riwayat penimpaan) atau menolak (data lama tetap) baris yang ditahan
create function putuskan_tahan(p_id uuid, p_setuju boolean) returns void
language plpgsql security definer set search_path = public as $$
declare t order_klien_tahan%rowtype;
begin
  if not coalesce(is_super(), false) then raise exception 'Hanya Super-admin yang boleh memutuskan perubahan yang ditahan'; end if;
  select * into t from order_klien_tahan where id = p_id for update;
  if not found then raise exception 'Perubahan yang ditahan tidak ditemukan'; end if;
  if t.status <> 'menunggu' then raise exception 'Perubahan ini sudah diputuskan (%)', t.status; end if;
  if p_setuju then
    insert into order_klien as o (tanggal, ds_id, kode_mtr, selesai, ontime, late, pod_sesuai, pod_tidak, unggahan_id)
    values (t.tanggal, t.ds_id, t.kode_mtr, t.selesai, t.ontime, t.late, t.pod_sesuai, t.pod_tidak, t.unggahan_id)
    on conflict (tanggal, ds_id, kode_mtr) do update
      set selesai = excluded.selesai, ontime = excluded.ontime, late = excluded.late,
          pod_sesuai = excluded.pod_sesuai, pod_tidak = excluded.pod_tidak, unggahan_id = excluded.unggahan_id;
  end if;
  update order_klien_tahan set status = case when p_setuju then 'disetujui' else 'ditolak' end, diputuskan = now(), oleh = nullif(auth.jwt() ->> 'email', '')
  where id = p_id;
end $$;

revoke execute on function klien_saya(), ds_klien_saya(), toko_klien(uuid), putuskan_tahan(uuid, boolean) from public, anon;
grant execute on function klien_saya(), ds_klien_saya(), toko_klien(uuid), putuskan_tahan(uuid, boolean) to authenticated;
