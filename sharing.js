"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const db = window.supabase.createClient(
    "https://pmdgnhkbmarvtvfprdsy.supabase.co",
    "sb_publishable_XVoP3QTblvFdhjs157vaWQ_yXTaYtE8"
  );
  let copyValue = "";
  let ownerId = null;
  let generation = 0;
  let busy = false;
  function message(id, value, bad = false) {
    $(id).textContent = value;
    $(id).style.color = bad ? "#ff889b" : "#aeb9d0";
  }
  function clearCode() {
    copyValue = "";
    $("outAlias").textContent = "";
    $("outCode").textContent = "";
    $("result").classList.add("hidden");
  }
  function lock() {
    generation++;
    ownerId = null;
    setBusy(false);
    clearCode();
    $("alias").value = "";
    $("shareState").textContent = "";
    $("status").textContent = "";
    $("ownerPanel").classList.add("hidden");
    message("gate", "Avval egasi sifatida login qiling.", true);
  }
  function setBusy(value, seq = generation) {
    if (seq !== generation) return;
    busy = value;
    $("createBtn").disabled = value;
    $("revokeBtn").disabled = value;
  }
  async function refreshState(seq) {
    const { data, error } = await db.rpc("my_diary_share");
    if (seq !== generation || !ownerId) return;
    if (error) { message("shareState", error.message, true); return; }
    const item = data?.[0];
    const active = item?.is_active && new Date(item.expires_at).getTime() > Date.now();
    message("shareState", !item ? "Hozircha kod yaratilmagan." : active
      ? "Faol nom: " + item.share_alias + " • muddati: " + new Date(item.expires_at).toLocaleString("uz-UZ")
      : "Ishonch kodi faol emas.");
  }
  $("shareForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (!ownerId || busy || !confirm("Yangi kod oldingi kodni bekor qiladi. Davom etasizmi?")) return;
    const seq = generation;
    setBusy(true);
    clearCode();
    try {
      const { data, error } = await db.rpc("create_private_diary_code", {
        p_alias: $("alias").value.trim().toLowerCase(), p_days: Number($("days").value)
      });
      if (seq !== generation || !ownerId) return;
      if (error) throw error;
      const item = data?.[0];
      if (!item) throw new Error("Yangi kodni olib bo‘lmadi.");
      $("outAlias").textContent = item.share_alias;
      $("outCode").textContent = item.share_code;
      copyValue = item.share_alias + "\n" + item.share_code;
      $("result").classList.remove("hidden");
      message("status", "Kod yaratildi. Uni faqat ishonadigan odamingizga yuboring.");
      await refreshState(seq);
    } catch (error) {
      if (seq === generation && ownerId) message("status", error.message || "Kod yaratilmadi.", true);
    } finally { setBusy(false, seq); }
  });
  $("copyBtn").addEventListener("click", async () => {
    if (!ownerId || !copyValue) return;
    const seq = generation;
    try {
      await navigator.clipboard.writeText(copyValue);
      if (seq === generation && ownerId) message("status", "Nom va kod nusxalandi.");
    } catch {
      if (seq === generation && ownerId) message("status", "Qo‘lda nusxalang — avtomatik nusxalab bo‘lmadi.", true);
    }
  });
  $("revokeBtn").addEventListener("click", async () => {
    if (!ownerId || busy || !confirm("Barcha kodlar bekor qilinsinmi?")) return;
    const seq = generation;
    setBusy(true);
    try {
      const { error } = await db.rpc("revoke_private_diary_code");
      if (seq !== generation || !ownerId) return;
      if (error) throw error;
      clearCode();
      message("status", "Ruxsat bekor qilindi.");
      await refreshState(seq);
    } catch (error) {
      if (seq === generation && ownerId) message("status", error.message || "Ruxsat bekor qilinmadi.", true);
    } finally { setBusy(false, seq); }
  });
  async function checkOwner() {
    const seq = ++generation;
    try {
      const { data, error } = await db.auth.getUser();
      if (seq !== generation) return;
      if (error || !data?.user) throw new Error("Avval egasi sifatida login qiling.");
      const admin = await db.rpc("am_i_diary_admin");
      if (seq !== generation) return;
      if (admin.error || admin.data !== true) throw new Error("Bu sahifaga faqat kundalik egasi kira oladi.");
      ownerId = data.user.id;
      message("gate", "Egasining huquqi tasdiqlandi.");
      $("ownerPanel").classList.remove("hidden");
      await refreshState(seq);
    } catch (error) {
      if (seq !== generation) return;
      lock();
      message("gate", error.message || "Ruxsat tekshirilmadi.", true);
    }
  }
  db.auth.onAuthStateChange((event, session) => {
    if (!session) lock();
    else if (event === "SIGNED_IN" && session.user.id !== ownerId) {
      lock();
      setTimeout(checkOwner, 0);
    }
  });
  checkOwner();
})();
