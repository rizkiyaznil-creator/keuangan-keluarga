-- ============================================================================
--  KEUANGAN KELUARGA — Skema Database + Row Level Security (RLS)
-- ----------------------------------------------------------------------------
--  Cara pakai:
--    1. Buka Supabase Dashboard -> SQL Editor -> New query.
--    2. Tempel SELURUH isi berkas ini.
--    3. Klik "Run". Aman dijalankan pada project baru (sekali jalan).
--
--  Ringkasan aturan privasi yang ditegakkan di sini (bukan hanya di frontend):
--    - Anggota biasa  : HANYA bisa melihat & menulis transaksi MILIKNYA.
--    - Admin/Kepala    : bisa MELIHAT transaksi SEMUA anggota sefamili,
--                        tetapi TETAP hanya bisa menulis transaksi miliknya.
--    - Kategori        : milik keluarga (boleh dikelola anggota keluarga).
--    - Pendaftaran     : lewat fungsi RPC aman (create_family / join_family)
--                        agar tidak ada kebocoran data antar-keluarga.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  TABEL
-- ---------------------------------------------------------------------------
create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  family_id    uuid not null references public.families (id) on delete cascade,
  display_name text not null,
  role         text not null default 'member' check (role in ('admin', 'member')),
  created_at   timestamptz not null default now()
);

create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families (id) on delete cascade,
  name       text not null,
  type       text not null check (type in ('income', 'expense')),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  type        text not null check (type in ('income', 'expense')),
  category_id uuid references public.categories (id) on delete set null,
  amount      numeric(14, 2) not null check (amount >= 0),
  note        text,
  tx_date     date not null default current_date,
  created_at  timestamptz not null default now()
);

create index if not exists idx_profiles_family      on public.profiles (family_id);
create index if not exists idx_categories_family    on public.categories (family_id);
create index if not exists idx_transactions_family  on public.transactions (family_id);
create index if not exists idx_transactions_user    on public.transactions (user_id);
create index if not exists idx_transactions_date    on public.transactions (tx_date);

-- ---------------------------------------------------------------------------
--  FUNGSI BANTU (SECURITY DEFINER) — mencegah rekursi RLS.
--  Karena dimiliki oleh owner (postgres), fungsi ini membaca profiles dengan
--  melewati RLS, sehingga aman dipanggil dari dalam policy.
-- ---------------------------------------------------------------------------
create or replace function public.my_family_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select family_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_family_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
--  AKTIFKAN ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table public.families     enable row level security;
alter table public.profiles     enable row level security;
alter table public.categories   enable row level security;
alter table public.transactions enable row level security;

-- ---------------------------------------------------------------------------
--  POLICY: families
--  Hanya bisa melihat keluarga sendiri. Pembuatan keluarga lewat RPC.
-- ---------------------------------------------------------------------------
drop policy if exists families_select on public.families;
create policy families_select on public.families
  for select to authenticated
  using (id = public.my_family_id());

-- ---------------------------------------------------------------------------
--  POLICY: profiles
--  - Setiap orang melihat profilnya sendiri.
--  - Admin melihat semua profil sefamili (untuk rincian per-anggota).
--  - Hanya boleh mengubah display_name milik sendiri (kolom sensitif dijaga
--    oleh trigger di bawah). Tidak ada INSERT/DELETE langsung (lewat RPC).
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_self  on public.profiles;
drop policy if exists profiles_select_admin on public.profiles;
drop policy if exists profiles_update_self  on public.profiles;

create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (public.is_family_admin() and family_id = public.my_family_id());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Cegah perubahan kolom sensitif (role / family_id / id) lewat API.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'Tidak boleh mengubah id profil';
  end if;
  if new.family_id is distinct from old.family_id then
    raise exception 'Tidak boleh berpindah keluarga';
  end if;
  if new.role is distinct from old.role then
    raise exception 'Tidak boleh mengubah peran (role)';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_columns on public.profiles;
create trigger trg_protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ---------------------------------------------------------------------------
--  POLICY: categories
--  Anggota keluarga boleh melihat & mengelola kategori keluarganya.
-- ---------------------------------------------------------------------------
drop policy if exists categories_select on public.categories;
drop policy if exists categories_insert on public.categories;
drop policy if exists categories_update on public.categories;
drop policy if exists categories_delete on public.categories;

create policy categories_select on public.categories
  for select to authenticated
  using (family_id = public.my_family_id());

create policy categories_insert on public.categories
  for insert to authenticated
  with check (family_id = public.my_family_id());

create policy categories_update on public.categories
  for update to authenticated
  using (family_id = public.my_family_id())
  with check (family_id = public.my_family_id());

create policy categories_delete on public.categories
  for delete to authenticated
  using (family_id = public.my_family_id());

