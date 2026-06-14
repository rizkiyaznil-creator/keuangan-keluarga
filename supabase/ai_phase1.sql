-- ============================================================================
--  KEUANGAN KELUARGA — Migrasi Fase 1 (Input AI)
-- ----------------------------------------------------------------------------
--  Menambah kolom pada tabel transactions untuk menampung data hasil input AI
--  (scan struk / ketik cepat / voice). Kolom bersifat OPSIONAL (nullable /
--  ber-default) sehingga:
--    - Transaksi manual yang lama & baru TETAP berfungsi tanpa perubahan.
--    - RLS yang sudah ada otomatis berlaku untuk kolom baru (aturan per-baris).
--
--  Kolom-kolom ini juga menjadi FONDASI untuk Fase 2-3 (intelijen harga &
--  perbandingan toko): kita mulai mengumpulkan toko, kuantitas, dan harga
--  satuan per barang sejak sekarang.
--
--  Cara pakai: Supabase Dashboard -> SQL Editor -> tempel -> Run. Aman diulang.
-- ============================================================================

alter table public.transactions
  add column if not exists source        text not null default 'manual',
  add column if not exists store         text,
  add column if not exists qty           numeric(14, 3),
  add column if not exists unit_price    numeric(14, 2),
  add column if not exists receipt_group uuid;

-- Batasi nilai "source" ke daftar yang dikenal (manual / hasil AI).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_source_check'
  ) then
    alter table public.transactions
      add constraint transactions_source_check
      check (source in ('manual', 'receipt', 'text', 'voice'));
  end if;
end $$;

-- Mempercepat pengelompokan item dari satu struk yang sama.
create index if not exists idx_transactions_receipt_group
  on public.transactions (receipt_group);

-- ============================================================================
--  SELESAI. Tidak perlu mengubah policy RLS — kolom baru ikut terlindungi.
-- ============================================================================
