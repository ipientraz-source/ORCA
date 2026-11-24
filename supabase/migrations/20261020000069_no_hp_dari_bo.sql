-- Nomor HP rider dari BO: isi nomor HP rider Orca yang masih kosong memakai daftar mitra di BO (Masterdata, Mitra: kode mitra dan nomor WhatsApp).
-- Dipanggil Edge Function tarik-hp-bo (service_role) atau Super-admin. Hanya mengisi yang KOSONG; nomor yang sudah ada tidak pernah ditimpa.
--   p_baris  array objek: kode (kode mitra), hp (nomor apa adanya dari BO)
-- Nomor dirapikan: hanya angka, 0812... dan 812... menjadi 62812..., harus 62 diikuti 8 sampai 13 angka. Selain itu dilewati.
create or replace function isi_no_hp_bo(p_baris jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_kandidat int; v_terisi int;
begin
  if not (is_super() or coalesce(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb->>'role' = 'service_role', false)) then
    raise exception 'Hanya Super-admin yang bisa mengisi nomor HP dari BO';
  end if;
  if jsonb_typeof(p_baris) <> 'array' then raise exception 'Baris harus berupa array'; end if;

  select count(*)::int into v_kandidat from riders where peran = 'rider' and status = 'aktif' and nullif(trim(coalesce(no_hp, '')), '') is null;

  with data as (
    select distinct on (upper(trim(e->>'kode'))) upper(trim(e->>'kode')) as kode, regexp_replace(coalesce(e->>'hp', ''), '[^0-9]', '', 'g') as hp
    from jsonb_array_elements(p_baris) e
    where coalesce(trim(e->>'kode'), '') <> ''
    order by upper(trim(e->>'kode'))
  ), rapi as (
    select kode, case when hp like '62%' then hp when hp like '0%' then '62' || substr(hp, 2) when hp like '8%' then '62' || hp end as hp from data
  ), isi as (
    update riders r set no_hp = d.hp
    from rapi d
    where upper(r.kode_mtr) = d.kode and d.hp ~ '^62[0-9]{8,13}$' and nullif(trim(coalesce(r.no_hp, '')), '') is null
    returning 1
  )
  select count(*)::int into v_terisi from isi;

  return jsonb_build_object('kandidat', v_kandidat, 'terisi', v_terisi);
end $$;
revoke execute on function isi_no_hp_bo(jsonb) from public, anon;
grant execute on function isi_no_hp_bo(jsonb) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function isi_no_hp_bo(jsonb) to service_role;
  end if;
end $$;
