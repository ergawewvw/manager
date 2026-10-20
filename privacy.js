"use strict";
// A privacy curtain and capture deterrent, not an OS screenshot blocker.
(() => {
  const root = document.documentElement;
  const surfaces = [...document.querySelectorAll("[data-private-surface]")];
  if (!surfaces.length) return;
  let locked = false;
  let previousFocus = null;
  const previousInert = new Map();

  const dock = document.createElement("div");
  dock.id = "privacyDock";
  const hide = document.createElement("button");
  hide.type = "button";
  hide.textContent = "Yashirish · Esc";
  const hint = document.createElement("small");
  hint.textContent = "Skrinshotni to‘liq bloklab bo‘lmaydi.";
  dock.append(hide, hint);

  const curtain = document.createElement("section");
  curtain.id = "privacyCurtain";
  curtain.hidden = true;
  curtain.setAttribute("role", "dialog");
  curtain.setAttribute("aria-modal", "true");
  curtain.setAttribute("aria-labelledby", "privacyTitle");
  curtain.setAttribute("aria-describedby", "privacyDescription");
  const card = document.createElement("div");
  const title = document.createElement("h2");
  title.id = "privacyTitle";
  title.textContent = "Kundalik yashirildi";
  const description = document.createElement("p");
  description.id = "privacyDescription";
  description.textContent = "Atrofingiz xavfsiz bo‘lsa, davom eting. Saqlanmagan matningiz shu yerda qoladi. Bu ekran qulfi akkauntdan chiqarmaydi.";
  const resume = document.createElement("button");
  resume.type = "button";
  resume.textContent = "Davom etish";
  card.append(title, description, resume);
  curtain.append(card);

  const watermark = document.createElement("div");
  watermark.id = "privacyWatermark";
  watermark.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 18; i++) {
    const label = document.createElement("span");
    label.textContent = "Daily Diary";
    watermark.append(label);
  }
  document.body.append(watermark, dock, curtain);

  function active() {
    return surfaces.some(surface => !surface.hidden && getComputedStyle(surface).display !== "none");
  }
  function unlock() {
    locked = false;
    root.classList.remove("dd-locked");
    curtain.hidden = true;
    for (const [surface, inert] of previousInert) surface.inert = inert;
    previousInert.clear();
  }
  function lock() {
    if (!active() || locked) return;
    previousFocus = document.activeElement;
    locked = true;
    root.classList.add("dd-locked");
    for (const surface of surfaces) {
      previousInert.set(surface, surface.inert);
      surface.inert = true;
    }
    curtain.hidden = false;
    resume.focus({ preventScroll: true });
  }
  function sync() {
    const enabled = active();
    root.classList.toggle("dd-private", enabled);
    dock.hidden = !enabled;
    watermark.hidden = !enabled;
    if (!enabled) {
      unlock();
      previousFocus = null;
    } else if (document.hidden || !document.hasFocus()) lock();
  }
  hide.addEventListener("click", lock);
  resume.addEventListener("click", () => {
    if (document.hidden || !document.hasFocus()) return;
    unlock();
    if (previousFocus?.isConnected && !previousFocus.closest(".hidden, [hidden]")) {
      previousFocus.focus({ preventScroll: true });
    }
    previousFocus = null;
  });
  window.addEventListener("blur", lock);
  document.addEventListener("visibilitychange", () => { if (document.hidden) lock(); });
  window.addEventListener("pagehide", lock);
  window.addEventListener("pageshow", sync);
  window.addEventListener("focus", () => { if (locked) resume.focus({ preventScroll: true }); });
  window.addEventListener("beforeprint", lock);
  document.addEventListener("keydown", event => {
    // These keys are only a best effort: the OS may capture without sending an event.
    const screenshot = event.key === "PrintScreen" ||
      (event.metaKey && event.shiftKey && ["s", "3", "4", "5"].includes(event.key.toLowerCase()));
    if (active() && (event.key === "Escape" || screenshot || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p"))) {
      event.preventDefault();
      lock();
    }
    if (locked && event.key === "Tab") {
      event.preventDefault();
      resume.focus({ preventScroll: true });
    }
  }, true);
  document.addEventListener("keyup", event => { if (event.key === "PrintScreen") lock(); }, true);
  const observer = new MutationObserver(sync);
  for (const surface of surfaces) observer.observe(surface, { attributes: true, attributeFilter: ["class", "hidden", "style"] });
  sync();
})();
