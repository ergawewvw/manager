"use strict";
(() => {
  const $ = id => document.getElementById(id);
  // Only the shared diary alias travels in the URL; never the code or answers.
  const requestedDiary = new URL(window.location.href).searchParams.get("diary") || "";
  if (/^[a-zA-Z0-9_-]{4,32}$/.test(requestedDiary)) $("alias").value = requestedDiary.toLowerCase();
  const db = window.supabase.createClient(
    "https://pmdgnhkbmarvtvfprdsy.supabase.co",
    "sb_publishable_XVoP3QTblvFdhjs157vaWQ_yXTaYtE8"
  );
  let readSequence = 0;
  let gate = null;
  let reading = null;
  let offset = 0;
  let hasMore = false;
  let commentWidgets = [];
  function clearCommentWidgets() { for (const widget of commentWidgets) widget.dispose(); commentWidgets = []; }
  function clearCredentials() { if (reading) reading.answers.fill(""); reading = null; }
  function pageControls(loading = false) {
    $("guestPrevBtn").disabled = loading || !reading || offset === 0;
    $("guestNextBtn").disabled = loading || !reading || !hasMore;
    $("guestPageLabel").textContent = reading ? `${Math.floor(offset / 40) + 1}-sahifa` : "";
  }
  function diaryMarkup(value) {
    const escape = s => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    return escape(value||"").replace(/^## (.+)$/gm,"<strong>$1</strong>")
      .replace(/\\*\\*([^\\n*]+)\\*\\*/g,"<strong>$1</strong>")
      .replace(/\\*([^\\n*]+)\\*/g,"<em>$1</em>").replace(/^- (.+)$/gm,"• $1");
  }
  function renderNotes(entries) {
    clearCommentWidgets();
    $("notes").replaceChildren();
    const credentials = reading, sequence = readSequence;
    for (const item of entries) {
      const article = document.createElement("article");
      const heading = document.createElement("h2"); heading.textContent = item.title;
      const date = document.createElement("small");
      const published = item.created_at ? new Date(item.created_at) : null;
      const publishedLabel = published && !Number.isNaN(published.getTime())
        ? published.toLocaleString("uz-UZ", {day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}) : "";
      date.textContent = item.entry_date + (publishedLabel ? " · Joylangan: " + publishedLabel : "");
      const body = document.createElement("p"); body.innerHTML = diaryMarkup(item.content);
      article.append(heading,date,body); $("notes").append(article);
      if (window.DiaryComments && /^\d+$/.test(String(item.id))) {
        const comments = document.createElement("div"); article.append(comments);
        commentWidgets.push(window.DiaryComments.mount(comments, {
          client:db,entryId:String(item.id),owner:false,
          credentials:() => reading === credentials ? reading : null,
          isCurrent:() => readSequence === sequence && reading === credentials,
          onAccessLost:data => { readSequence++;resetAccess();say(resultMessage(data),true); }
        }));
      }
    }
    $("readSection").classList.remove("hidden");
  }
  async function navigatePage(target) {
    if (!reading) return;
    const seq = ++readSequence, credentials = reading, answers = credentials.answers.slice();
    pageControls(true);
    try {
      const { data,error } = await db.rpc("read_private_diary_verified", {p_alias:credentials.alias,p_code:credentials.code,p_answers:answers,p_offset:target});
      if (seq !== readSequence) return;
      if (error) throw error;
      if (data?.status !== "ok" || !Array.isArray(data.entries)) { resetAccess(); say(resultMessage(data),true); return; }
      offset = target; hasMore = data.has_more === true; renderNotes(data.entries); say(`${data.entries.length} ta yozuv. Izohlar yozuv ostida.`);
    } catch { if (seq === readSequence) say("Sahifa yuklanmadi. Qayta urinib ko‘ring.",true); }
    finally { answers.fill(""); if (seq === readSequence) pageControls(); }
  }
  $("guestPrevBtn").addEventListener("click", () => { if (!$("guestPrevBtn").disabled) return navigatePage(Math.max(0, offset - 40)); });
  $("guestNextBtn").addEventListener("click", () => { if (!$("guestNextBtn").disabled) return navigatePage(offset + 40); });
  function say(message, isError = false) {
    $("message").textContent = message;
    $("message").style.color = isError ? "#ff8a9b" : "#b5bdd1";
  }
  function clearRead() {
    clearCommentWidgets();
    $("notes").replaceChildren();
    $("readSection").classList.add("hidden");
  }
  function clearAnswers() {
    for (const input of $("questionFields").querySelectorAll("input")) input.value = "";
  }
  function resetAccess() {
    gate = null; clearCredentials(); offset = 0; hasMore = false; pageControls();
    clearRead(); clearAnswers();
    $("questionFields").replaceChildren();
    $("questionForm").classList.add("hidden");
    $("accessForm").classList.remove("hidden");
    $("closeBtn").classList.add("hidden");
    $("openBtn").disabled = false;
    $("verifyBtn").disabled = false;
    $("code").value = "";
  }
  function resultMessage(data) {
    if (data?.status === "blocked") {
      const until = new Date(data.blocked_until).toLocaleString("uz-UZ");
      return `Urinishlar chegarasi tugadi. ${until} dan keyin qayta urinib ko‘ring.`;
    }
    if (data?.status === "invalid_answers") return `Javoblar noto‘g‘ri. Qolgan urinishlar: ${data.attempts_remaining}.`;
    if (data?.status === "not_configured") return "Maxfiy savollar hali sozlanmagan. Kundalik egasiga murojaat qiling.";
    return "Kod noto‘g‘ri, bekor qilingan yoki uning muddati tugagan.";
  }
  $("closeBtn").addEventListener("click", () => {
    readSequence++;
    resetAccess();
    say("Kundalik yopildi.");
  });
  $("accessForm").addEventListener("submit", async event => {
    event.preventDefault();
    if ($("openBtn").disabled) return;
    const seq = ++readSequence;
    const alias = $("alias").value.trim().toLowerCase();
    const code = $("code").value.trim().toLowerCase();
    resetAccess();
    $("openBtn").disabled = true;
    $("closeBtn").classList.remove("hidden");
    say("1-bosqich: kod tekshirilmoqda...");
    try {
      const { data, error } = await db.rpc("get_private_diary_questions", { p_alias:alias, p_code:code });
      if (seq !== readSequence) return;
      if (error) throw error;
      if (data?.status !== "questions_required" || !Array.isArray(data.questions) || data.questions.length !== 3) {
        resetAccess(); say(resultMessage(data), true); return;
      }
      gate = { alias, code };
      for (const question of data.questions) {
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.id = `answer${question.number}`;
        input.type = "password"; input.autocomplete = "off";
        input.maxLength = 200; input.required = true;
        label.htmlFor = input.id; label.textContent = question.text;
        $("questionFields").append(label,input);
      }
      $("accessForm").classList.add("hidden");
      $("questionForm").classList.remove("hidden");
      $("questionFields").querySelector("input").focus();
      say("Kod tasdiqlandi. Endi uchta maxfiy savolga javob bering.");
    } catch {
      if (seq !== readSequence) return;
      resetAccess(); say("Kodni tekshirib bo‘lmadi. Qayta urinib ko‘ring.", true);
    } finally {
      if (seq === readSequence) $("openBtn").disabled = false;
    }
  });
  $("questionForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (!gate || $("verifyBtn").disabled) return;
    const seq = ++readSequence;
    const credentials = gate;
    const answers = [1,2,3].map(number => $("answer" + number).value);
    $("verifyBtn").disabled = true;
    clearRead();
    say("2-bosqich: javoblar tekshirilmoqda...");
    try {
      const { data, error } = await db.rpc("read_private_diary_verified", {
        p_alias:credentials.alias, p_code:credentials.code, p_answers:answers, p_offset:0
      });
      if (seq !== readSequence) return;
      if (error) throw error;
      if (data?.status !== "ok" || !Array.isArray(data.entries)) {
        clearAnswers(); if (data?.status !== "invalid_answers") resetAccess();
        say(resultMessage(data), true); return;
      }
      clearCredentials();
      reading = {alias:credentials.alias,code:credentials.code,answers:answers.slice()};
      offset = 0; hasMore = data.has_more === true;
      clearAnswers(); gate = null;
      $("questionFields").replaceChildren(); $("questionForm").classList.add("hidden");
      renderNotes(data.entries); pageControls();
      say(data.entries.length ? `Ikki bosqich ham tasdiqlandi. ${data.entries.length} ta yozuv. Izoh qoldirishingiz mumkin.` : "Ikki bosqich ham tasdiqlandi. Kundalik hozircha bo‘sh.");
    } catch {
      if (seq !== readSequence) return;
      clearAnswers(); say("Javoblarni tekshirib bo‘lmadi. Qayta urinib ko‘ring.", true);
    } finally {
      answers.fill("");
      if (seq === readSequence) $("verifyBtn").disabled = false;
    }
  });
})();
