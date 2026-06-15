-- ============================================================================
--  KEUANGAN KELUARGA — Migrasi: jenis ketiga "Investasi"
-- ----------------------------------------------------------------------------
--  Menambahkan jenis 'investment' untuk kategori & transaksi (selain
--  'income'/'expense'). Investasi = uang KELUAR untuk ditanam, dihitung
--  TERPISAH dari pengeluaran konsumsi. Menambah pula kategori default
--  "Investasi" untuk tiap user.
--
--  Prasyarat: jalankan categories_per_user.sql LEBIH DULU (butuh kolom user_id).
--  Cara pakai: Supabase Dashboard -> SQL Editor -> tempel -> Run. Aman diulang.
-- ============================================================================

-- 1) Longgarkan CHECK type pada categories & transactions.
alter table public.categories  drop constraint if exists categories_type_check;
alter table public.categories  add  constraint categories_type_check
  check (type in ('income', 'expense', 'investment'));

alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions add  constraint transactions_type_check
  check (type in ('income', 'expense', 'investment'));

-- 2) Seed default per-user kini termasuk kategori "Investasi".
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
    ('Gaji','income'),('Usaha','income'),('Lainnya','income'),
    ('Investasi','investment')
  ) as v(name, type)
  where not exists (
    select 1 from public.categories c
    where c.family_id = p_family_id and c.user_id = auth.uid()
      and c.name = v.name and c.type = v.type
  );
end;
$$;

-- 3) Beri kategori "Investasi" untuk user yang sudah ada (idempotent).
do $$
declare m record;
begin
  for m in select id, family_id from public.profiles loop
    if not exists (select 1 from public.categories
                   where family_id = m.family_id and user_id = m.id
                     and name = 'Investasi' and type = 'investment') then
      insert into public.categories (family_id, user_id, name, type, is_default)
        values (m.family_id, m.id, 'Investasi', 'investment', true);
    end if;
  end loop;
end $$;
