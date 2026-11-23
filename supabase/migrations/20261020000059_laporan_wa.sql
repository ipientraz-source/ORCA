-- Laporan WhatsApp otomatis lewat Fonnte. Pesan disusun di database (laporan_wa) supaya bisa dites tanpa Fonnte; Edge Function kirim-laporan
-- hanya mengambil teksnya lalu mengirim ke group_wa_id tiap DS. Empat sesi per hari (jam WIB, diatur di pg_cron, bukan di sini):
--   ingat_pagi / ingat_siang   : pengingat bila masih ada rider terjadwal di shift itu yang belum diabsen (tidak ada baris kalau semua sudah)
--   laporan_pagi / laporan_siang: rekap shift itu (terpenuhi vs kebutuhan, hadir, pengganti, tidak hadir, belum diabsen); laporan_siang juga merangkum hari itu
-- Dihitung dengan aturan yang sama dengan halaman Absensi: shift yang dikerjakan lewat shift_dikerjakan(), tukar dua arah yang belum
-- dikonfirmasi dihitung belum diabsen, rider hasil tukar yang tidak hadir masuk ke shift yang ditinggalkannya.

create table if not exists log_wa (
  id bigserial primary key,
  waktu timestamptz not null default now(),
  tanggal date not null,
  ds_id uuid references ds(id) on delete cascade,
  sesi text not null,
  status text not null check (status in ('terkirim', 'gagal')),
  respons text
);
-- satu pesan terkirim per DS per sesi per hari: cron yang terpanggil dua kali tidak mengirim dobel
create unique index if not exists log_wa_terkirim on log_wa (tanggal, ds_id, sesi) where status = 'terkirim';
alter table log_wa enable row level security;
drop policy if exists log_wa_read on log_wa;
create policy log_wa_read on log_wa for select to authenticated using ((select is_super()));

