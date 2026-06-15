// ============================================================================
//  Edge Function: ai-parse  (HIBRIDA / multi-provider)
// ----------------------------------------------------------------------------
//  Menerima input dari aplikasi (foto struk / teks / rekaman suara), memanggil
//  AI, lalu mengembalikan transaksi terstruktur (JSON) untuk ditinjau pengguna
//  sebelum disimpan.
//
//  Pembagian penyedia (hemat + fitur tetap lengkap):
//    - "text"  (Ketik cepat) -> DeepSeek bila DEEPSEEK_API_KEY diset (murah,
//                               kuota terpisah). Jika belum diset -> Gemini.
//    - "receipt" / "voice"   -> Gemini (perlu input gambar/audio native).
//    - "advice" (Saran AI)   -> DeepSeek DIUTAMAKAN bila ada; fallback otomatis ke Gemini.
//                               Input hanya RINGKASAN ANGKA agregat (tanpa data pribadi).
//
//  Kenapa lewat Edge Function (bukan langsung dari browser)?
//    - API key DISIMPAN sebagai secret di server (tidak bocor ke publik).
//    - Hanya pengguna yang SUDAH LOGIN yang boleh memakainya (verifikasi JWT).
//
//  Secret (Dashboard -> Edge Functions -> Secrets):
//    GEMINI_API_KEY   = <kunci Google AI Studio>       (WAJIB untuk struk/voice)
//    GEMINI_MODEL     = gemini-2.5-flash               (opsional, default ini)
//    DEEPSEEK_API_KEY = <kunci platform.deepseek.com>  (opsional; aktifkan teks via DeepSeek)
//    DEEPSEEK_MODEL   = deepseek-chat                  (opsional)
//  SUPABASE_URL & SUPABASE_ANON_KEY otomatis tersedia di runtime.
//
//  Cara deploy:
//    Dashboard: Edge Functions -> ai-parse -> tempel isi berkas ini -> Deploy.
//    CLI:       supabase functions deploy ai-parse
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

    const payload = await req.json().catch(() => ({}));
    const mode = payload.mode;
    const categories = Array.isArray(payload.categories) ? payload.categories : [];
    const today = typeof payload.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.today)
      ? payload.today
      : new Date().toISOString().slice(0, 10);

    if (!["receipt", "text", "voice", "advice"].includes(mode)) {
      return json({ ok: false, error: "Mode tidak dikenali." }, 400);
    }

    const prompt = buildPrompt(mode, categories, today);

    // --- Validasi input per-mode (sebelum memanggil penyedia mana pun). ---
    if (mode === "receipt" && !payload.image) return json({ ok: false, error: "Gambar struk kosong." }, 400);
    if (mode === "voice" && !payload.audio) return json({ ok: false, error: "Rekaman suara kosong." }, 400);
    if (mode === "advice" && (!payload.summary || typeof payload.summary !== "object")) {
      return json({ ok: false, error: "Ringkasan angka kosong." }, 400);
    }
    if (mode === "text" && !(payload.text || "").toString().trim()) {
      return json({ ok: false, error: "Teks kosong." }, 400);
    }

    // --- Routing penyedia ---
    //   text/advice : DeepSeek DIUTAMAKAN bila DEEPSEEK_API_KEY ada; bila gagal,
    //                 otomatis fallback ke Gemini. receipt/voice : selalu Gemini.
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY");
    const preferDeepseek = (mode === "text" || mode === "advice") && !!deepseekKey;

    let resultText: string | null = null;
    let provider = "";
    let dsErr = "";

    // 1) Coba DeepSeek lebih dulu (teks/saran).
    if (preferDeepseek) {
      const userText = mode === "advice"
        ? "DATA RINGKASAN (JSON):\n" + JSON.stringify(payload.summary || {})
        : (payload.text || "").toString().trim();
      const r = await callDeepSeek(deepseekKey!, prompt, userText);
      if (r.ok) { resultText = r.text!; provider = "deepseek"; }
      else { dsErr = r.error || "DeepSeek gagal."; }
    }

    // 2) Gemini: penyedia utama (receipt/voice/tanpa key DeepSeek) ATAU fallback bila DeepSeek gagal.
    if (resultText === null) {
      if (!geminiKey) {
        return json({
          ok: false,
          error: preferDeepseek
            ? ("Saran via DeepSeek gagal dan Gemini belum disiapkan sebagai cadangan. " + dsErr)
            : "Server AI belum dikonfigurasi (GEMINI_API_KEY belum diset).",
        }, preferDeepseek ? 502 : 500);
      }
      const parts = buildGeminiParts(mode, payload, prompt);
      // Struk: sedikit anggaran nalar (256); lainnya matikan demi hemat.
      const thinkingBudget = mode === "receipt" ? 256 : 0;
      const r = await callGemini(geminiKey, parts, thinkingBudget);
      if (!r.ok) {
        const err = preferDeepseek ? ("DeepSeek lalu Gemini sama-sama gagal. " + r.error) : r.error;
        return json({ ok: false, error: err, detail: r.detail }, 502);
      }
      resultText = r.text!;
      provider = preferDeepseek ? "gemini (fallback)" : "gemini";
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(resultText);
    } catch {
      return json({ ok: false, error: "Hasil AI tidak berformat JSON yang valid." }, 502);
    }

    return json({ ok: true, mode, result: parsed, provider });
  } catch (e) {
    return json({ ok: false, error: "Kesalahan server: " + ((e as Error)?.message || String(e)) }, 500);
  }
});

