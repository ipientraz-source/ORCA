-- Data order klien (dasar untuk Dashboard Klien). Klien mengunggah kinerja antar per rider per hari per toko
-- (pesanan selesai, ontime, late, POD sesuai, POD tidak sesuai). Langkah ini baru untuk Super-admin; login klien menyusul.
--
-- TOKO: satu klien memegang banyak DS (toko). Toko di file klien dikenali lewat Kode Toko yang dipasang pada DS (ds.kode_toko), jadi pencocokan
-- tidak menebak nama. Toko yang kodenya belum terpasang di ORCA DILEWATI: dilaporkan ke pengunggah tetapi tidak disimpan.
-- DATA PRIBADI: nama rider tidak pernah dikirim atau disimpan. Yang tersimpan hanya Kode Mitra (MTR) dan angka.
-- ATURAN ANGKA (diperiksa di database, bukan di layar): Ontime + Late = Pesanan Selesai dan POD sesuai + tidak sesuai = Pesanan Selesai.
-- UNGGAH ULANG: file klien bersifat kumulatif, jadi baris yang sama ditimpa; nilai lama disimpan ke order_klien_riwayat (siapa menimpa lewat unggahan mana).
-- Semua penulisan lewat simpan_order_klien (atomik); tidak ada kebijakan tulis langsung pada tabel data.

create table klien (
  id uuid primary key default gen_random_uuid(),
  nama text not null check (char_length(btrim(nama)) between 1 and 80),
  target_ketepatan numeric(5, 2) check (target_ketepatan between 0 and 100), -- target ketepatan antar (%), diisi Super-admin
  dibuat timestamptz not null default now()
);
create unique index klien_nama_uq on klien (lower(btrim(nama)));

alter table ds
  add column klien_id uuid references klien(id) on delete set null,
  add column kode_toko text check (kode_toko is null or (kode_toko = upper(btrim(kode_toko)) and kode_toko <> ''));
create unique index ds_kode_toko_uq on ds (klien_id, kode_toko) where klien_id is not null and kode_toko is not null;

-- Arcon boleh mengubah kuota DS yang dipegang (migrasi 0018), tetapi tidak boleh mengalihkan toko ke klien lain atau mengganti kode tokonya.
create or replace function ds_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and current_user = 'authenticated' and not is_super() then
    if (new.id, new.nama, new.captain_id, new.arcon_id, new.group_wa_id, new.klien_id, new.kode_toko)
       is distinct from (old.id, old.nama, old.captain_id, old.arcon_id, old.group_wa_id, old.klien_id, old.kode_toko) then
      raise exception 'Arcon hanya boleh mengubah kebutuhan rider (kuota) DS';
    end if;
  end if;
  return new;
end $$;

create table unggahan_klien (
  id uuid primary key default gen_random_uuid(),
  klien_id uuid not null references klien(id) on delete cascade,
  waktu timestamptz not null default now(),
  oleh text,
  berkas text check (char_length(berkas) <= 200),
  sidik text check (char_length(sidik) <= 128),  -- sidik jari berkas (hash) untuk jejak audit; berkas aslinya tidak disimpan
  tgl_awal date,
  tgl_akhir date,
  baris_total int not null default 0,
  baris_baru int not null default 0,
  baris_ubah int not null default 0,
  baris_sama int not null default 0,
  baris_tolak int not null default 0,
  baris_lewat int not null default 0
);
create index unggahan_klien_waktu on unggahan_klien (klien_id, waktu desc);

create table order_klien (
  tanggal date not null,
  ds_id uuid not null references ds(id) on delete cascade,
  kode_mtr text not null check (char_length(kode_mtr) between 1 and 30),
  selesai int not null check (selesai between 0 and 999),
  ontime int not null check (ontime >= 0),
  late int not null check (late >= 0),
  pod_sesuai int not null check (pod_sesuai >= 0),
  pod_tidak int not null check (pod_tidak >= 0),
  unggahan_id uuid references unggahan_klien(id) on delete set null,
  diubah timestamptz not null default now(),
  primary key (tanggal, ds_id, kode_mtr),
  check (ontime + late = selesai),
  check (pod_sesuai + pod_tidak = selesai)
);
create index order_klien_ds_tanggal on order_klien (ds_id, tanggal);

-- Nilai lama sebelum ditimpa unggahan baru (tanpa kunci asing, supaya jejak tetap ada walau DS atau unggahan dihapus)
create table order_klien_riwayat (
  id bigint generated always as identity primary key,
  waktu timestamptz not null default now(),
  tanggal date not null,
  ds_id uuid not null,
  kode_mtr text not null,
  selesai_lama int not null,
  ontime_lama int not null,
  late_lama int not null,
  pod_sesuai_lama int not null,
  pod_tidak_lama int not null,
  unggahan_id uuid -- unggahan yang menimpa
);
create index order_klien_riwayat_kunci on order_klien_riwayat (tanggal, ds_id, kode_mtr);

create function order_klien_catat() returns trigger language plpgsql as $$
begin
  insert into order_klien_riwayat (tanggal, ds_id, kode_mtr, selesai_lama, ontime_lama, late_lama, pod_sesuai_lama, pod_tidak_lama, unggahan_id)
  values (old.tanggal, old.ds_id, old.kode_mtr, old.selesai, old.ontime, old.late, old.pod_sesuai, old.pod_tidak, new.unggahan_id);
  new.diubah := now();
  return new;
