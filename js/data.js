// Lapisan data: semua interaksi dengan Supabase (auth, RPC, query tabel).
// Semua fungsi async melempar Error bila gagal -> tangani dengan try/catch.
window.KK = window.KK || {};

KK.db = (function () {
  function sb() {
    if (!KK.sb) throw new Error("Aplikasi belum terhubung ke Supabase. Periksa js/config.js.");
    return KK.sb;
  }

  // Konteks pengguna aktif (diisi oleh app.js setelah profil dimuat).
  let ctx = { familyId: null, userId: null };
  function setContext(c) { ctx = Object.assign({}, ctx, c); }
  function getContext() { return ctx; }

  function unwrap(res) {
    if (res.error) throw res.error;
    return res.data;
  }

  // ---------------- AUTH ----------------
  async function getSession() {
    const { data } = await sb().auth.getSession();
    return data.session || null;
  }
  async function getUser() {
    const { data } = await sb().auth.getUser();
    return data.user || null;
  }
  function onAuthStateChange(cb) {
    return sb().auth.onAuthStateChange((event, session) => cb(event, session));
  }
  async function signUp(email, password) {
    return unwrap(await sb().auth.signUp({ email: email.trim(), password }));
  }
  async function signIn(email, password) {
    return unwrap(await sb().auth.signInWithPassword({ email: email.trim(), password }));
  }
  async function signOut() {
    const { error } = await sb().auth.signOut();
    if (error) throw error;
  }
  async function sendPasswordReset(email) {
    const redirectTo = location.origin + location.pathname;
    const { error } = await sb().auth.resetPasswordForEmail(email.trim(), { redirectTo });
    if (error) throw error;
  }
  async function updatePassword(newPassword) {
    return unwrap(await sb().auth.updateUser({ password: newPassword }));
  }

  // ---------------- RPC ----------------
  async function createFamily(familyName, displayName) {
    return unwrap(await sb().rpc("create_family", {
      p_family_name: familyName, p_display_name: displayName,
    }));
  }
  async function joinFamily(inviteCode, displayName) {
    return unwrap(await sb().rpc("join_family", {
      p_invite_code: inviteCode, p_display_name: displayName,
    }));
  }

  // ---------------- PROFIL & KELUARGA ----------------
  async function getProfile() {
    return unwrap(
      await sb().from("profiles")
        .select("id, family_id, display_name, role, created_at")
        .eq("id", ctx.userId || (await getUser())?.id)
        .maybeSingle()
    );
  }
  async function getFamily() {
    return unwrap(
      await sb().from("families")
        .select("id, name, invite_code, created_at")
        .limit(1).maybeSingle()
    );
  }
  async function updateDisplayName(name) {
    return unwrap(
      await sb().from("profiles").update({ display_name: name }).eq("id", ctx.userId).select().maybeSingle()
    );
  }
  // Daftar anggota: admin dapat semua sefamili; anggota biasa hanya dirinya (RLS).
  async function getMembers() {
    return unwrap(
      await sb().from("profiles")
        .select("id, display_name, role, created_at")
        .order("role", { ascending: true })
        .order("created_at", { ascending: true })
    ) || [];
  }

  // ---------------- KATEGORI ----------------
  async function listCategories() {
    return unwrap(
      await sb().from("categories")
        .select("id, family_id, name, type, is_default")
        .order("type", { ascending: true })
        .order("name", { ascending: true })
    ) || [];
  }
  async function addCategory(fields) {
    return unwrap(
      await sb().from("categories")
        .insert({ family_id: ctx.familyId, name: fields.name, type: fields.type, is_default: false })
        .select().single()
    );
  }
  async function updateCategory(id, fields) {
    return unwrap(
      await sb().from("categories")
        .update({ name: fields.name, type: fields.type })
        .eq("id", id).select().single()
    );
  }
  async function deleteCategory(id) {
    const { error } = await sb().from("categories").delete().eq("id", id);
    if (error) throw error;
  }

  // ---------------- TRANSAKSI ----------------
  const TX_COLS = "id, family_id, user_id, type, category_id, amount, note, tx_date, created_at, categories(name)";

  function normalizeTx(row) {
    return Object.assign({}, row, {
      amount: Number(row.amount) || 0,
      category_name: row.categories ? row.categories.name : null,
    });
  }

  async function listTransactions(opts) {
    opts = opts || {};
    let q = sb().from("transactions").select(TX_COLS)
      .order("tx_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (opts.month) {
      const r = KK.util.monthRange(opts.month);
      q = q.gte("tx_date", r.start).lte("tx_date", r.end);
    }
    if (opts.userId) q = q.eq("user_id", opts.userId);
    const data = unwrap(await q) || [];
    return data.map(normalizeTx);
  }
  async function getTransaction(id) {
    const row = unwrap(await sb().from("transactions").select(TX_COLS).eq("id", id).maybeSingle());
    return row ? normalizeTx(row) : null;
  }
  async function addTransaction(fields) {
    return unwrap(
      await sb().from("transactions").insert({
        family_id: ctx.familyId,
        user_id: ctx.userId,
        type: fields.type,
        category_id: fields.category_id || null,
        amount: fields.amount,
        note: fields.note || null,
        tx_date: fields.tx_date,
      }).select(TX_COLS).single()
    );
  }
  async function updateTransaction(id, fields) {
    return unwrap(
      await sb().from("transactions").update({
        type: fields.type,
        category_id: fields.category_id || null,
        amount: fields.amount,
        note: fields.note || null,
        tx_date: fields.tx_date,
      }).eq("id", id).select(TX_COLS).single()
    );
  }
  async function deleteTransaction(id) {
    const { error } = await sb().from("transactions").delete().eq("id", id);
    if (error) throw error;
  }

  return {
    setContext, getContext,
    getSession, getUser, onAuthStateChange,
    signUp, signIn, signOut, sendPasswordReset, updatePassword,
    createFamily, joinFamily,
    getProfile, getFamily, updateDisplayName, getMembers,
    listCategories, addCategory, updateCategory, deleteCategory,
    listTransactions, getTransaction, addTransaction, updateTransaction, deleteTransaction,
  };
})();
