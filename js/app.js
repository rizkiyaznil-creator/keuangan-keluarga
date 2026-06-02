// Modul utama: bootstrap aplikasi, navigasi antar-halaman, kontrol bulan &
// lingkup (admin), serta UI transaksi, kategori, dan tampilan keluarga.
window.KK = window.KK || {};

KK.app = (function () {
  const u = KK.util;

  const state = {
    session: null, user: null, profile: null, family: null,
    members: [], memberMap: {}, categories: [],
    month: u.currentMonth(),
    scope: "self",          // admin: 'self' | 'family'
    memberFilter: "",       // admin + scope family: user_id tertentu atau "" (semua)
    view: "summary",
    recovering: false,
  };

  const isAdmin = () => state.profile && state.profile.role === "admin";

  // ----------------------------------------------------------------- BOOTSTRAP
  async function init() {
    if (!KK.isConfigured || !KK.sb) {
      u.$("#configWarning").classList.remove("hidden");
      u.$("#viewAuth").classList.add("hidden");
      return;
    }

    KK.auth.wire(enterApp);
    wireShell();

    KK.db.onAuthStateChange((event, session) => {
      state.session = session;
      if (event === "PASSWORD_RECOVERY") {
        state.recovering = true;
        showAuth();
        KK.auth.show("paneReset");
      } else if (event === "SIGNED_OUT") {
        resetState();
        showAuth();
        KK.auth.show("paneLogin");
      }
    });

    // Tautan setel ulang password membawa "type=recovery" pada hash URL.
    if (location.hash.indexOf("type=recovery") !== -1) {
      state.recovering = true;
      showAuth();
      KK.auth.show("paneReset");
      return;
    }

    const session = await KK.db.getSession();
    if (session) await enterApp();
    else { showAuth(); KK.auth.show("paneLogin"); }
  }

  function resetState() {
    state.profile = state.family = state.user = null;
    state.members = []; state.memberMap = {}; state.categories = [];
    state.scope = "self"; state.memberFilter = ""; state.recovering = false;
  }

  function showAuth() {
    u.$("#viewAuth").classList.remove("hidden");
    u.$("#appShell").classList.add("hidden");
  }
  function showApp() {
    u.$("#viewAuth").classList.add("hidden");
    u.$("#appShell").classList.remove("hidden");
  }

  async function enterApp() {
    try {
      state.recovering = false;
      state.user = await KK.db.getUser();
      if (!state.user) { showAuth(); return; }
      KK.db.setContext({ userId: state.user.id });

      state.profile = await KK.db.getProfile();
      if (!state.profile) {
        // Akun aktif tetapi belum punya keluarga -> lengkapi setup.
        showAuth();
        u.$$(".auth-pane").forEach((p) => p.classList.add("hidden"));
        const host = u.$("#paneComplete");
        host.classList.remove("hidden");
        KK.auth.renderCompleteSetup(host, () => location.reload());
        return;
      }
      KK.db.setContext({ familyId: state.profile.family_id });

      const [family, members, categories] = await Promise.all([
        KK.db.getFamily(), KK.db.getMembers(), KK.db.listCategories(),
      ]);
      state.family = family;
      state.members = members || [];
      state.memberMap = {};
      state.members.forEach((m) => { state.memberMap[m.id] = m.display_name; });
      state.categories = categories || [];

      buildShellForRole();
      showApp();
      showView("summary");
    } catch (err) {
      u.toast(KK.auth.friendly(err), "error", 6000);
    }
  }

  // -------------------------------------------------------------- SHELL / NAV
  function wireShell() {
    u.$("#accountBtn").addEventListener("click", openAccountModal);
    u.$$("[data-nav]").forEach((b) =>
      b.addEventListener("click", () => {
        const v = b.dataset.nav;
        if (v === "add") openTxModal(null);
        else showView(v);
      }));
  }

  function buildShellForRole() {
    u.$("#brandFamily").textContent = state.family ? state.family.name : "";
    u.$("#acctName").textContent = state.profile.display_name;
    const chip = u.$("#roleChip");
    chip.textContent = isAdmin() ? "Admin" : "Anggota";
    chip.className = "chip " + (isAdmin() ? "chip-admin" : "chip-member");
    // Menu "Keluarga" hanya untuk admin.
    u.$("[data-nav=family]").classList.toggle("hidden", !isAdmin());
  }

  function showView(name) {
    state.view = name;
    u.$$("[data-nav]").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
    renderActiveView();
  }

  function renderActiveView() {
    const main = u.$("#main");
    if (state.view === "summary") viewSummary(main);
    else if (state.view === "advice") viewAdvice(main);
    else if (state.view === "categories") viewCategories(main);
    else if (state.view === "family") viewFamily(main);
  }

  function loading(container, text) {
    u.clear(container);
    container.appendChild(u.el("div", { class: "loading", text: text || "Memuat…" }));
  }

  // --------------------------------------------------------- KONTROL (bulan/lingkup)
  function controlsBar(opts) {
    opts = opts || {};
    const bar = u.el("div", { class: "controls" });

    const monthInput = u.el("input", { class: "input month-input", type: "month", value: state.month });
    monthInput.addEventListener("change", () => { state.month = monthInput.value || u.currentMonth(); renderActiveView(); });
    bar.appendChild(u.el("label", { class: "control" }, [
      u.el("span", { class: "control-label", text: "Bulan" }), monthInput,
    ]));

    if (isAdmin()) {
      const seg = u.el("div", { class: "segmented" });
      ["self", "family"].forEach((s) => {
        const b = u.el("button", { class: "seg" + (state.scope === s ? " active" : ""), type: "button",
          text: s === "self" ? "Saya" : "Keluarga" });
        b.addEventListener("click", () => { state.scope = s; renderActiveView(); });
        seg.appendChild(b);
      });
      bar.appendChild(u.el("div", { class: "control" }, [
        u.el("span", { class: "control-label", text: "Lingkup" }), seg,
      ]));

      if (opts.withMemberFilter && state.scope === "family") {
        const sel = u.el("select", { class: "input" });
        sel.appendChild(u.el("option", { value: "", text: "Semua anggota" }));
        state.members.forEach((m) =>
          sel.appendChild(u.el("option", { value: m.id, text: m.display_name + (m.role === "admin" ? " (Admin)" : "") })));
        sel.value = state.memberFilter;
        sel.addEventListener("change", () => { state.memberFilter = sel.value; renderActiveView(); });
        bar.appendChild(u.el("label", { class: "control" }, [
          u.el("span", { class: "control-label", text: "Anggota" }), sel,
        ]));
      }
    }
    return bar;
  }

  function scopeUserId() {
    if (isAdmin()) {
      if (state.scope === "self") return state.user.id;
      if (state.memberFilter) return state.memberFilter;
    }
    return null;
  }
  function scopeForFetch() {
    const opts = { month: state.month };
    const uid = scopeUserId();
    if (uid) opts.userId = uid;
    return opts;
  }

  // ------------------------------------------------------------------ RINGKASAN
  async function viewSummary(main) {
    loading(main);
    try {
      const txs = await KK.db.listTransactions(scopeForFetch());
      u.clear(main);
      main.appendChild(pageTitle("Ringkasan", u.formatBulan(state.month)));
      main.appendChild(controlsBar({ withMemberFilter: true }));
      const body = u.el("div", {});
      main.appendChild(body);
      KK.summary.render(body, {
        transactions: txs,
        memberMap: state.memberMap,
        month: state.month,
        showWho: isAdmin() && state.scope === "family" && !state.memberFilter,
        onEditTx: (t) => { if (t.user_id === state.user.id) openTxModal(t); else viewOnlyTx(t); },
        onExportAll: async () => {
          try {
            const uid = scopeUserId();
            const all = await KK.db.listTransactions(uid ? { userId: uid } : {});
            KK.summary.exportTransactions(all, state.memberMap, "keuangan_semua.csv");
          } catch (err) { u.toast(KK.auth.friendly(err), "error"); }
        },
      });
    } catch (err) { errorBox(main, err); }
  }

  // ---------------------------------------------------------------------- SARAN
  async function viewAdvice(main) {
    loading(main);
    try {
      const cur = scopeForFetch();
      const prev = Object.assign({}, cur, { month: u.prevMonth(state.month) });
      const [thisTxs, lastTxs] = await Promise.all([
        KK.db.listTransactions(cur), KK.db.listTransactions(prev),
      ]);
      u.clear(main);
      main.appendChild(pageTitle("Saran Keuangan", u.formatBulan(state.month)));
      main.appendChild(controlsBar({ withMemberFilter: false }));
      const body = u.el("div", { class: "card" });
      main.appendChild(body);
      KK.advice.render(body, thisTxs, lastTxs);
    } catch (err) { errorBox(main, err); }
  }

  // ------------------------------------------------------------------- KATEGORI
  async function viewCategories(main) {
    loading(main);
    try {
      state.categories = await KK.db.listCategories();
      u.clear(main);
      main.appendChild(pageTitle("Kelola Kategori", "Kategori keluarga"));
      const addBtn = u.el("button", { class: "btn btn-primary", text: "+ Tambah Kategori" });
      addBtn.addEventListener("click", () => openCategoryModal(null));
      main.appendChild(u.el("div", { class: "actions-row" }, [addBtn]));

      ["expense", "income"].forEach((type) => {
        const list = state.categories.filter((c) => c.type === type);
        const sec = u.el("section", { class: "card" }, [
          u.el("h3", { class: "card-title", text: type === "expense" ? "Pengeluaran" : "Pemasukan" }),
        ]);
        if (!list.length) sec.appendChild(u.el("p", { class: "muted", text: "Belum ada kategori." }));
        list.forEach((c) => {
          sec.appendChild(u.el("div", { class: "cat-row" }, [
            u.el("span", { class: "cat-name" }, [
              c.name, c.is_default ? u.el("span", { class: "tag", text: "default" }) : null,
            ]),
            u.el("div", { class: "cat-actions" }, [
              iconBtn("Edit", () => openCategoryModal(c)),
              iconBtn("Hapus", () => removeCategory(c), "danger"),
            ]),
          ]));
        });
        main.appendChild(sec);
      });
    } catch (err) { errorBox(main, err); }
  }

  function openCategoryModal(cat) {
    const editing = !!cat;
    const form = u.el("form", { class: "form" });
    const name = u.el("input", { class: "input", type: "text", value: editing ? cat.name : "", placeholder: "Nama kategori" });
    form.appendChild(field("Nama kategori", name));

    const typeSel = u.el("select", { class: "input" }, [
      u.el("option", { value: "expense", text: "Pengeluaran" }),
      u.el("option", { value: "income", text: "Pemasukan" }),
    ]);
    typeSel.value = editing ? cat.type : "expense";
    form.appendChild(field("Jenis", typeSel));

    const m = u.openModal({
      title: editing ? "Edit Kategori" : "Tambah Kategori",
      body: form,
      actions: [
        { label: "Batal", class: "btn-ghost", onClick: (c) => c() },
        { label: "Simpan", class: "btn-primary", onClick: async (close) => {
            const nm = name.value.trim();
            if (!nm) return u.toast("Nama kategori wajib diisi.", "warn");
            try {
              if (editing) await KK.db.updateCategory(cat.id, { name: nm, type: typeSel.value });
              else await KK.db.addCategory({ name: nm, type: typeSel.value });
              close();
              u.toast("Kategori disimpan.", "success");
              state.categories = await KK.db.listCategories();
              if (state.view === "categories") renderActiveView();
            } catch (err) { u.toast(KK.auth.friendly(err), "error"); }
          } },
      ],
    });
    setTimeout(() => name.focus(), 50);
    return m;
  }

  async function removeCategory(cat) {
    const ok = await u.confirmDialog(
      "Hapus kategori \"" + cat.name + "\"? Transaksi lama yang memakai kategori ini akan menjadi \"Tanpa kategori\".",
      { okText: "Hapus", danger: true });
    if (!ok) return;
    try {
      await KK.db.deleteCategory(cat.id);
      u.toast("Kategori dihapus.", "success");
      state.categories = await KK.db.listCategories();
      if (state.view === "categories") renderActiveView();
    } catch (err) { u.toast(KK.auth.friendly(err), "error"); }
  }

  // -------------------------------------------------------------- TRANSAKSI (modal)
  function openTxModal(tx) {
    const editing = !!tx;
    const form = u.el("form", { class: "form" });

    let curType = editing ? tx.type : "expense";
    const typeSeg = u.el("div", { class: "segmented seg-type" });
    const mkType = (val, label) => {
      const b = u.el("button", { type: "button", class: "seg" + (curType === val ? " active" : ""), text: label });
      b.addEventListener("click", () => {
        curType = val;
        u.$$(".seg", typeSeg).forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        fillCategories();
      });
      return b;
    };
    typeSeg.appendChild(mkType("expense", "Pengeluaran"));
    typeSeg.appendChild(mkType("income", "Pemasukan"));
    form.appendChild(field("Jenis", typeSeg));

    const amount = u.el("input", { class: "input", type: "text", inputmode: "numeric", placeholder: "0" });
    if (editing) amount.value = u.formatNumber(tx.amount);
    u.attachThousandsInput(amount);
    form.appendChild(field("Jumlah (Rp)", amount));

    const catSel = u.el("select", { class: "input" });
    form.appendChild(field("Kategori", catSel));
    function fillCategories() {
      u.clear(catSel);
      catSel.appendChild(u.el("option", { value: "", text: "— Tanpa kategori —" }));
      state.categories.filter((c) => c.type === curType).forEach((c) =>
        catSel.appendChild(u.el("option", { value: c.id, text: c.name })));
      if (editing && tx.category_id) catSel.value = tx.category_id;
    }
    fillCategories();

    const date = u.el("input", { class: "input", type: "date", value: editing ? tx.tx_date : u.todayISO() });
    form.appendChild(field("Tanggal", date));

    const note = u.el("input", { class: "input", type: "text", value: editing ? (tx.note || "") : "", placeholder: "Catatan (opsional)" });
    form.appendChild(field("Catatan", note));

    const actions = [{ label: "Batal", class: "btn-ghost", onClick: (c) => c() }];
    if (editing) actions.push({ label: "Hapus", class: "btn-danger", onClick: async (close) => {
        const ok = await u.confirmDialog("Hapus transaksi ini?", { okText: "Hapus", danger: true });
        if (!ok) return;
        try { await KK.db.deleteTransaction(tx.id); close(); u.toast("Transaksi dihapus.", "success"); renderActiveView(); }
        catch (err) { u.toast(KK.auth.friendly(err), "error"); }
      } });
    actions.push({ label: editing ? "Simpan" : "Tambah", class: "btn-primary", onClick: async (close) => {
        const amt = u.parseNumber(amount.value);
        if (amt <= 0) return u.toast("Jumlah harus lebih dari 0.", "warn");
        if (!date.value) return u.toast("Tanggal wajib diisi.", "warn");
        const payload = { type: curType, amount: amt, category_id: catSel.value || null, tx_date: date.value, note: note.value.trim() };
        try {
          if (editing) await KK.db.updateTransaction(tx.id, payload);
          else await KK.db.addTransaction(payload);
          close();
          u.toast(editing ? "Transaksi diperbarui." : "Transaksi ditambahkan.", "success");
          if (state.view === "summary" || state.view === "advice" || state.view === "family") renderActiveView();
          else showView("summary");
        } catch (err) { u.toast(KK.auth.friendly(err), "error"); }
      } });

    u.openModal({ title: editing ? "Edit Transaksi" : "Tambah Transaksi", body: form, actions });
    setTimeout(() => amount.focus(), 50);
  }

  // Tampilan baca-saja untuk transaksi anggota lain (admin).
  function viewOnlyTx(t) {
    const who = state.memberMap[t.user_id] || "Anggota";
    u.openModal({
      title: "Detail Transaksi",
      body: u.el("div", { class: "form" }, [
        detailRow("Anggota", who),
        detailRow("Jenis", t.type === "income" ? "Pemasukan" : "Pengeluaran"),
        detailRow("Jumlah", u.formatRupiah(t.amount)),
        detailRow("Kategori", t.category_name || "Tanpa kategori"),
        detailRow("Tanggal", u.formatTanggal(t.tx_date)),
        detailRow("Catatan", t.note || "—"),
        u.el("p", { class: "muted small", text: "Sebagai admin Anda dapat melihat transaksi anggota, tetapi tidak dapat mengubahnya." }),
      ]),
      actions: [{ label: "Tutup", class: "btn-primary", onClick: (c) => c() }],
    });
  }

  // ------------------------------------------------------------------- KELUARGA
  async function viewFamily(main) {
    if (!isAdmin()) { showView("summary"); return; }
    loading(main);
    try {
      const txs = await KK.db.listTransactions({ month: state.month });
      u.clear(main);
      main.appendChild(pageTitle("Keluarga", u.formatBulan(state.month)));

      // Kode undangan
      const code = state.family ? state.family.invite_code : "—";
      const copyBtn = u.el("button", { class: "btn btn-ghost btn-sm", text: "Salin" });
      copyBtn.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(code); u.toast("Kode disalin.", "success"); }
        catch (e) { u.toast("Salin manual: " + code, "info"); }
      });
      main.appendChild(u.el("section", { class: "card invite-card" }, [
        u.el("h3", { class: "card-title", text: "Kode Undangan Keluarga" }),
        u.el("p", { class: "muted", text: "Bagikan kode ini agar anggota lain bisa bergabung saat mendaftar." }),
        u.el("div", { class: "invite-row" }, [u.el("span", { class: "invite-code", text: code }), copyBtn]),
      ]));

      // Bulan picker untuk tampilan keluarga
      const monthInput = u.el("input", { class: "input month-input", type: "month", value: state.month });
      monthInput.addEventListener("change", () => { state.month = monthInput.value || u.currentMonth(); renderActiveView(); });
      main.appendChild(u.el("div", { class: "controls" }, [
        u.el("label", { class: "control" }, [u.el("span", { class: "control-label", text: "Bulan" }), monthInput]),
      ]));

      // Total gabungan
      let income = 0, expense = 0;
      txs.forEach((t) => { if (t.type === "income") income += t.amount; else expense += t.amount; });
      main.appendChild(u.el("div", { class: "stats-grid" }, [
        statCard("Pemasukan Keluarga", income, "income"),
        statCard("Pengeluaran Keluarga", expense, "expense"),
        statCard("Saldo Keluarga", income - expense, income - expense >= 0 ? "balance-pos" : "balance-neg"),
      ]));

      // Rincian per anggota
      const perMember = {};
      state.members.forEach((m) => { perMember[m.id] = { name: m.display_name, role: m.role, income: 0, expense: 0 }; });
      txs.forEach((t) => {
        const row = perMember[t.user_id] || (perMember[t.user_id] = { name: state.memberMap[t.user_id] || "Anggota", role: "member", income: 0, expense: 0 });
        if (t.type === "income") row.income += t.amount; else row.expense += t.amount;
      });

      const memSec = u.el("section", { class: "card" }, [u.el("h3", { class: "card-title", text: "Rincian per Anggota" })]);
      const rows = Object.values(perMember).sort((a, b) => (b.income + b.expense) - (a.income + a.expense));
      if (!rows.length) memSec.appendChild(u.el("p", { class: "muted", text: "Belum ada anggota." }));
      rows.forEach((r) => {
        memSec.appendChild(u.el("div", { class: "member-row" }, [
          u.el("div", { class: "member-head" }, [
            u.el("span", { class: "member-name", text: r.name }),
            r.role === "admin" ? u.el("span", { class: "chip chip-admin", text: "Admin" }) : null,
          ]),
          u.el("div", { class: "member-stats" }, [
            u.el("span", { class: "pos", text: "+ " + u.formatRupiah(r.income) }),
            u.el("span", { class: "neg", text: "− " + u.formatRupiah(r.expense) }),
            u.el("span", { class: "member-bal " + (r.income - r.expense >= 0 ? "pos" : "neg"), text: u.formatRupiah(r.income - r.expense) }),
          ]),
        ]));
      });
      main.appendChild(memSec);
    } catch (err) { errorBox(main, err); }
  }

  // ----------------------------------------------------------------- AKUN MODAL
  function openAccountModal() {
    const form = u.el("form", { class: "form" });
    const name = u.el("input", { class: "input", type: "text", value: state.profile.display_name });
    form.appendChild(field("Nama tampilan", name));
    form.appendChild(detailRow("Email", (state.user && state.user.email) || "—"));
    form.appendChild(detailRow("Keluarga", state.family ? state.family.name : "—"));
    form.appendChild(detailRow("Peran", isAdmin() ? "Admin / Kepala Keluarga" : "Anggota"));

    u.openModal({
      title: "Akun Saya",
      body: form,
      actions: [
        { label: "Keluar", class: "btn-danger", onClick: async (close) => {
            close(); try { await KK.db.signOut(); } catch (e) {} } },
        { label: "Simpan Nama", class: "btn-primary", onClick: async (close) => {
            const nm = name.value.trim();
            if (!nm) return u.toast("Nama tidak boleh kosong.", "warn");
            try {
              await KK.db.updateDisplayName(nm);
              state.profile.display_name = nm; state.memberMap[state.user.id] = nm;
              u.$("#acctName").textContent = nm;
              close(); u.toast("Nama diperbarui.", "success");
              renderActiveView();
            } catch (err) { u.toast(KK.auth.friendly(err), "error"); }
          } },
      ],
    });
  }

  // --------------------------------------------------------------------- HELPERS
  function pageTitle(title, sub) {
    return u.el("div", { class: "page-head" }, [
      u.el("h2", { class: "page-title", text: title }),
      sub ? u.el("span", { class: "page-sub", text: sub }) : null,
    ]);
  }
  function field(label, input) {
    return u.el("label", { class: "field" }, [u.el("span", { class: "field-label", text: label }), input]);
  }
  function detailRow(label, value) {
    return u.el("div", { class: "detail-row" }, [
      u.el("span", { class: "detail-label", text: label }),
      u.el("span", { class: "detail-value", text: value }),
    ]);
  }
  function statCard(label, value, cls) {
    return u.el("div", { class: "stat-card " + (cls || "") }, [
      u.el("div", { class: "stat-label", text: label }),
      u.el("div", { class: "stat-value", text: u.formatRupiah(value) }),
    ]);
  }
  function iconBtn(label, onClick, kind) {
    const b = u.el("button", { class: "btn btn-sm " + (kind === "danger" ? "btn-ghost-danger" : "btn-ghost"), text: label });
    b.addEventListener("click", onClick);
    return b;
  }
  function errorBox(container, err) {
    u.clear(container);
    container.appendChild(u.el("div", { class: "error-box" }, [
      u.el("p", { text: "Gagal memuat data: " + (KK.auth.friendly(err)) }),
      u.el("p", { class: "small muted", text: "Pastikan skema SQL & RLS sudah dipasang di Supabase." }),
    ]));
  }

  return { init, state };
})();

document.addEventListener("DOMContentLoaded", () => KK.app.init());
