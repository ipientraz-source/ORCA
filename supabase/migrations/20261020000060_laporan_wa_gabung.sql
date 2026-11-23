-- Pesan WhatsApp gabungan: DS yang memakai ID grup yang sama dijadikan satu pesan ringkas (satu baris per DS) berisi tautan ke Orca untuk detailnya.
-- DS dengan grup sendiri tetap dapat pesan rinci seperti sebelumnya, ditambah tautan. laporan_wa mendapat tiga kolom angka (terpenuhi, kebutuhan,
-- belum diabsen) yang dipakai untuk baris ringkas, jadi fungsinya dibuat ulang (kolom keluaran tidak bisa diubah lewat create or replace).

drop function if exists laporan_wa(text, date);

create or replace function laporan_wa(p_sesi text, p_tanggal date default today_wib())
returns table (ds_id uuid, ds_nama text, group_wa_id text, pesan text, n_terpenuhi int, n_kebutuhan int, n_belum int)
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
    n_terpenuhi := v_terpenuhi; n_kebutuhan := v_keb; n_belum := coalesce(cardinality(v_belum), 0);
    return next;
  end loop;
end $$;
revoke execute on function laporan_wa(text, date) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function laporan_wa(text, date) to service_role;
  end if;
end $$;

create or replace function laporan_wa_gabung(p_sesi text, p_tanggal date default today_wib(), p_url text default 'https://asched.vercel.app', p_ds uuid default null)
returns table (group_wa_id text, ds_ids uuid[], ds_namas text[], pesan text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_jenis text := split_part(p_sesi, '_', 1);
  v_label text := initcap(split_part(p_sesi, '_', 2));
  v_hari text;
  v_tautan text;
  g record;
begin
  v_hari := (array['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'])[extract(dow from p_tanggal)::int + 1] || ', '
         || extract(day from p_tanggal)::int || ' '
         || (array['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'])[extract(month from p_tanggal)::int] || ' '
         || extract(year from p_tanggal)::int;
  -- laporan: rekap kehadiran hari itu; pengingat: halaman absensi untuk mengisi
  v_tautan := case when v_jenis = 'laporan' then 'Detail per rider: ' || p_url || '/?tab=rekap&tgl=' || p_tanggal
                   else 'Isi absensi: ' || p_url || '/?tab=absensi' end;
  for g in
    with k as (select coalesce(l.group_wa_id, l.ds_id::text) as kunci, l.* from laporan_wa(p_sesi, p_tanggal) l where p_ds is null or l.ds_id = p_ds)
    select k.kunci,
           max(k.group_wa_id) as gid,
           array_agg(k.ds_id order by k.ds_nama) as ids,
           array_agg(k.ds_nama order by k.ds_nama) as namas,
           count(*) as n,
           min(k.pesan) as satu,
           string_agg(case when v_jenis = 'laporan'
                           then '*' || k.ds_nama || '* · ' || k.n_terpenuhi || ' dari ' || k.n_kebutuhan
                                || case when k.n_kebutuhan > 0 then ' (' || round(100.0 * k.n_terpenuhi / k.n_kebutuhan) || '%)' else '' end
                                || case when k.n_belum > 0 then ' · ' || k.n_belum || ' belum diabsen' else '' end
                           else '*' || k.ds_nama || '* · ' || k.n_belum || ' rider' end,
                      E'\n\n' order by k.ds_nama) as baris
    from k group by k.kunci order by min(k.ds_nama)
  loop
    group_wa_id := g.gid; ds_ids := g.ids; ds_namas := g.namas;
    if g.gid is null then
      pesan := g.satu;                                  -- tanpa grup: tidak dikirim, hanya dicatat dilewati
    elsif g.n = 1 then
      pesan := g.satu || E'\n\n' || v_tautan;            -- satu DS di grupnya sendiri: pesan rinci
    elsif v_jenis = 'laporan' then
      pesan := '*Laporan Absensi Shift ' || v_label || E'*\n' || v_hari || ' · ' || g.n || E' DS\n\n' || g.baris || E'\n\n' || v_tautan;
    else
      pesan := '*Pengingat Absensi Shift ' || v_label || E'*\n' || v_hari || E'\n\nBelum diabsen:\n' || g.baris || E'\n\n' || v_tautan;
    end if;
    return next;
  end loop;
end $$;
revoke execute on function laporan_wa_gabung(text, date, text, uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function laporan_wa_gabung(text, date, text, uuid) to service_role;
  end if;
end $$;
