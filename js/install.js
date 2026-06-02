// Petunjuk pasang aplikasi (Add to Home Screen / Install).
// - Android & Chrome desktop: tampilkan tombol "Pasang" (memakai event beforeinstallprompt).
// - iPhone/iPad: tampilkan banner langkah manual (iOS tak punya prompt otomatis).
// Banner bisa ditutup dan diingat lewat localStorage.
window.KK = window.KK || {};

(function () {
  var u = KK.util;
  var DISMISS_KEY = "kk_install_hint_dismissed";
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

  function init() {
    if (isStandalone()) return; // sudah terpasang

    // Android / Chrome (termasuk desktop): tampilkan tombol Pasang saat tersedia.
    if (window.__kkDeferredPrompt) showAndroidBanner();
    window.addEventListener("kk-installable", showAndroidBanner);
    window.addEventListener("appinstalled", function () { setDismissed(); removeBanner(); });

    // iOS: tidak ada prompt otomatis -> tampilkan petunjuk manual.
    if (isIos() && !window.__kkDeferredPrompt) setTimeout(showIosBanner, 900);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
