-- Ubah dan hapus data rider, supaya salah ketik saat pengisian bisa diperbaiki.
--
-- UBAH (nama, Kode MTR, no HP): hanya rider biasa. Boleh Super-admin, Captain DS-nya, dan Arcon yang memegang DS-nya (sama dengan yang boleh
-- mengubah status rider). Lewat fungsi ini, bukan isian langsung: riders_guard dan kebijakan RLS tidak dilonggarkan, jadi Captain dan Arcon
-- tetap tidak bisa mengubah baris rider dengan cara lain. Super-admin juga bisa memperbaiki nama, Kode MTR, dan no HP Captain dan Arcon.
-- Kode MTR tetap unik. Kode lama yang sudah punya clock-in BO tidak boleh diganti, karena clock-in itu disimpan memakai kodenya dan akan terputus.
--
-- HAPUS: hanya rider biasa yang BELUM punya riwayat apa pun (salah ketik atau salah masuk): jadwal, absensi (juga sebagai pengganti), clock-in BO,
-- laporan order, kandidat rekrutmen yang diterima menjadi rider ini, riwayat berhenti/kembali/impor, dan motor yang dipegang.
-- Yang sudah punya riwayat ditolak dan diarahkan ke Nonaktifkan, supaya turnover, jadwal, dan absensi lama tidak rusak.
-- Boleh Super-admin dan Arcon DS-nya (sama dengan yang boleh menambah rider); Captain tidak.
--
-- Pencatatan ke riwayat aktivitas (siapa, kapan, nilai lama → baru) dilakukan trigger riwayat_ubah/riwayat_hapus pada tabel riders (migrasi 0027),
-- jadi tidak ditulis lagi di sini.

create function jejak_rider(p_rider uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare r riders%rowtype; v text[] := '{}'; n int;
begin
  select * into r from riders where id = p_rider;
  if not found then raise exception 'Rider tidak ditemukan'; end if;
  if r.peran <> 'rider' then raise exception 'Hanya rider biasa yang bisa dihapus dari sini'; end if;
  if not coalesce(is_super() or (my_peran() = 'arcon' and r.ds_id = any(my_ds_ids())), false) then
    raise exception 'Hanya Super-admin atau Arcon DS-nya yang boleh menghapus rider ini';
  end if;
  select count(*) into n from jadwal where rider_id = p_rider;
  if n > 0 then v := v || (n || ' jadwal'); end if;
  select count(*) into n from actual_harian where rider_id = p_rider or backup_untuk_id = p_rider;
  if n > 0 then v := v || (n || ' absensi'); end if;
  select count(*) into n from kehadiran_bo where kode_mtr = r.kode_mtr;
  if n > 0 then v := v || (n || ' clock-in BO'); end if;
  select count(*) into n from laporan_order where rider_id = p_rider;
  if n > 0 then v := v || (n || ' laporan order'); end if;
  select count(*) into n from kandidat where rider_id = p_rider; -- perujuk tidak dihitung: namanya tersimpan di kandidat (perujuk_nama) dan perujuk_id memang boleh kosong
  if n > 0 then v := v || (n || ' data rekrutmen'); end if;
  select count(*) into n from rider_peristiwa where rider_id = p_rider and (jenis <> 'bergabung' or sumber <> 'sistem');
  if n > 0 then v := v || (n || ' riwayat bergabung/berhenti'); end if;
  select count(*) into n from motor where dipegang_oleh = p_rider;
  if n > 0 then v := v || (n || ' motor dipegang'); end if;
  return array_to_string(v, ', ');
end $$;

create function hapus_rider(p_rider uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_jejak text;
begin
  perform 1 from riders where id = p_rider for update; -- kunci dulu: jadwal baru untuk rider ini menunggu, lalu gagal karena rider sudah tiada
  v_jejak := jejak_rider(p_rider);
  if v_jejak <> '' then
    raise exception 'Rider ini sudah punya riwayat (%) dan tidak bisa dihapus. Nonaktifkan saja supaya jadwal, absensi, dan angka turnover lama tetap utuh', v_jejak;
  end if;
  delete from riders where id = p_rider;
end $$;

create function ubah_rider(p_rider uuid, p_nama text, p_kode text, p_hp text) returns void
language plpgsql security definer set search_path = public as $$
declare r riders%rowtype; v_nama text := regexp_replace(trim(coalesce(p_nama, '')), '\s+', ' ', 'g');
        v_kode text := nullif(upper(trim(coalesce(p_kode, ''))), ''); v_hp text := nullif(regexp_replace(coalesce(p_hp, ''), '[\s.-]', '', 'g'), '');
        v_pakai riders%rowtype; n int;
begin
  select * into r from riders where id = p_rider for update;
  if not found then raise exception 'Rider tidak ditemukan'; end if;
  if r.peran = 'super_admin' then raise exception 'Super-admin diatur di Hub Control, bukan di sini'; end if;
  -- coalesce: DS kosong (NULL) membuat perbandingan NULL, dan "not NULL" akan meloloskan pemeriksaan
  if not coalesce(is_super()
      or (r.peran = 'rider' and my_peran() = 'captain' and r.ds_id = my_ds())
      or (r.peran = 'rider' and my_peran() = 'arcon' and r.ds_id = any(my_ds_ids())), false) then
    raise exception 'Tidak berwenang mengubah data rider ini';
  end if;
  if v_nama = '' then raise exception 'Nama rider wajib diisi'; end if;
  if r.peran = 'rider' and v_kode is null then raise exception 'Kode MTR rider wajib diisi'; end if;
  if v_hp is not null and v_hp !~ '^\+?[0-9]{8,15}$' then
    raise exception 'No HP tidak valid. Isi 8 sampai 15 angka, mis. 08123456789 (boleh diawali +)';
  end if;
  if v_kode is distinct from r.kode_mtr then
    select * into v_pakai from riders where kode_mtr = v_kode and id <> p_rider;
    if found then
      raise exception 'Kode MTR % sudah dipakai rider lain%', v_kode,
        case when is_super() then ' (' || v_pakai.nama || ')' else '. Periksa lagi kodenya atau hubungi Super-admin' end;
    end if;
    select count(*) into n from kehadiran_bo where kode_mtr = r.kode_mtr;
    if n > 0 then
      raise exception 'Kode MTR % tidak bisa diganti karena sudah punya % clock-in BO yang tersimpan dengan kode itu', r.kode_mtr, n;
    end if;
  end if;
  update riders set nama = v_nama, kode_mtr = v_kode, no_hp = v_hp where id = p_rider;
end $$;

revoke execute on function jejak_rider(uuid), hapus_rider(uuid), ubah_rider(uuid, text, text, text) from public, anon;
grant execute on function jejak_rider(uuid), hapus_rider(uuid), ubah_rider(uuid, text, text, text) to authenticated;
