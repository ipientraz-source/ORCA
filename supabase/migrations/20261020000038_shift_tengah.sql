-- Shift tengah (opsional): shift ketiga di antara pagi dan siang.
-- Opsional per DS: kebutuhannya (kuota_tengah) bawaan 0 = tidak dipakai, sehingga DS yang tidak memakainya tidak berubah sama sekali.
-- Boleh berbeda tiap hari lewat kuota_harian, sama seperti kebutuhan pagi dan siang. Laporan, Fulfillment, dan kebutuhan rekrut menyusul di tahap berikutnya.

-- Urutan enum: pagi, tengah, siang, off (urutan ini juga dipakai order by shift)
alter type shift_t add value if not exists 'tengah' before 'siang';

alter table ds add column kuota_tengah int not null default 0 check (kuota_tengah >= 0);
alter table kuota_harian add column kuota_tengah int not null default 0 check (kuota_tengah between 0 and 500);

-- Isi sama seperti 20261020000019_arcon_jadwal.sql; yang berubah hanya kuota tengah (opsional di JSON, kosong dianggap 0).
create or replace function simpan_kuota(p_ds uuid, p_dari date, p_sampai date, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int; v_ds ds%rowtype;
begin
  -- is not distinct from: pemanggil tanpa DS membuat my_ds() NULL, dan NULL pada not(...) akan meloloskan pemeriksaan
  if not (is_super() or p_ds is not distinct from my_ds() or (my_peran() = 'arcon' and p_ds = any(my_ds_ids()))) then
    raise exception 'Hanya Captain DS ini, Arcon yang memegangnya, atau Super-admin yang bisa mengatur kuota';
  end if;
  if p_sampai < p_dari or p_sampai - p_dari > 62 then raise exception 'Rentang tanggal tidak valid (maks 63 hari)'; end if;
  select * into v_ds from ds where id = p_ds;
  if not found then raise exception 'DS tidak ditemukan'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as x(tanggal date, pagi int, siang int, tengah int, cadangan int)
    where x.tanggal not between p_dari and p_sampai or x.pagi is null or x.siang is null or x.pagi < 0 or x.siang < 0
       or coalesce(x.tengah, 0) < 0 or coalesce(x.cadangan, 0) < 0
  ) then raise exception 'Isian kuota tidak valid (di luar rentang tanggal atau bernilai negatif)'; end if;

  delete from kuota_harian where ds_id = p_ds and tanggal between p_dari and p_sampai;
  insert into kuota_harian (ds_id, tanggal, kuota_pagi, kuota_siang, kuota_tengah, cadangan)
    select p_ds, x.tanggal, x.pagi, x.siang, coalesce(x.tengah, 0), coalesce(x.cadangan, 0)
    from jsonb_to_recordset(p_rows) as x(tanggal date, pagi int, siang int, tengah int, cadangan int)
    where x.pagi <> v_ds.kuota_pagi or x.siang <> v_ds.kuota_siang or coalesce(x.tengah, 0) <> v_ds.kuota_tengah or coalesce(x.cadangan, 0) > 0
    on conflict (ds_id, tanggal) do update set kuota_pagi = excluded.kuota_pagi, kuota_siang = excluded.kuota_siang,
      kuota_tengah = excluded.kuota_tengah, cadangan = excluded.cadangan;
  get diagnostics v_n = row_count;
  insert into log_aktivitas (captain_id, aksi, detail)
    values (me(), 'ubah kuota', v_ds.nama || ': ' || p_dari || ' s/d ' || p_sampai || ', ' || v_n || ' hari berbeda dari bawaan');
  return v_n;
end $$;
