"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const db = window.supabase.createClient(
    "https://pmdgnhkbmarvtvfprdsy.supabase.co",
    "sb_publishable_XVoP3QTblvFdhjs157vaWQ_yXTaYtE8"
  );
  let readSequence = 0;
  function say(message, isError = false) {
    $("message").textContent = message;
    $("message").style.color = isError ? "#ff8a9b" : "#b5bdd1";
  }
  function clearRead() {
    $("notes").replaceChildren();
    $("readSection").classList.add("hidden");
  }
  $("closeBtn").addEventListener("click", () => {
    readSequence++;
    $("closeBtn").classList.add("hidden");
    clearRead();
    $("openBtn").disabled = false;
    $("code").value = "";
    say("Kundalik yopildi.");
  });
  $("accessForm").addEventListener("submit", async event => {
    event.preventDefault();
    const seq = ++readSequence;
    clearRead();
    const button = $("openBtn");
    button.disabled = true;
    $("closeBtn").classList.remove("hidden");
    say("Kod tekshirilmoqda...");
    const alias = $("alias").value.trim().toLowerCase();
    const code = $("code").value.trim().toLowerCase();
    try {
      const { data, error } = await db.rpc("read_private_diary_with_code", {
        p_alias: alias, p_code: code
      });
      if (seq !== readSequence) return;
      if (error) throw error;
      $("code").value = "";
      if (!Array.isArray(data) || !data.length) {
        say("Yozuv topilmadi. Kod noto‘g‘ri, eskirgan yoki kundalik hali bo‘sh bo‘lishi mumkin.", true);
        return;
      }
      for (const item of data) {
        const article = document.createElement("article");
        const heading = document.createElement("h2");
        heading.textContent = item.title;
        const date = document.createElement("small");
        date.textContent = item.entry_date;
        const body = document.createElement("p");
        body.textContent = item.content;
        article.append(heading, date, body);
        $("notes").append(article);
      }
      $("readSection").classList.remove("hidden");
      say("Faqat o‘qish rejimi. " + data.length + " ta yozuv ochildi.");
    } catch (error) {
      if (seq !== readSequence) return;
      $("code").value = "";
      say("Kundalikni ochib bo‘lmadi. " + (error.message || "Qayta urinib ko‘ring."), true);
    } finally {
      if (seq === readSequence) button.disabled = false;
    }
  });
})();
