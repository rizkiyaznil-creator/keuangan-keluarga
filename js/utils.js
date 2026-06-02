// Utilitas umum: format Rupiah & tanggal (lokal Indonesia), helper DOM,
// toast, modal, dan dialog konfirmasi.
window.KK = window.KK || {};

KK.util = (function () {
  const idNum = new Intl.NumberFormat("id-ID");
  const idDate = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });
  const idDateLong = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const idMonth = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" });

  // ---- Angka & mata uang ----
  function formatRupiah(n) { return "Rp " + idNum.format(Math.round(Number(n) || 0)); }
  function formatNumber(n) { return idNum.format(Number(n) || 0); }
  function parseNumber(str) { return Number(String(str == null ? "" : str).replace(/[^\d]/g, "")) || 0; }

  // ---- Tanggal ----
  function pad2(n) { return String(n).padStart(2, "0"); }
  function ymd(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function toDate(d) {
    if (d instanceof Date) return d;
    const s = String(d);
    return new Date(s.length === 10 ? s + "T00:00:00" : s);
  }
  function todayISO() { return ymd(new Date()); }
  function currentMonth() { const d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1); }
  function formatTanggal(d) { return idDate.format(toDate(d)); }
  function formatTanggalPanjang(d) { return idDateLong.format(toDate(d)); }
  function formatBulan(ym) {
    const [y, m] = String(ym).split("-").map(Number);
    return idMonth.format(new Date(y, m - 1, 1));
  }
  function monthRange(ym) {
    const [y, m] = String(ym).split("-").map(Number);
    return { start: ymd(new Date(y, m - 1, 1)), end: ymd(new Date(y, m, 0)) };
  }
  function prevMonth(ym) {
    const [y, m] = String(ym).split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }

  // ---- DOM ----
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "text") node.textContent = v;
        else if (k === "dataset") { for (const dk in v) node.dataset[dk] = v[dk]; }
        else if (k.length > 2 && k.slice(0, 2) === "on" && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else node.setAttribute(k, v === true ? "" : v);
      }
    }
    if (children != null) {
      (Array.isArray(children) ? children : [children]).forEach((c) => {
        if (c == null || c === false) return;
        node.appendChild(typeof c === "string" || typeof c === "number"
          ? document.createTextNode(String(c)) : c);
      });
    }
    return node;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  // Format input angka jadi ribuan saat diketik. Baca nilainya dengan parseNumber().
  function attachThousandsInput(input) {
    input.addEventListener("input", () => {
      const digits = input.value.replace(/[^\d]/g, "");
      input.value = digits ? idNum.format(Number(digits)) : "";
    });
  }

  function setLoading(btn, loading, loadingText) {
    if (!btn) return;
    if (loading) {
      if (btn.dataset._txt === undefined) btn.dataset._txt = btn.textContent;
      btn.disabled = true;
      btn.classList.add("is-loading");
      btn.textContent = loadingText || "Memproses…";
    } else {
      btn.disabled = false;
      btn.classList.remove("is-loading");
      if (btn.dataset._txt !== undefined) { btn.textContent = btn.dataset._txt; delete btn.dataset._txt; }
    }
  }

  // ---- Toast ----
  function toast(msg, type, ms) {
    type = type || "info";
    ms = ms || 3400;
    let wrap = $("#toastWrap");
    if (!wrap) { wrap = el("div", { id: "toastWrap", class: "toast-wrap" }); document.body.appendChild(wrap); }
    const t = el("div", { class: "toast toast-" + type, text: msg });
    wrap.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, ms);
  }

  // ---- Modal ----
  function openModal(opts) {
    opts = opts || {};
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal", role: "dialog", "aria-modal": "true" });

    const header = el("div", { class: "modal-header" }, [
      el("h3", { class: "modal-title", text: opts.title || "" }),
      el("button", { class: "modal-close", "aria-label": "Tutup", html: "&times;", onClick: () => close() }),
    ]);
    const content = el("div", { class: "modal-body" });
    if (typeof opts.body === "string") content.innerHTML = opts.body;
    else if (opts.body) content.appendChild(opts.body);

    modal.appendChild(header);
    modal.appendChild(content);

    if (opts.actions && opts.actions.length) {
      const foot = el("div", { class: "modal-foot" });
      opts.actions.forEach((a) => {
        foot.appendChild(el("button", {
          class: "btn " + (a.class || ""),
          text: a.label,
          onClick: () => { if (a.onClick) a.onClick(close); },
        }));
      });
      modal.appendChild(foot);
    }

    overlay.appendChild(modal);
    overlay.addEventListener("click", (e) => { if (e.target === overlay && opts.dismissable !== false) close(); });
    document.body.appendChild(overlay);
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => overlay.classList.add("show"));

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      overlay.classList.remove("show");
      setTimeout(() => { overlay.remove(); if (!$(".modal-overlay")) document.body.classList.remove("modal-open"); }, 200);
      if (opts.onClose) opts.onClose();
    }
    return { close, modal, overlay, body: content };
  }

  function confirmDialog(message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      let done = false;
      const finish = (v, closeFn) => { if (done) return; done = true; closeFn(); resolve(v); };
      openModal({
        title: opts.title || "Konfirmasi",
        body: el("p", { text: message }),
        actions: [
          { label: opts.cancelText || "Batal", class: "btn-ghost", onClick: (c) => finish(false, c) },
          { label: opts.okText || "Ya", class: opts.danger ? "btn-danger" : "btn-primary", onClick: (c) => finish(true, c) },
        ],
        onClose: () => { if (!done) { done = true; resolve(false); } },
      });
    });
  }

  return {
    formatRupiah, formatNumber, parseNumber,
    todayISO, currentMonth, formatTanggal, formatTanggalPanjang, formatBulan,
    monthRange, prevMonth, ymd,
    $, $$, el, escapeHtml, clear, attachThousandsInput, setLoading,
    toast, openModal, confirmDialog,
  };
})();
