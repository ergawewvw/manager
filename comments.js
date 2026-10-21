"use strict";
(() => {
  let widgetId = 0;
  function mount(container, options) {
    const prefix = `diary-comment-${++widgetId}`;
    let disposed = false, sending = false, before = null, loadSequence = 0;
    const controllers = new Set();
    let requestId = null, requestText = null;
    const alive = () => !disposed && options.isCurrent();
    const el = (tag, text, className) => {
      const node = document.createElement(tag);
      if (text) node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    const button = text => { const node = el("button", text, "comment-button"); node.type = "button"; return node; };
    container.className = "diary-comments";
    const actions = el("div", "", "comment-actions");
    const show = button("Izohlar"), write = button("Izoh yozish");
    actions.append(show, write);
    const panel = el("section"); panel.hidden = true;
    panel.setAttribute("aria-label", "Yozuvga izohlar");
    const list = el("div", "", "comment-list");
    const more = button("Oldingi izohlar"); more.hidden = true;
    panel.append(list, more);
    const form = el("form", "", "comment-form"); form.hidden = true;
    const nameStep = el("div"), bodyStep = el("div"); bodyStep.hidden = true;
    const nameLabel = el("label", "Ismingiz?"); nameLabel.htmlFor = prefix + "-name";
    const name = el("input"); name.id = nameLabel.htmlFor; name.type = "text";
    name.required = true; name.minLength = 2; name.maxLength = 60; name.autocomplete = "name";
    name.placeholder = "Ismingizni kiriting";
    const identityHint = el("p", "Ismni o‘zingiz kiritasiz; u tasdiqlangan shaxs degani emas.", "comment-hint");
    const next = button("Davom etish");
    nameStep.append(nameLabel, name, identityHint, next);
    const bodyLabel = el("label", "Izohingiz"); bodyLabel.htmlFor = prefix + "-body";
    const body = el("textarea"); body.id = bodyLabel.htmlFor; body.required = true;
    body.maxLength = 2000; body.disabled = true; body.rows = 4;
    body.placeholder = "Shu yozuv haqida fikringizni yozing…";
    const changeName = button("Ismni o‘zgartirish");
    const submit = button("Izohni yuborish"); submit.type = "submit";
    const cancel = button("Bekor qilish");
    const bodyActions = el("div", "", "comment-actions"); bodyActions.append(submit, changeName);
    bodyStep.append(bodyLabel, body, bodyActions);
    form.append(nameStep, bodyStep, cancel);
    const status = el("p", "", "comment-status");
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    container.append(actions, form, status, panel);

    function say(text) { if (alive()) status.textContent = text; }
    function advanceName() {
      if (!alive() || sending) return;
      const value = name.value.trim().replace(/\s+/gu, " ");
      if (value.length < 2 || value.length > 60 || (value.match(/\p{L}/gu) || []).length < 2 || /[<>\p{Cc}]/u.test(value)) {
        say("Ismingizni kiriting: 2–60 belgi, kamida ikkita harf."); name.focus(); return;
      }
      name.value = value; nameStep.hidden = true; bodyStep.hidden = false;
      body.disabled = false; body.focus(); say("");
    }
    function closeForm() {
      name.value = ""; body.value = ""; body.disabled = true;
      nameStep.hidden = false; bodyStep.hidden = true; form.hidden = true;
      requestId = null; requestText = null;
    }
    async function rpc(kind, extra) {
      const credentials = options.credentials?.();
      if (!alive() || (!options.owner && !credentials)) return null;
      const answers = credentials?.answers.slice();
      const controller = new AbortController(); controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const query = options.client.rpc(
          options.owner ? `${kind}_my_diary_comment${kind === "get" ? "s" : ""}` : `${kind}_private_diary_comment${kind === "get" ? "s" : ""}`,
          {p_entry_id:options.entryId,...extra,...(credentials ? {p_alias:credentials.alias,p_code:credentials.code,p_answers:answers} : {})}
        );
        const { data, error } = await (typeof query.abortSignal === "function" ? query.abortSignal(controller.signal) : query);
        if (!alive()) return null;
        if (error) throw error;
        if (!data || data.status !== "ok") {
          if (["invalid_code", "invalid_answers", "blocked", "not_configured"].includes(data?.status)) {
            options.onAccessLost?.(data); return null;
          }
          const messages = {
            rate_limited:"Izohlar juda tez yuborildi. Bir daqiqadan keyin urinib ko‘ring.",
            invalid_input:"Ism va izohni tekshiring. Izoh ko‘pi bilan 2000 belgi bo‘lsin.",
            not_found:"Yozuv yoki izoh topilmadi.", invalid_request:"So‘rovni qayta tekshirib yuboring."
          };
          throw new Error(messages[data?.status] || "Izoh bilan ishlashda xatolik.");
        }
        return data;
      } finally { clearTimeout(timer);controllers.delete(controller);answers?.fill(""); }
    }
    function renderComment(item) {
      const card = el("div", "", "diary-comment");
      const title = el("strong", item.name);
      const date = el("small", new Date(item.created_at).toLocaleString("uz-UZ"));
      const text = el("p", item.body);
      card.append(title, date, text);
      if (options.owner) {
        const remove = button("Izohni o‘chirish"); remove.classList.add("comment-delete");
        remove.addEventListener("click", async () => {
          if (!alive() || remove.disabled || !confirm("Shu izohni o‘chirasizmi?")) return;
          remove.disabled = true;
          try { const data = await rpc("delete", {p_comment_id:item.id}); if (data) await load(false); }
          catch { say("Izoh o‘chirilmadi. Qayta urinib ko‘ring."); }
          finally { if (alive()) remove.disabled = false; }
        }); card.append(remove);
      }
      return card;
    }
    async function load(append = false) {
      if (!alive()) return;
      const sequence = ++loadSequence;
      more.disabled = true; panel.hidden = false; say("Izohlar yuklanmoqda…");
      try {
        const data = await rpc("get", {p_before_id:append ? before : null});
        if (!data || !alive() || sequence !== loadSequence) return;
        if (!Array.isArray(data.comments) || data.comments.length > 20) throw new Error();
        if (!append) list.replaceChildren();
        for (const item of data.comments) list.append(renderComment(item));
        if (!append && !data.comments.length) list.append(el("p", "Hozircha izoh yo‘q.", "comment-hint"));
        before = data.comments.length ? String(data.comments[data.comments.length - 1].id) : null;
        more.hidden = data.has_more !== true || !before; say("");
      } catch { if (sequence === loadSequence) say("Izohlar yuklanmadi. «Izohlar» tugmasini bosib qayta urinib ko‘ring."); }
      finally { if (alive() && sequence === loadSequence) more.disabled = false; }
    }
    show.addEventListener("click", () => load(false));
    more.addEventListener("click", () => { if (!more.disabled && before) return load(true); });
    write.addEventListener("click", () => {
      if (!alive() || sending) return;
      form.hidden = false; (nameStep.hidden ? body : name).focus(); say("");
    });
    next.addEventListener("click", advanceName);
    changeName.addEventListener("click", () => {
      if (sending) return;
      nameStep.hidden = false; bodyStep.hidden = true; body.disabled = true; name.focus();
    });
    cancel.addEventListener("click", () => { if (!sending) {closeForm();say("");} });
    form.addEventListener("submit", async event => {
      event.preventDefault(); if (!alive() || sending) return;
      if (!nameStep.hidden && bodyStep.hidden) { advanceName(); return; }
      const value = body.value.trim();
      if (!value || value.length > 2000) {say("1–2000 belgili izoh yozing.");return;}
      const fingerprint = JSON.stringify([name.value, value]);
      if (requestText !== fingerprint) {requestText = fingerprint;requestId = crypto.randomUUID();}
      sending = true; submit.disabled = cancel.disabled = changeName.disabled = name.disabled = body.disabled = true;
      say("Izoh yuborilmoqda…");
      try {
        const data = await rpc("add", {p_name:name.value,p_body:value,p_request_id:requestId});
        if (!data || !alive()) return;
        closeForm(); await load(false); say("Izoh saqlandi.");
      } catch (error) { say(error.message?.startsWith("Izoh") || error.message?.startsWith("Ism") || error.message?.startsWith("So‘rov") || error.message?.startsWith("Yozuv") ? error.message : "Izoh yuborilmadi. Matningiz saqlandi; qayta urinib ko‘ring."); }
      finally {
        if (alive()) {sending = false;submit.disabled = cancel.disabled = changeName.disabled = name.disabled = false;body.disabled = bodyStep.hidden;}
      }
    });
    return { dispose() {
      disposed = true;loadSequence++;name.value = body.value = "";requestId = requestText = null;
      for (const controller of controllers) controller.abort(); controllers.clear();
      container.replaceChildren();options = null;
    } };
  }
  window.DiaryComments = {mount};
})();
