"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const db = window.supabase.createClient(
    "https://pmdgnhkbmarvtvfprdsy.supabase.co",
    "sb_publishable_XVoP3QTblvFdhjs157vaWQ_yXTaYtE8"
  );
  let copyValue = "";

  function message(id, value, bad = false) {
    $(id).textContent = value;
    $(id).style.color = bad ? "#ff889b" : "#aeb9d0";
  }

  async function refreshState() {
    const { data, error } = await db.rpc("my_diary_share");
    if (error) {
      message("shareState", error.message, true);
      return;
    }
    const item = data?.[0];
    message("shareState", !item
      ? "Hozircha kod yaratilmagan."
      : item.is_active
        ? "Faol nom: " + item.share_alias + " • muddati: " +
          new Date(item.expires_at).toLocaleString("uz-UZ")
        : "Ishonch kodi faol emas.");
  }

  $("shareForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (!confirm("Yangi kod oldingi kodni bekor qiladi. Davom etasizmi?")) return;
    $("createBtn").disabled = true;
    $("result").classList.add("hidden");
    copyValue = "";
    try {
      const { data, error } = await db.rpc("create_private_diary_code", {
        p_alias: $("alias").value.trim().toLowerCase(),
        p_days: Number($("days").value)
      });
      if (error) throw error;
      const item = data?.[0];
      if (!item) throw new Error("Yangi kodni olib bo‘lmadi.");
      $("outAlias").textContent = item.share_alias;
      $("outCode").textContent = item.share_code;
      copyValue = item.share_alias + "\n" + item.share_code;
      $("result").classList.remove("hidden");
      message("status", "Kod yaratildi. Uni faqat ishonadigan odamingizga yuboring.");
      await refreshState();
    } catch (error) {
      message("status", error.message, true);
    } finally {
      $("createBtn").disabled = false;
    }
  });

  $("copyBtn").addEventListener("click", async () => {
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(copyValue);
      message("status", "Nom va kod nusxalandi.");
    } catch {
      message("status", "Qo‘lda nusxalang — avtomatik nusxalab bo‘lmadi.", true);
    }
  });

  $("revokeBtn").addEventListener("click", async () => {
    if (!confirm("Barcha kodlar bekor qilinsinmi?")) return;
    const { error } = await db.rpc("revoke_private_diary_code");
    if (error) {
      message("status", error.message, true);
      return;
    }
    copyValue = "";
    $("result").classList.add("hidden");
    message("status", "Ruxsat bekor qilindi.");
    await refreshState();
  });

  (async () => {
    try {
      const { data, error } = await db.auth.getUser();
      if (error || !data?.user) throw new Error("Avval egasi sifatida login qiling.");
      const admin = await db.rpc("am_i_diary_admin");
      if (admin.error || admin.data !== true) throw new Error("Bu sahifaga faqat kundalik egasi kira oladi.");
      message("gate", "Egasining huquqi tasdiqlandi.");
      $("ownerPanel").classList.remove("hidden");
      await refreshState();
    } catch (error) {
      message("gate", error.message, true);
    }
  })();
})();
