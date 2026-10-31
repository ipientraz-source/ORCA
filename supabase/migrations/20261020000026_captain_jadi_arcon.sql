-- Captain yang naik jabatan jadi Arcon (Super-admin). Orangnya, email login, dan seluruh riwayat jadwal/absensinya tetap;
-- peran berubah jadi Arcon, DS-nya dilepas, dan kursi Captain di DS yang dulu dia pimpin dikosongkan (tunjuk Captain baru di Kelola DS).
-- Arcon tidak punya DS sendiri: DS yang dipegang diatur lewat pilih_arcon.
create function jadikan_arcon(p_rider uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_peran text; v_email text; v_kosong int;
begin
  if not is_super() then raise exception 'Hanya Super-admin'; end if;
  select peran, email into v_peran, v_email from riders where id = p_rider;
  if not found then raise exception 'Orang tidak ditemukan'; end if;
  if v_peran <> 'captain' then raise exception 'Hanya Captain yang bisa dijadikan Arcon dari sini'; end if;
  if coalesce(v_email, '') = '' then raise exception 'Captain ini belum punya email login'; end if;
  update ds set captain_id = null where captain_id = p_rider;
  get diagnostics v_kosong = row_count;
  update riders set peran = 'arcon', ds_id = null, status = 'aktif' where id = p_rider;
  insert into log_aktivitas (captain_id, aksi, detail)
    values (me(), 'captain jadi arcon', (select nama from riders where id = p_rider) || ', ' || v_kosong || ' DS kehilangan Captain');
  return v_kosong;
end $$;

revoke execute on function jadikan_arcon(uuid) from public, anon;
grant execute on function jadikan_arcon(uuid) to authenticated;
