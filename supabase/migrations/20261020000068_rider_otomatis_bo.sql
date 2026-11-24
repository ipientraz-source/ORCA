-- Rider otomatis dari clock-in BO: tiap sinkron, mitra yang clock-in tetapi belum ada di Orca ditambahkan sebagai rider aktif di DS hub-nya, jadi Captain
-- tinggal menonaktifkan yang sudah resign. impor_kehadiran_bo (0064) menerima nama (kolom "nama" pada baris) dan mengembalikan rider_baru.
-- Hanya nama yang disimpan; NIK, selfie, dan GPS tetap tidak dibawa. Rider yang sudah ada tidak diubah (DS, nama, dan status tetap).
-- Rider yang ditambahkan dicatat "bergabung sebelum pencatatan" (tanggal kosong) agar tidak dihitung sebagai rekrutan baru. Jalan ulang aman.

create or replace function impor_kehadiran_bo(p_baris jsonb, p_peta jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  h text; v_ds uuid; v_pasang text;
  v_dibuat int := 0; v_dipasang int := 0; v_baru int := 0; v_ubah int := 0;
  v_peta jsonb := '{}'::jsonb;
  v_baris jsonb; v_pet jsonb;
  v_rider int := 0; v_kode text[];
begin
  -- Super-admin dari Orca, atau Edge Function tarik-kehadiran-bo (service_role) yang sudah memeriksa Super-admin / rahasia cron sendiri
  if not (is_super() or coalesce(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb->>'role' = 'service_role', false)) then
    raise exception 'Hanya Super-admin yang bisa mengimpor kehadiran';
  end if;
  if jsonb_typeof(p_baris) <> 'array' then raise exception 'Baris harus berupa array'; end if;
  -- Satu aturan untuk semua sumber (CSV maupun API): nama hub dirapikan (spasi ganda dan tepi dibuang), kode mitra huruf besar
  select coalesce(jsonb_agg(jsonb_set(e, '{hub}', to_jsonb(regexp_replace(trim(e->>'hub'), '\s+', ' ', 'g')))), '[]'::jsonb) into v_baris
    from jsonb_array_elements(p_baris) e where e->>'hub' is not null;
  select coalesce(jsonb_object_agg(regexp_replace(trim(k), '\s+', ' ', 'g'), v), '{}'::jsonb) into v_pet from jsonb_each(coalesce(p_peta, '{}'::jsonb)) as t(k, v);

  for h in select distinct e->>'hub' from jsonb_array_elements(v_baris) e loop
    continue when h is null or trim(h) = '';
    select id into v_ds from ds where hub_bo = h;
    if v_ds is null then
      v_pasang := v_pet->>h;
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
           e->>'zona' as zona, (e->>'masuk_wib')::timestamptz as masuk_wib, nullif(e->>'keluar_wib', '')::timestamptz as keluar_wib,
           case when e->>'sumber' = 'csv' then 'csv' else 'api' end as sumber
    from jsonb_array_elements(v_baris) e
    where coalesce(trim(e->>'hub'), '') <> '' and coalesce(trim(e->>'kode_mtr'), '') <> ''
  ), up as (
    insert into kehadiran_bo (hub, ds_id, kode_mtr, tanggal, masuk_lokal, zona, masuk_wib, keluar_wib, sumber)
    select d.hub, (v_peta->>d.hub)::uuid, d.kode_mtr, d.tanggal, d.masuk_lokal, d.zona, d.masuk_wib, d.keluar_wib, d.sumber from data d
    on conflict (hub, kode_mtr, masuk_wib) do update
      set keluar_wib = excluded.keluar_wib, ds_id = excluded.ds_id, diimpor = now()
      where kehadiran_bo.keluar_wib is distinct from excluded.keluar_wib or kehadiran_bo.ds_id is distinct from excluded.ds_id
    returning (xmax = 0) as baru
  )
  select count(*) filter (where baru), count(*) filter (where not baru) into v_baru, v_ubah from up;

  -- Rider baru dari BO: mitra yang clock-in tetapi belum ada di Orca ditambahkan sebagai rider aktif di DS hub clock-in terbarunya. Hanya nama dari BO yang dibawa
  -- (NIK, selfie, dan GPS tidak). Captain tinggal menonaktifkan yang sudah resign. Rider yang sudah ada tidak diubah, baris tanpa nama dilewati.
  with calon as (
    select distinct on (upper(trim(e->>'kode_mtr'))) upper(trim(e->>'kode_mtr')) as kode,
           left(regexp_replace(trim(e->>'nama'), '\s+', ' ', 'g'), 120) as nama, (v_peta->>(e->>'hub'))::uuid as ds_id
    from jsonb_array_elements(v_baris) e
    where coalesce(trim(e->>'hub'), '') <> '' and coalesce(trim(e->>'kode_mtr'), '') <> '' and coalesce(trim(e->>'nama'), '') <> ''
    order by upper(trim(e->>'kode_mtr')), (e->>'masuk_wib')::timestamptz desc
  ), baru as (
    insert into riders (kode_mtr, nama, ds_id, peran, status)
    select c.kode, c.nama, c.ds_id, 'rider', 'aktif' from calon c
    where not exists (select 1 from riders r where upper(r.kode_mtr) = c.kode)
    on conflict (kode_mtr) do nothing
    returning kode_mtr
  )
  select coalesce(array_agg(kode_mtr), '{}'::text[]), count(*)::int into v_kode, v_rider from baru;
  -- Trigger mencatat "bergabung hari ini". Mereka sudah bekerja sebelum terdaftar di Orca, jadi dicatat bergabung sebelum pencatatan
  -- supaya angka rekrutmen dan churn tidak menggelembung.
  if v_rider > 0 then
    update rider_peristiwa set tanggal = null
    where jenis = 'bergabung' and tanggal = today_wib() and rider_id in (select id from riders where kode_mtr = any(v_kode));
  end if;

  return jsonb_build_object('hub', (select count(distinct e->>'hub') from jsonb_array_elements(v_baris) e),
                            'ds_dibuat', v_dibuat, 'ds_dipasang', v_dipasang, 'baris_baru', v_baru, 'baris_diperbarui', v_ubah, 'rider_baru', v_rider);
end $$;
