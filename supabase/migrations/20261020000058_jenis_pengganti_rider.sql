-- Rider pengganti dibedakan di akun rider: long shift = rider yang terjadwal hari itu lalu lanjut menutup shift lain,
-- backup = rider tanpa jadwal hari itu (mis. Libur) yang menutup shift rider lain. Aturannya sama dengan Laporan Absensi Harian Captain (daily.tsx).
-- Fungsi dibuat ulang karena kolom hasil bertambah (jenis); isi selain itu sama dengan 0057.

drop function if exists riwayat_absensi_rider(text, int);
create function riwayat_absensi_rider(p_kode text, p_hari int default 60)
returns table (tanggal date, status text, shift text, jenis text)
language sql stable security definer set search_path = public as $$
  with r as (select id from riders where kode_mtr = upper(trim(p_kode)) and status = 'aktif'),
  h as (select today_wib() - least(greatest(coalesce(p_hari, 60), 1), 90) as dari)
  select a.tanggal, a.status::text,
    coalesce((select sd.shift::text from shift_dikerjakan(a.tanggal, a.tanggal) sd where sd.rider_id = a.rider_id and (sd.sumber = 'pengganti') = (a.status = 'pengganti') limit 1),
             (select j.shift::text from jadwal j where j.tanggal = a.tanggal and j.rider_id = a.rider_id and j.shift <> 'off' limit 1)),
    case when a.status = 'pengganti' then
      case when exists (select 1 from jadwal j where j.tanggal = a.tanggal and j.rider_id = a.rider_id and j.shift <> 'off') then 'long_shift' else 'backup' end
    end
  from actual_harian a, r, h
  where a.rider_id = r.id and a.tanggal between h.dari and today_wib()
  union all
  select j.tanggal, 'belum', j.shift::text, null::text
  from jadwal j, r, h
  where j.rider_id = r.id and j.shift <> 'off' and j.tanggal between h.dari and today_wib() - 1
    and not exists (select 1 from actual_harian a where a.tanggal = j.tanggal and a.rider_id = j.rider_id)
  order by 1 desc
  limit 120
$$;
revoke execute on function riwayat_absensi_rider(text, int) from public;
grant execute on function riwayat_absensi_rider(text, int) to anon, authenticated;

drop function if exists pengganti_rider(text);
create function pengganti_rider(p_kode text)
returns table (tanggal date, shift text, jenis text)
language sql stable security definer set search_path = public as $$
  select a.tanggal,
    (select sd.shift::text from shift_dikerjakan(a.tanggal, a.tanggal) sd where sd.rider_id = a.rider_id and sd.sumber = 'pengganti' limit 1),
    case when exists (select 1 from jadwal j where j.tanggal = a.tanggal and j.rider_id = a.rider_id and j.shift <> 'off') then 'long_shift' else 'backup' end
  from actual_harian a
  where a.status = 'pengganti' and a.tanggal >= today_wib() and a.tanggal <= today_wib() + 14
    and a.rider_id = (select id from riders where kode_mtr = upper(trim(p_kode)) and status = 'aktif')
  order by a.tanggal
$$;
revoke execute on function pengganti_rider(text) from public;
grant execute on function pengganti_rider(text) to anon, authenticated;
