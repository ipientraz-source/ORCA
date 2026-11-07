-- Arcon boleh memindahkan rider antar DS yang sama-sama dipegangnya (Super-admin: DS mana pun).
-- Lewat fungsi ini, bukan ubah isian langsung: riders_guard tetap melarang Arcon dan Captain mengubah ds_id.
-- Seperti saat rider dijadikan Arcon: jadwal dari hari ini ke depan di DS lama dihapus (jadwal dan absensi yang sudah lewat tetap),
-- dan motor yang dipegang dikembalikan ke gudang, karena pemegang motor harus rider di DS yang sama.
-- Perpindahan tercatat di perpindahan_rider dan Captain lama diberi notifikasi oleh trigger riders_ds_log; di sini ditambah catatan Riwayat.
create function pindah_rider(p_rider uuid, p_ds uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_lama uuid; v_nama text; v_peran text; v_ds_lama text; v_ds_baru text; v_jadwal int; v_motor int;
begin
  select ds_id, nama, peran into v_lama, v_nama, v_peran from riders where id = p_rider;
  if not found then raise exception 'Rider tidak ditemukan'; end if;
  if v_peran <> 'rider' then raise exception 'Hanya rider yang bisa dipindahkan dari sini'; end if;
  -- coalesce: DS kosong (NULL) membuat perbandingan NULL, dan "not NULL" akan meloloskan pemeriksaan
  if not coalesce(is_super() or (my_peran() = 'arcon' and v_lama = any(my_ds_ids()) and p_ds = any(my_ds_ids())), false) then
    raise exception 'Arcon hanya bisa memindahkan rider antar DS yang dipegangnya';
  end if;
  if p_ds is not distinct from v_lama then raise exception 'Rider sudah ada di DS itu'; end if;
  select nama into v_ds_baru from ds where id = p_ds;
  if not found then raise exception 'DS tujuan tidak ditemukan'; end if;
  select nama into v_ds_lama from ds where id = v_lama;

  delete from jadwal where rider_id = p_rider and tanggal >= today_wib();
  get diagnostics v_jadwal = row_count;
  update motor set dipegang_oleh = null where dipegang_oleh = p_rider;
  get diagnostics v_motor = row_count;
  update riders set ds_id = p_ds where id = p_rider;
  insert into log_aktivitas (captain_id, aksi, detail)
    values (me(), 'pindah rider', v_nama || ': ' || coalesce(v_ds_lama, 'tanpa DS') || ' -> ' || v_ds_baru
                                  || ', ' || v_jadwal || ' jadwal ke depan dihapus, ' || v_motor || ' motor dilepas');
end $$;

revoke execute on function pindah_rider(uuid, uuid) from public, anon;
grant execute on function pindah_rider(uuid, uuid) to authenticated;
