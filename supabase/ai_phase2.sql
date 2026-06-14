-- ============================================================================
--  KEUANGAN KELUARGA — Migrasi Fase 2 (Analisis Harga & Perbandingan Toko)
-- ----------------------------------------------------------------------------
--  Menyediakan fungsi RPC AMAN untuk fitur "Analisis -> Harga":
--    - Mengembalikan RINGKASAN harga per barang & toko dari struk SELURUH
--      anggota keluarga (cakupan se-keluarga), TANPA mengungkap transaksi
--      pribadi: tidak ada user_id, tidak ada jumlah total, tidak ada catatan
--      lain selain nama barang/toko/harga-satuan/tanggal.
--    - Hanya pengguna login, dan hanya untuk keluarganya sendiri
--      (difilter dengan public.my_family_id()).
--
--  Prasyarat: schema.sql + ai_phase1.sql sudah dijalankan.
--  Cara pakai: Supabase Dashboard -> SQL Editor -> tempel -> Run. Aman diulang.
-- ============================================================================

create or replace function public.price_rows()
returns table (
  item       text,
  store      text,
  unit_price numeric,
  qty        numeric,
  tx_date    date
)
language sql
stable
security definer
set search_path = public
as $$
  select t.note as item, t.store, t.unit_price, t.qty, t.tx_date
  from public.transactions t
  where t.family_id = public.my_family_id()
    and t.source = 'receipt'
    and t.unit_price is not null
    and t.store is not null
    and coalesce(btrim(t.note), '') <> ''
  order by t.tx_date desc, t.created_at desc;
$$;

grant execute on function public.price_rows() to authenticated;

-- ============================================================================
--  SELESAI. Fungsi ini hanya membuka RINGKASAN harga (barang/toko/harga/tanggal)
--  se-keluarga; akses langsung ke tabel transactions tetap dijaga oleh RLS.
-- ============================================================================
