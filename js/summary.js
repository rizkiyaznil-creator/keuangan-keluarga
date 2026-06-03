// Modul ringkasan: hitung total & rincian per kategori; render kartu ringkasan,
// grafik per kategori (batang ATAU pai, untuk pemasukan ATAU pengeluaran),
// dan daftar transaksi (per kategori ATAU per tanggal) + ekspor CSV.
window.KK = window.KK || {};

KK.summary = (function () {
  const u = KK.util;

  const COLORS = [
    "#0d9488", "#f59e0b", "#3b82f6", "#ef4444", "#8b5cf6",
    "#10b981", "#ec4899", "#f97316", "#14b8a6", "#6366f1",
    "#84cc16", "#06b6d4", "#e11d48", "#a855f7", "#0ea5e9",
  ];
  const colorAt = (i) => COLORS[i % COLORS.length];

  function buildCats(map, total) {
    const arr = Array.from(map, ([name, sum]) => ({ name, total: sum }));
    arr.sort((a, b) => b.total - a.total);
    const max = arr.length ? arr[0].total : 0;
    arr.forEach((c) => {
      c.pctOfTotal = total > 0 ? (c.total / total) * 100 : 0;
      c.pctOfMax = max > 0 ? (c.total / max) * 100 : 0;
    });
    return arr;
  }

  function compute(transactions) {
    let income = 0, expense = 0;
    const inc = new Map(), exp = new Map();
    transactions.forEach((t) => {
      const amt = Number(t.amount) || 0;
      const key = t.category_name || "Tanpa kategori";
      if (t.type === "income") { income += amt; inc.set(key, (inc.get(key) || 0) + amt); }
      else { expense += amt; exp.set(key, (exp.get(key) || 0) + amt); }
    });
    const expenseByCategory = buildCats(exp, expense);
    const incomeByCategory = buildCats(inc, income);
    return {
      income, expense, balance: income - expense,
      expenseByCategory, incomeByCategory,
      byCategory: expenseByCategory, // kompatibilitas lama
    };
  }

  // ---------- elemen kecil ----------
  function statCard(label, value, cls) {
    return u.el("div", { class: "stat-card " + (cls || "") }, [
      u.el("div", { class: "stat-label", text: label }),
      u.el("div", { class: "stat-value", text: u.formatRupiah(value) }),
    ]);
  }

  function segmented(opts, current, onChange) {
    const wrap = u.el("div", { class: "segmented" });
    opts.forEach((o) => {
      const b = u.el("button", { type: "button", class: "seg" + (o.value === current ? " active" : ""), text: o.label });
      b.addEventListener("click", () => { if (o.value !== current) onChange(o.value); });
      wrap.appendChild(b);
    });
    return wrap;
  }

  // ---------- grafik ----------
  function renderBars(items) {
    const wrap = u.el("div", { class: "chart" });
    items.forEach((c, i) => {
      const color = colorAt(i);
      wrap.appendChild(u.el("div", { class: "chart-row" }, [
        u.el("div", { class: "chart-head" }, [
          u.el("span", { class: "chart-name" }, [u.el("span", { class: "dot", style: "background:" + color }), c.name]),
          u.el("span", { class: "chart-val", text: u.formatRupiah(c.total) + " · " + Math.round(c.pctOfTotal) + "%" }),
        ]),
        u.el("div", { class: "bar-track" }, [
          u.el("div", { class: "bar-fill", style: "width:" + Math.max(2, c.pctOfMax) + "%;background:" + color }),
        ]),
      ]));
    });
    return wrap;
  }

  function renderPie(items) {
    let cumulative = 0, segs = "";
    items.forEach((it, i) => {
      const val = it.pctOfTotal;
      if (val <= 0) return;
      segs += '<circle cx="21" cy="21" r="15.91549431" fill="transparent" stroke="' + colorAt(i) +
        '" stroke-width="6" stroke-dasharray="' + val.toFixed(3) + " " + (100 - val).toFixed(3) +
        '" stroke-dashoffset="' + (25 - cumulative).toFixed(3) + '"></circle>';
      cumulative += val;
    });
    const svg = '<svg viewBox="0 0 42 42" class="pie-svg" role="img" aria-label="Diagram lingkaran per kategori">' +
      '<circle cx="21" cy="21" r="15.91549431" fill="transparent" stroke="#eef2f7" stroke-width="6"></circle>' +
      segs + "</svg>";

    const legend = u.el("div", { class: "pie-legend" });
    items.forEach((it, i) => {
      legend.appendChild(u.el("div", { class: "legend-row" }, [
        u.el("span", { class: "dot", style: "background:" + colorAt(i) }),
        u.el("span", { class: "legend-name", text: it.name }),
        u.el("span", { class: "legend-val", text: u.formatRupiah(it.total) + " · " + Math.round(it.pctOfTotal) + "%" }),
      ]));
    });
    return u.el("div", { class: "pie-wrap" }, [u.el("div", { class: "pie-chart", html: svg }), legend]);
  }

  function renderCategoryChart(container, items, style) {
    u.clear(container);
    if (!items.length) { container.appendChild(u.el("p", { class: "muted", text: "Belum ada data pada periode ini." })); return; }
    container.appendChild(style === "pie" ? renderPie(items) : renderBars(items));
  }

  // ---------- tabel transaksi ----------
  function flatTable(txs, data) {
    const showWho = !!data.showWho;
    const memberMap = data.memberMap || {};
    const thead = u.el("thead", {}, [u.el("tr", {}, [
      u.el("th", { text: "Tgl" }), u.el("th", { text: "Uraian" }),
      showWho ? u.el("th", { text: "Anggota" }) : null,
      u.el("th", { class: "ta-right", text: "Jumlah" }),
    ])]);
    const tbody = u.el("tbody");
    txs.forEach((t) => {
      const isIncome = t.type === "income";
      const tr = u.el("tr", { class: "tx-trow" }, [
        u.el("td", { class: "td-date" }, [u.formatTanggal(t.tx_date), (data.isLocked && data.isLocked(t)) ? u.el("span", { class: "lock-badge", title: "Final", text: " 🔒" }) : null]),
        u.el("td", {}, [
          u.el("div", { class: "td-cat", text: t.category_name || (isIncome ? "Pemasukan" : "Tanpa kategori") }),
          t.note ? u.el("div", { class: "td-note", text: t.note }) : null,
        ]),
        showWho ? u.el("td", { class: "td-who", text: memberMap[t.user_id] || "—" }) : null,
        u.el("td", { class: "td-amt ta-right " + (isIncome ? "pos" : "neg"), text: (isIncome ? "+ " : "− ") + u.formatRupiah(t.amount) }),
      ]);
      if (data.onEditTx) { tr.classList.add("clickable"); tr.addEventListener("click", () => data.onEditTx(t)); }
      tbody.appendChild(tr);
    });
    return u.el("div", { class: "table-wrap" }, [u.el("table", { class: "tx-table" }, [thead, tbody])]);
  }

  function groupByCategory(txs) {
    const map = new Map();
    txs.forEach((t) => {
      const name = t.category_name || "Tanpa kategori";
      const key = name + "|" + t.type; // pisahkan kategori bernama sama beda jenis
      let g = map.get(key);
      if (!g) { g = { name, type: t.type, total: 0, items: [] }; map.set(key, g); }
      g.total += Number(t.amount) || 0;
      g.items.push(t);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }

  function categoryTables(txs, data) {
    const showWho = !!data.showWho;
    const memberMap = data.memberMap || {};
    const container = u.el("div", { class: "cat-groups" });
    groupByCategory(txs).forEach((g) => {
      const isIncome = g.type === "income";
      const head = u.el("div", { class: "cat-group-head" }, [
        u.el("span", { class: "cat-group-name" }, [g.name, u.el("span", { class: "cat-group-count", text: " (" + g.items.length + ")" })]),
        u.el("span", { class: "cat-group-total " + (isIncome ? "pos" : "neg"), text: (isIncome ? "+ " : "− ") + u.formatRupiah(g.total) }),
      ]);
      const thead = u.el("thead", {}, [u.el("tr", {}, [
        u.el("th", { text: "Tgl" }), u.el("th", { text: "Catatan" }),
        showWho ? u.el("th", { text: "Anggota" }) : null,
        u.el("th", { class: "ta-right", text: "Jumlah" }),
      ])]);
      const tbody = u.el("tbody");
      g.items.forEach((t) => {
        const tr = u.el("tr", { class: "tx-trow" }, [
          u.el("td", { class: "td-date" }, [u.formatTanggal(t.tx_date), (data.isLocked && data.isLocked(t)) ? u.el("span", { class: "lock-badge", title: "Final", text: " 🔒" }) : null]),
          u.el("td", { class: "td-cat", text: t.note || "—" }),
          showWho ? u.el("td", { class: "td-who", text: memberMap[t.user_id] || "—" }) : null,
          u.el("td", { class: "td-amt ta-right " + (isIncome ? "pos" : "neg"), text: (isIncome ? "+ " : "− ") + u.formatRupiah(t.amount) }),
        ]);
        if (data.onEditTx) { tr.classList.add("clickable"); tr.addEventListener("click", () => data.onEditTx(t)); }
        tbody.appendChild(tr);
      });
      container.appendChild(u.el("div", { class: "cat-group" }, [head, u.el("div", { class: "table-wrap" }, [u.el("table", { class: "tx-table" }, [thead, tbody])])]));
    });
    return container;
  }

  function exportTransactions(txs, memberMap, filename) {
    if (!txs || !txs.length) { u.toast("Tidak ada transaksi untuk diekspor.", "warn"); return; }
    const headers = ["Tanggal", "Jenis", "Kategori", "Anggota", "Catatan", "Jumlah"];
    const rows = txs.map((t) => [
      t.tx_date,
      t.type === "income" ? "Pemasukan" : "Pengeluaran",
      t.category_name || "",
      (memberMap && memberMap[t.user_id]) || "",
      t.note || "",
      Math.round(Number(t.amount) || 0),
    ]);
    u.downloadCSV(filename || "keuangan.csv", headers, rows);
    u.toast(rows.length + " transaksi diekspor ke CSV.", "success");
  }

  // ---------- render utama ----------
  function render(container, data) {
    u.clear(container);
    const txs = data.transactions || [];
    const r = compute(txs);

    // Statistik
    container.appendChild(u.el("div", { class: "stats-grid" }, [
      statCard("Pemasukan", r.income, "income"),
      statCard("Pengeluaran", r.expense, "expense"),
      statCard("Saldo", r.balance, r.balance >= 0 ? "balance-pos" : "balance-neg"),
    ]));

    // Kartu grafik (default: Pengeluaran + Pai)
    let chartType = "expense", chartStyle = "pie";
    const chartCard = u.el("section", { class: "card" });
    container.appendChild(chartCard);
    function renderChartCard() {
      u.clear(chartCard);
      const items = chartType === "expense" ? r.expenseByCategory : r.incomeByCategory;
      const total = chartType === "expense" ? r.expense : r.income;
      chartCard.appendChild(u.el("div", { class: "card-head" }, [
        u.el("h3", { class: "card-title", text: (chartType === "expense" ? "Pengeluaran" : "Pemasukan") + " per Kategori" }),
        u.el("span", { class: "count-badge", text: u.formatRupiah(total) }),
      ]));
      chartCard.appendChild(u.el("div", { class: "chart-controls" }, [
        segmented([{ value: "expense", label: "Pengeluaran" }, { value: "income", label: "Pemasukan" }], chartType, (v) => { chartType = v; renderChartCard(); }),
        segmented([{ value: "bar", label: "Batang" }, { value: "pie", label: "Pai" }], chartStyle, (v) => { chartStyle = v; renderChartCard(); }),
      ]));
      const body = u.el("div", {});
      chartCard.appendChild(body);
      renderCategoryChart(body, items, chartStyle);
    }
    renderChartCard();

    // Kartu transaksi (default: Per Kategori)
    let groupBy = "category";
    const txCard = u.el("section", { class: "card" });
    container.appendChild(txCard);
    function renderTxCard() {
      u.clear(txCard);
      txCard.appendChild(u.el("div", { class: "card-head" }, [
        u.el("h3", { class: "card-title", text: "Semua Transaksi" }),
        u.el("span", { class: "count-badge", text: txs.length + " transaksi" }),
      ]));

      const exportRow = u.el("div", { class: "export-row" });
      if (txs.length) {
        exportRow.appendChild(u.el("button", { class: "btn btn-ghost btn-sm", text: "⬇️ Ekspor bulan ini",
          onClick: () => exportTransactions(txs, data.memberMap, "keuangan_" + (data.month || "data") + ".csv") }));
      }
      if (data.onExportAll) {
        exportRow.appendChild(u.el("button", { class: "btn btn-ghost btn-sm", text: "⬇️ Ekspor semua bulan",
          onClick: () => data.onExportAll() }));
      }
      if (exportRow.childNodes.length) txCard.appendChild(exportRow);

      txCard.appendChild(u.el("div", { class: "chart-controls" }, [
        segmented([{ value: "category", label: "Per Kategori" }, { value: "date", label: "Per Tanggal" }], groupBy, (v) => { groupBy = v; renderTxCard(); }),
      ]));

      const body = u.el("div", {});
      txCard.appendChild(body);
      if (!txs.length) body.appendChild(u.el("p", { class: "muted", text: "Belum ada transaksi pada periode ini." }));
      else body.appendChild(groupBy === "category" ? categoryTables(txs, data) : flatTable(txs, data));
    }
    renderTxCard();

    return r;
  }

  return {
    compute, render, exportTransactions,
    renderBars, renderPie, flatTable, categoryTables, groupByCategory,
    renderTable: flatTable, // alias kompatibilitas
  };
})();
