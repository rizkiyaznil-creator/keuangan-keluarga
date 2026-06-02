// Inisialisasi koneksi ke Supabase.
// Bergantung pada: library @supabase/supabase-js (dimuat via CDN di index.html)
// dan window.KK_CONFIG (dari js/config.js).
window.KK = window.KK || {};

(function () {
  const cfg = window.KK_CONFIG || {};

  const isPlaceholder = (v) =>
    !v || typeof v !== "string" || v.indexOf("ISI_") === 0 || v.trim() === "";

  KK.isConfigured = !isPlaceholder(cfg.SUPABASE_URL) && !isPlaceholder(cfg.SUPABASE_ANON_KEY);

  if (!KK.isConfigured) {
    console.warn(
      "[Keuangan Keluarga] js/config.js belum diisi. " +
      "Isi SUPABASE_URL dan SUPABASE_ANON_KEY terlebih dahulu (lihat README.md)."
    );
    KK.sb = null;
    return;
  }

  if (typeof supabase === "undefined" || !supabase.createClient) {
    console.error("[Keuangan Keluarga] Library Supabase gagal dimuat dari CDN.");
    KK.sb = null;
    KK.isConfigured = false;
    return;
  }

  KK.sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
})();
