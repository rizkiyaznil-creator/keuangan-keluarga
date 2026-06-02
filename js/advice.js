// Mesin saran keuangan sehat berbasis data transaksi.
// Aturan: rasio tabungan (sehat >= 20%), rasio pengeluaran/pemasukan
// (waspada > 90% atau defisit), kategori pengeluaran terbesar, dan
// perbandingan dengan bulan lalu + pesan motivasi.
window.KK = window.KK || {};

KK.advice = (function () {
  const u = KK.util;

  function totals(txs) {
    let income = 0, expense = 0, savings = 0;
    const catMap = new Map();
    txs.forEach((t) => {
      if (t.type === "income") income += t.amount;
      else {
        expense += t.amount;
        const name = t.category_name || "Tanpa kategori";
        catMap.set(name, (catMap.get(name) || 0) + t.amount);
        if (name.trim().toLowerCase() === "tabungan") savings += t.amount;
      }
    });
    let topCat = null;
    catMap.forEach((total, name) => { if (!topCat || total > topCat.total) topCat = { name, total }; });
    return { income, expense, savings, balance: income - expense, topCat };
  }

  function pct(n) { return Math.round(n) + "%"; }

  // thisTxs / lastTxs: array transaksi (sudah disaring sesuai lingkup & bulan).
  function compute(thisTxs, lastTxs) {
    const t = totals(thisTxs || []);
    const p = totals(lastTxs || []);
    const items = [];

    if (!thisTxs || !thisTxs.length) {
      items.push({ level: "info", icon: "📝", title: "Belum ada data",
        text: "Catat pemasukan & pengeluaran bulan ini untuk mendapatkan saran keuangan." });
      return { items, totals: t };
    }

    // 1) Rasio tabungan
    const savingRatio = t.income > 0 ? (t.savings / t.income) * 100 : 0;
    if (t.income <= 0) {
      items.push({ level: "info", icon: "💰", title: "Rasio tabungan",
        text: "Belum ada pemasukan tercatat bulan ini, jadi rasio tabungan belum bisa dihitung." });
    } else if (savingRatio >= 20) {
      items.push({ level: "good", icon: "🌟", title: "Tabungan sehat (" + pct(savingRatio) + ")",
        text: "Kerja bagus! Anda menabung " + u.formatRupiah(t.savings) + " atau " + pct(savingRatio) +
              " dari pemasukan — sudah memenuhi target sehat minimal 20%." });
    } else {
      items.push({ level: "warn", icon: "💡", title: "Tabungan masih " + pct(savingRatio),
        text: "Idealnya tabungan minimal 20% dari pemasukan. Coba sisihkan sekitar " +
              u.formatRupiah(Math.max(0, t.income * 0.2 - t.savings)) + " lagi bulan ini ke kategori \"Tabungan\"." });
    }

    // 2) Rasio pengeluaran / pemasukan & defisit
    if (t.income > 0) {
      const expRatio = (t.expense / t.income) * 100;
      if (t.balance < 0) {
        items.push({ level: "danger", icon: "🚨", title: "Pengeluaran melebihi pemasukan",
          text: "Defisit " + u.formatRupiah(Math.abs(t.balance)) + " bulan ini. Tinjau pengeluaran terbesar dan tunda yang tidak mendesak." });
      } else if (expRatio > 90) {
        items.push({ level: "warn", icon: "⚠️", title: "Pengeluaran tinggi (" + pct(expRatio) + ")",
          text: "Pengeluaran sudah " + pct(expRatio) + " dari pemasukan. Sisa ruang aman tipis — waspadai pengeluaran tambahan." });
      } else {
        items.push({ level: "good", icon: "✅", title: "Pengeluaran terkendali (" + pct(expRatio) + ")",
          text: "Pengeluaran " + pct(expRatio) + " dari pemasukan, masih dalam batas sehat. Pertahankan!" });
      }
    } else if (t.expense > 0) {
      items.push({ level: "danger", icon: "🚨", title: "Pengeluaran tanpa pemasukan",
        text: "Ada pengeluaran " + u.formatRupiah(t.expense) + " namun belum ada pemasukan tercatat bulan ini." });
    }

    // 3) Kategori pengeluaran terbesar
    if (t.topCat && t.expense > 0) {
      const share = (t.topCat.total / t.expense) * 100;
      items.push({ level: "info", icon: "📊", title: "Pengeluaran terbesar: " + t.topCat.name,
        text: t.topCat.name + " menyerap " + u.formatRupiah(t.topCat.total) + " (" + pct(share) +
              " dari total pengeluaran). " + (share >= 40 ? "Cukup dominan — pertimbangkan menekan pos ini." : "Pantau agar tetap proporsional.") });
    }

    // 4) Perbandingan dengan bulan lalu
    if (lastTxs && lastTxs.length) {
      if (p.expense > 0) {
        const diff = t.expense - p.expense;
        const change = (diff / p.expense) * 100;
        if (diff > 0) {
          items.push({ level: "warn", icon: "📈", title: "Pengeluaran naik " + pct(change),
            text: "Naik " + u.formatRupiah(diff) + " dibanding bulan lalu (" + u.formatRupiah(p.expense) +
                  " → " + u.formatRupiah(t.expense) + "). Cek apakah ada pos yang membengkak." });
        } else if (diff < 0) {
          items.push({ level: "good", icon: "📉", title: "Pengeluaran turun " + pct(Math.abs(change)),
            text: "Hemat " + u.formatRupiah(Math.abs(diff)) + " dibanding bulan lalu. Mantap, terus jaga kebiasaan ini!" });
        } else {
          items.push({ level: "info", icon: "➖", title: "Pengeluaran stabil",
            text: "Total pengeluaran sama dengan bulan lalu (" + u.formatRupiah(t.expense) + ")." });
        }
      }
    }

    // 5) Pesan motivasi penutup sesuai kondisi
    if (t.balance < 0) {
      items.push({ level: "info", icon: "🤝", title: "Tetap semangat",
        text: "Bulan ini berat, tapi bisa diperbaiki. Susun anggaran sederhana untuk bulan depan dan utamakan kebutuhan pokok." });
    } else if (savingRatio >= 20 && (t.income > 0 && (t.expense / t.income) * 100 <= 90)) {
      items.push({ level: "good", icon: "🎯", title: "Pertahankan momentum",
        text: "Kondisi keuangan Anda sehat. Pertimbangkan menaikkan target tabungan atau mulai dana darurat 3–6× pengeluaran bulanan." });
    } else {
      items.push({ level: "info", icon: "🌱", title: "Langkah kecil konsisten",
        text: "Sisihkan tabungan di awal (bukan dari sisa), dan catat setiap pengeluaran agar pola belanja makin terlihat." });
    }

    return { items, totals: t };
  }

  function render(container, thisTxs, lastTxs) {
    u.clear(container);
    const { items } = compute(thisTxs, lastTxs);
    const list = u.el("div", { class: "advice-list" });
    items.forEach((it) => {
      list.appendChild(u.el("div", { class: "advice-item advice-" + it.level }, [
        u.el("div", { class: "advice-icon", text: it.icon }),
        u.el("div", { class: "advice-body" }, [
          u.el("div", { class: "advice-title", text: it.title }),
          u.el("div", { class: "advice-text", text: it.text }),
        ]),
      ]));
    });
    container.appendChild(list);
  }

  return { compute, render };
})();
