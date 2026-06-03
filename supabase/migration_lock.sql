-- ============================================================================
--  MIGRASI: Penguncian transaksi (final) untuk PROJECT YANG SUDAH ADA
-- ----------------------------------------------------------------------------
--  Jalankan SEKALI di Supabase Dashboard -> SQL Editor -> New query -> Run.
--  Aman diulang (idempoten). Untuk project BARU, ini sudah termasuk di schema.sql.
--
--  Aturan: sebuah transaksi bisa diedit/dihapus oleh pemiliknya bila SALAH SATU:
--    (a) tanggalnya masih di BULAN BERJALAN (zona WIB / Asia/Jakarta),
--    (b) BARU ditambahkan <= 7 hari (untuk mencatat yang terlupa),
--    (c) ADMIN sudah membuka kunci (editable_until belum lewat).
--  Setelah itu => FINAL. Admin boleh "buka kunci" atau "hapus".
-- ============================================================================

-- 1) Kolom untuk "buka kunci" oleh admin.
alter table public.transactions
  add column if not exists editable_until timestamptz;

-- 2) Fungsi penentu transaksi masih terbuka atau tidak.
create or replace function public.tx_is_open(
  p_tx_date date, p_created_at timestamptz, p_editable_until timestamptz
)
returns boolean
language sql
stable
as $$
  select
    to_char(p_tx_date, 'YYYYMM') >= to_char((now() at time zone 'Asia/Jakarta'), 'YYYYMM')
    or p_created_at >= now() - interval '7 days'
    or (p_editable_until is not null and now() < p_editable_until);
$$;
grant execute on function public.tx_is_open(date, timestamptz, timestamptz) to authenticated;

-- 3) Perbarui policy UPDATE & DELETE pemilik agar menghormati penguncian.
drop policy if exists tx_update_self on public.transactions;
create policy tx_update_self on public.transactions
  for update to authenticated
  using (user_id = auth.uid() and public.tx_is_open(tx_date, created_at, editable_until))
  with check (user_id = auth.uid() and family_id = public.my_family_id());

drop policy if exists tx_delete_self on public.transactions;
create policy tx_delete_self on public.transactions
  for delete to authenticated
  using (user_id = auth.uid() and public.tx_is_open(tx_date, created_at, editable_until));

-- 4) Admin boleh menghapus transaksi sefamili (mis. final yang salah).
drop policy if exists tx_delete_admin on public.transactions;
create policy tx_delete_admin on public.transactions
  for delete to authenticated
  using (public.is_family_admin() and family_id = public.my_family_id());

-- 5) RPC: admin membuka kunci (beri pemilik jendela edit, default 7 hari).
--    Hanya mengubah masa-edit, TIDAK mengubah nilai transaksi.
create or replace function public.admin_unlock_transaction(p_tx_id uuid, p_days int default 7)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
begin
  if not public.is_family_admin() then
    raise exception 'Hanya admin yang dapat membuka kunci';
  end if;
  update public.transactions
     set editable_until = now() + (greatest(coalesce(p_days, 7), 1) || ' days')::interval
   where id = p_tx_id and family_id = public.my_family_id()
  returning editable_until into v_until;
  if v_until is null then
    raise exception 'Transaksi tidak ditemukan di keluarga Anda';
  end if;
  return v_until;
end;
$$;
grant execute on function public.admin_unlock_transaction(uuid, int) to authenticated;

-- ============================================================================
--  SELESAI. Muat ulang aplikasi setelah menjalankan ini.
-- ============================================================================
