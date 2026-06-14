// ============================================================================
//  Edge Function: ai-parse
// ----------------------------------------------------------------------------
//  Menerima input dari aplikasi (foto struk / teks / rekaman suara), memanggil
//  Google Gemini, lalu mengembalikan transaksi terstruktur (JSON) untuk
//  ditinjau pengguna sebelum disimpan.
//
//  Kenapa lewat Edge Function (bukan langsung dari browser)?
//    - API key Gemini DISIMPAN sebagai secret di server (tidak bocor ke publik).
//    - Hanya pengguna yang SUDAH LOGIN yang boleh memakainya (verifikasi JWT).
//
//  Secret yang harus diset (Dashboard -> Edge Functions -> ai-parse -> Secrets,
//  atau: supabase secrets set ...):
//    GEMINI_API_KEY = <kunci dari Google AI Studio>     (WAJIB)
//    GEMINI_MODEL   = gemini-2.0-flash                  (opsional, default ini)
//  SUPABASE_URL & SUPABASE_ANON_KEY otomatis tersedia di runtime.
//
//  Cara deploy:
//    A) Dashboard: Edge Functions -> Deploy a new function -> nama "ai-parse" ->
//       tempel isi berkas ini -> Deploy. Lalu isi Secrets di atas.
//    B) CLI:  supabase functions deploy ai-parse
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Metode tidak diizinkan." }, 405);

  try {
    // --- Verifikasi login: cegah penyalahgunaan API key oleh pihak anonim. ---
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
    );
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return json({ ok: false, error: "Sesi tidak valid. Silakan login ulang." }, 401);
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return json({ ok: false, error: "Server AI belum dikonfigurasi (GEMINI_API_KEY belum diset)." }, 500);
    }

    const payload = await req.json().catch(() => ({}));
    const mode = payload.mode;
    const categories = Array.isArray(payload.categories) ? payload.categories : [];
    const today = typeof payload.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.today)
      ? payload.today
      : new Date().toISOString().slice(0, 10);

    if (!["receipt", "text", "voice"].includes(mode)) {
      return json({ ok: false, error: "Mode tidak dikenali." }, 400);
    }

    // --- Susun isi permintaan untuk Gemini sesuai jenis input. ---
    const parts: Array<Record<string, unknown>> = [{ text: buildPrompt(mode, categories, today) }];

    if (mode === "receipt") {
      if (!payload.image) return json({ ok: false, error: "Gambar struk kosong." }, 400);
      parts.push({ inline_data: { mime_type: payload.imageMime || "image/jpeg", data: payload.image } });
    } else if (mode === "voice") {
      if (!payload.audio) return json({ ok: false, error: "Rekaman suara kosong." }, 400);
      parts.push({ inline_data: { mime_type: payload.audioMime || "audio/wav", data: payload.audio } });
    } else {
      const text = (payload.text || "").toString().trim();
      if (!text) return json({ ok: false, error: "Teks kosong." }, 400);
      parts.push({ text: '\n\nKalimat pengguna:\n"""\n' + text + '\n"""' });
    }

    const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 8192 },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        ],
      }),
    });

    if (!geminiRes.ok) {
      const detail = (await geminiRes.text().catch(() => "")).slice(0, 400);
      return json({ ok: false, error: "Layanan AI menolak permintaan (" + geminiRes.status + ").", detail }, 502);
    }

    const data = await geminiRes.json();
    const text: string = (data?.candidates?.[0]?.content?.parts || [])
      .map((p: { text?: string }) => p.text || "").join("");

    if (!text) {
      const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || "kosong";
      return json({ ok: false, error: "AI tidak mengembalikan hasil (" + reason + ")." }, 502);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return json({ ok: false, error: "Hasil AI tidak berformat JSON yang valid." }, 502);
    }

    return json({ ok: true, mode, result: parsed });
  } catch (e) {
    return json({ ok: false, error: "Kesalahan server: " + ((e as Error)?.message || String(e)) }, 500);
  }
});

