-- Long shift, kasus kelelahan: rider X menutup shift 1 rider lain, lalu di shift 2 yang SESUAI JADWALNYA X diganti rider Y karena lelah.
-- Sebelumnya (0042) X ditolak dijadikan alpha/izin/sakit selama masih menutup shift lain, dan sebaliknya X yang sudah tidak hadir
-- ditolak jadi pengganti. Keduanya terlalu ketat: dua isian X menyangkut shift yang BERBEDA (aturan shift-beda tetap berlaku).
-- Perubahan:
--  * rider terjadwal boleh dicatat alpha/izin/sakit untuk shift miliknya walau sedang menutup shift lain (urutan pencatatan bebas);
--  * rider yang sendiri tidak hadir di shift miliknya boleh dipilih sebagai pengganti shift lain;
--  * tukar terencana tetap ditolak bila salah satu pihak sedang menutup shift lain (supaya isian penggantinya tidak tertimpa);
--  * Batalkan pada rider yang hanya punya isian pengganti (termasuk isian lama tanpa rider yang digantikan) sekarang menghapusnya.

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
  if v_jadwal and p_status = 'tukar'
     and exists (select 1 from actual_harian a where a.tanggal = p_tanggal and a.rider_id = p_rider and a.status = 'pengganti') then
    raise exception 'Rider ini sedang menutup shift rider lain hari ini, tukar terencana tidak bisa dipakai';
  end if;
  if p_status = 'tukar' and p_backup is not null
     and exists (select 1 from actual_harian a where a.tanggal = p_tanggal and a.rider_id = p_backup
                 and a.status = 'pengganti' and a.backup_untuk_id is distinct from p_rider) then
    raise exception 'Rekan tukar sedang menutup shift rider lain hari ini, pilih rekan lain';
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
declare v_ds uuid; v_jadwal boolean; v_biasa boolean;
begin
  if is_super() then
    select ds_id into v_ds from riders where id = p_rider;
  else
    v_ds := my_ds();
  end if;
  if v_ds is null then raise exception 'Hanya Captain atau Super-admin'; end if;
  v_jadwal := exists (select 1 from jadwal j where j.tanggal = p_tanggal and j.rider_id = p_rider and j.shift <> 'off');
  v_biasa := exists (select 1 from actual_harian a where a.tanggal = p_tanggal and a.ds_id = v_ds and a.rider_id = p_rider and a.status <> 'pengganti');
  -- rider terjadwal yang punya isian sendiri: hanya isian itu yang dihapus, penggantiannya tetap. Kalau tinggal isian pengganti
  -- (termasuk isian lama tanpa rider yang digantikan), isian itu yang dihapus. Penggantian ikut hilang bila isian rider yang digantikan dibatalkan.
  delete from actual_harian where tanggal = p_tanggal and ds_id = v_ds
    and ((rider_id = p_rider and (not v_jadwal or status <> 'pengganti' or not v_biasa)) or (backup_untuk_id = p_rider and status = 'pengganti'));
end $$;
