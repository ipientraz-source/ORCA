-- 1) Rider yang sudah punya email login bisa dinaikkan jadi Arcon (sebelumnya hanya Captain).
--    Orangnya, email login, dan riwayat tetap. Rider tidak lagi bekerja sebagai rider, jadi jadwal dari hari ini ke depan dihapus
--    dan motor yang dipegangnya dikembalikan (jadwal dan absensi yang sudah lewat tetap). DS dipilihkan lewat Kelola DS.
-- 2) Arcon yang sudah nonaktif dan tidak memegang DS bisa dihapus, dengan alasan wajib dan tercatat di Riwayat.
-- 3) Riwayat menyimpan nama pelaku saat kejadian, supaya aktivitas orang yang kemudian dihapus tetap tampak atas nama dia.

-- ───────── 3) nama pelaku tersimpan di catatan ─────────
alter table log_aktivitas add column pelaku_nama text;
update log_aktivitas l set pelaku_nama = r.nama from riders r where r.id = l.captain_id;
create function log_pelaku_nama() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.captain_id is not null and new.pelaku_nama is null then
    select nama into new.pelaku_nama from riders where id = new.captain_id;
  end if;
  return new;
end $$;
create trigger log_pelaku_nama_t before insert on log_aktivitas for each row execute function log_pelaku_nama();
revoke execute on function log_pelaku_nama() from public, anon, authenticated;

-- ───────── 1) Captain atau rider berakun email → Arcon ─────────
create or replace function jadikan_arcon(p_rider uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_peran text; v_email text; v_nama text; v_kosong int := 0; v_jadwal int := 0; v_motor int := 0;
begin
  if not is_super() then raise exception 'Hanya Super-admin'; end if;
  select peran, email, nama into v_peran, v_email, v_nama from riders where id = p_rider;
  if not found then raise exception 'Orang tidak ditemukan'; end if;
  if v_peran not in ('captain', 'rider') then raise exception 'Hanya Captain atau rider yang bisa dijadikan Arcon dari sini'; end if;
  if coalesce(v_email, '') = '' then raise exception 'Orang ini belum punya email login'; end if;
  if v_peran = 'captain' then
    update ds set captain_id = null where captain_id = p_rider;
    get diagnostics v_kosong = row_count;
  else
    delete from jadwal where rider_id = p_rider and tanggal >= today_wib();
    get diagnostics v_jadwal = row_count;
    update motor set dipegang_oleh = null where dipegang_oleh = p_rider;
    get diagnostics v_motor = row_count;
  end if;
  update riders set peran = 'arcon', ds_id = null, status = 'aktif' where id = p_rider;
  insert into log_aktivitas (captain_id, aksi, detail)
    values (me(), v_peran || ' jadi arcon', v_nama || case when v_peran = 'captain' then ', ' || v_kosong || ' DS kehilangan Captain'
                                                           else ', ' || v_jadwal || ' jadwal ke depan dihapus, ' || v_motor || ' motor dilepas' end);
  return v_kosong;
end $$;

-- ───────── 2) hapus Arcon yang sudah tidak aktif ─────────
create function hapus_arcon(p_rider uuid, p_alasan text) returns void
language plpgsql security definer set search_path = public as $$
declare r riders%rowtype;
begin
  if not is_super() then raise exception 'Hanya Super-admin'; end if;
  if length(trim(coalesce(p_alasan, ''))) = 0 then raise exception 'Alasan menghapus wajib diisi'; end if;
  select * into r from riders where id = p_rider for update;
  if not found then raise exception 'Orang tidak ditemukan'; end if;
  if r.peran <> 'arcon' then raise exception 'Hanya Arcon yang bisa dihapus dari sini'; end if;
  if r.status <> 'nonaktif' then raise exception 'Nonaktifkan Arcon ini dulu sebelum dihapus'; end if;
  if exists (select 1 from ds where arcon_id = p_rider) then
    raise exception 'Arcon ini masih memegang DS. Lepas dulu dari DS-nya di Kelola DS';
  end if;
  insert into log_aktivitas (captain_id, aksi, detail)
    values (me(), 'hapus arcon', r.nama || ' (' || coalesce(r.email, 'tanpa email') || '): ' || trim(p_alasan));
  delete from riders where id = p_rider;
end $$;

revoke execute on function hapus_arcon(uuid, text) from public, anon;
grant execute on function hapus_arcon(uuid, text) to authenticated;
