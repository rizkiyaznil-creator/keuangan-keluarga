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

    const recent = txs.slice(0, 12);
    const list = u2.el("div", { class: "tx-list" });
    if (!recent.length) {
      list.appendChild(u2.el("p", { class: "muted", text: "Belum ada transaksi pada periode ini." }));
    } else {
      recent.forEach((t) => {
        const who = data.showWho && data.memberMap ? (data.memberMap[t.user_id] || "—") : null;
        list.appendChild(txRow(t, { who, onClick: data.onEditTx }));
      });
    }
    container.appendChild(u2.el("section", { class: "card" }, [
      u2.el("h3", { class: "card-title", text: "Transaksi Terbaru" }),
      list,
    ]));

    return r;
  }

  return { compute, render, txRow };
})();
