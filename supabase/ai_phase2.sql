-- ============================================================================
--  KEUANGAN KELUARGA — Migrasi Fase 2 (Analisis Harga & Perbandingan Toko)
-- ----------------------------------------------------------------------------
--  Menyediakan fungsi RPC AMAN untuk fitur "Analisis -> Harga":
--    - Mengembalikan RINGKASAN harga per barang & toko dari struk, TANPA
--      mengungkap transaksi pribadi: tidak ada user_id, tidak ada jumlah total,
--      tidak ada catatan lain selain nama barang/toko/harga-satuan/tanggal.
--    - Cakupan diatur peran (default 'self' = aman):
--        * p_scope = 'self'   -> hanya data milik pengguna yang login.
--        * p_scope = 'family' -> data SE-KELUARGA, HANYA jika pengguna admin
--                                (is_family_admin); anggota biasa otomatis
--                                dibatasi ke datanya sendiri.
--
--  Prasyarat: schema.sql + ai_phase1.sql sudah dijalankan.
--  Cara pakai: Supabase Dashboard -> SQL Editor -> tempel -> Run. Aman diulang.
-- ============================================================================

-- Hapus versi lama (termasuk varian tanpa argumen dari rilis awal yang
-- mengembalikan data se-keluarga untuk semua orang) agar tak ada celah privasi.
drop function if exists public.price_rows();
drop function if exists public.price_rows(text);

create or replace function public.price_rows(p_scope text default 'self')
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
    and (
      -- Se-keluarga hanya untuk admin; selain itu dibatasi ke milik sendiri.
      (p_scope = 'family' and public.is_family_admin())
      or t.user_id = auth.uid()
    )
    and t.source = 'receipt'
    and t.unit_price is not null
    and t.store is not null
    and coalesce(btrim(t.note), '') <> ''
  order by t.tx_date desc, t.created_at desc;
$$;

grant execute on function public.price_rows(text) to authenticated;

-- ============================================================================
--  SELESAI. Fungsi ini hanya membuka RINGKASAN harga (barang/toko/harga/tanggal);
--  akses langsung ke tabel transactions tetap dijaga oleh RLS. Cakupan
--  se-keluarga ditegakkan di sisi server, bukan hanya di UI.
-- ============================================================================
