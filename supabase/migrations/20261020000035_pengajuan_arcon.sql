-- Pengajuan Arcon: Arcon boleh MENGAJUKAN (1) DS baru dan (2) menjadi Arcon di sebuah DS; keputusannya di tangan Super-admin.
-- Tidak ada jalan pintas: Arcon tidak bisa membuat DS atau memasang dirinya sendiri. Tabel hanya bisa dibaca (pemohon: miliknya sendiri,
-- Super-admin: semua); menulis hanya lewat empat fungsi di bawah. Saat DS baru disetujui, pemohon otomatis jadi Arcon DS itu
-- (itulah sebabnya "DS baru" dan "jadi Arcon di DS itu" satu pengajuan, bukan dua).
-- Mengganti Captain di DS yang dipegang Arcon sudah ada sejak migrasi 0018/0020 dan tidak diubah di sini.
create table pengajuan_arcon (
  id uuid primary key default gen_random_uuid(),
  jenis text not null check (jenis in ('ds_baru', 'jadi_arcon')),
  pemohon_id uuid references riders(id) on delete set null,
  pemohon_nama text not null,           -- disalin saat mengajukan: tetap terbaca bila akunnya kelak dihapus
  ds_id uuid references ds(id) on delete set null, -- jadi_arcon: DS yang dituju; ds_baru: terisi setelah disetujui
  nama_ds text not null,
  kuota_pagi int check (kuota_pagi >= 0),
  kuota_siang int check (kuota_siang >= 0),
  alasan text not null,
  status text not null default 'menunggu' check (status in ('menunggu', 'disetujui', 'ditolak', 'dibatalkan')),
  dibuat timestamptz not null default now(),
  diputuskan_oleh uuid references riders(id) on delete set null,
  diputuskan_nama text,
  diputuskan_pada timestamptz,
  catatan text,
  check (jenis <> 'ds_baru' or (kuota_pagi is not null and kuota_siang is not null))
);
create index on pengajuan_arcon (status, dibuat desc);
-- satu pengajuan menunggu per (pemohon, DS), dan satu per nama DS baru (nama yang dirapikan: huruf besar, tanpa spasi/tanda baca)
create unique index pengajuan_menunggu_arcon on pengajuan_arcon (pemohon_id, ds_id) where status = 'menunggu' and jenis = 'jadi_arcon';
create unique index pengajuan_menunggu_ds on pengajuan_arcon ((regexp_replace(upper(nama_ds), '[^A-Z0-9]', '', 'g'))) where status = 'menunggu' and jenis = 'ds_baru';

alter table pengajuan_arcon enable row level security;
create policy pengajuan_read on pengajuan_arcon for select to authenticated using (is_super() or pemohon_id = me());

