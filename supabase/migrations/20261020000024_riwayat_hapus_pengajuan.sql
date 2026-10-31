-- Menghapus pengajuan servis wajib beralasan dan tercatat di riwayat (hanya Super-admin), sama seperti motor.
-- Hapus langsung lewat tabel ditutup; satu-satunya jalan adalah hapus_permintaan(pengajuan, alasan).
create table permintaan_dihapus (
  id uuid primary key default gen_random_uuid(),
  permintaan_id uuid not null,
  judul text not null,
  jenis text,
  status text,
  jumlah_motor int not null default 0,
  alasan text not null check (length(trim(alasan)) > 0),
  data jsonb not null, -- salinan baris pengajuan dan daftar itemnya saat dihapus
  dihapus_oleh uuid references riders(id) on delete set null,
  waktu timestamptz not null default now()
);
alter table permintaan_dihapus enable row level security;
create policy permintaan_dihapus_read on permintaan_dihapus for select to authenticated using (is_super());

drop policy permintaan_hapus on permintaan_servis;

create function hapus_permintaan(p_id uuid, p_alasan text) returns void
language plpgsql security definer set search_path = public as $$
declare r permintaan_servis%rowtype;
begin
  if not is_super() then raise exception 'Hanya Super-admin yang bisa menghapus pengajuan'; end if;
  if length(trim(coalesce(p_alasan, ''))) = 0 then raise exception 'Alasan penghapusan wajib diisi'; end if;
  select * into r from permintaan_servis where id = p_id;
  if not found then raise exception 'Pengajuan tidak ditemukan'; end if;
  insert into permintaan_dihapus (permintaan_id, judul, jenis, status, jumlah_motor, alasan, data, dihapus_oleh)
    values (r.id, r.judul, r.jenis, r.status, (select count(*) from permintaan_servis_item where permintaan_id = r.id), trim(p_alasan),
            to_jsonb(r) || jsonb_build_object('item', coalesce((select jsonb_agg(to_jsonb(i)) from permintaan_servis_item i where i.permintaan_id = r.id), '[]'::jsonb)), me());
  insert into log_aktivitas (captain_id, aksi, detail) values (me(), 'hapus pengajuan servis', r.judul || ': ' || trim(p_alasan));
  delete from permintaan_servis where id = r.id;
end $$;
