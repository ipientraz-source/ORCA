-- Kehadiran dari backoffice Dash (BO): clock-in rider per hub. BO adalah sumber daftar DS: tiap DS punya hub_bo (nama hub persis seperti di BO),
-- dan hub baru yang muncul saat impor otomatis membuat DS baru (kuota 0, budget diisi manual di Orca karena BO tidak menyimpan budget).
-- Hanya yang dibutuhkan laporan fulfillment yang disimpan: kode mitra, hub, jam masuk dan keluar. NIK, nama, selfie, dan GPS sengaja tidak diimpor.
-- Penilaian shift dan tepat waktu dilakukan Orca (bukan BO), memakai pengaturan_kehadiran.

alter table ds add column if not exists hub_bo text;
create unique index if not exists ds_hub_bo on ds (hub_bo) where hub_bo is not null;

create table if not exists kehadiran_bo (
  id uuid primary key default gen_random_uuid(),
  hub text not null,
  ds_id uuid references ds(id) on delete set null,
  kode_mtr text not null,
  tanggal date not null,                       -- tanggal lokal hub
  masuk_lokal time not null,                   -- jam masuk menurut jam lokal hub (dipakai menilai tepat waktu)
  zona text not null check (zona in ('WIB', 'WITA', 'WIT')),
  masuk_wib timestamptz not null,
  keluar_wib timestamptz,
  sumber text not null default 'csv' check (sumber in ('csv', 'api')),
  diimpor timestamptz not null default now(),
  unique (hub, kode_mtr, masuk_wib)
);
create index if not exists kehadiran_bo_tgl on kehadiran_bo (tanggal, ds_id);
create index if not exists kehadiran_bo_mtr on kehadiran_bo (kode_mtr, tanggal);
alter table kehadiran_bo enable row level security;
drop policy if exists kehadiran_bo_baca on kehadiran_bo;
-- Super-admin melihat semua; Arcon hanya DS yang dipegangnya
create policy kehadiran_bo_baca on kehadiran_bo for select to authenticated
  using ((select is_super()) or ((select my_peran()) = 'arcon' and ds_id = any((select my_ds_ids())::uuid[])));

