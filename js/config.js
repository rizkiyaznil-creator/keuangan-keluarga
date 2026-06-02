// ============================================================================
//  KONFIGURASI SUPABASE  —  ISI BAGIAN INI SEBELUM MENJALANKAN APLIKASI
// ============================================================================
//  Langkah:
//   1. Buka Supabase Dashboard -> pilih project Anda.
//   2. Masuk ke "Project Settings" -> "API" (atau "Data API").
//   3. Salin "Project URL"  -> tempel ke SUPABASE_URL.
//   4. Salin kunci "anon public" -> tempel ke SUPABASE_ANON_KEY.
//
//  CATATAN KEAMANAN (penting):
//   URL dan "anon key" ini MEMANG bersifat publik dan aman untuk ditaruh di
//   kode frontend. Keamanan & privasi data dijaga oleh Row Level Security (RLS)
//   di database Supabase (lihat supabase/schema.sql), BUKAN oleh kerahasiaan
//   kunci ini.
// ============================================================================

window.KK_CONFIG = {
  SUPABASE_URL: "ISI_SUPABASE_URL_DI_SINI",            // contoh: https://abcdwxyz.supabase.co
  SUPABASE_ANON_KEY: "ISI_SUPABASE_ANON_KEY_DI_SINI"   // contoh: eyJhbGciOi...
};
