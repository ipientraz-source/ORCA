-- Arcon boleh menambah rider baru, hanya ke DS yang dipegangnya.
-- Yang boleh dibuat Arcon hanya rider biasa: peran rider, tanpa email login. Captain, Arcon, dan Super-admin tetap dibuat Super-admin
-- (atau lewat Tunjuk Captain). Kode MTR tetap unik dan dirapikan oleh trigger riders_guard seperti biasa.

create policy riders_insert_arcon on riders for insert to authenticated
  with check (my_peran() = 'arcon' and ds_id = any(my_ds_ids()) and peran = 'rider' and email is null);
