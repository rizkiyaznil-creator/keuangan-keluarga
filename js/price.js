// Analisis Harga & Toko (Fase 2): mengubah data per-barang dari Scan struk
// menjadi perbandingan harga antar-toko. Dipakai oleh tab "Analisis -> Harga".
// Bergantung pada: KK.util, KK.db.priceRows, KK.auth.friendly.
window.KK = window.KK || {};

KK.price = (function () {
  const u = KK.util;

  // Samakan nama barang yang berantakan dari struk: huruf kecil + rapikan spasi.
  function normName(s) {
    return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
  }

  // Kelompokkan baris harga per barang (nama dinormalisasi), lalu per toko.
  function aggregate(rows) {
    const map = new Map();
    rows.forEach((r) => {
      const price = Number(r.unit_price);
      if (!(price > 0)) return;
      const key = normName(r.item);
      if (!key) return;
      const date = r.tx_date || "";
      let it = map.get(key);
      if (!it) { it = { key, name: r.item, lastDate: date, n: 0, stores: new Map(), history: [] }; map.set(key, it); }
      if (date >= it.lastDate) { it.lastDate = date; it.name = r.item; } // nama dari pembelian terbaru
      const store = (r.store || "—").toString().trim() || "—";
      let st = it.stores.get(store);
      if (!st) { st = { store, min: price, last: price, lastDate: date, n: 0 }; it.stores.set(store, st); }
      if (price < st.min) st.min = price;
      if (date >= st.lastDate) { st.lastDate = date; st.last = price; }
      st.n++; it.n++;
      it.history.push({ store, price, date });
    });

    const list = [];
    map.forEach((it) => {
      let minP = Infinity, minStore = null, lastP = null, lastStore = null, lastD = "";
      it.stores.forEach((st) => {
        if (st.min < minP) { minP = st.min; minStore = st.store; }
        if (st.lastDate >= lastD) { lastD = st.lastDate; lastP = st.last; lastStore = st.store; }
      });
      it.minPrice = minP; it.minStore = minStore;
      it.lastPrice = lastP; it.lastStore = lastStore;
      it.storeCount = it.stores.size;
      it.history.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      list.push(it);
    });
    list.sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : b.n - a.n));
    return list;
  }

  function itemRow(it) {
    const row = u.el("button", { class: "price-item", type: "button" }, [
      u.el("div", { class: "price-item-main" }, [
        u.el("span", { class: "price-item-name", text: it.name }),
        u.el("span", { class: "price-item-sub muted", text:
          (it.storeCount > 1 ? it.storeCount + " toko · " : "") + it.n + "× beli" }),
      ]),
      u.el("div", { class: "price-item-right" }, [
        u.el("span", { class: "price-item-price", text: u.formatRupiah(it.minPrice) }),
        u.el("span", { class: "price-item-store muted", text: "termurah · " + it.minStore }),
      ]),
    ]);
    row.addEventListener("click", () => openDetail(it));
    return row;
  }

  function sumCell(label, value, sub, cls) {
    return u.el("div", { class: "price-sum-cell " + (cls || "") }, [
      u.el("div", { class: "price-sum-label muted", text: label }),
      u.el("div", { class: "price-sum-value", text: value }),
      u.el("div", { class: "price-sum-sub muted", text: sub }),
    ]);
  }

  function openDetail(it) {
    const body = u.el("div", { class: "price-detail" });

    body.appendChild(u.el("div", { class: "price-sum" }, [
      sumCell("Termurah", u.formatRupiah(it.minPrice), it.minStore, "is-min"),
      sumCell("Terakhir", u.formatRupiah(it.lastPrice), it.lastStore + " · " + u.formatTanggal(it.lastDate)),
    ]));

    body.appendChild(u.el("h4", { class: "price-h", text: "Harga per toko" }));
    const stores = Array.from(it.stores.values()).sort((a, b) => a.min - b.min);
    stores.forEach((st, i) => {
      body.appendChild(u.el("div", { class: "price-store" + (i === 0 && stores.length > 1 ? " is-cheapest" : "") }, [
        u.el("span", { class: "price-store-name", text: st.store }),
        u.el("div", { class: "price-store-vals" }, [
          u.el("span", { class: "pos", text: u.formatRupiah(st.min) }),
          u.el("span", { class: "muted small", text: "terakhir " + u.formatRupiah(st.last) + " · " + u.formatTanggal(st.lastDate) }),
        ]),
      ]));
    });

    if (it.history.length > 1) {
      body.appendChild(u.el("h4", { class: "price-h", text: "Riwayat" }));
      const hist = u.el("div", { class: "price-hist" });
      it.history.slice(0, 12).forEach((h) => {
        hist.appendChild(u.el("div", { class: "price-hist-row" }, [
          u.el("span", { class: "muted", text: u.formatTanggal(h.date) }),
          u.el("span", { class: "price-hist-store", text: h.store }),
          u.el("span", { class: "price-hist-price", text: u.formatRupiah(h.price) }),
        ]));
      });
      body.appendChild(hist);
    }

    u.openModal({ title: it.name, body });
  }

  async function render(container, scope) {
    scope = scope === "family" ? "family" : "self";
    u.clear(container);
    container.appendChild(u.el("div", { class: "loading", text: "Memuat data harga…" }));

    let rows;
    try {
      rows = await KK.db.priceRows(scope);
    } catch (err) {
      u.clear(container);
      container.appendChild(u.el("div", { class: "error-box" }, [
        u.el("p", { text: "Gagal memuat data harga: " + KK.auth.friendly(err) }),
        u.el("p", { class: "small muted", text: "Pastikan skrip SQL Fase 2 (fungsi price_rows) sudah dijalankan di Supabase." }),
      ]));
      return;
    }

    u.clear(container);
    const list = aggregate(rows || []);

    if (!list.length) {
      container.appendChild(u.el("div", { class: "card" }, [
        u.el("h3", { class: "card-title", text: "Belum ada data harga" }),
        u.el("p", { class: "muted", text: "Gunakan ＋ Tambah → 📷 Scan struk untuk mulai mengumpulkan harga barang & toko." }),
        u.el("p", { class: "hint", text: scope === "family"
          ? "Data dari seluruh anggota keluarga akan terkumpul di sini untuk dibandingkan."
          : "Data dari struk yang Anda pindai akan terkumpul di sini untuk dibandingkan." }),
      ]));
      return;
    }

    const search = u.el("input", { class: "input", type: "search", placeholder: "Cari barang… (mis. beras, minyak)" });
    container.appendChild(u.el("div", { class: "controls" }, [
      u.el("label", { class: "control control-wide" }, [
        u.el("span", { class: "control-label", text: "Cari barang (" + list.length + " jenis)" }), search,
      ]),
    ]));

    const listWrap = u.el("div", { class: "price-list" });
    container.appendChild(listWrap);

    function paint(q) {
      u.clear(listWrap);
      const nq = normName(q);
      const shown = nq ? list.filter((it) => it.key.indexOf(nq) >= 0) : list;
      if (!shown.length) {
        listWrap.appendChild(u.el("p", { class: "muted pad", text: "Tidak ada barang yang cocok." }));
        return;
      }
      shown.slice(0, 300).forEach((it) => listWrap.appendChild(itemRow(it)));
    }
    search.addEventListener("input", () => paint(search.value));
    paint("");
  }

  return { render, aggregate };
})();