create function ajukan_ds_baru(p_nama text, p_pagi int, p_siang int, p_alasan text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_nama text := regexp_replace(trim(coalesce(p_nama, '')), '\s+', ' ', 'g'); v_n text; v_pemohon text; v_id uuid;
begin
  if my_peran() is distinct from 'arcon' then raise exception 'Hanya Arcon yang bisa mengajukan'; end if;
  if v_nama = '' then raise exception 'Nama DS wajib diisi'; end if;
  if coalesce(p_pagi, -1) < 0 or coalesce(p_siang, -1) < 0 then raise exception 'Kebutuhan rider pagi dan siang wajib diisi (0 atau lebih)'; end if;
  if length(trim(coalesce(p_alasan, ''))) = 0 then raise exception 'Alasan pengajuan wajib diisi'; end if;
  v_n := regexp_replace(upper(v_nama), '[^A-Z0-9]', '', 'g');
  if v_n = '' then raise exception 'Nama DS tidak valid'; end if;
  if exists (select 1 from ds where regexp_replace(upper(nama), '[^A-Z0-9]', '', 'g') = v_n) then raise exception 'DS dengan nama itu sudah ada'; end if;
  if exists (select 1 from pengajuan_arcon where status = 'menunggu' and jenis = 'ds_baru' and regexp_replace(upper(nama_ds), '[^A-Z0-9]', '', 'g') = v_n) then
    raise exception 'Sudah ada pengajuan DS dengan nama itu yang menunggu persetujuan';
  end if;
  select nama into v_pemohon from riders where id = me();
  insert into pengajuan_arcon (jenis, pemohon_id, pemohon_nama, nama_ds, kuota_pagi, kuota_siang, alasan)
    values ('ds_baru', me(), v_pemohon, v_nama, p_pagi, p_siang, trim(p_alasan)) returning id into v_id;
  insert into log_aktivitas (captain_id, aksi, detail) values (me(), 'ajukan ds baru', v_nama || ' (pagi ' || p_pagi || ', siang ' || p_siang || ')');
  return v_id;
end $$;

create function ajukan_jadi_arcon(p_ds uuid, p_alasan text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_nama text; v_arcon uuid; v_pemohon text; v_id uuid;
begin
  if my_peran() is distinct from 'arcon' then raise exception 'Hanya Arcon yang bisa mengajukan'; end if;
  select nama, arcon_id into v_nama, v_arcon from ds where id = p_ds;
  if not found then raise exception 'DS tidak ditemukan'; end if;
  if v_arcon is not distinct from me() then raise exception 'Anda sudah memegang DS ini'; end if;
  if length(trim(coalesce(p_alasan, ''))) = 0 then raise exception 'Alasan pengajuan wajib diisi'; end if;
  if exists (select 1 from pengajuan_arcon where status = 'menunggu' and jenis = 'jadi_arcon' and pemohon_id = me() and ds_id = p_ds) then
    raise exception 'Pengajuan Anda untuk DS ini masih menunggu persetujuan';
  end if;
  select nama into v_pemohon from riders where id = me();
  insert into pengajuan_arcon (jenis, pemohon_id, pemohon_nama, ds_id, nama_ds, alasan)
    values ('jadi_arcon', me(), v_pemohon, p_ds, v_nama, trim(p_alasan)) returning id into v_id;
  insert into log_aktivitas (captain_id, aksi, detail) values (me(), 'ajukan jadi arcon', v_nama);
  return v_id;
end $$;

create function batalkan_pengajuan(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update pengajuan_arcon set status = 'dibatalkan', diputuskan_pada = now()
    where id = p_id and pemohon_id = me() and status = 'menunggu';
  if not found then raise exception 'Pengajuan tidak ditemukan atau sudah diputuskan'; end if;
end $$;

create function putuskan_pengajuan(p_id uuid, p_setuju boolean, p_catatan text) returns void
language plpgsql security definer set search_path = public as $$
declare r pengajuan_arcon%rowtype; v_ds uuid; v_nama text; v_lama uuid;
begin
  if not is_super() then raise exception 'Hanya Super-admin'; end if;
  select * into r from pengajuan_arcon where id = p_id for update;
  if not found then raise exception 'Pengajuan tidak ditemukan'; end if;
  if r.status <> 'menunggu' then raise exception 'Pengajuan ini sudah diputuskan'; end if;
  if not p_setuju and length(trim(coalesce(p_catatan, ''))) = 0 then raise exception 'Alasan penolakan wajib diisi'; end if;
  if p_setuju then
    if not exists (select 1 from riders where id = r.pemohon_id and peran = 'arcon' and status = 'aktif') then
      raise exception 'Pemohon sudah bukan Arcon aktif';
    end if;
    if r.jenis = 'ds_baru' then
      if exists (select 1 from ds where regexp_replace(upper(nama), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(r.nama_ds), '[^A-Z0-9]', '', 'g')) then
        raise exception 'Nama DS sudah dipakai DS lain. Tolak pengajuan ini dan minta pemohon mengajukan ulang dengan nama lain';
      end if;
      insert into ds (nama, kuota_pagi, kuota_siang, arcon_id) values (r.nama_ds, r.kuota_pagi, r.kuota_siang, r.pemohon_id) returning id into v_ds;
    else
      select arcon_id into v_lama from ds where id = r.ds_id;
      if not found then raise exception 'DS sudah tidak ada'; end if;
      update ds set arcon_id = r.pemohon_id where id = r.ds_id;
      v_ds := r.ds_id;
    end if;
  end if;
  select nama into v_nama from riders where id = me();
  update pengajuan_arcon set status = case when p_setuju then 'disetujui' else 'ditolak' end,
      ds_id = coalesce(v_ds, ds_id), diputuskan_oleh = me(), diputuskan_nama = v_nama, diputuskan_pada = now(), catatan = nullif(trim(coalesce(p_catatan, '')), '')
    where id = p_id;
  insert into log_aktivitas (captain_id, aksi, detail)
    values (me(), case when p_setuju then 'setujui pengajuan' else 'tolak pengajuan' end,
            r.pemohon_nama || ': ' || case r.jenis when 'ds_baru' then 'DS baru ' else 'jadi Arcon di ' end || r.nama_ds
            || case when p_setuju and v_lama is not null and v_lama is distinct from r.pemohon_id then ' (menggantikan Arcon sebelumnya)' else '' end
            || coalesce(': ' || nullif(trim(coalesce(p_catatan, '')), ''), ''));
end $$;

revoke execute on function ajukan_ds_baru(text, int, int, text), ajukan_jadi_arcon(uuid, text), batalkan_pengajuan(uuid), putuskan_pengajuan(uuid, boolean, text) from public, anon;
grant execute on function ajukan_ds_baru(text, int, int, text), ajukan_jadi_arcon(uuid, text), batalkan_pengajuan(uuid), putuskan_pengajuan(uuid, boolean, text) to authenticated;