interface CallResult {
  ok: boolean;
  text?: string;
  error?: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
//  Penyedia: Google Gemini — mendukung teks + gambar + audio dalam satu API.
// ---------------------------------------------------------------------------
async function callGemini(
  apiKey: string,
  parts: Array<Record<string, unknown>>,
  thinkingBudget = 0,
): Promise<CallResult> {
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: 8192,
        // Hemat biaya: token "thinking" ditagih sebagai output. 0 = mati
        // (teks/voice/saran); struk diberi sedikit anggaran sebagai jaring pengaman.
        thinkingConfig: { thinkingBudget },
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    }),
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 400);
    return { ok: false, error: "Layanan AI (Gemini) menolak permintaan (" + res.status + ").", detail };
  }

  const data = await res.json();
  const text: string = (data?.candidates?.[0]?.content?.parts || [])
    .map((p: { text?: string }) => p.text || "").join("");

  if (!text) {
    const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || "kosong";
    return { ok: false, error: "AI (Gemini) tidak mengembalikan hasil (" + reason + ")." };
  }
  return { ok: true, text };
}

// ---------------------------------------------------------------------------
//  Penyedia: DeepSeek (OpenAI-compatible, TEKS saja) — untuk "Ketik cepat".
// ---------------------------------------------------------------------------
async function callDeepSeek(apiKey: string, systemPrompt: string, userText: string): Promise<CallResult> {
  const model = Deno.env.get("DEEPSEEK_MODEL") || "deepseek-chat";

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: 'Kalimat pengguna:\n"""\n' + userText + '\n"""' },
      ],
      temperature: 0.1,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 400);
    return { ok: false, error: "Layanan AI (DeepSeek) menolak permintaan (" + res.status + ").", detail };
  }

  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content || "";
  if (!text) return { ok: false, error: "AI (DeepSeek) tidak mengembalikan hasil." };
  return { ok: true, text };
}

// ---------------------------------------------------------------------------
//  Susun "parts" untuk Gemini sesuai jenis input (dipakai jalur utama & fallback).
// ---------------------------------------------------------------------------
function buildGeminiParts(
  mode: string,
  payload: Record<string, any>,
  prompt: string,
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (mode === "receipt") {
    parts.push({ inline_data: { mime_type: payload.imageMime || "image/jpeg", data: payload.image } });
  } else if (mode === "voice") {
    parts.push({ inline_data: { mime_type: payload.audioMime || "audio/wav", data: payload.audio } });
  } else if (mode === "advice") {
    parts.push({ text: "\n\nDATA RINGKASAN (JSON):\n" + JSON.stringify(payload.summary) });
  } else {
    parts.push({ text: '\n\nKalimat pengguna:\n"""\n' + (payload.text || "").toString().trim() + '\n"""' });
  }
  return parts;
}

// ---------------------------------------------------------------------------
//  Susun instruksi (prompt) untuk model. Dipakai semua penyedia.
// ---------------------------------------------------------------------------
function buildPrompt(
  mode: string,
  categories: Array<{ name: string; type: string }>,
  today: string,
): string {
  if (mode === "advice") {
    return [
      "Anda penasihat keuangan keluarga Indonesia yang hati-hati, membumi, dan suportif.",
      "Anda menerima RINGKASAN ANGKA keuangan satu bulan dalam JSON (bukan transaksi mentah, tanpa nama orang).",
      "Arti field: bulan (YYYY-MM); lingkup ('Saya' atau 'Keluarga'); pemasukan; pengeluaran; " +
        "saldo (=pemasukan-pengeluaran, negatif berarti defisit); tabungan (nominal pada kategori 'Tabungan'); " +
        "rasio_tabungan_persen; rasio_pengeluaran_persen; kategori_pengeluaran (daftar {nama, jumlah}, terbesar dahulu); " +
        "pengeluaran_bulan_lalu (boleh null).",
      "ATURAN:",
      "- Gunakan HANYA angka yang diberikan. DILARANG mengarang nominal atau persen yang tidak ada di data.",
      "- Semua uang dalam Rupiah; tulis dengan pemisah ribuan titik (contoh: Rp 1.500.000).",
      "- Bahasa Indonesia, ramah, ringkas, konkret, tidak menggurui.",
      "- Saran harus bisa ditindaklanjuti dan masuk akal untuk keluarga Indonesia.",
      "- JANGAN merekomendasikan produk investasi spesifik atau menjanjikan imbal hasil. " +
        "Ini edukasi umum, bukan nasihat keuangan profesional.",
      "- Jika kategori 'Lainnya' atau 'Tanpa kategori' besar, ingatkan kemungkinan pencatatan belum terkategorisasi rapi.",
      "- Jika tabungan 0 padahal ada pemasukan, ingatkan tabungan mungkin tercatat di kategori lain.",
      "Keluarkan HANYA JSON valid berbentuk persis:",
      "{",
      '  "ringkasan": string,',
      '  "items": [',
      '    { "level": "good"|"warn"|"danger"|"info", "title": string, "text": string }',
      "  ]",
      "}",
      "Beri 3 sampai 5 item, urut dari paling penting. 'title' singkat (maks ~6 kata); 'text' maks 2 kalimat.",
    ].join("\n");
  }

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
