-- ============================================================================
--  KEUANGAN KELUARGA — Migrasi: kategori PRIVAT per user (asimetris)
-- ----------------------------------------------------------------------------
--  Sebelumnya kategori dibagi se-keluarga. Setelah migrasi:
--    - Setiap kategori dimiliki seorang user (kolom user_id).
--    - Anggota hanya MELIHAT & MEMAKAI kategori miliknya.
--    - Admin bisa MELIHAT semua kategori keluarga (untuk laporan Keluarga),
--      tetapi membuat/mengubah/menghapus tetap HANYA miliknya.
--  Data lama dipisah: tiap transaksi dipindah ke salinan kategori milik
--  pemilik transaksinya; lalu tiap user diberi set kategori default sendiri.
--
--  Prasyarat: schema.sql sudah dijalankan.
--  Cara pakai: Supabase Dashboard -> SQL Editor -> tempel -> Run. (Sekali jalan.)
-- ============================================================================

-- 1) Kolom pemilik.
alter table public.categories
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

-- 2) Pindahkan tiap transaksi ke salinan kategori milik pemilik transaksinya
--    (cari yang sudah ada bernama sama, atau buat baru).
do $$
declare r record; v_id uuid;
begin
  for r in
    select distinct t.user_id as uid, c.family_id, c.id as cat_id, c.name, c.type
    from public.transactions t
    join public.categories c on c.id = t.category_id
    where c.user_id is null and t.user_id is not null
  loop
    select id into v_id from public.categories
      where family_id = r.family_id and user_id = r.uid and name = r.name and type = r.type
      limit 1;
    if v_id is null then
      insert into public.categories (family_id, user_id, name, type, is_default)
        values (r.family_id, r.uid, r.name, r.type, false)
        returning id into v_id;
    end if;
    update public.transactions set category_id = v_id
      where category_id = r.cat_id and user_id = r.uid;
  end loop;
end $$;

-- 3) Sisa kategori bersama (belum bertuan) -> berikan ke admin keluarga;
--    bila admin sudah punya nama+jenis yang sama, hapus (hindari ganda).
do $$
declare r record; v_admin uuid;
begin
  for r in select id, family_id, name, type from public.categories where user_id is null loop
    select p.id into v_admin from public.profiles p
      where p.family_id = r.family_id and p.role = 'admin'
      order by p.created_at limit 1;
    if v_admin is null then
      delete from public.categories where id = r.id;
    elsif exists (select 1 from public.categories
                  where family_id = r.family_id and user_id = v_admin and name = r.name and type = r.type) then
      delete from public.categories where id = r.id;
    else
      update public.categories set user_id = v_admin where id = r.id;
    end if;
  end loop;
end $$;

-- 4) Seed kategori default untuk tiap anggota (lewati yang sudah ada).
do $$
declare m record; d record;
begin
  for m in select id, family_id from public.profiles loop
    for d in select * from (values
      ('Gaji Pekerja','expense'),('Rekreasi','expense'),('Makan di Luar','expense'),
      ('BBM','expense'),('Listrik','expense'),('Air','expense'),('Belanja Dapur','expense'),
      ('Tabungan','expense'),('Lainnya','expense'),
      ('Gaji','income'),('Usaha','income'),('Lainnya','income')
    ) as t(name, type) loop
      if not exists (select 1 from public.categories
                     where family_id = m.family_id and user_id = m.id and name = d.name and type = d.type) then
        insert into public.categories (family_id, user_id, name, type, is_default)
          values (m.family_id, m.id, d.name, d.type, true);
      end if;
    end loop;
  end loop;
end $$;

-- 5) Semua kategori kini wajib punya pemilik.
delete from public.categories where user_id is null;
alter table public.categories alter column user_id set not null;
create index if not exists idx_categories_user on public.categories (user_id);

-- 6) RLS baru (asimetris): anggota -> miliknya; admin -> semua kategori keluarga.
drop policy if exists categories_select on public.categories;
drop policy if exists categories_insert on public.categories;
drop policy if exists categories_update on public.categories;
drop policy if exists categories_delete on public.categories;

create policy categories_select on public.categories
  for select to authenticated
  using (
    user_id = auth.uid()
    or (public.is_family_admin() and family_id = public.my_family_id())
  );

create policy categories_insert on public.categories
  for insert to authenticated
  with check (user_id = auth.uid() and family_id = public.my_family_id());

create policy categories_update on public.categories
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and family_id = public.my_family_id());

create policy categories_delete on public.categories
  for delete to authenticated
  using (user_id = auth.uid());

-- 7) Seed default PER-USER (dipakai create_family & join_family ke depan).
create or replace function public.seed_default_categories(p_family_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.categories (family_id, user_id, name, type, is_default)
  select p_family_id, auth.uid(), v.name, v.type, true
  from (values
    ('Gaji Pekerja','expense'),('Rekreasi','expense'),('Makan di Luar','expense'),
    ('BBM','expense'),('Listrik','expense'),('Air','expense'),('Belanja Dapur','expense'),
    ('Tabungan','expense'),('Lainnya','expense'),
    ('Gaji','income'),('Usaha','income'),('Lainnya','income')
  ) as v(name, type)
  where not exists (
    select 1 from public.categories c
    where c.family_id = p_family_id and c.user_id = auth.uid()
      and c.name = v.name and c.type = v.type
  );
end;
$$;

-- 8) join_family: beri anggota baru kategori default miliknya sendiri.
create or replace function public.join_family(p_invite_code text, p_display_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_family_id uuid;
begin
  if v_uid is null then
    raise exception 'Anda harus login terlebih dahulu';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'Akun Anda sudah tergabung dalam sebuah keluarga';
  end if;
  if coalesce(btrim(p_display_name), '') = '' then
    raise exception 'Nama tampilan wajib diisi';
  end if;

  select id into v_family_id
  from public.families
  where invite_code = upper(btrim(p_invite_code));

  if v_family_id is null then
    raise exception 'Kode keluarga tidak ditemukan';
  end if;

  insert into public.profiles (id, family_id, display_name, role)
  values (v_uid, v_family_id, btrim(p_display_name), 'member');

  perform public.seed_default_categories(v_family_id);

  return json_build_object('family_id', v_family_id, 'role', 'member');
end;
$$;

-- ============================================================================
--  SELESAI. (create_family tidak perlu diubah: ia memanggil
--  seed_default_categories yang kini otomatis menanam untuk auth.uid().)
-- ============================================================================