-- ---------------------------------------------------------------------------
--  POLICY: transactions  (INTI PRIVASI)
--  - SELECT  : milik sendiri ATAU (admin & sefamili) -> admin lihat semua.
--  - INSERT  : hanya milik sendiri & di keluarga sendiri.
--  - UPDATE  : hanya milik sendiri (admin pun tidak bisa edit punya anggota).
--  - DELETE  : hanya milik sendiri.
-- ---------------------------------------------------------------------------
drop policy if exists tx_select_self  on public.transactions;
drop policy if exists tx_select_admin on public.transactions;
drop policy if exists tx_insert_self  on public.transactions;
drop policy if exists tx_update_self  on public.transactions;
drop policy if exists tx_delete_self  on public.transactions;

create policy tx_select_self on public.transactions
  for select to authenticated
  using (user_id = auth.uid());

create policy tx_select_admin on public.transactions
  for select to authenticated
  using (public.is_family_admin() and family_id = public.my_family_id());

create policy tx_insert_self on public.transactions
  for insert to authenticated
  with check (user_id = auth.uid() and family_id = public.my_family_id());

create policy tx_update_self on public.transactions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and family_id = public.my_family_id());

create policy tx_delete_self on public.transactions
  for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
--  KATEGORI DEFAULT — diisi otomatis saat keluarga dibuat.
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_categories(p_family_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.categories (family_id, name, type, is_default) values
    (p_family_id, 'Gaji Pekerja',  'expense', true),
    (p_family_id, 'Rekreasi',      'expense', true),
    (p_family_id, 'Makan di Luar', 'expense', true),
    (p_family_id, 'BBM',           'expense', true),
    (p_family_id, 'Listrik',       'expense', true),
    (p_family_id, 'Air',           'expense', true),
    (p_family_id, 'Belanja Dapur', 'expense', true),
    (p_family_id, 'Tabungan',      'expense', true),
    (p_family_id, 'Lainnya',       'expense', true),
    (p_family_id, 'Gaji',          'income',  true),
    (p_family_id, 'Usaha',         'income',  true),
    (p_family_id, 'Lainnya',       'income',  true);
end;
$$;

-- ---------------------------------------------------------------------------
--  KODE UNDANGAN UNIK (tanpa karakter ambigu: 0/O/1/I).
-- ---------------------------------------------------------------------------
create or replace function public.gen_invite_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result   text := '';
  i        int;
begin
  for i in 1..6 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
--  RPC: create_family — buat keluarga baru, jadi admin, dapat kode, seed kategori.
-- ---------------------------------------------------------------------------
create or replace function public.create_family(p_family_name text, p_display_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_family_id uuid;
  v_code      text;
  v_tries     int := 0;
begin
  if v_uid is null then
    raise exception 'Anda harus login terlebih dahulu';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'Akun Anda sudah tergabung dalam sebuah keluarga';
  end if;
  if coalesce(btrim(p_family_name), '') = '' then
    raise exception 'Nama keluarga wajib diisi';
  end if;
  if coalesce(btrim(p_display_name), '') = '' then
    raise exception 'Nama tampilan wajib diisi';
  end if;

  loop
    v_code := public.gen_invite_code();
    exit when not exists (select 1 from public.families where invite_code = v_code);
    v_tries := v_tries + 1;
    if v_tries > 20 then
      raise exception 'Gagal membuat kode unik, coba lagi';
    end if;
  end loop;

  insert into public.families (name, invite_code)
  values (btrim(p_family_name), v_code)
  returning id into v_family_id;

  insert into public.profiles (id, family_id, display_name, role)
  values (v_uid, v_family_id, btrim(p_display_name), 'admin');

  perform public.seed_default_categories(v_family_id);

  return json_build_object('family_id', v_family_id, 'invite_code', v_code, 'role', 'admin');
end;
$$;

-- ---------------------------------------------------------------------------
--  RPC: join_family — gabung memakai kode undangan yang valid.
-- ---------------------------------------------------------------------------
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

  return json_build_object('family_id', v_family_id, 'role', 'member');
end;
$$;

-- ---------------------------------------------------------------------------
--  HAK AKSES FUNGSI (anon tidak diberi; hanya pengguna login).
-- ---------------------------------------------------------------------------
grant execute on function public.my_family_id()                 to authenticated;
grant execute on function public.is_family_admin()              to authenticated;
grant execute on function public.create_family(text, text)      to authenticated;
grant execute on function public.join_family(text, text)        to authenticated;

-- ============================================================================
--  SELESAI. Jangan lupa: di Authentication -> Sign In / Providers -> Email,
--  MATIKAN "Confirm email" agar pendaftaran langsung aktif.
-- ============================================================================