create or replace function laporan_wa(p_sesi text, p_tanggal date default today_wib())
returns table (ds_id uuid, ds_nama text, group_wa_id text, pesan text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_jenis text := split_part(p_sesi, '_', 1);
  v_shift text := split_part(p_sesi, '_', 2);
  v_label text;
  v_hari text;
  d record;
  v_hadir int; v_terpenuhi int; v_pengganti int; v_tpagi int; v_tsiang int; v_kpagi int; v_ksiang int; v_keb int;
  v_belum text[]; v_tidak text[];
  v_teks text;
begin
  if v_jenis not in ('laporan', 'ingat') or v_shift not in ('pagi', 'siang') then
    raise exception 'Sesi tidak dikenal: %', p_sesi;
  end if;
  v_label := initcap(v_shift);
  v_hari := (array['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'])[extract(dow from p_tanggal)::int + 1] || ', '
         || extract(day from p_tanggal)::int || ' '
         || (array['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'])[extract(month from p_tanggal)::int] || ' '
         || extract(year from p_tanggal)::int;

  for d in
    select s.id, s.nama, s.group_wa_id,
           coalesce(k.kuota_pagi, s.kuota_pagi) as kpagi, coalesce(k.kuota_siang, s.kuota_siang) as ksiang
    from ds s left join kuota_harian k on k.ds_id = s.id and k.tanggal = p_tanggal
    order by s.nama
  loop
    -- rider terjadwal hari itu: shift yang dikerjakan (tukar: shift rekannya, juga bila ia sendiri tidak hadir) dan isian miliknya
    with rid as (
      select j.rider_id, r.nama, a.status, a.tukar_dikonfirmasi,
             coalesce((select j2.shift from jadwal j2
                        where j2.tanggal = j.tanggal and j2.shift <> 'off'
                          and j2.rider_id = coalesce(case when a.status = 'tukar' then a.backup_untuk_id end,
                                                     (select t.rider_id from actual_harian t
                                                       where t.tanggal = j.tanggal and t.status = 'tukar' and t.backup_untuk_id = j.rider_id limit 1))),
                      j.shift)::text as eff
      from jadwal j
      join riders r on r.id = j.rider_id
      left join actual_harian a on a.tanggal = j.tanggal and a.rider_id = j.rider_id and a.status <> 'pengganti'
      where j.tanggal = p_tanggal and j.ds_id = d.id and j.shift <> 'off'
    )
    select
      count(*) filter (where eff = v_shift and (status = 'hadir' or (status = 'tukar' and tukar_dikonfirmasi))),
      array_agg(nama order by nama) filter (where eff = v_shift and (status is null or (status = 'tukar' and not tukar_dikonfirmasi))),
      array_agg(nama || ' (' || replace(status::text, '_', ' ') || '), '
                || coalesce('diganti ' || (select rp.nama from actual_harian p join riders rp on rp.id = p.rider_id
                                            where p.tanggal = p_tanggal and p.status = 'pengganti' and p.backup_untuk_id = rid.rider_id limit 1),
                            'tanpa pengganti') order by nama)
        filter (where eff = v_shift and status in ('alpha', 'izin', 'sakit', 'tukar_libur'))
    into v_hadir, v_belum, v_tidak
    from rid;

    select count(*) filter (where s.shift::text = v_shift),
           count(*) filter (where s.shift::text = v_shift and s.sumber = 'pengganti'),
           count(*) filter (where s.shift::text = 'pagi'),
           count(*) filter (where s.shift::text = 'siang')
    into v_terpenuhi, v_pengganti, v_tpagi, v_tsiang
    from shift_dikerjakan(p_tanggal, p_tanggal) s where s.ds_id = d.id;
    v_kpagi := coalesce(d.kpagi, 0); v_ksiang := coalesce(d.ksiang, 0);
    v_keb := case v_shift when 'pagi' then v_kpagi else v_ksiang end;

    if v_jenis = 'ingat' then
      continue when coalesce(cardinality(v_belum), 0) = 0;
      v_teks := '*Pengingat Absensi Shift ' || v_label || E'*\n' || d.nama || ' · ' || v_hari || E'\n\n'
             || 'Masih ada ' || cardinality(v_belum) || E' rider yang belum diabsen:\n'
             || (select string_agg('- ' || x, E'\n') from unnest(v_belum) x)
             || E'\n\nMohon segera diisi di aplikasi sebelum laporan dikirim.';
    else
      -- DS yang tidak punya kebutuhan maupun rider di shift ini tidak perlu dilaporkan
      continue when v_keb = 0 and v_terpenuhi = 0 and v_hadir = 0 and coalesce(cardinality(v_belum), 0) = 0 and coalesce(cardinality(v_tidak), 0) = 0;
      v_teks := '*Laporan Absensi Shift ' || v_label || E'*\n' || d.nama || ' · ' || v_hari || E'\n\n'
             || 'Terpenuhi: ' || v_terpenuhi || ' dari ' || v_keb || ' rider'
             || case when v_keb > 0 then ' (' || round(100.0 * v_terpenuhi / v_keb) || '%)' else '' end
             || E'\nHadir: ' || v_hadir || ' · Pengganti: ' || v_pengganti
             || E'\nTidak hadir: ' || coalesce(cardinality(v_tidak), 0)
             || coalesce(E'\n' || (select string_agg('- ' || x, E'\n') from unnest(v_tidak) x), '')
             || E'\nBelum diabsen: ' || coalesce(cardinality(v_belum), 0)
             || coalesce(E'\n' || (select string_agg('- ' || x, E'\n') from unnest(v_belum) x), '');
      if v_shift = 'siang' then
        v_teks := v_teks || E'\n\n*Rekap hari ini*\nPagi: ' || v_tpagi || '/' || v_kpagi || ' · Siang: ' || v_tsiang || '/' || v_ksiang;
      end if;
    end if;

    ds_id := d.id; ds_nama := d.nama; group_wa_id := nullif(trim(d.group_wa_id), ''); pesan := v_teks;
    return next;
  end loop;
end $$;
revoke execute on function laporan_wa(text, date) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function laporan_wa(text, date) to service_role;
  end if;
end $$;
