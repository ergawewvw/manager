"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const db = window.supabase.createClient(
    "https://pmdgnhkbmarvtvfprdsy.supabase.co",
    "sb_publishable_XVoP3QTblvFdhjs157vaWQ_yXTaYtE8"
  );
  let currentId = null;
  let activeCode = "";

  function status(id, message, error = false) {
    $(id).textContent = message;
    $(id).style.color = error ? "#ff849b" : "#aab6cf";
  }

  async function refresh() {
    const [mine, others] = await Promise.all([
      db.rpc("my_diary_share"),
      db.rpc("my_visited_diaries")
    ]);
    if (mine.error) {
      status("shareInfo", mine.error.message, true);
    } else {
      const setting = mine.data?.[0];
      status("shareInfo", !setting ? "Hozircha kod mavjud emas." :
        setting.is_active
          ? "Faol ulashish: " + setting.share_alias + ", muddat: " +
            new Date(setting.expires_at).toLocaleString("uz-UZ") +
            ", ruxsat olganlar: " + setting.visitor_count
          : "Ulashish kodi faol emas.");
    }
    $("visitorsList").replaceChildren();
    $("visitorNotes").replaceChildren();
    if (others.error) {
      status("visitMessage", others.error.message, true);
      return;
    }
    if (!others.data?.length) {
      $("visitorsList").textContent = "Hozircha hech kim ruxsat bermagan.";
    }
    for (const friend of others.data || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = friend.share_alias + " — ochish";
      button.addEventListener("click", () => openDiary(friend));
      $("visitorsList").append(button);
    }
  }

  async function openDiary(friend) {
    $("visitorNotes").textContent = "Yuklanmoqda...";
    const { data, error } = await db.from("diary_entries")
      .select("title,content,entry_date")
      .eq("user_id", friend.owner_id)
      .order("entry_date", { ascending: false })
      .limit(500);
    $("visitorNotes").replaceChildren();
    if (error) {
      status("visitMessage", error.message, true);
      return;
    }
    const heading = document.createElement("h2");
    heading.textContent = friend.share_alias;
    $("visitorNotes").append(heading);
    if (!data?.length) {
      $("visitorNotes").append("Bu kundalikda yozuvlar yo‘q.");
    }
    for (const item of data || []) {
      const paper = document.createElement("article");
      paper.className = "paper";
      const title = document.createElement("strong");
      title.textContent = item.title;
      const date = document.createElement("small");
      date.textContent = item.entry_date;
      const content = document.createElement("p");
      content.textContent = item.content;
      paper.append(title, date, content);
      $("visitorNotes").append(paper);
    }
  }

  $("shareForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (!currentId) return;
    if (!confirm("Eski kod va barcha avvalgi ruxsatlar bekor bo‘ladi. Davom etilsinmi?")) return;
    $("createBtn").disabled = true;
    $("keyBox").classList.add("hidden");
    activeCode = "";
    try {
      const { data, error } = await db.rpc("create_diary_share", {
        p_alias: $("alias").value.toLowerCase().trim(),
        p_days: Number($("days").value)
      });
      if (error) throw error;
      const result = data?.[0];
      if (!result) throw new Error("Kod yaratilmadi.");
      $("outAlias").textContent = result.share_alias;
      $("outCode").textContent = result.share_code;
      activeCode = result.share_alias + "\n" + result.share_code;
      $("keyBox").classList.remove("hidden");
      status("shareMessage", "Yangi kod yaratildi.");
      await refresh();
    } catch (error) {
      status("shareMessage", error.message, true);
    } finally {
      $("createBtn").disabled = false;
    }
  });

  $("copyBtn").addEventListener("click", async () => {
    if (!activeCode) return;
    try {
      await navigator.clipboard.writeText(activeCode);
      status("shareMessage", "Nom va kod nusxalandi.");
    } catch {
      status("shareMessage", "Nusxalashga ruxsat yo‘q. Qo‘lda nusxalang.", true);
    }
  });

  $("revokeBtn").addEventListener("click", async () => {
    if (!confirm("Kundalikni boshqa foydalanuvchilar o‘qish huquqi bekor qilinsinmi?")) return;
    const { error } = await db.rpc("revoke_diary_share");
    if (error) {
      status("shareMessage", error.message, true);
      return;
    }
    activeCode = "";
    $("keyBox").classList.add("hidden");
    status("shareMessage", "Barcha ulashish ruxsatlari bekor qilindi.");
    await refresh();
  });

  $("visitForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (!currentId) return;
    $("visitBtn").disabled = true;
    try {
      const { data, error } = await db.rpc("redeem_diary_share", {
        p_alias: $("visitorAlias").value.toLowerCase().trim(),
        p_code: $("visitorCode").value.toLowerCase().trim()
      });
      $("visitorCode").value = "";
      if (error) throw error;
      if (data !== true) throw new Error("Nom yoki kod noto‘g‘ri yoki muddati tugagan.");
      status("visitMessage", "Ruxsat olindi. Quyidan kundalikni oching.");
      await refresh();
    } catch (error) {
      status("visitMessage", error.message, true);
    } finally {
      $("visitBtn").disabled = false;
    }
  });

  (async () => {
    try {
      const { data, error } = await db.auth.getUser();
      if (error || !data?.user) {
        throw new Error("Avval asosiy sahifadan login qiling.");
      }
      currentId = data.user.id;
      status("gate", "Boshqalarning kundaliklarini faqat ruxsat bilan ko‘rish mumkin.");
      $("app").classList.remove("hidden");
      await refresh();
    } catch (error) {
      status("gate", error.message, true);
    }
  })();
})();
