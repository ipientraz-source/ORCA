-- Menghapus motor wajib beralasan dan tercatat di riwayat (hanya Super-admin).
-- Hapus langsung lewat tabel ditutup; satu-satunya jalan adalah hapus_motor(motor, alasan).
create table motor_dihapus (
  id uuid primary key default gen_random_uuid(),
  motor_id uuid not null,
  kode_motor text not null,
  plat_nomor text,
  ds_id uuid references ds(id) on delete set null,
  alasan text not null check (length(trim(alasan)) > 0),
  jumlah_servis int not null default 0,
  jumlah_kerusakan int not null default 0,
  data jsonb not null, -- salinan lengkap baris motor saat dihapus
  dihapus_oleh uuid references riders(id) on delete set null,
  waktu timestamptz not null default now()
);
alter table motor_dihapus enable row level security;
create policy motor_dihapus_read on motor_dihapus for select to authenticated using (is_super());

drop policy motor_delete on motor;

create function hapus_motor(p_motor uuid, p_alasan text) returns void
language plpgsql security definer set search_path = public as $$
declare m motor%rowtype;
begin
  if not is_super() then raise exception 'Hanya Super-admin yang bisa menghapus motor'; end if;
  if length(trim(coalesce(p_alasan, ''))) = 0 then raise exception 'Alasan penghapusan wajib diisi'; end if;
  select * into m from motor where id = p_motor;
  if not found then raise exception 'Motor tidak ditemukan'; end if;
  insert into motor_dihapus (motor_id, kode_motor, plat_nomor, ds_id, alasan, jumlah_servis, jumlah_kerusakan, data, dihapus_oleh)
    values (m.id, m.kode_motor, m.plat_nomor, m.ds_id, trim(p_alasan),
            (select count(*) from servis_motor where motor_id = m.id), (select count(*) from kerusakan_motor where motor_id = m.id), to_jsonb(m), me());
  insert into log_aktivitas (captain_id, aksi, detail) values (me(), 'hapus motor', m.kode_motor || ': ' || trim(p_alasan));
  delete from motor where id = m.id;
end $$;
