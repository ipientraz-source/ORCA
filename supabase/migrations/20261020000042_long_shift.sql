-- Long shift: rider yang sudah masuk kerja boleh menutup shift lain di hari yang sama bila ada rider yang tidak hadir.
-- Contoh: A masuk pagi, B (siang) alpha, A lanjut menutup shift siang B. A tercatat HADIR (shift pagi) dan PENGGANTI (shift siang B),
-- jadi dihitung 2 shift; insentif tetap di baris pengganti.
-- Aturan:
--  * rider pengganti harus hadir (atau belum diabsen) di shift miliknya, dan shift yang ditutup harus BEDA dari shift miliknya;
--  * satu rider maksimal satu shift tambahan per hari;
--  * rider yang sedang menutup shift lain tidak bisa diubah jadi alpha/izin/sakit/tukar sebelum penggantiannya dibatalkan;
--  * rider yang dijadwalkan tidak bisa dicatat sebagai pengganti langsung, hanya lewat isian rider yang tidak hadir;
--  * rider tanpa jadwal dan tukar terencana tetap satu isian per hari seperti sebelumnya.
-- Teknis: kunci unik (tanggal, rider_id) diganti jadi satu isian biasa + satu isian pengganti per rider per hari.
-- Laporan yang membandingkan jadwal dengan absensi hanya menghitung isian milik rider itu sendiri (bukan isian pengganti).

alter table actual_harian drop constraint actual_harian_tanggal_rider_id_key;
create unique index actual_harian_satu_jenis on actual_harian (tanggal, rider_id, ((status = 'pengganti')));

