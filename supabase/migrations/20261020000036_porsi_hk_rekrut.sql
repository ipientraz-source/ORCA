-- Kebutuhan rekrut memakai porsi rider 6 hari kerja (sisanya 5 hari kerja), bukan lagi 6 HK untuk semua.
-- Rata-rata HK per rider = 5 + porsi/100, jadi dibutuhkan = kuota harian × 7 / rata-rata HK, dibulatkan ke atas.
-- Bawaan 50% (rata-rata 5,5 HK ≈ ×1,27). 0% = semua 5 HK (×1,4). 100% = semua 6 HK (×1,17, perilaku lama).
create table pengaturan_rekrut (
  id boolean primary key default true check (id),
  porsi_enam_hk int not null default 50 check (porsi_enam_hk between 0 and 100)
);
insert into pengaturan_rekrut default values;
alter table pengaturan_rekrut enable row level security;
create policy pengaturan_rekrut_read on pengaturan_rekrut for select to authenticated using (true);
create policy pengaturan_rekrut_update on pengaturan_rekrut for update to authenticated using (is_super()) with check (is_super());

create or replace function ds_rekrut() returns table (ds_id uuid, ds_nama text, kuota int, perlu int, rider_aktif int, kandidat_proses int, kurang int)
language sql stable security definer set search_path = public as $$
  with t as (
    select d.id, d.nama, d.kuota_pagi + d.kuota_siang as kuota,
           ceil((d.kuota_pagi + d.kuota_siang) * 7 / (5 + (select porsi_enam_hk from pengaturan_rekrut) / 100.0))::int as perlu,
           (select count(*) from riders r where r.ds_id = d.id and r.peran in ('rider', 'captain') and r.status = 'aktif')::int as aktif,
           (select count(*) from kandidat k where k.ds_id = d.id and k.status in ('baru', 'dihubungi', 'interview', 'training'))::int as proses
    from ds d
    where is_super() or my_peran() = 'recruiter' or d.id = any(my_ds_ids())
  )
  select id, nama, kuota, perlu, aktif, proses, greatest(0, perlu - aktif) from t order by nama
$$;
