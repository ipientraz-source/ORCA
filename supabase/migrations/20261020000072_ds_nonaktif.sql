-- DS bisa dinonaktifkan tanpa dihapus. Menghapus DS ikut menghapus jadwal, absensi Captain (actual), dan budget harian, jadi riwayat performa hilang;
-- menonaktifkan hanya menandai: semua data dan riwayat tetap utuh, dan DS bisa diaktifkan lagi kapan saja.
--   aktif          : kolom baru, default true (semua DS yang ada tetap aktif)
--   penjaga        : hanya Super-admin yang boleh mengubahnya; DS yang masih punya rider aktif atau jadwal mulai hari ini tidak bisa dinonaktifkan
--   ds_tanpa_clockin(p_hari): DS yang terhubung ke BO (hub_bo terisi), masih aktif, dan tidak ada mitra clock-in dalam p_hari hari terakhir (termasuk hari ini);
--                    dipakai sebagai petunjuk di Kelola DS, tidak menonaktifkan apa pun sendiri
-- Sinkron BO tetap mencatat clock-in DS nonaktif; datanya tidak disembunyikan.

alter table ds add column if not exists aktif boolean not null default true;

create or replace function ds_jaga_aktif() returns trigger language plpgsql as $$
begin
  if new.aktif is not distinct from old.aktif then return new; end if;
  -- editor SQL / service role (bukan authenticated atau anon) dibiarkan; lewat aplikasi hanya Super-admin
  if current_user in ('authenticated', 'anon') and not is_super() then
    raise exception 'Hanya Super-admin yang boleh menonaktifkan atau mengaktifkan DS';
  end if;
  if not new.aktif then
    if exists (select 1 from riders where ds_id = new.id and peran = 'rider' and status = 'aktif') then
      raise exception 'DS ini masih punya rider aktif. Pindahkan atau nonaktifkan ridernya dulu';
    end if;
    if exists (select 1 from jadwal where ds_id = new.id and tanggal >= today_wib() and shift <> 'off') then
      raise exception 'DS ini masih punya jadwal mulai hari ini. Hapus jadwalnya dulu';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists ds_jaga_aktif on ds;
create trigger ds_jaga_aktif before update of aktif on ds for each row execute function ds_jaga_aktif();

create or replace function ds_tanpa_clockin(p_hari int default 3)
returns setof uuid language sql stable security definer set search_path = public as $$
  select d.id from ds d
  where is_super() and d.aktif and d.hub_bo is not null
    and not exists (select 1 from kehadiran_bo b where b.ds_id = d.id and b.tanggal > today_wib() - p_hari)
$$;
revoke execute on function ds_tanpa_clockin(int) from public, anon;
grant execute on function ds_tanpa_clockin(int) to authenticated;
