// Petunjuk pasang aplikasi (Add to Home Screen / Install).
// - Android & Chrome desktop: tampilkan tombol "Pasang" (memakai event beforeinstallprompt).
// - iPhone/iPad: tampilkan banner langkah manual (iOS tak punya prompt otomatis).
// Banner bisa ditutup dan diingat lewat localStorage.
window.KK = window.KK || {};

(function () {
  var u = KK.util;
  var DISMISS_KEY = "kk_install_hint_dismissed";
  var POPUP_KEY = "kk_install_popup_until"; // tahan pop-up sampai timestamp ini
  var bannerEl = null;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      window.navigator.standalone === true;
  }
  function isIos() {
    var ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS
  }
  function dismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch (e) { return false; }
  }
  function setDismissed() {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch (e) {}
  }
  function popupSuppressed() {
    try { var v = localStorage.getItem(POPUP_KEY); return !!v && Date.now() < Number(v); } catch (e) { return false; }
  }
  function suppressPopup() {
    try { localStorage.setItem(POPUP_KEY, String(Date.now() + 14 * 864e5)); } catch (e) {} // 14 hari
  }

  function svg(paths) {
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + "</svg>";
  }
  function iconShare() {
    return u.el("span", { class: "install-glyph", html: svg('<path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>') });
  }
  function iconInstall() {
    return u.el("span", { class: "install-glyph", html: svg('<path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M5 21h14"/>') });
  }

  function removeBanner() { if (bannerEl) { bannerEl.remove(); bannerEl = null; } }

  function showBanner(iconNode, text, action) {
    if (bannerEl || dismissed() || isStandalone()) return;
    var card = u.el("div", { class: "install-banner" }, [
      u.el("div", { class: "install-ic" }, [iconNode]),
      u.el("div", { class: "install-text", text: text }),
    ]);
    if (action) {
      card.appendChild(u.el("button", {
        class: "btn btn-primary btn-sm install-action", text: action.label, onClick: action.onClick,
      }));
    }
    card.appendChild(u.el("button", {
      class: "install-close", "aria-label": "Tutup", html: "&times;",
      onClick: function () { setDismissed(); removeBanner(); },
    }));
    document.body.appendChild(card);
    bannerEl = card;
    requestAnimationFrame(function () { card.classList.add("show"); });
  }

  function showAndroidBanner() {
    showBanner(iconInstall(), "Pasang aplikasi ini ke layar utama untuk akses cepat.", {
      label: "Pasang",
      onClick: function () {
        var dp = window.__kkDeferredPrompt;
        if (!dp) { setDismissed(); removeBanner(); return; }
        dp.prompt();
        (dp.userChoice || Promise.resolve()).then(function (res) {
          if (res && res.outcome === "accepted") setDismissed();
          window.__kkDeferredPrompt = null;
          removeBanner();
        });
      },
    });
  }

  function showIosBanner() {
    showBanner(iconShare(), "Pasang di iPhone/iPad: ketuk Bagikan, lalu “Tambah ke Layar Utama”.", null);
  }

  // Petunjuk manual (dipakai tombol "Pasang Aplikasi" di menu Keluarga).
  function stepList(tag, steps) {
    return u.el(tag, { class: "install-steps" }, steps.map(function (s) { return u.el("li", { text: s }); }));
  }
  function iosHelpBody() {
    return u.el("div", { class: "install-help" }, [
      u.el("p", { text: "Pasang di iPhone/iPad menggunakan Safari:" }),
      stepList("ol", [
        "Ketuk tombol Bagikan (kotak dengan panah ke atas) di bilah Safari.",
        "Pilih “Tambah ke Layar Utama” / “Add to Home Screen”.",
        "Ketuk “Tambah”. Ikon aplikasi akan muncul di layar utama.",
      ]),
    ]);
  }
  function genericHelpBody() {
    return u.el("div", { class: "install-help" }, [
      u.el("p", { text: "Pasang aplikasi ke perangkat Anda:" }),
      stepList("ul", [
        "Android / Chrome: buka menu ⋮, lalu pilih “Pasang aplikasi” / “Add to Home screen”.",
        "iPhone / iPad: buka di Safari, ketuk Bagikan → “Tambah ke Layar Utama”.",
      ]),
    ]);
  }

  // Dipicu oleh tombol di menu Keluarga: jalankan prompt resmi bila tersedia
  // (Android/Chrome), atau tampilkan petunjuk manual (iOS & lainnya).
  function promptInstall() {
    if (isStandalone()) { u.toast("Aplikasi sudah terpasang. ✅", "success"); return; }
    var dp = window.__kkDeferredPrompt;
    if (dp && dp.prompt) {
      dp.prompt();
      (dp.userChoice || Promise.resolve()).then(function (res) {
        window.__kkDeferredPrompt = null;
        if (res && res.outcome === "accepted") { setDismissed(); removeBanner(); }
      });
      return;
    }
    u.openModal({
      title: "Pasang Aplikasi",
      body: isIos() ? iosHelpBody() : genericHelpBody(),
      actions: [{ label: "Mengerti", class: "btn-primary", onClick: function (c) { c(); } }],
    });
  }

  // Pop-up modal yang lebih menonjol, muncul otomatis sekali saat app dibuka di
  // browser. Ditahan 14 hari bila ditutup (cara apa pun); tak muncul bila sudah terpasang.
  function showInstallPopup() {
    if (isStandalone() || popupSuppressed()) return;
    var dp = window.__kkDeferredPrompt;
    if (dp && dp.prompt && !isIos()) {
      u.openModal({
        title: "Pasang Aplikasi",
        body: u.el("div", { class: "install-help" }, [
          u.el("p", { text: "Pasang ke layar utama agar terbuka lebih cepat, tampil layar penuh, dan tetap bisa dibuka saat offline." }),
        ]),
        onClose: suppressPopup,
        actions: [
          { label: "Nanti saja", class: "btn-ghost", onClick: function (c) { c(); } },
          { label: "📲 Pasang", class: "btn-primary", onClick: function (c) {
              var d = window.__kkDeferredPrompt;
              if (d && d.prompt) {
                d.prompt();
                (d.userChoice || Promise.resolve()).then(function (res) {
                  window.__kkDeferredPrompt = null;
                  if (res && res.outcome === "accepted") { setDismissed(); removeBanner(); }
                });
              }
              c();
            } },
        ],
      });
    } else {
      u.openModal({
        title: "Pasang Aplikasi",
        body: isIos() ? iosHelpBody() : genericHelpBody(),
        onClose: suppressPopup,
        actions: [{ label: "Mengerti", class: "btn-primary", onClick: function (c) { c(); } }],
      });
    }
  }

  KK.install = { promptInstall: promptInstall };

  function init() {
    if (isStandalone()) return; // sudah terpasang

    // Android / Chrome (termasuk desktop): tampilkan tombol Pasang saat tersedia.
    if (window.__kkDeferredPrompt) showAndroidBanner();
    window.addEventListener("kk-installable", showAndroidBanner);
    window.addEventListener("appinstalled", function () { setDismissed(); suppressPopup(); removeBanner(); });

    // iOS: tidak ada prompt otomatis -> tampilkan petunjuk manual.
    if (isIos() && !window.__kkDeferredPrompt) setTimeout(showIosBanner, 900);

    // Pop-up modal yang lebih menonjol (selain banner) — sekali, ditahan 14 hari bila ditutup.
    setTimeout(showInstallPopup, 1500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
