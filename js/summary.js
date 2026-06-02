// Modul ringkasan: hitung total & rincian per kategori, render kartu ringkasan,
// grafik batang per kategori (CSS murni), dan daftar transaksi terbaru.
window.KK = window.KK || {};

KK.summary = (function () {
  const u = KK.util;

  // Palet warna untuk batang grafik kategori.
  const COLORS = [
    "#0d9488", "#f59e0b", "#3b82f6", "#ef4444", "#8b5cf6",
    "#10b981", "#ec4899", "#f97316", "#14b8a6", "#6366f1",
    "#84cc16", "#06b6d4",
  ];

  function compute(transactions) {
    let income = 0, expense = 0;
    const catMap = new Map();
    transactions.forEach((t) => {
      if (t.type === "income") income += t.amount;
      else {
        expense += t.amount;
        const key = t.category_name || "Tanpa kategori";
        catMap.set(key, (catMap.get(key) || 0) + t.amount);
      }
    });
    const byCategory = Array.from(catMap, ([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);
    const maxCat = byCategory.length ? byCategory[0].total : 0;
    byCategory.forEach((c) => {
      c.pctOfExpense = expense > 0 ? (c.total / expense) * 100 : 0;
      c.pctOfMax = maxCat > 0 ? (c.total / maxCat) * 100 : 0;
    });
    return { income, expense, balance: income - expense, byCategory };
  }

  function statCard(label, value, cls) {
    return u.el("div", { class: "stat-card " + (cls || "") }, [
      u.el("div", { class: "stat-label", text: label }),
      u.el("div", { class: "stat-value", text: u.formatRupiah(value) }),
    ]);
  }

  function renderChart(byCategory) {
    if (!byCategory.length) {
      return u.el("p", { class: "muted", text: "Belum ada pengeluaran pada periode ini." });
    }
    const wrap = u.el("div", { class: "chart" });
    byCategory.forEach((c, i) => {
      const color = COLORS[i % COLORS.length];
      wrap.appendChild(u.el("div", { class: "chart-row" }, [
        u.el("div", { class: "chart-head" }, [
          u.el("span", { class: "chart-name" }, [
            u.el("span", { class: "dot", style: "background:" + color }),
            c.name,
          ]),
          u.el("span", { class: "chart-val", text: u.formatRupiah(c.total) + " · " + Math.round(c.pctOfExpense) + "%" }),
        ]),
        u.el("div", { class: "bar-track" }, [
          u.el("div", { class: "bar-fill", style: "width:" + Math.max(2, c.pctOfMax) + "%;background:" + color }),
        ]),
      ]));
    });
    return wrap;
  }

  function txRow(t, opts) {
    opts = opts || {};
    const isIncome = t.type === "income";
    const left = u.el("div", { class: "tx-left" }, [
      u.el("div", { class: "tx-cat", text: t.category_name || (isIncome ? "Pemasukan" : "Tanpa kategori") }),
      u.el("div", { class: "tx-sub" }, [
        u.formatTanggal(t.tx_date),
        opts.who ? u.el("span", { class: "tx-who", text: " · " + opts.who }) : null,
        t.note ? u.el("span", { class: "tx-note", text: " · " + t.note }) : null,
      ]),
    ]);
    const right = u.el("div", { class: "tx-amt " + (isIncome ? "pos" : "neg"), text: (isIncome ? "+ " : "− ") + u.formatRupiah(t.amount) });
    const row = u.el("div", { class: "tx-row" }, [left, right]);
    if (opts.onClick) { row.classList.add("clickable"); row.addEventListener("click", () => opts.onClick(t)); }
    return row;
  }

  // container: elemen tujuan; data: { transactions, memberMap, showWho, onEditTx }
  function render(container, data) {
    const u2 = u;
    u2.clear(container);
    const txs = data.transactions || [];
    const r = compute(txs);

    const stats = u2.el("div", { class: "stats-grid" }, [
      statCard("Pemasukan", r.income, "income"),
      statCard("Pengeluaran", r.expense, "expense"),
      statCard("Saldo", r.balance, r.balance >= 0 ? "balance-pos" : "balance-neg"),
    ]);
    container.appendChild(stats);

    container.appendChild(u2.el("section", { class: "card" }, [
      u2.el("h3", { class: "card-title", text: "Pengeluaran per Kategori" }),
      renderChart(r.byCategory),
    ]));

    // Tabel semua transaksi + tombol ekspor
    const section = u2.el("section", { class: "card" });
    section.appendChild(u2.el("div", { class: "card-head" }, [
      u2.el("h3", { class: "card-title", text: "Semua Transaksi" }),
      u2.el("span", { class: "count-badge", text: txs.length + " transaksi" }),
    ]));

    const exportRow = u2.el("div", { class: "export-row" });
    if (txs.length) {
      exportRow.appendChild(u2.el("button", {
        class: "btn btn-ghost btn-sm",
        text: "⬇️ Ekspor bulan ini",
        onClick: () => exportTransactions(txs, data.memberMap, "keuangan_" + (data.month || "data") + ".csv"),
      }));
    }
    if (data.onExportAll) {
      exportRow.appendChild(u2.el("button", {
        class: "btn btn-ghost btn-sm",
        text: "⬇️ Ekspor semua bulan",
        onClick: () => data.onExportAll(),
      }));
    }
    if (exportRow.childNodes.length) section.appendChild(exportRow);

    if (!txs.length) {
      section.appendChild(u2.el("p", { class: "muted", text: "Belum ada transaksi pada periode ini." }));
    } else {
      section.appendChild(renderTable(txs, data));
    }
    container.appendChild(section);

    return r;
  }

  function renderTable(txs, data) {
    const showWho = !!data.showWho;
    const memberMap = data.memberMap || {};
    const thead = u.el("thead", {}, [
      u.el("tr", {}, [
        u.el("th", { text: "Tgl" }),
        u.el("th", { text: "Uraian" }),
        showWho ? u.el("th", { text: "Anggota" }) : null,
        u.el("th", { class: "ta-right", text: "Jumlah" }),
      ]),
    ]);
    const tbody = u.el("tbody");
    txs.forEach((t) => {
      const isIncome = t.type === "income";
      const tr = u.el("tr", { class: "tx-trow" }, [
        u.el("td", { class: "td-date", text: u.formatTanggal(t.tx_date) }),
        u.el("td", {}, [
          u.el("div", { class: "td-cat", text: t.category_name || (isIncome ? "Pemasukan" : "Tanpa kategori") }),
          t.note ? u.el("div", { class: "td-note", text: t.note }) : null,
        ]),
        showWho ? u.el("td", { class: "td-who", text: memberMap[t.user_id] || "—" }) : null,
        u.el("td", { class: "td-amt ta-right " + (isIncome ? "pos" : "neg"),
          text: (isIncome ? "+ " : "− ") + u.formatRupiah(t.amount) }),
      ]);
      if (data.onEditTx) {
        tr.classList.add("clickable");
        tr.addEventListener("click", () => data.onEditTx(t));
      }
      tbody.appendChild(tr);
    });
    return u.el("div", { class: "table-wrap" }, [u.el("table", { class: "tx-table" }, [thead, tbody])]);
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

  return { compute, render, txRow, renderTable, exportTransactions };
})();