-- Aturan shift dan tepat waktu (jam lokal hub). Tepat waktu bila jam masuk <= jam mulai shift + toleransi_menit.
-- Untuk rider yang tidak terjadwal, shift ditentukan dari jam masuk: pagi sampai batas_pagi, Middle sampai batas_tengah, selebihnya siang.
create table if not exists pengaturan_kehadiran (
  id int primary key default 1 check (id = 1),
  mulai_pagi text not null default '06:00' check (mulai_pagi ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  mulai_tengah text not null default '10:00' check (mulai_tengah ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  mulai_siang text not null default '14:00' check (mulai_siang ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  toleransi_menit int not null default 2 check (toleransi_menit between 0 and 60),
  batas_pagi text not null default '08:55' check (batas_pagi ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  batas_tengah text not null default '11:59' check (batas_tengah ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  diubah timestamptz not null default now()
);
insert into pengaturan_kehadiran (id) values (1) on conflict (id) do nothing;
alter table pengaturan_kehadiran enable row level security;
drop policy if exists pengaturan_kehadiran_super on pengaturan_kehadiran;
drop policy if exists pengaturan_kehadiran_baca on pengaturan_kehadiran;
drop policy if exists pengaturan_kehadiran_ubah on pengaturan_kehadiran;
-- Super-admin dan Arcon boleh membaca (Arcon melihat aturan yang dipakai); hanya Super-admin yang mengubah
create policy pengaturan_kehadiran_baca on pengaturan_kehadiran for select to authenticated using ((select is_super()) or (select my_peran()) = 'arcon');
create policy pengaturan_kehadiran_ubah on pengaturan_kehadiran for update to authenticated using ((select is_super())) with check ((select is_super()));

-- Impor baris kehadiran. Hanya Super-admin.
--   p_baris  array objek: hub, kode_mtr, tanggal (YYYY-MM-DD), masuk_lokal (HH:MM), zona, masuk_wib, keluar_wib (boleh null)
--   p_peta   objek: nama hub -> id DS yang dipasangkan (untuk hub yang belum terhubung); hub tanpa pasangan dibuatkan DS baru bernama hub itu
-- Urutan mencocokkan hub: (1) DS yang hub_bo-nya sudah sama, (2) pasangan dari p_peta (DS diganti namanya mengikuti BO), (3) DS yang namanya sudah persis
-- nama hub, (4) DS baru. Aman diulang: baris yang sama (hub, kode mitra, jam masuk) hanya diperbarui jam keluarnya.
create or replace function impor_kehadiran_bo(p_baris jsonb, p_peta jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  h text; v_ds uuid; v_pasang text;
  v_dibuat int := 0; v_dipasang int := 0; v_baru int := 0; v_ubah int := 0;
  v_peta jsonb := '{}'::jsonb;
begin
  if not is_super() then raise exception 'Hanya Super-admin yang bisa mengimpor kehadiran'; end if;
  if jsonb_typeof(p_baris) <> 'array' then raise exception 'Baris harus berupa array'; end if;

  for h in select distinct e->>'hub' from jsonb_array_elements(p_baris) e loop
    continue when h is null or trim(h) = '';
    select id into v_ds from ds where hub_bo = h;
    if v_ds is null then
      v_pasang := p_peta->>h;
      if v_pasang is not null and v_pasang <> '' then
        -- DS yang sudah ada dipasangkan ke hub ini dan namanya mengikuti BO
        update ds set hub_bo = h, nama = h where id = v_pasang::uuid and hub_bo is null returning id into v_ds;
        if v_ds is null then raise exception 'DS pasangan untuk hub "%" tidak ditemukan atau sudah terhubung ke hub lain', h; end if;
        v_dipasang := v_dipasang + 1;
      else
        select id into v_ds from ds where lower(nama) = lower(h) and hub_bo is null;
        if v_ds is not null then
          update ds set hub_bo = h, nama = h where id = v_ds;
          v_dipasang := v_dipasang + 1;
        else
          insert into ds (nama, hub_bo) values (h, h) returning id into v_ds;
          v_dibuat := v_dibuat + 1;
        end if;
      end if;
    end if;
    v_peta := v_peta || jsonb_build_object(h, v_ds);
  end loop;

  with data as (
    select e->>'hub' as hub, upper(trim(e->>'kode_mtr')) as kode_mtr, (e->>'tanggal')::date as tanggal, (e->>'masuk_lokal')::time as masuk_lokal,
           e->>'zona' as zona, (e->>'masuk_wib')::timestamptz as masuk_wib, nullif(e->>'keluar_wib', '')::timestamptz as keluar_wib
    from jsonb_array_elements(p_baris) e
    where coalesce(trim(e->>'hub'), '') <> '' and coalesce(trim(e->>'kode_mtr'), '') <> ''
  ), up as (
    insert into kehadiran_bo (hub, ds_id, kode_mtr, tanggal, masuk_lokal, zona, masuk_wib, keluar_wib)
    select d.hub, (v_peta->>d.hub)::uuid, d.kode_mtr, d.tanggal, d.masuk_lokal, d.zona, d.masuk_wib, d.keluar_wib from data d
    on conflict (hub, kode_mtr, masuk_wib) do update
      set keluar_wib = excluded.keluar_wib, ds_id = excluded.ds_id, diimpor = now()
      where kehadiran_bo.keluar_wib is distinct from excluded.keluar_wib or kehadiran_bo.ds_id is distinct from excluded.ds_id
    returning (xmax = 0) as baru
  )
  select count(*) filter (where baru), count(*) filter (where not baru) into v_baru, v_ubah from up;

  return jsonb_build_object('hub', (select count(distinct e->>'hub') from jsonb_array_elements(p_baris) e),
                            'ds_dibuat', v_dibuat, 'ds_dipasang', v_dipasang, 'baris_baru', v_baru, 'baris_diperbarui', v_ubah);
end $$;
revoke execute on function impor_kehadiran_bo(jsonb, jsonb) from public, anon;
grant execute on function impor_kehadiran_bo(jsonb, jsonb) to authenticated;

-- Ringkasan kehadiran per tanggal dan hub: rider unik yang clock-in, dan berapa yang terdaftar sebagai rider di Orca.
-- Super-admin melihat semua hub; Arcon hanya hub dari DS yang dipegangnya.
create or replace function ringkasan_kehadiran_bo(p_dari date, p_sampai date)
returns table (tanggal date, hub text, ds_id uuid, rider int, terdaftar int)
language sql stable security definer set search_path = public as $$
  select k.tanggal, k.hub, k.ds_id, count(distinct k.kode_mtr)::int, (count(distinct k.kode_mtr) filter (where exists (select 1 from riders r where r.kode_mtr = k.kode_mtr)))::int
  from kehadiran_bo k
  where (is_super() or (my_peran() = 'arcon' and k.ds_id = any(my_ds_ids()))) and k.tanggal between p_dari and p_sampai
  group by k.tanggal, k.hub, k.ds_id
  order by k.tanggal desc, k.hub
$$;
revoke execute on function ringkasan_kehadiran_bo(date, date) from public, anon;
grant execute on function ringkasan_kehadiran_bo(date, date) to authenticated;
