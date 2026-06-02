// Modul autentikasi UI: tab Masuk / Daftar / Lupa Password, alur pilih
// "buat keluarga" atau "gabung keluarga", serta layar setel ulang password.
window.KK = window.KK || {};

KK.auth = (function () {
  const u = KK.util;

  function show(id) {
    u.$$(".auth-pane").forEach((p) => p.classList.toggle("hidden", p.id !== id));
    u.$$(".auth-tab").forEach((t) => t.classList.toggle("active", t.dataset.target === id));
  }

  // Toggle bagian "buat" vs "gabung" keluarga pada form daftar.
  function refreshFamilyMode() {
    const mode = (u.$("input[name=famMode]:checked") || {}).value || "create";
    u.$("#regCreateBox").classList.toggle("hidden", mode !== "create");
    u.$("#regJoinBox").classList.toggle("hidden", mode !== "join");
  }

  function wire(onAuthed) {
    // Tab navigasi
    u.$$(".auth-tab").forEach((t) =>
      t.addEventListener("click", () => show(t.dataset.target)));
    u.$$("[data-goto]").forEach((a) =>
      a.addEventListener("click", (e) => { e.preventDefault(); show(a.dataset.goto); }));

    u.$$("input[name=famMode]").forEach((r) =>
      r.addEventListener("change", refreshFamilyMode));
    refreshFamilyMode();

    // ----- LOGIN -----
    u.$("#loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = u.$("#loginBtn");
      const email = u.$("#loginEmail").value;
      const pass = u.$("#loginPassword").value;
      if (!email || !pass) return u.toast("Lengkapi email dan password.", "warn");
      u.setLoading(btn, true, "Masuk…");
      try {
        await KK.db.signIn(email, pass);
        onAuthed();
      } catch (err) {
        u.toast(friendly(err), "error");
      } finally { u.setLoading(btn, false); }
    });

    // ----- DAFTAR -----
    u.$("#registerForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = u.$("#registerBtn");
      const name = u.$("#regName").value.trim();
      const email = u.$("#regEmail").value.trim();
      const pass = u.$("#regPassword").value;
      const mode = (u.$("input[name=famMode]:checked") || {}).value || "create";
      const famName = u.$("#regFamilyName").value.trim();
      const code = u.$("#regInviteCode").value.trim();

      if (!name) return u.toast("Nama tampilan wajib diisi.", "warn");
      if (!email || !pass) return u.toast("Email dan password wajib diisi.", "warn");
      if (pass.length < 6) return u.toast("Password minimal 6 karakter.", "warn");
      if (mode === "create" && !famName) return u.toast("Nama keluarga wajib diisi.", "warn");
      if (mode === "join" && !code) return u.toast("Kode keluarga wajib diisi.", "warn");

      u.setLoading(btn, true, "Mendaftar…");
      try {
        const res = await KK.db.signUp(email, pass);
        // Jika verifikasi email dimatikan (sesuai anjuran), sesi langsung aktif.
        if (!res.session) {
          u.toast("Pendaftaran berhasil. Silakan verifikasi email lalu masuk untuk melanjutkan.", "info", 6000);
          u.setLoading(btn, false);
          show("paneLogin");
          return;
        }
        await finishSetup(mode, { famName, code, name });
        onAuthed();
      } catch (err) {
        u.toast(friendly(err), "error");
        u.setLoading(btn, false);
      }
    });

    // ----- LUPA PASSWORD -----
    u.$("#forgotForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = u.$("#forgotBtn");
      const email = u.$("#forgotEmail").value.trim();
      if (!email) return u.toast("Masukkan email Anda.", "warn");
      u.setLoading(btn, true, "Mengirim…");
      try {
        await KK.db.sendPasswordReset(email);
        u.toast("Tautan setel ulang password telah dikirim ke email Anda.", "success", 6000);
        show("paneLogin");
      } catch (err) {
        u.toast(friendly(err), "error");
      } finally { u.setLoading(btn, false); }
    });

    // ----- SETEL ULANG PASSWORD (dari tautan email) -----
    u.$("#resetForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = u.$("#resetBtn");
      const p1 = u.$("#resetPassword").value;
      const p2 = u.$("#resetPassword2").value;
      if (p1.length < 6) return u.toast("Password minimal 6 karakter.", "warn");
      if (p1 !== p2) return u.toast("Konfirmasi password tidak cocok.", "warn");
      u.setLoading(btn, true, "Menyimpan…");
      try {
        await KK.db.updatePassword(p1);
        u.toast("Password berhasil diperbarui.", "success");
        onAuthed();
      } catch (err) {
        u.toast(friendly(err), "error");
      } finally { u.setLoading(btn, false); }
    });
  }

  // Jalankan create/join keluarga setelah punya sesi login.
  async function finishSetup(mode, { famName, code, name }) {
    if (mode === "join") await KK.db.joinFamily(code, name);
    else await KK.db.createFamily(famName, name);
  }

  // Layar "lengkapi data keluarga" untuk akun yang login tetapi belum punya profil.
  function renderCompleteSetup(container, onDone) {
    u.clear(container);
    const box = u.el("div", { class: "auth-card" }, [
      u.el("h2", { class: "auth-title", text: "Lengkapi Data Keluarga" }),
      u.el("p", { class: "muted", text: "Akun Anda sudah aktif. Pilih untuk membuat keluarga baru atau bergabung memakai kode." }),
    ]);
    const form = u.el("form", { class: "form" });
    const name = inputRow(form, "Nama tampilan", "text", "cs_name", "cth: Budi");

    const modeWrap = u.el("div", { class: "radio-row" }, [
      radio("cs_mode", "create", "Buat keluarga baru", true),
      radio("cs_mode", "join", "Gabung keluarga"),
    ]);
    form.appendChild(modeWrap);

    const createBox = u.el("div", {}, []);
    const famName = inputRow(createBox, "Nama keluarga", "text", "cs_fam", "cth: Keluarga Santoso");
    const joinBox = u.el("div", { class: "hidden" }, []);
    const code = inputRow(joinBox, "Kode keluarga", "text", "cs_code", "cth: AB3KZ9");
    form.appendChild(createBox);
    form.appendChild(joinBox);

    modeWrap.addEventListener("change", () => {
      const m = (form.querySelector("input[name=cs_mode]:checked") || {}).value;
      createBox.classList.toggle("hidden", m !== "create");
      joinBox.classList.toggle("hidden", m !== "join");
    });

    const btn = u.el("button", { class: "btn btn-primary btn-block", type: "submit", text: "Lanjutkan" });
    form.appendChild(btn);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const m = (form.querySelector("input[name=cs_mode]:checked") || {}).value || "create";
      if (!name.value.trim()) return u.toast("Nama tampilan wajib diisi.", "warn");
      if (m === "create" && !famName.value.trim()) return u.toast("Nama keluarga wajib diisi.", "warn");
      if (m === "join" && !code.value.trim()) return u.toast("Kode keluarga wajib diisi.", "warn");
      u.setLoading(btn, true);
      try {
        await finishSetup(m, { famName: famName.value, code: code.value, name: name.value });
        onDone();
      } catch (err) {
        u.toast(friendly(err), "error");
        u.setLoading(btn, false);
      }
    });

    box.appendChild(form);
    container.appendChild(box);
  }

  // Helper kecil untuk form yang dirender via JS.
  function inputRow(parent, label, type, id, placeholder) {
    const input = u.el("input", { class: "input", type, id, placeholder, autocomplete: "off" });
    parent.appendChild(u.el("label", { class: "field" }, [
      u.el("span", { class: "field-label", text: label }), input,
    ]));
    return input;
  }
  function radio(name, value, label, checked) {
    return u.el("label", { class: "radio" }, [
      u.el("input", { type: "radio", name, value, checked: checked ? "checked" : null }),
      u.el("span", { text: label }),
    ]);
  }

  function friendly(err) {
    const m = (err && (err.message || err.error_description || err.msg)) || "Terjadi kesalahan.";
    const map = {
      "Invalid login credentials": "Email atau password salah.",
      "User already registered": "Email sudah terdaftar. Silakan masuk.",
      "Email not confirmed": "Email belum diverifikasi. Cek kotak masuk Anda.",
    };
    return map[m] || m;
  }

  return { wire, show, renderCompleteSetup, friendly };
})();
