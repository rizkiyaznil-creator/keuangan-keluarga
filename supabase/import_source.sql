-- ============================================================================
--  KEUANGAN KELUARGA — Migrasi: izinkan source 'import' pada transactions
-- ----------------------------------------------------------------------------
--  Fitur "Impor mutasi" (rekening koran / GoPay / OVO / dll) menyimpan
--  transaksi dengan source = 'import'. Perbarui CHECK constraint agar nilai
--  ini diterima (selain 'manual', 'receipt', 'text', 'voice').
--
--  Cara pakai: Supabase Dashboard -> SQL Editor -> tempel -> Run. Aman diulang.
-- ============================================================================

alter table public.transactions drop constraint if exists transactions_source_check;

alter table public.transactions
  add constraint transactions_source_check
  check (source in ('manual', 'receipt', 'text', 'voice', 'import'));
