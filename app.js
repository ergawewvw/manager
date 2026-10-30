"use strict";
(() => {
  const $ = id => document.getElementById(id);
  if (!window.supabase?.createClient) {
    $("message").textContent = "Ilova yuklanmadi. Internetni tekshirib, sahifani yangilang.";
    return;
  }
  const client = window.supabase.createClient("https://pmdgnhkbmarvtvfprdsy.supabase.co", "sb_publishable_XVoP3QTblvFdhjs157vaWQ_yXTaYtE8", {
    global: { fetch: async (input, init = {}) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (init.signal?.aborted) abort();
      else init.signal?.addEventListener("abort",abort,{once:true});
      const timer = setTimeout(abort,20000);
      try { return await fetch(input,{...init,signal:controller.signal}); }
      finally { clearTimeout(timer); init.signal?.removeEventListener("abort",abort); }
    } }
  });
  let currentUser = null, entries = [], busy = false, loadingEntries = false;
  let fetchSequence = 0, sessionSequence = 0, detailSequence = 0, backupSequence = 0;
  let formSnapshot = "", cursor = null, pageHistory = [], hasMore = false, searchTimer;
  let stats = { total:0, today:0, month:0 }, backupBusy = false, recoveryMode = false;
  let authBusy = false, emailCooldownUntil = 0;
  let readerComments = null;
  const redirectUrl = () => new URL("./index.html", window.location.href).href;
  function localDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  function escapeHTML(s = "") {
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  }
  function formatDate(value) {
    const [y,m,d] = value.split("-").map(Number);
    return new Date(y,m-1,d).toLocaleDateString("uz-UZ", {day:"numeric",month:"long",year:"numeric"});
  }
  function postedAt(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return "Joylangan: " + date.toLocaleString("uz-UZ", {day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false});
  }
  function showMessage(text, error = false) { $("message").textContent = text; $("message").style.color = error ? "var(--danger)" : "var(--accent)"; }
  function showSaveMessage(text, error = false) { $("saveMessage").textContent = text; $("saveMessage").style.color = error ? "var(--danger)" : "var(--muted)"; }
  function authError(error) {
    const messages = {
      invalid_credentials:"Email yoki parol noto‘g‘ri.", email_not_confirmed:"Emailingiz tasdiqlanmagan. «Tasdiqlash xatini qayta yuborish» tugmasidan foydalaning.",
      signup_disabled:"Ro‘yxatdan o‘tish vaqtincha yopilgan.", over_email_send_rate_limit:"Xat yuborish chegarasiga yetildi. Biroz kutib, qayta urinib ko‘ring.",
      over_request_rate_limit:"So‘rovlar ko‘payib ketdi. Birozdan keyin qayta urinib ko‘ring.", weak_password:"Kuchliroq, kamida 8 belgili parol tanlang.",
      same_password:"Yangi parol eskisidan farq qilishi kerak.", otp_expired:"Havolaning muddati tugagan. Yangi xat so‘rang.",
      user_already_exists:"Bu email bilan akkaunt mavjud. Kirish yoki parolni tiklashdan foydalaning."
    };
    return messages[error?.code] || (error?.name === "TimeoutError" ? "So‘rov vaqti tugadi. Internetni tekshirib, qayta urinib ko‘ring." : error?.message || "Ulanishda xatolik. Qayta urinib ko‘ring.");
  }
  function editorSnapshot() { return JSON.stringify([$("editId").value,$("entryTitle").value,$("entryDate").value,$("entryContent").value]); }
  function hasDraft() { return formSnapshot !== editorSnapshot(); }
  function mayDiscard() { return !hasDraft() || confirm("Saqlanmagan o‘zgarishlar bor. Ularni bekor qilasizmi?"); }
  function updateWordCount() {
    const text = $("entryContent").value;
    $("wordCount").textContent = `${text.trim() ? text.trim().split(/\s+/u).length : 0} ta so‘z · ${text.length} belgi`;
  }
  function setEditorBusy(value, seq = sessionSequence) {
    if (seq !== sessionSequence) return;
    busy = value;
    for (const id of ["saveBtn","newBtn","cancelBtn","entryTitle","entryDate","entryContent"]) $(id).disabled = value;
    updateControls();
  }
  function updateControls() {
    $("prevPageBtn").disabled = loadingEntries || busy || pageHistory.length === 0;
    $("nextPageBtn").disabled = loadingEntries || busy || !hasMore;
    $("exportBtn").disabled = !currentUser || busy || backupBusy || stats.total === 0;
    $("importBtn").disabled = !currentUser || busy || backupBusy;
    $("searchInput").disabled = backupBusy;
    $("monthFilter").disabled = backupBusy;
    $("clearFilters").disabled = backupBusy;
    $("pageLabel").textContent = `${pageHistory.length + 1}-sahifa`;
  }
  function closeReader() {
    detailSequence++;
    readerComments?.dispose(); readerComments = null;
    $("readerComments").replaceChildren();
    for (const id of ["readerTitle","readerDate","readerContent"]) $(id).textContent = "";
    $("readerCard").classList.add("hidden");
  }
  function clearPrivateState() {
    sessionSequence++; fetchSequence++; backupSequence++;
    clearTimeout(searchTimer);
    currentUser = null; entries = []; stats = { total:0,today:0,month:0 };
    cursor = null; pageHistory = []; hasMore = false; loadingEntries = false; backupBusy = false; recoveryMode = false;
    closeReader(); setEditorBusy(false); resetForm();
    for (const id of ["searchInput","monthFilter","password","newPassword","confirmPassword","importFile"]) $(id).value = "";
    for (const id of ["userLabel","backupMessage","recoveryMessage"]) $(id).textContent = "";
    $("authView").classList.remove("hidden");
    for (const id of ["appView","recoveryView","adminLink","sharingLink","mobileSharingLink","mobileAdminLink","retryBtn"]) $(id).classList.add("hidden");
    render();
  }
  async function updateAdminUI() {
    const ownerId = currentUser?.id, seq = sessionSequence;
    if (!ownerId) return;
    try {
      const { data,error } = await client.rpc("am_i_diary_admin");
      if (seq !== sessionSequence || ownerId !== currentUser?.id) return;
      for (const id of ["sharingLink","mobileSharingLink","adminLink","mobileAdminLink"]) $(id).classList.toggle("hidden", !!error || data !== true);
    } catch { /* The diary remains usable if the optional admin check is unavailable. */ }
  }
  function setAuthBusy(value) {
    authBusy = value;
    for (const id of ["authSubmit","signupBtn","forgotBtn","resendBtn"]) $(id).disabled = value;
  }
  function validEmail() {
    const email = $("email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showMessage("To‘g‘ri email manzilini kiriting.",true); return null; }
    return email;
  }
  $("authForm").addEventListener("submit", async event => {
    event.preventDefault(); if (authBusy) return;
    const email = validEmail(); if (!email) return;
    setAuthBusy(true); showMessage("Tekshirilmoqda...");
    try {
      const { error } = await client.auth.signInWithPassword({email,password:$("password").value});
      if (error) throw error;
      $("password").value = ""; await checkSession();
    } catch (error) { showMessage(authError(error),true); }
    finally { setAuthBusy(false); }
  });
  $("signupBtn").addEventListener("click", async () => {
    if (authBusy) return;
    const email = validEmail(), password = $("password").value;
    if (!email) return;
    if (password.length < 8 || password.length > 128) { showMessage("Parol 8–128 belgidan iborat bo‘lsin.",true); return; }
    setAuthBusy(true); showMessage("Akkaunt yaratilmoqda...");
    try {
      const { data,error } = await client.auth.signUp({email,password,options:{emailRedirectTo:redirectUrl()}});
      if (error) throw error;
      $("password").value = "";
      if (data?.session) await checkSession();
      else { emailCooldownUntil = Date.now()+60000; showMessage("So‘rov qabul qilindi. Emailingizdagi tasdiqlash havolasini oching. Spam papkasini ham tekshiring."); }
    } catch (error) { showMessage(authError(error),true); }
    finally { setAuthBusy(false); }
  });
  async function sendAuthEmail(kind) {
    if (authBusy) return;
    const email = validEmail(); if (!email) return;
    if (Date.now()<emailCooldownUntil) { showMessage(`Qayta xat so‘rashdan oldin ${Math.ceil((emailCooldownUntil-Date.now())/1000)} soniya kuting.`,true); return; }
    setAuthBusy(true); showMessage("Xat so‘ralmoqda...");
    try {
      const result = kind === "recovery"
        ? await client.auth.resetPasswordForEmail(email,{redirectTo:redirectUrl()})
        : await client.auth.resend({type:"signup",email,options:{emailRedirectTo:redirectUrl()}});
      if (result.error) throw result.error;
      emailCooldownUntil = Date.now()+60000;
      showMessage("So‘rov qabul qilindi. Emailingiz va spam papkasini tekshiring. Qayta so‘rash uchun 60 soniya kuting.");
    } catch (error) { showMessage(authError(error),true); }
    finally { setAuthBusy(false); }
  }
  $("forgotBtn").addEventListener("click", () => sendAuthEmail("recovery"));
  $("resendBtn").addEventListener("click", () => sendAuthEmail("signup"));
  $("recoveryForm").addEventListener("submit", async event => {
    event.preventDefault(); if (!recoveryMode || authBusy) return;
    const password = $("newPassword").value;
    if (password.length<8 || password.length>128 || password !== $("confirmPassword").value) { $("recoveryMessage").textContent = "Kamida 8 belgili bir xil parollarni kiriting."; return; }
    const seq = sessionSequence;
    setAuthBusy(true); $("updatePasswordBtn").disabled = true;
    try {
      const { error } = await client.auth.updateUser({password});
      if (seq !== sessionSequence || !recoveryMode) return;
      if (error) throw error;
      const signout = await client.auth.signOut();
      if (signout.error) throw signout.error;
      clearPrivateState(); showMessage("Parol yangilandi. Yangi parolingiz bilan kiring.");
    } catch (error) { if (recoveryMode) $("recoveryMessage").textContent = authError(error); }
    finally { setAuthBusy(false); $("updatePasswordBtn").disabled = false; }
  });
  $("cancelRecoveryBtn").addEventListener("click", async () => {
    if (authBusy) return;
    try { const {error} = await client.auth.signOut(); if (error) throw error; clearPrivateState(); }
    catch(error) { $("recoveryMessage").textContent = authError(error); }
  });
  async function checkSession() {
    if (recoveryMode) return;
    const seq = ++sessionSequence;
    try {
      const { data,error } = await client.auth.getUser();
      if (seq !== sessionSequence || recoveryMode) return;
      if (error || !data?.user) { clearPrivateState(); return; }
      currentUser = data.user;
      $("authView").classList.add("hidden"); $("appView").classList.remove("hidden");
      $("userLabel").textContent = currentUser.email || "";
      $("pageTitle").textContent = "Shaxsiy kundaligim";
      $("todayLabel").textContent = new Date().toLocaleDateString("uz-UZ",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
      await Promise.all([loadEntries({reset:true}),updateAdminUI()]);
    } catch (error) { if (seq === sessionSequence) { clearPrivateState(); showMessage(authError(error),true); } }
  }
  async function loadEntries({reset = false} = {}) {
    const seq = ++fetchSequence, ownerId = currentUser?.id;
    if (!ownerId) return;
    if (reset) { cursor = null; pageHistory = []; }
    loadingEntries = true; hasMore = false; entries = [];
    $("retryBtn").classList.add("hidden"); updateControls();
    $("entriesList").innerHTML = '<div class="empty">Yozuvlar yuklanmoqda...</div>';
    try {
      const { data,error } = await client.rpc("get_my_diary_page", {
        p_search:$("searchInput").value.trim(),p_month:$("monthFilter").value,
        p_before_date:cursor?.entry_date || null,p_before_id:cursor?.id || null,p_today:localDate()
      });
      if (seq !== fetchSequence || ownerId !== currentUser?.id) return;
      if (error) throw error;
      if (!data || !Array.isArray(data.entries) || data.entries.length>40 || !data.stats) throw new Error("Server javobi noto‘g‘ri.");
      entries = data.entries; stats = data.stats; hasMore = data.has_more === true;
      if (!entries.length && pageHistory.length) { cursor = pageHistory.pop(); return await loadEntries(); }
      render();
    } catch (error) {
      if (seq !== fetchSequence || ownerId !== currentUser?.id) return;
      entries = []; render(); $("retryBtn").classList.remove("hidden");
      $("entriesList").innerHTML = `<div class="empty">Yuklashda xatolik: ${escapeHTML(authError(error))}</div>`;
    } finally { if (seq === fetchSequence) { loadingEntries = false; updateControls(); } }
  }
  function render() {
    $("totalStat").textContent = stats.total; $("todayStat").textContent = stats.today; $("monthStat").textContent = stats.month;
    $("resultsCount").textContent = `Bu sahifada ${entries.length} ta · jami ${stats.total} ta yozuv`;
    if (!entries.length) $("entriesList").innerHTML = stats.total
      ? '<div class="empty">Qidiruvga mos yozuv topilmadi. Qidiruv yoki oy filtrini o‘zgartiring.</div>'
      : '<div class="empty">📔<p>Hozircha yozuv yo‘q.</p><small>Birinchi kundalik yozuvingizni yarating!</small></div>';
    else $("entriesList").innerHTML = entries.map(e => `<article class="entry"><div class="entry-head"><div><h3>${escapeHTML(e.title)}</h3><div class="entry-date">${escapeHTML(formatDate(e.entry_date))} · ${escapeHTML(postedAt(e.created_at))}</div></div></div><div class="entry-content">${escapeHTML(e.preview ?? e.content ?? "")}${e.truncated ? "…" : ""}</div><div class="actions"><button class="small" data-read="${escapeHTML(e.id)}">To‘liq o‘qish</button><button class="small" data-edit="${escapeHTML(e.id)}">Tahrirlash</button><button class="small delete" data-delete="${escapeHTML(e.id)}">O‘chirish</button></div></article>`).join("");
    updateControls();
  }
  function resetForm() {
    $("entryForm").reset(); $("editId").value = ""; $("entryDate").value = localDate();
    $("editorTitle").textContent = "Yangi yozuv"; $("saveBtn").textContent = "Saqlash";
    showSaveMessage(""); formSnapshot = editorSnapshot(); updateWordCount();
  }
  function openEditor() { $("editorCard").scrollIntoView({behavior:"smooth",block:"start"}); $("entryTitle").focus({preventScroll:true}); }
  $("entryForm").addEventListener("submit", async event => {
    event.preventDefault(); if (!currentUser || busy) return;
    const title = $("entryTitle").value.trim(), content = $("entryContent").value.trim(), entry_date = $("entryDate").value, id = $("editId").value;
    if (!title || !content || !entry_date || title.length>120 || content.length>20000) { showSaveMessage("Maydonlarni to‘g‘ri to‘ldiring.",true); return; }
    const ownerId = currentUser.id, seq = sessionSequence;
    setEditorBusy(true); showSaveMessage("Saqlanmoqda...");
    try {
      let result;
      if (id) result = await client.from("diary_entries").update({title,content,entry_date,updated_at:new Date().toISOString()}).eq("id",id).eq("user_id",ownerId).select("id");
      else result = await client.from("diary_entries").insert({title,content,entry_date,user_id:ownerId}).select("id");
      if (seq !== sessionSequence || ownerId !== currentUser?.id) return;
      if (result.error) throw result.error;
      if (!result.data?.length) throw new Error("Yozuv o‘zgarmadi. Qayta urinib ko‘ring.");
      resetForm(); await loadEntries({reset:true});
      if (seq === sessionSequence && ownerId === currentUser?.id) showSaveMessage("Yozuv saqlandi ✓");
    } catch (error) { if (seq === sessionSequence && ownerId === currentUser?.id) showSaveMessage(authError(error),true); }
    finally { setEditorBusy(false,seq); }
  });
  $("entriesList").addEventListener("click", async event => {
    if (!currentUser || busy || loadingEntries) return;
    const edit = event.target.closest("[data-edit]"), del = event.target.closest("[data-delete]"), read = event.target.closest("[data-read]");
    if (read || edit) {
      const id = edit ? edit.dataset.edit : read.dataset.read;
      if (!entries.some(e => String(e.id) === id) || (edit && !mayDiscard())) return;
      const seq = sessionSequence, detail = ++detailSequence, ownerId = currentUser.id;
      setEditorBusy(true); showSaveMessage("Yozuv ochilmoqda...");
      try {
        const {data,error} = await client.from("diary_entries").select("id,title,content,entry_date,created_at").eq("id",id).eq("user_id",ownerId).single();
        if (seq !== sessionSequence || ownerId !== currentUser?.id || detail !== detailSequence) return;
        if (error || !data) throw error || new Error("Yozuv topilmadi.");
        if (edit) {
          $("editId").value = String(data.id); $("entryTitle").value = data.title; $("entryContent").value = data.content; $("entryDate").value = data.entry_date;
          $("editorTitle").textContent = "Yozuvni tahrirlash"; $("saveBtn").textContent = "Yangilash";
          formSnapshot = editorSnapshot(); updateWordCount(); openEditor();
        } else {
          $("readerTitle").textContent = data.title; $("readerDate").textContent = formatDate(data.entry_date) + " · " + postedAt(data.created_at); $("readerContent").textContent = data.content;
          readerComments?.dispose(); $("readerComments").replaceChildren();
          if (window.DiaryComments) readerComments = window.DiaryComments.mount($("readerComments"), {
            client,entryId:String(data.id),owner:true,
            isCurrent:() => detail === detailSequence && seq === sessionSequence && ownerId === currentUser?.id
          });
          $("readerCard").classList.remove("hidden"); $("readerCard").scrollIntoView({behavior:"smooth",block:"start"});
        }
        showSaveMessage("");
      } catch (error) { if (seq === sessionSequence && ownerId === currentUser?.id) showSaveMessage(authError(error),true); }
      finally { setEditorBusy(false,seq); }
    }
    if (del) {
      const id = del.dataset.delete, entry = entries.find(e => String(e.id) === id);
      if (!entry || !confirm(`"${entry.title}" yozuvini o‘chirasizmi? Uni qayta tiklab bo‘lmaydi.`)) return;
      const ownerId = currentUser.id, seq = sessionSequence;
      setEditorBusy(true); del.disabled = true;
      try {
        const {error,data} = await client.from("diary_entries").delete().eq("id",id).eq("user_id",ownerId).select("id");
        if (seq !== sessionSequence || ownerId !== currentUser?.id) return;
        if (error || !data?.length) throw error || new Error("Yozuv topilmadi.");
        if ($("editId").value === id) resetForm(); closeReader(); await loadEntries();
      } catch (error) { if (seq === sessionSequence && ownerId === currentUser?.id) showSaveMessage("O‘chirishda xatolik: "+authError(error),true); }
      finally { setEditorBusy(false,seq); del.disabled = false; }
    }
  });
  function scheduleSearch() {
    clearTimeout(searchTimer); fetchSequence++; loadingEntries = true; hasMore = false;
    entries = []; updateControls(); $("entriesList").innerHTML = '<div class="empty">Qidirilmoqda...</div>';
    searchTimer = setTimeout(() => { if (currentUser) loadEntries({reset:true}); },300);
  }
  $("searchInput").addEventListener("input",scheduleSearch);
  $("monthFilter").addEventListener("input",scheduleSearch);
  $("clearFilters").addEventListener("click", () => { clearTimeout(searchTimer); $("searchInput").value = ""; $("monthFilter").value = ""; loadEntries({reset:true}); });
  $("prevPageBtn").addEventListener("click", () => { if (!currentUser || loadingEntries || busy || !pageHistory.length) return; cursor = pageHistory.pop(); return loadEntries(); });
  $("nextPageBtn").addEventListener("click", () => { if (!currentUser || loadingEntries || busy || !hasMore || !entries.length) return; pageHistory.push(cursor); const last = entries[entries.length-1]; cursor = {entry_date:last.entry_date,id:String(last.id)}; return loadEntries(); });
  $("retryBtn").addEventListener("click", () => { if (currentUser && !busy) return loadEntries(); });
  $("closeReaderBtn").addEventListener("click",closeReader);
  $("entryForm").addEventListener("input",updateWordCount);
  window.addEventListener("beforeunload", event => { if ((currentUser && hasDraft()) || backupBusy) { event.preventDefault(); event.returnValue = ""; } });
  document.addEventListener("keydown", event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && currentUser) { event.preventDefault(); if (!busy) $("entryForm").requestSubmit(); } });
  function startBackup() { backupBusy = true; setEditorBusy(true); $("backupMessage").textContent = ""; return {seq:++backupSequence,owner:currentUser.id,session:sessionSequence}; }
  function validBackupJob(job) { return job.seq === backupSequence && job.session === sessionSequence && job.owner === currentUser?.id; }
  function endBackup(job) { if (validBackupJob(job)) { backupBusy = false; setEditorBusy(false); } }
  $("exportBtn").addEventListener("click", async () => {
    if (!currentUser || busy || backupBusy || !stats.total) return;
    const job = startBackup();
    try {
      const notes = []; let after = "0", max = null;
      while (true) {
        const {data,error} = await client.rpc("export_my_diary_page",{p_after_id:after,p_max_id:max});
        if (!validBackupJob(job)) return;
        if (error) throw error;
        if (!Array.isArray(data?.entries)) throw new Error("Zaxira javobi noto‘g‘ri.");
        notes.push(...data.entries); max = data.max_id;
        $("backupMessage").textContent = `${notes.length} ta yozuv zaxiraga olinmoqda...`;
        if (!data.has_more) break;
        if (!/^\d+$/.test(String(data.next_id)) || BigInt(data.next_id)<=BigInt(after)) throw new Error("Zaxira sahifasini olib bo‘lmadi.");
        after = data.next_id;
      }
      if (!validBackupJob(job)) return;
      const backup = {version:1,exported_at:new Date().toISOString(),entries:notes.map(({title,content,entry_date,created_at,updated_at}) => ({title,content,entry_date,created_at,updated_at}))};
      if (window.DailyDiaryExport?.postMessage) {
        window.DailyDiaryExport.postMessage(JSON.stringify({filename:`daily-diary-${localDate()}.json`,content:JSON.stringify(backup,null,2)}));
        $("backupMessage").textContent = "Android oynasida zaxira saqlanadigan joyni tanlang.";
        return;
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:"application/json;charset=utf-8"}));
      const link = document.createElement("a"); link.href = url; link.download = `daily-diary-${localDate()}.json`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
      $("backupMessage").textContent = `${notes.length} ta yozuv yuklab olindi. Faylni xavfsiz joyda saqlang.`;
    } catch (error) { if (validBackupJob(job)) $("backupMessage").textContent = "Zaxira olinmadi: "+authError(error); }
    finally { endBackup(job); }
  });
  $("importBtn").addEventListener("click", () => { if (currentUser && !busy) $("importFile").click(); });
  $("importFile").addEventListener("change", async () => {
    const file = $("importFile").files?.[0]; $("importFile").value = "";
    if (!file || !currentUser || busy || backupBusy) return;
    const job = startBackup(); let added = 0, skipped = 0;
    try {
      if (file.size>20*1024*1024) throw new Error("Fayl 20 MB dan katta. Uni kichikroq zaxiralarga ajrating.");
      const backup = JSON.parse(await file.text());
      if (!validBackupJob(job)) return;
      if (backup?.version !== 1 || !Array.isArray(backup.entries) || !backup.entries.length) throw new Error("Daily Diary JSON zaxirasini tanlang.");
      const notes = backup.entries.map(e => {
        if (typeof e?.title !== "string" || typeof e?.content !== "string" || typeof e?.entry_date !== "string") throw new Error("Zaxirada noto‘g‘ri yozuv bor.");
        const title = e.title.trim(), content = e.content.trim(), date = e.entry_date;
        if (!title || title.length>120 || !content || content.length>20000 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000") || !Number.isFinite(Date.parse(date+"T00:00:00Z")) || new Date(date+"T00:00:00Z").toISOString().slice(0,10)!==date) throw new Error("Zaxiradagi matn yoki sana noto‘g‘ri.");
        return {title,content,entry_date:date};
      });
      if (!confirm(`${notes.length} ta yozuv joriy akkauntingizga qo‘shilsinmi? Mavjud yozuvlar saqlanadi, aynan bir xil yozuvlar takrorlanmaydi.`)) return;
      for (let offset = 0; offset<notes.length; offset+=100) {
        if (!validBackupJob(job)) return;
        const {data,error} = await client.rpc("import_my_diary_entries",{p_entries:notes.slice(offset,offset+100)});
        if (!validBackupJob(job)) return;
        if (error) throw error;
        if (!Number.isInteger(data?.inserted) || !Number.isInteger(data?.skipped)) throw new Error("Zaxira javobi noto‘g‘ri.");
        added += data.inserted; skipped += data.skipped;
        $("backupMessage").textContent = `${Math.min(offset+100,notes.length)} / ${notes.length} ta yozuv tekshirildi...`;
      }
      await loadEntries({reset:true});
      if (validBackupJob(job)) $("backupMessage").textContent = `${added} ta yozuv qo‘shildi; ${skipped} ta takroriy yozuv o‘tkazib yuborildi.`;
    } catch (error) {
      if (validBackupJob(job)) {
        $("backupMessage").textContent = `${added} ta yozuv qo‘shildi. Import tugamadi: ${authError(error)} Faylni qayta yuklash mumkin; bir xil yozuvlar takrorlanmaydi.`;
        if (added) await loadEntries({reset:true});
      }
    } finally { endBackup(job); }
  });
  $("newBtn").addEventListener("click", () => { if (!busy && mayDiscard()) { detailSequence++; resetForm(); openEditor(); } });
  $("cancelBtn").addEventListener("click", () => { if (!busy && mayDiscard()) { detailSequence++; resetForm(); } });
  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => {
    if (button.dataset.view === "write" && (busy || !mayDiscard())) return;
    document.querySelectorAll("[data-view]").forEach(b => b.classList.remove("active")); button.classList.add("active");
    if (button.dataset.view === "write") { resetForm(); openEditor(); }
    else if (button.dataset.view === "entries") $("entriesCard").scrollIntoView({behavior:"smooth"});
    else window.scrollTo({top:0,behavior:"smooth"});
  }));
  function setTheme(light) { document.body.classList.toggle("light",light); try { localStorage.setItem("daily_diary_theme",light ? "light":"dark"); } catch {} }
  $("themeBtn").addEventListener("click", () => setTheme(!document.body.classList.contains("light")));
  $("mobileThemeBtn").addEventListener("click", () => setTheme(!document.body.classList.contains("light")));
  async function logout() {
    if (busy || !mayDiscard()) return;
    try { const {error} = await client.auth.signOut(); if (error) throw error; clearPrivateState(); }
    catch (error) { showSaveMessage("Chiqishda xatolik: "+authError(error),true); }
  }
  $("logoutBtn").addEventListener("click",logout); $("mobileLogoutBtn").addEventListener("click",logout);
  client.auth.onAuthStateChange((event, session) => {
    if (!session) clearPrivateState();
    else if (event === "PASSWORD_RECOVERY") {
      clearPrivateState(); recoveryMode = true; $("authView").classList.add("hidden"); $("recoveryView").classList.remove("hidden");
    } else if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && !recoveryMode && currentUser?.id !== session.user.id) {
      clearPrivateState(); setTimeout(() => { if (!recoveryMode && currentUser?.id !== session.user.id) checkSession(); },0);
    }
  });
  try { setTheme(localStorage.getItem("daily_diary_theme") === "light"); } catch { setTheme(false); }
  resetForm(); checkSession();
})();
