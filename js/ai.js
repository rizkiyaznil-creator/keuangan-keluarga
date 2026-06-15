// ============================================================================
//  Modul Input AI (KK.ai)
// ----------------------------------------------------------------------------
//  Tiga cara cepat menambah transaksi, semuanya melewati layar TINJAU & EDIT
//  sebelum disimpan:
//    1. 📷 Scan struk   -> foto diperkecil di HP, dibaca item-per-item.
//    2. ⚡ Ketik cepat   -> kalimat bebas ("makan siang 25rb") jadi transaksi.
//    3. 🎤 Voice note    -> rekaman suara ditranskrip lalu dipahami.
//
//  Privasi: foto/rekaman TIDAK disimpan — hanya dipakai sekali untuk membaca,
//  lalu dibuang. Yang tersimpan hanyalah transaksi yang Anda setujui.
//
//  Bergantung pada: KK.util, KK.db, KK.app (state.categories, openManualTx,
//  refreshAfterAdd), KK.auth.friendly, dan Edge Function "ai-parse".
// ============================================================================
window.KK = window.KK || {};

KK.ai = (function () {
  const u = KK.util;

  const MAX_REC_MS = 60000; // batas aman durasi rekaman suara (1 menit)

  // ----------------------------------------------------------------- UTIL UMUM
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function categoriesPayload() {
    const uid = KK.app.state.user && KK.app.state.user.id;
    return (KK.app.state.categories || []).filter((c) => c.user_id === uid).map((c) => ({ name: c.name, type: c.type }));
  }

  // Petakan nama kategori (dari AI) -> id kategori keluarga, cocok per jenis.
  function findCategoryId(name, type) {
    if (!name) return "";
    const uid = KK.app.state.user && KK.app.state.user.id;
    const lc = String(name).trim().toLowerCase();
    const hit = (KK.app.state.categories || []).find(
      (c) => c.user_id === uid && c.type === type && c.name.trim().toLowerCase() === lc
    );
    return hit ? hit.id : "";
  }

  // ----------------------------------------------------------- GAMBAR (struk)
  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Gambar tidak dapat dibuka.")); };
      img.src = url;
    });
  }

  // Perkecil gambar di sisi HP -> hemat kuota & token AI, lebih cepat.
  async function downscaleImage(file, maxDim, quality) {
    maxDim = maxDim || 1600;
    quality = quality || 0.82;
    const img = await fileToImage(file);
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    return { data: dataUrl.split(",")[1], mime: "image/jpeg" };
  }

  // ------------------------------------------------------------- SUARA (voice)
  let _stream = null, _recorder = null, _chunks = [];

  function pickAudioMime() {
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
    const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    return cands.find((c) => MediaRecorder.isTypeSupported(c)) || "";
  }

  async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("Perangkat/peramban ini tidak mendukung perekaman suara.");
    }
    _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _chunks = [];
    const mime = pickAudioMime();
    _recorder = mime ? new MediaRecorder(_stream, { mimeType: mime }) : new MediaRecorder(_stream);
    _recorder.ondataavailable = (e) => { if (e.data && e.data.size) _chunks.push(e.data); };
    _recorder.start();
  }

  function stopRecording() {
    return new Promise((resolve, reject) => {
      if (!_recorder) return reject(new Error("Belum ada rekaman."));
      _recorder.onstop = () => {
        const blob = new Blob(_chunks, { type: (_recorder && _recorder.mimeType) || "audio/webm" });
        cleanupStream();
        resolve(blob);
      };
      try { _recorder.stop(); } catch (e) { cleanupStream(); reject(e); }
    });
  }

  function cleanupStream() {
    if (_stream) { _stream.getTracks().forEach((t) => t.stop()); _stream = null; }
    _recorder = null;
  }

  // Decode rekaman (webm/opus di Chrome, mp4/aac di Safari) lalu ubah ke WAV
  // mono 16kHz — format yang pasti diterima Gemini di semua peramban.
  async function blobToWavBase64(blob, targetRate) {
    targetRate = targetRate || 16000;
    const arrayBuf = await blob.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("Peramban tidak mendukung pemrosesan audio.");
    const ctx = new AC();
    let audioBuf;
    try {
      audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
    } catch (e) {
      try { ctx.close && ctx.close(); } catch (_) {}
      throw new Error("Rekaman tidak dapat diproses. Coba ulangi.");
    }

    // Campur semua kanal menjadi mono.
    const len = audioBuf.length;
    const chCount = audioBuf.numberOfChannels || 1;
    const mono = new Float32Array(len);
    for (let ch = 0; ch < chCount; ch++) {
      const d = audioBuf.getChannelData(ch);
      for (let i = 0; i < len; i++) mono[i] += d[i] / chCount;
    }

    // Resample linear ke targetRate.
    const srcRate = audioBuf.sampleRate;
    const newLen = Math.max(1, Math.round((len * targetRate) / srcRate));
    const out = new Float32Array(newLen);
    const ratio = (len - 1) / (newLen - 1 || 1);
    for (let i = 0; i < newLen; i++) {
      const idx = i * ratio;
      const i0 = Math.floor(idx);
      const i1 = Math.min(i0 + 1, len - 1);
      const frac = idx - i0;
      out[i] = mono[i0] * (1 - frac) + mono[i1] * frac;
    }
    try { ctx.close && ctx.close(); } catch (_) {}

    return { data: arrayBufferToBase64(encodeWav(out, targetRate)), mime: "audio/wav" };
  }

  function encodeWav(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);            // PCM
    view.setUint16(22, 1, true);            // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);           // 16-bit
    writeStr(36, "data");
    view.setUint32(40, samples.length * 2, true);
    let off = 44;
    for (let i = 0; i < samples.length; i++) {
      let s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
    return buffer;
  }

  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  // ------------------------------------------------------------ PANGGIL SERVER
  async function invokeParse(payload) {
    if (!KK.sb) throw new Error("Aplikasi belum terhubung ke Supabase.");
    const { data, error } = await KK.sb.functions.invoke("ai-parse", { body: payload });
    if (error) {
      let msg = (error && error.message) || "Gagal memanggil layanan AI.";
      let gotBody = false;
      try {
        if (error.context && typeof error.context.json === "function") {
          const body = await error.context.json();
          if (body && body.error) { msg = body.error; gotBody = true; }
          if (body && body.detail) msg += "\n\nDetail: " + String(body.detail);
        }
      } catch (_) { /* abaikan */ }
      // "Fitur belum aktif" HANYA bila benar-benar gagal menghubungi function —
      // jangan tertukar dengan error terstruktur dari penyedia (mis. 404 "model
      // tidak ditemukan" dari Gemini yang kebetulan memuat "404/not found").
      if (!gotBody && /Failed to fetch|NetworkError|load failed|not found|404/i.test(msg)) {
        msg = "Fitur AI belum aktif atau tidak ada koneksi. Pastikan Edge Function \"ai-parse\" sudah dipasang (lihat README).";
      }
      throw new Error(msg);
    }
    if (!data || data.ok === false) throw new Error((data && data.error) || "AI gagal memproses input.");
    return data;
  }

  // ====================================================================== UI
  // -- Lembar pilihan saat menekan tombol "Tambah" (＋).
  function openAddSheet() {
    const opt = (icon, title, desc, onClick) => {
      const b = u.el("button", { class: "ai-opt", type: "button" }, [
        u.el("span", { class: "ai-opt-ic", text: icon }),
        u.el("span", { class: "ai-opt-txt" }, [
          u.el("span", { class: "ai-opt-title", text: title }),
          u.el("span", { class: "ai-opt-desc", text: desc }),
        ]),
      ]);
      b.addEventListener("click", () => { m.close(); onClick(); });
      return b;
    };
    const grid = u.el("div", { class: "ai-opts" }, [
      opt("⌨️", "Ketik manual", "Isi form sendiri", () => KK.app.openManualTx()),
      opt("⚡", "Ketik cepat", "cth: “makan 25rb”", () => openTextFlow()),
      opt("📷", "Scan struk", "Foto struk belanja", () => openReceiptFlow()),
      opt("🎤", "Voice note", "Ucapkan transaksi", () => openVoiceFlow()),
      opt("📋", "Impor mutasi", "Rekening / GoPay / OVO", () => openImportFlow()),
    ]);
    const m = u.openModal({ title: "Tambah Transaksi", body: grid });
  }

  // -- Status: memuat / error (dirender ke dalam body modal).
  function renderLoading(host, text) {
    u.clear(host);
    host.appendChild(u.el("div", { class: "ai-loading" }, [
      u.el("div", { class: "ai-spinner" }),
      u.el("div", { text: text || "Memproses…" }),
      u.el("div", { class: "small muted", text: "Mohon tunggu sebentar." }),
    ]));
  }

  function renderError(host, m, err) {
    u.clear(host);
    const msg = (KK.auth && KK.auth.friendly) ? KK.auth.friendly(err) : (err && err.message) || String(err);
    host.appendChild(u.el("div", { class: "error-box" }, [u.el("p", { text: msg })]));
    const foot = u.el("div", { class: "ai-foot" }, [
      u.el("button", { class: "btn btn-ghost", text: "Tutup", onClick: () => m.close() }),
    ]);
    host.appendChild(foot);
  }

  // --------------------------------------------------------------- KETIK CEPAT
  function openTextFlow() {
    const m = u.openModal({ title: "⚡ Ketik Cepat" });
    const host = m.body;
    renderTextInput(host, m);
  }

  function renderTextInput(host, m) {
    u.clear(host);
    const ta = u.el("textarea", {
      class: "input ai-textarea", rows: "3",
      placeholder: "cth: belanja bulanan 350rb di superindo, bensin 50rb kemarin",
    });
    host.appendChild(u.el("div", { class: "form" }, [
      u.el("label", { class: "field" }, [
        u.el("span", { class: "field-label", text: "Tulis transaksi (bahasa bebas)" }), ta,
      ]),
      u.el("p", { class: "hint", text: "Boleh lebih dari satu transaksi dalam satu kalimat." }),
    ]));
    host.appendChild(u.el("div", { class: "ai-foot" }, [
      u.el("button", { class: "btn btn-ghost", text: "Batal", onClick: () => m.close() }),
      u.el("button", {
        class: "btn btn-primary", text: "Proses",
        onClick: () => {
          const text = ta.value.trim();
          if (!text) return u.toast("Tulis dulu transaksinya.", "warn");
          processAndReview(host, m, "Menganalisis teks…",
            async () => ({ mode: "text", text, categories: categoriesPayload(), today: u.todayISO() }),
            (h, mm, result) => renderDraftsReview(h, mm, result, { source: "text" }));
        },
      }),
    ]));
    setTimeout(() => ta.focus(), 60);
  }

  // ------------------------------------------------------------- IMPOR MUTASI
  function openImportFlow() {
    const m = u.openModal({ title: "📋 Impor Mutasi" });
    renderImportInput(m.body, m);
  }

  function renderImportInput(host, m) {
    u.clear(host);
    const ta = u.el("textarea", {
      class: "input ai-textarea", rows: "5",
      placeholder: "Tempel mutasi rekening / riwayat GoPay/OVO di sini…",
    });
    const fileInp = u.el("input", { type: "file", accept: "image/*", class: "hidden" });
    const pickBtn = u.el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "🖼️ Unggah screenshot" });
    pickBtn.addEventListener("click", () => fileInp.click());
    fileInp.addEventListener("change", () => {
      const file = fileInp.files && fileInp.files[0];
      if (!file) return;
      processAndReview(host, m, "Membaca mutasi…",
        async () => {
          const img = await downscaleImage(file, 1400, 0.72);
          return { mode: "import", image: img.data, imageMime: img.mime, categories: categoriesPayload(), today: u.todayISO() };
        },
        (h, mm, result) => renderDraftsReview(h, mm, result, { source: "import", allowTransfer: true }));
    });

    host.appendChild(u.el("div", { class: "form" }, [
      u.el("label", { class: "field" }, [
        u.el("span", { class: "field-label", text: "Tempel teks mutasi / riwayat e-wallet" }), ta,
      ]),
      u.el("p", { class: "hint", text: "Atau unggah screenshot riwayat transaksi. Top-up / transfer antar-dompet otomatis ditandai & diabaikan." }),
      pickBtn, fileInp,
    ]));
    host.appendChild(u.el("div", { class: "ai-foot" }, [
      u.el("button", { class: "btn btn-ghost", text: "Batal", onClick: () => m.close() }),
      u.el("button", {
        class: "btn btn-primary", text: "Proses",
        onClick: () => {
          const text = ta.value.trim();
          if (!text) return u.toast("Tempel teks mutasi, atau unggah screenshot.", "warn");
          processAndReview(host, m, "Membaca mutasi…",
            async () => ({ mode: "import", text, categories: categoriesPayload(), today: u.todayISO() }),
            (h, mm, result) => renderDraftsReview(h, mm, result, { source: "import", allowTransfer: true }));
        },
      }),
    ]));
    setTimeout(() => ta.focus(), 60);
  }

  // ----------------------------------------------------------------- SCAN STRUK
  function openReceiptFlow() {
    const input = u.el("input", { type: "file", accept: "image/*", style: "display:none" });
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      const m = u.openModal({ title: "📷 Scan Struk" });
      const host = m.body;
      processAndReview(host, m, "Membaca struk…",
        async () => {
          // Hemat token gambar: turunkan resolusi (1600->1200) & kualitas (0.82->0.7).
          const img = await downscaleImage(file, 1200, 0.7);
          return { mode: "receipt", image: img.data, imageMime: img.mime, categories: categoriesPayload(), today: u.todayISO() };
        },
        (h, mm, result) => renderReceiptReview(h, mm, result));
    });
    input.click();
  }

  // ----------------------------------------------------------------- VOICE NOTE
  function openVoiceFlow() {
    const ref = {};
    const m = u.openModal({ title: "🎤 Voice Note", onClose: () => { if (ref.cleanup) ref.cleanup(); } });
    renderRecorder(m.body, m, ref);
  }

  function renderRecorder(host, m, ref) {
    u.clear(host);
    let recording = false, startedAt = 0, timer = null, autoStop = null, done = false;

    // Dipanggil saat modal ditutup: hentikan timer & matikan mikrofon.
    ref.cleanup = function () {
      done = true; recording = false;
      clearInterval(timer); clearTimeout(autoStop);
      cleanupStream();
    };

    const btn = u.el("button", { class: "ai-rec-btn", type: "button", text: "🎤" });
    const time = u.el("div", { class: "ai-rec-time", text: "00:00" });
    const hint = u.el("div", { class: "ai-rec-hint", text: "Ketuk untuk mulai merekam, lalu ucapkan transaksi Anda." });

    function fmt(ms) {
      const s = Math.floor(ms / 1000);
      return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    }
    function tick() { time.textContent = fmt(Date.now() - startedAt); }

    async function begin() {
      if (done) return;
      try {
        await startRecording();
        recording = true; startedAt = Date.now();
        btn.classList.add("recording"); btn.textContent = "⏹";
        hint.textContent = "Sedang merekam… ketuk lagi untuk berhenti.";
        timer = setInterval(tick, 250);
        autoStop = setTimeout(() => { if (recording && !done) finish(); }, MAX_REC_MS);
      } catch (err) {
        let msg = (err && err.name === "NotAllowedError")
          ? "Izin mikrofon ditolak. Aktifkan izin mikrofon untuk memakai voice note."
          : ((KK.auth && KK.auth.friendly) ? KK.auth.friendly(err) : err.message);
        renderError(host, m, new Error(msg));
      }
    }

    async function finish() {
      if (!recording || done) return;
      recording = false;
      clearInterval(timer); clearTimeout(autoStop);
      btn.classList.remove("recording");
      try {
        const blob = await stopRecording();
        processAndReview(host, m, "Menyimak & menganalisis suara…",
          async () => {
            const wav = await blobToWavBase64(blob);
            return { mode: "voice", audio: wav.data, audioMime: wav.mime, categories: categoriesPayload(), today: u.todayISO() };
          },
          (h, mm, result) => renderDraftsReview(h, mm, result, { source: "voice" }));
      } catch (err) {
        renderError(host, m, err);
      }
    }

    btn.addEventListener("click", () => { recording ? finish() : begin(); });

    host.appendChild(u.el("div", { class: "ai-rec" }, [btn, time, hint]));
    host.appendChild(u.el("div", { class: "ai-foot" }, [
      u.el("button", { class: "btn btn-ghost", text: "Batal", onClick: () => m.close() }),
    ]));
  }

  // ----------------------------------------------- ALUR: proses lalu tinjau
  async function processAndReview(host, m, loadingText, makePayload, reviewFn) {
    renderLoading(host, loadingText);
    try {
      const payload = await makePayload();
      const data = await invokeParse(payload);
      reviewFn(host, m, data.result || {});
    } catch (err) {
      renderError(host, m, err);
    }
  }

  // ------------------------------------------------- KOMPONEN FORM BERSAMA
  function amountInput(value) {
    const inp = u.el("input", { class: "input", type: "text", inputmode: "numeric", placeholder: "0" });
    if (value) inp.value = u.formatNumber(Math.round(Number(value) || 0));
    u.attachThousandsInput(inp);
    return inp;
  }

  async function saveDrafts(drafts, m, btn) {
    if (!drafts.length) { u.toast("Tidak ada transaksi untuk disimpan.", "warn"); return; }
    u.setLoading(btn, true, "Menyimpan…");
    try {
      await KK.db.addTransactions(drafts);
      m.close();
      u.toast(drafts.length + " transaksi disimpan.", "success");
      KK.app.refreshAfterAdd();
    } catch (err) {
      u.setLoading(btn, false);
      u.toast((KK.auth && KK.auth.friendly) ? KK.auth.friendly(err) : err.message, "error", 6000);
    }
  }

  // ------------------------------------------------- TINJAU: STRUK (per item)
  function renderReceiptReview(host, m, result) {
    u.clear(host);
    result = result || {};
    const items = Array.isArray(result.items) ? result.items : [];
    const group = uuid();

    const storeInp = u.el("input", { class: "input", type: "text", value: result.store || "", placeholder: "Nama toko (opsional)" });
    const dateInp = u.el("input", { class: "input", type: "date", value: (result.date && /^\d{4}-\d{2}-\d{2}$/.test(result.date)) ? result.date : u.todayISO() });

    host.appendChild(u.el("div", { class: "ai-row2" }, [
      u.el("label", { class: "field" }, [u.el("span", { class: "field-label", text: "Toko" }), storeInp]),
      u.el("label", { class: "field" }, [u.el("span", { class: "field-label", text: "Tanggal" }), dateInp]),
    ]));

    const totalLine = u.el("span", { class: "ai-total-val" });
    host.appendChild(u.el("div", { class: "ai-section-head" }, [
      u.el("strong", { text: "Item belanja" }),
      u.el("span", { class: "count-badge ai-count" }),
    ]));

    const listEl = u.el("div", { class: "ai-items" });
    host.appendChild(listEl);

    const rows = [];
    function recompute() {
      let total = 0, n = 0;
      rows.forEach((r) => { if (!r.removed) { total += u.parseNumber(r.amount.value); n++; } });
      totalLine.textContent = u.formatRupiah(total);
      u.$(".ai-count", host).textContent = n + " item";
    }

    function addItemRow(item) {
      item = item || {};
      const nameInp = u.el("input", { class: "input", type: "text", value: item.name || "", placeholder: "Nama barang" });
      const amt = amountInput(item.amount);
      const cat = KK.app.makeCategoryPicker({ type: "expense", selectedId: findCategoryId(item.category, "expense") });
      amt.addEventListener("input", recompute);

      const sub = [];
      if (item.qty != null) sub.push("×" + item.qty);
      if (item.unit_price != null) sub.push("@ " + u.formatRupiah(item.unit_price));

      const rowObj = { name: nameInp, amount: amt, cat: cat, qty: item.qty, unit_price: item.unit_price, removed: false };
      const removeBtn = u.el("button", { class: "ai-item-remove", type: "button", title: "Hapus", html: "&times;" });
      const wrap = u.el("div", { class: "ai-item" }, [
        removeBtn,
        u.el("div", { class: "ai-item-grid" }, [
          nameInp,
          u.el("div", { class: "ai-row2" }, [amt, cat.row]),
          sub.length ? u.el("div", { class: "ai-item-sub", text: sub.join("  ") }) : null,
        ]),
      ]);
      removeBtn.addEventListener("click", () => { rowObj.removed = true; wrap.remove(); recompute(); });
      rows.push(rowObj);
      listEl.appendChild(wrap);
    }

    if (items.length) items.forEach(addItemRow);
    else {
      host.insertBefore(
        u.el("p", { class: "hint", text: "AI tidak menemukan item. Tambahkan manual di bawah." }),
        listEl
      );
      addItemRow({});
    }

    const addBtn = u.el("button", { class: "btn btn-ghost btn-sm ai-add-row", type: "button", text: "+ Tambah item" });
    addBtn.addEventListener("click", () => { addItemRow({}); recompute(); });
    host.appendChild(addBtn);

    host.appendChild(u.el("div", { class: "ai-total" }, [u.el("span", { text: "Total" }), totalLine]));

    const saveBtn = u.el("button", { class: "btn btn-primary", text: "Simpan" });
    saveBtn.addEventListener("click", () => {
      const store = storeInp.value.trim() || null;
      const date = dateInp.value || u.todayISO();
      const drafts = [];
      rows.forEach((r) => {
        if (r.removed) return;
        const amount = u.parseNumber(r.amount.value);
        const name = r.name.value.trim();
        if (amount <= 0) return;
        drafts.push({
          type: "expense", amount, category_id: r.cat.getValue(),
          note: name || (store ? "Belanja " + store : "Item belanja"),
          tx_date: date, source: "receipt", store,
          qty: r.qty != null ? r.qty : null,
          unit_price: r.unit_price != null ? r.unit_price : null,
          receipt_group: group,
        });
      });
      if (!drafts.length) return u.toast("Isi minimal satu item dengan jumlah > 0.", "warn");
      saveBtn.textContent = "Simpan " + drafts.length + " item";
      saveDrafts(drafts, m, saveBtn);
    });

    host.appendChild(u.el("div", { class: "ai-foot" }, [
      u.el("button", { class: "btn btn-ghost", text: "Batal", onClick: () => m.close() }),
      saveBtn,
    ]));

    recompute();
  }

  // ------------------------------------------- TINJAU: TEKS / VOICE (daftar tx)
  function renderDraftsReview(host, m, result, opts) {
    u.clear(host);
    result = result || {};
    opts = opts || {};
    const txs = Array.isArray(result.transactions) ? result.transactions : [];

    if (opts.source === "voice" && result.transcript) {
      host.appendChild(u.el("div", { class: "ai-transcript" }, [
        u.el("b", { text: "Terdengar: " }), document.createTextNode(result.transcript),
      ]));
    }

    host.appendChild(u.el("div", { class: "ai-section-head" }, [
      u.el("strong", { text: "Transaksi" }),
      u.el("span", { class: "count-badge ai-count" }),
    ]));

    const listEl = u.el("div", { class: "ai-items" });
    host.appendChild(listEl);

    const rows = [];
    function recount() {
      const keep = rows.filter((r) => !r.removed && !r.isTransfer());
      const ignored = rows.filter((r) => !r.removed && r.isTransfer());
      u.$(".ai-count", host).textContent = keep.length + " transaksi" + (ignored.length ? " · " + ignored.length + " transfer diabaikan" : "");
    }

    function addTxRow(tx) {
      tx = tx || {};
      let type = tx.tx_type === "income" ? "income" : "expense";
      let isTransfer = !!(opts.allowTransfer && tx.transfer);

      const typeSeg = u.el("div", { class: "segmented seg-type" });
      const amt = amountInput(tx.amount);
      const catPicker = KK.app.makeCategoryPicker({ type: type, selectedId: findCategoryId(tx.category, type) });

      const mkType = (val, label) => {
        const b = u.el("button", { type: "button", class: "seg" + (type === val ? " active" : ""), text: label });
        b.addEventListener("click", () => {
          if (type === val) return;
          type = val;
          u.$$(".seg", typeSeg).forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
          catPicker.setType(type);
        });
        return b;
      };
      typeSeg.appendChild(mkType("expense", "Pengeluaran"));
      typeSeg.appendChild(mkType("income", "Pemasukan"));
      typeSeg.appendChild(mkType("investment", "Investasi"));

      const dateInp = u.el("input", { class: "input", type: "date", value: (tx.date && /^\d{4}-\d{2}-\d{2}$/.test(tx.date)) ? tx.date : u.todayISO() });
      const noteInp = u.el("input", { class: "input", type: "text", value: tx.note || "", placeholder: "Catatan" });

      const rowObj = { getType: () => type, amount: amt, getCat: () => catPicker.getValue(), date: dateInp, note: noteInp, removed: false, isTransfer: () => isTransfer };
      const removeBtn = u.el("button", { class: "ai-item-remove", type: "button", title: "Hapus", html: "&times;" });

      const grid = [
        typeSeg,
        u.el("div", { class: "ai-row2" }, [amt, catPicker.row]),
        u.el("div", { class: "ai-row2" }, [dateInp, noteInp]),
      ];
      let transferCb = null;
      if (opts.allowTransfer) {
        transferCb = u.el("input", { type: "checkbox" });
        transferCb.checked = isTransfer;
        grid.push(u.el("label", { class: "ai-transfer" }, [
          transferCb, u.el("span", { text: "Transfer / top-up — abaikan (jangan dihitung)" }),
        ]));
      }

      const wrap = u.el("div", { class: "ai-item" }, [
        removeBtn,
        u.el("div", { class: "ai-item-grid" }, grid),
      ]);
      if (opts.allowTransfer) {
        wrap.classList.toggle("is-transfer", isTransfer);
        transferCb.addEventListener("change", () => {
          isTransfer = transferCb.checked;
          wrap.classList.toggle("is-transfer", isTransfer);
          recount();
        });
      }
      removeBtn.addEventListener("click", () => { rowObj.removed = true; wrap.remove(); recount(); });
      rows.push(rowObj);
      listEl.appendChild(wrap);
    }

    if (txs.length) txs.forEach(addTxRow);
    else {
      host.insertBefore(u.el("p", { class: "hint", text: "AI tidak menemukan transaksi. Tambahkan manual di bawah." }), listEl);
      addTxRow({});
    }

    const addBtn = u.el("button", { class: "btn btn-ghost btn-sm ai-add-row", type: "button", text: "+ Tambah transaksi" });
    addBtn.addEventListener("click", () => { addTxRow({}); recount(); });
    host.appendChild(addBtn);

    const saveBtn = u.el("button", { class: "btn btn-primary", text: "Simpan" });
    saveBtn.addEventListener("click", () => {
      const drafts = [];
      rows.forEach((r) => {
        if (r.removed || r.isTransfer()) return;
        const amount = u.parseNumber(r.amount.value);
        if (amount <= 0) return;
        drafts.push({
          type: r.getType(), amount, category_id: r.getCat() || null,
          note: r.note.value.trim() || null, tx_date: r.date.value || u.todayISO(),
          source: opts.source || "text",
        });
      });
      if (!drafts.length) return u.toast("Isi minimal satu transaksi dengan jumlah > 0.", "warn");
      saveDrafts(drafts, m, saveBtn);
    });

    host.appendChild(u.el("div", { class: "ai-foot" }, [
      u.el("button", { class: "btn btn-ghost", text: "Batal", onClick: () => m.close() }),
      saveBtn,
    ]));

    recount();
  }

  return { openAddSheet };
})();