create or replace function catat_actual(p_tanggal date, p_rider uuid, p_status actual_status_t,
                             p_backup uuid default null, p_penjelasan text default null,
                             p_potongan boolean default null, p_insentif int default 0,
                             p_tanpa_pengganti boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_ds uuid; v_me uuid := me(); v_ins int := coalesce(p_insentif, 0); v_tanpa boolean := coalesce(p_tanpa_pengganti, false);
  v_sr shift_t; v_sb shift_t; v_jadwal boolean;
begin
  if is_super() then
    select ds_id into v_ds from riders where id = p_rider;
    if v_ds is null then raise exception 'Rider belum punya DS, masukkan ke DS dulu'; end if;
  else
    v_ds := my_ds();
    if v_ds is null then raise exception 'Hanya Captain atau Super-admin yang bisa mengisi actual'; end if;
  end if;
  if p_tanggal > today_wib() then raise exception 'Tidak bisa mengisi actual untuk tanggal mendatang'; end if;
  if not exists (select 1 from riders where id = p_rider and ds_id = v_ds) then
    raise exception 'Rider bukan anggota DS Anda';
  end if;
  if p_backup is not null and (p_backup = p_rider or not exists (select 1 from riders where id = p_backup and ds_id = v_ds)) then
    raise exception 'Backup/rekan harus rider lain di DS Anda';
  end if;
  if p_status = 'tukar' and p_backup is null then raise exception 'Tukar terencana wajib memilih rekan'; end if;
  if p_status = 'hadir' and p_backup is not null then
    raise exception 'Rider pengganti hanya untuk rider yang tidak hadir';
  end if;
  if v_tanpa and p_status not in ('alpha', 'izin', 'sakit') then
    raise exception '"Tidak dapat pengganti" hanya untuk alpha, izin, atau sakit';
  end if;
  if v_ins < 0 then raise exception 'Nominal insentif tidak boleh negatif'; end if;
  if v_ins > 0 and not (p_status = 'pengganti' or (p_status in ('alpha', 'izin', 'sakit') and p_backup is not null)) then
    raise exception 'Insentif hanya untuk rider pengganti';
  end if;
  if p_status in ('alpha', 'izin', 'sakit') and p_potongan is null then
    raise exception 'Pilih dulu apakah rider ini kena potongan (Ya atau Tidak)';
  end if;
  if p_status in ('alpha', 'izin', 'sakit') then
    if p_backup is null and not v_tanpa then
      raise exception 'Pilih rider pengganti, atau pilih "Tidak dapat pengganti"';
    end if;
    if p_backup is not null and v_tanpa then
      raise exception 'Pilih rider pengganti atau "Tidak dapat pengganti", tidak keduanya';
    end if;
    if p_backup is not null then
      select shift into v_sb from jadwal j where j.tanggal = p_tanggal and j.rider_id = p_backup and j.shift <> 'off';
      select shift into v_sr from jadwal j where j.tanggal = p_tanggal and j.rider_id = p_rider and j.shift <> 'off';
      if v_sb is not null then
        -- long shift: rider yang sudah masuk boleh menutup SHIFT LAIN (bukan shift yang sama), asalkan dirinya hadir
        if v_sb = v_sr then
          raise exception 'Rider pengganti sudah dijadwalkan di shift yang sama, pilih rider lain';
        end if;
        if exists (select 1 from actual_harian a where a.tanggal = p_tanggal and a.rider_id = p_backup and a.status not in ('hadir', 'pengganti')) then
          raise exception 'Rider pengganti sedang tidak hadir di hari itu';
        end if;
      elsif exists (select 1 from actual_harian a where a.tanggal = p_tanggal and a.rider_id = p_backup
                    and not (a.status = 'pengganti' and a.backup_untuk_id = p_rider)) then
        raise exception 'Rider pengganti sudah punya absensi di hari itu';
      end if;
      -- satu rider hanya boleh menutup satu shift tambahan per hari
      if exists (select 1 from actual_harian a where a.tanggal = p_tanggal and a.rider_id = p_backup
                 and a.status = 'pengganti' and a.backup_untuk_id is distinct from p_rider) then
        raise exception 'Rider pengganti sudah menutup shift rider lain di hari itu';
      end if;
    end if;
  end if;

  v_jadwal := exists (select 1 from jadwal j where j.tanggal = p_tanggal and j.rider_id = p_rider and j.shift <> 'off');
  if v_jadwal and p_status = 'pengganti' then
    raise exception 'Rider yang dijadwalkan hanya bisa jadi pengganti lewat isian rider yang tidak hadir (long shift)';
  end if;
  if v_jadwal and p_status in ('alpha', 'izin', 'sakit', 'tukar')
     and exists (select 1 from actual_harian a where a.tanggal = p_tanggal and a.rider_id = p_rider and a.status = 'pengganti') then
    raise exception 'Rider ini sedang menutup shift rider lain hari ini (long shift), batalkan penggantiannya dulu';
  end if;
  if not v_jadwal then
    -- rider tanpa jadwal tetap satu isian per hari seperti sebelumnya: isian baru menggantikan yang lama
    delete from actual_harian where tanggal = p_tanggal and rider_id = p_rider
      and (status = 'pengganti') is distinct from (p_status = 'pengganti');
  end if;
  if p_status = 'tukar' and p_backup is not null then
    -- tukar terencana: isian rekan diganti (bukan ditambah), seperti sebelumnya
    delete from actual_harian where tanggal = p_tanggal and rider_id = p_backup and status <> 'pengganti';
  end if;

  if p_status <> 'pengganti' then  -- bersihkan paket lama milik rider ini (termasuk insentif pengganti lama)
    delete from actual_harian where tanggal = p_tanggal and backup_untuk_id = p_rider and status = 'pengganti';
  end if;

  insert into actual_harian (tanggal, rider_id, ds_id, status, backup_untuk_id, penjelasan, potongan, insentif, tanpa_pengganti, diinput_oleh)
  values (p_tanggal, p_rider, v_ds, p_status, case when p_status = 'pengganti' then p_backup end, p_penjelasan,
          case when p_status in ('alpha', 'izin', 'sakit') then p_potongan end,
          case when p_status = 'pengganti' then v_ins else 0 end, v_tanpa, v_me)
  on conflict (tanggal, rider_id, ((status = 'pengganti'))) do update set
    status = excluded.status, backup_untuk_id = excluded.backup_untuk_id, penjelasan = excluded.penjelasan,
    potongan = excluded.potongan, insentif = excluded.insentif, tanpa_pengganti = excluded.tanpa_pengganti,
    diinput_oleh = v_me, jam_input = now(), ds_id = v_ds;

  if p_status in ('alpha', 'izin', 'sakit', 'tukar') and p_backup is not null then
    insert into actual_harian (tanggal, rider_id, ds_id, status, backup_untuk_id, potongan, insentif, diinput_oleh)
    values (p_tanggal, p_backup, v_ds, 'pengganti', p_rider, null, case when p_status = 'tukar' then 0 else v_ins end, v_me)
    on conflict (tanggal, rider_id, ((status = 'pengganti'))) do update set
      status = 'pengganti', backup_untuk_id = p_rider, potongan = null, tanpa_pengganti = false,
      insentif = case when p_status = 'tukar' then 0 else v_ins end,
      diinput_oleh = v_me, jam_input = now(), ds_id = v_ds;
  end if;
end $$;

create or replace function hapus_actual(p_tanggal date, p_rider uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_ds uuid; v_jadwal boolean;
begin
  if is_super() then
    select ds_id into v_ds from riders where id = p_rider;
  else
    v_ds := my_ds();
  end if;
  if v_ds is null then raise exception 'Hanya Captain atau Super-admin'; end if;
  v_jadwal := exists (select 1 from jadwal j where j.tanggal = p_tanggal and j.rider_id = p_rider and j.shift <> 'off');
  -- rider yang dijadwalkan: hanya isian miliknya sendiri; penggantian long shift-nya hilang bila isian rider yang digantikan dibatalkan
  delete from actual_harian where tanggal = p_tanggal and ds_id = v_ds
    and ((rider_id = p_rider and (not v_jadwal or status <> 'pengganti')) or (backup_untuk_id = p_rider and status = 'pengganti'));
end $$;

create or replace function laporan_ds(p_dari date, p_sampai date)
returns table (ds_id uuid, ds_nama text, dijadwalkan int, terisi int, patuh int, alpha int, tukar int, pengganti int,
               belum_diisi int, hari_belum_isi int, terakhir_input timestamptz, pagi_belum_isi int, siang_belum_isi int)
language sql stable as $$
  select d.id, d.nama,
    (select count(*) from jadwal j where j.ds_id = d.id and j.shift <> 'off' and j.tanggal between p_dari and p_sampai)::int,
    (select count(*) from jadwal j join actual_harian a on a.tanggal = j.tanggal and a.rider_id = j.rider_id and a.status <> 'pengganti'
       where j.ds_id = d.id and j.shift <> 'off' and j.tanggal between p_dari and p_sampai)::int,
    (select count(*) from jadwal j join actual_harian a on a.tanggal = j.tanggal and a.rider_id = j.rider_id and a.status <> 'pengganti'
       where j.ds_id = d.id and j.shift <> 'off' and j.tanggal between p_dari and p_sampai and a.status = 'hadir')::int,
    (select count(*) from actual_harian a where a.ds_id = d.id and a.tanggal between p_dari and p_sampai and a.status = 'alpha')::int,
    (select count(*) from actual_harian a where a.ds_id = d.id and a.tanggal between p_dari and p_sampai and a.status = 'tukar')::int,
    (select count(*) from actual_harian a where a.ds_id = d.id and a.tanggal between p_dari and p_sampai and a.status = 'pengganti')::int,
    (select count(*) from jadwal j where j.ds_id = d.id and j.shift <> 'off'
       and j.tanggal between p_dari and least(p_sampai, today_wib())
       and not exists (select 1 from actual_harian a where a.tanggal = j.tanggal and a.rider_id = j.rider_id and a.status <> 'pengganti'))::int,
    (select count(distinct j.tanggal) from jadwal j where j.ds_id = d.id and j.shift <> 'off'
       and j.tanggal between p_dari and least(p_sampai, today_wib())
       and not exists (select 1 from actual_harian a where a.tanggal = j.tanggal and a.ds_id = d.id))::int,
    (select max(a.jam_input) from actual_harian a where a.ds_id = d.id),
    (select count(distinct j.tanggal) from jadwal j where j.ds_id = d.id and j.shift = 'pagi'
       and j.tanggal between p_dari and least(p_sampai, today_wib())
       and not exists (select 1 from jadwal j2 join actual_harian a on a.tanggal = j2.tanggal and a.rider_id = j2.rider_id and a.status <> 'pengganti'
                       where j2.ds_id = d.id and j2.tanggal = j.tanggal and j2.shift = 'pagi'))::int,
    (select count(distinct j.tanggal) from jadwal j where j.ds_id = d.id and j.shift = 'siang'
       and j.tanggal between p_dari and least(p_sampai, case when (now() at time zone 'Asia/Jakarta')::time >= time '22:00' then today_wib() else today_wib() - 1 end)
       and not exists (select 1 from jadwal j2 join actual_harian a on a.tanggal = j2.tanggal and a.rider_id = j2.rider_id and a.status <> 'pengganti'
                       where j2.ds_id = d.id and j2.tanggal = j.tanggal and j2.shift = 'siang'))::int
  from ds d
  where is_super() or d.id = any(my_ds_ids())
  order by d.nama
$$;

create or replace function laporan_fulfillment(p_dari date, p_sampai date)
returns table (tanggal date, ds_id uuid, ds_nama text, kebutuhan_pagi int, kebutuhan_siang int,
               terpenuhi_pagi int, terpenuhi_siang int, terpenuhi_lain int, lapor_pagi boolean, lapor_siang boolean, siang_jatuh_tempo boolean)
language sql stable as $$
  select g.tgl::date, d.id, d.nama,
    coalesce(k.kuota_pagi, d.kuota_pagi), coalesce(k.kuota_siang, d.kuota_siang),
    (select count(*) from actual_harian a
       join jadwal j on j.tanggal = a.tanggal and j.rider_id = case when a.status = 'pengganti' then a.backup_untuk_id else a.rider_id end
       where a.ds_id = d.id and a.tanggal = g.tgl::date and a.status in ('hadir', 'tukar', 'pengganti') and j.shift = 'pagi')::int,
    (select count(*) from actual_harian a
       join jadwal j on j.tanggal = a.tanggal and j.rider_id = case when a.status = 'pengganti' then a.backup_untuk_id else a.rider_id end
       where a.ds_id = d.id and a.tanggal = g.tgl::date and a.status in ('hadir', 'tukar', 'pengganti') and j.shift = 'siang')::int,
    (select count(*) from actual_harian a
       where a.ds_id = d.id and a.tanggal = g.tgl::date and a.status in ('hadir', 'tukar', 'pengganti')
         and not exists (select 1 from jadwal j where j.tanggal = a.tanggal and j.shift in ('pagi', 'siang')
                         and j.rider_id = case when a.status = 'pengganti' then a.backup_untuk_id else a.rider_id end))::int,
    exists (select 1 from jadwal j join actual_harian a on a.tanggal = j.tanggal and a.rider_id = j.rider_id and a.status <> 'pengganti'
            where j.ds_id = d.id and j.tanggal = g.tgl::date and j.shift = 'pagi'),
    exists (select 1 from jadwal j join actual_harian a on a.tanggal = j.tanggal and a.rider_id = j.rider_id and a.status <> 'pengganti'
            where j.ds_id = d.id and j.tanggal = g.tgl::date and j.shift = 'siang'),
    (g.tgl::date < today_wib() or (now() at time zone 'Asia/Jakarta')::time >= time '22:00')
  from ds d
  cross join generate_series(p_dari::timestamp, least(p_sampai, today_wib())::timestamp, interval '1 day') g(tgl)
  left join kuota_harian k on k.ds_id = d.id and k.tanggal = g.tgl::date
  where is_super() or d.id = any(my_ds_ids())
  order by g.tgl, d.nama
$$;

create or replace function laporan_rider(p_dari date, p_sampai date)
returns table (rider_id uuid, kode_mtr text, nama text, ds_nama text, dijadwalkan int, hadir int,
               alpha int, izin int, sakit int, tukar int, pengganti int, belum_diisi int, potongan int, insentif bigint)
language sql stable as $$
  with x as (
    select coalesce(s.rider_id, a.rider_id) rid, coalesce(s.tanggal, a.tanggal) tgl,
           s.rider_id is not null as sched, a.status, a.potongan, a.insentif
    from (select rider_id, tanggal from jadwal where shift <> 'off' and tanggal between p_dari and p_sampai) s
    full join (select rider_id, tanggal, status, potongan, insentif from actual_harian where tanggal between p_dari and p_sampai) a
      on a.rider_id = s.rider_id and a.tanggal = s.tanggal and a.status <> 'pengganti'
  )
  select r.id, r.kode_mtr, r.nama, d.nama,
    (count(*) filter (where x.sched))::int,
    (count(*) filter (where x.status = 'hadir'))::int,
    (count(*) filter (where x.status = 'alpha'))::int,
    (count(*) filter (where x.status = 'izin'))::int,
    (count(*) filter (where x.status = 'sakit'))::int,
    (count(*) filter (where x.status = 'tukar'))::int,
    (count(*) filter (where x.status = 'pengganti'))::int,
    (count(*) filter (where x.sched and x.status is null and x.tgl <= today_wib()))::int,
    (count(*) filter (where x.potongan))::int,
    (coalesce(sum(x.insentif) filter (where x.status = 'pengganti'), 0))::bigint
  from x join riders r on r.id = x.rid left join ds d on d.id = r.ds_id
  group by r.id, r.kode_mtr, r.nama, d.nama
  order by r.nama
$$;