// ---------------------------------------------------------------------------
//  Susun instruksi (prompt) untuk Gemini.
// ---------------------------------------------------------------------------
function buildPrompt(
  mode: string,
  categories: Array<{ name: string; type: string }>,
  today: string,
): string {
  const exp = categories.filter((c) => c.type === "expense").map((c) => c.name);
  const inc = categories.filter((c) => c.type === "income").map((c) => c.name);
  const catBlock =
    "Kategori PENGELUARAN yang tersedia: " + (exp.length ? exp.join(", ") : "(tidak ada)") + "\n" +
    "Kategori PEMASUKAN yang tersedia: " + (inc.length ? inc.join(", ") : "(tidak ada)");

  const moneyRule =
    "Aturan jumlah uang (Rupiah): keluarkan BILANGAN BULAT tanpa pemisah ribuan. " +
    'Contoh: "25rb"/"25k"/"25.000" => 25000; "1,5jt"/"1.5jt"/"1500k" => 1500000; "Rp 12.500" => 12500. ' +
    "Dalam format Indonesia, titik biasanya pemisah ribuan dan koma adalah desimal.";

  const dateRule =
    "Tanggal hari ini = " + today + " (zona Asia/Jakarta). Ubah kata relatif seperti " +
    '"hari ini", "kemarin", "tadi pagi", "lusa", "minggu lalu" menjadi format YYYY-MM-DD. ' +
    "Bila tanggal tidak disebut, gunakan tanggal hari ini.";

  const catRule =
    "Untuk tiap transaksi/item, pilih kategori dari daftar di atas yang paling cocok " +
    "(SALIN nama persis, perhatikan jenis pengeluaran/pemasukan). Bila ragu atau tidak ada yang cocok, isi null.";

  if (mode === "receipt") {
    return [
      "Anda asisten yang membaca STRUK BELANJA Indonesia dari gambar dan mengubahnya menjadi data JSON.",
      catBlock, moneyRule, dateRule, catRule,
      "Baca tiap baris ITEM belanja. Abaikan baris non-item (subtotal, total, tunai, kembalian, " +
      "PPN, diskon, poin, NPWP, kasir, dll), kecuali untuk mengisi field store, date, dan total.",
      "Keluarkan HANYA JSON valid dengan bentuk persis berikut:",
      "{",
      '  "type": "receipt",',
      '  "store": string|null,',
      '  "date": "YYYY-MM-DD"|null,',
      '  "items": [',
      "    {",
      '      "name": string,',
      '      "qty": number|null,',
      '      "unit_price": number|null,',
      '      "amount": number,',
      '      "tx_type": "expense",',
      '      "category": string|null',
      "    }",
      "  ],",
      '  "total": number|null',
      "}",
      'Keterangan: "amount" = total per baris (qty x harga satuan) dalam Rupiah bilangan bulat. ' +
      '"name" = nama barang yang singkat dan rapi.',
      "Jika gambar bukan struk atau tidak terbaca, kembalikan items berupa array kosong dan store/date/total null.",
    ].join("\n");
  }

  // mode === "text" || mode === "voice"
  const intro = mode === "voice"
    ? "Anda menerima REKAMAN SUARA berbahasa Indonesia berisi catatan keuangan. Transkripsikan lalu pahami isinya."
    : "Anda menerima KALIMAT berbahasa Indonesia berisi catatan keuangan singkat.";

  const lines = [
    intro,
    "Ubah menjadi satu atau beberapa transaksi keuangan.",
    catBlock, moneyRule, dateRule, catRule,
    "Keluarkan HANYA JSON valid dengan bentuk persis berikut:",
    "{",
    '  "type": "list",',
  ];
  if (mode === "voice") lines.push('  "transcript": string,');
  lines.push(
    '  "transactions": [',
    "    {",
    '      "tx_type": "expense"|"income",',
    '      "amount": number,',
    '      "category": string|null,',
    '      "date": "YYYY-MM-DD",',
    '      "note": string',
    "    }",
    "  ]",
    "}",
    "Jika tidak ada transaksi yang dapat dikenali, kembalikan transactions berupa array kosong.",
  );
  if (mode === "voice") lines.push('Selalu isi "transcript" dengan apa yang Anda dengar, apa adanya.');
  return lines.join("\n");
}