end $$;
create trigger order_klien_catat_t before update on order_klien for each row execute function order_klien_catat();

-- Hanya dibaca Super-admin untuk saat ini. Tanpa kebijakan tulis pada tabel data: penulisan hanya lewat simpan_order_klien.
alter table klien enable row level security;
alter table unggahan_klien enable row level security;
alter table order_klien enable row level security;
alter table order_klien_riwayat enable row level security;
create policy klien_super on klien for all to authenticated using ((select is_super())) with check ((select is_super()));
create policy unggahan_klien_baca on unggahan_klien for select to authenticated using ((select is_super()));
create policy order_klien_baca on order_klien for select to authenticated using ((select is_super()));
create policy order_klien_riwayat_baca on order_klien_riwayat for select to authenticated using ((select is_super()));

-- yyyy-mm-dd yang benar-benar ada di kalender, selain itu NULL (tidak melempar galat)
create function tanggal_aman(t text) returns date language plpgsql immutable as $$
begin
  if t is null or t !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return t::date;
exception when others then return null;
end $$;

-- Simpan unggahan klien. p_baris = [{baris?, tanggal, kode_toko, nama_toko?, kode_mtr, selesai, ontime, late, pod_sesuai, pod_tidak}, ...]
-- (tanpa nama rider). Mengembalikan ringkasan: total, baru, ubah, sama, tolak, lewat, daftar baris ditolak (maks 100) dan toko dilewati (maks 100).
create function simpan_order_klien(p_klien uuid, p_baris jsonb, p_berkas text default null, p_sidik text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_n int; v_id uuid := gen_random_uuid(); v_hari date := today_wib();
  v_baru int; v_ubah int; v_ok int; v_tolak int; v_lewat int; v_awal date; v_akhir date;
  v_tolak_daftar jsonb; v_lewat_daftar jsonb;
begin
  if not coalesce(is_super(), false) then raise exception 'Hanya Super-admin yang boleh mengunggah data order klien'; end if;
  perform 1 from klien where id = p_klien;
  if not found then raise exception 'Klien tidak ditemukan'; end if;
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

  with masuk as (
    insert into order_klien as o (tanggal, ds_id, kode_mtr, selesai, ontime, late, pod_sesuai, pod_tidak, unggahan_id)
    select tgl, ds_id, kode_mtr, selesai, ontime, late, pod_sesuai, pod_tidak, v_id
    from _unggah_klien where alasan is null and ds_id is not null
    on conflict (tanggal, ds_id, kode_mtr) do update
      set selesai = excluded.selesai, ontime = excluded.ontime, late = excluded.late,
          pod_sesuai = excluded.pod_sesuai, pod_tidak = excluded.pod_tidak, unggahan_id = excluded.unggahan_id
      where (o.selesai, o.ontime, o.late, o.pod_sesuai, o.pod_tidak)
            is distinct from (excluded.selesai, excluded.ontime, excluded.late, excluded.pod_sesuai, excluded.pod_tidak)
    returning (xmax = 0) as baru
  )
  select count(*) filter (where baru), count(*) filter (where not baru) into v_baru, v_ubah from masuk;

  select count(*) filter (where alasan is null and ds_id is not null), count(*) filter (where alasan is not null),
         count(*) filter (where alasan is null and ds_id is null), min(tgl) filter (where alasan is null), max(tgl) filter (where alasan is null)
    into v_ok, v_tolak, v_lewat, v_awal, v_akhir from _unggah_klien;

  select coalesce(jsonb_agg(jsonb_build_object('baris', nomor, 'alasan', alasan) order by urut), '[]') into v_tolak_daftar
    from (select * from _unggah_klien where alasan is not null order by urut limit 100) q;
  select coalesce(jsonb_agg(jsonb_build_object('kode_toko', kode_toko, 'nama_toko', nama_toko, 'baris', baris) order by kode_toko), '[]') into v_lewat_daftar
    from (select kode_toko, max(nama_toko) as nama_toko, count(*) as baris from _unggah_klien
          where alasan is null and ds_id is null group by kode_toko order by kode_toko limit 100) q;

  update unggahan_klien set tgl_awal = v_awal, tgl_akhir = v_akhir, baris_total = v_n, baris_baru = v_baru, baris_ubah = v_ubah,
         baris_sama = v_ok - v_baru - v_ubah, baris_tolak = v_tolak, baris_lewat = v_lewat
  where id = v_id;

  return jsonb_build_object('unggahan', v_id, 'total', v_n, 'baru', v_baru, 'ubah', v_ubah, 'sama', v_ok - v_baru - v_ubah,
                            'tolak', v_tolak, 'lewat', v_lewat, 'ditolak', v_tolak_daftar, 'toko_dilewati', v_lewat_daftar);
end $$;

revoke execute on function tanggal_aman(text), simpan_order_klien(uuid, jsonb, text, text) from public, anon;
grant execute on function tanggal_aman(text), simpan_order_klien(uuid, jsonb, text, text) to authenticated;
