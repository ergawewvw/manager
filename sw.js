"use strict";
const CACHE="daily-diary-shell-v1-20261031";
const PATHS=["","index.html","offline.html","offline.js","drafts.js","features.js","app.js","assets/vendor/supabase-2.118.0.js","assets/logo.png","assets/favicon.png","assets/icon-192.png","assets/icon-512.png","design.css","privacy.css","privacy.js","comments.css","comments.js","manifest.webmanifest","favicon.ico"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(PATHS.map(p=>"./"+p))).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(x=>x.startsWith("daily-diary-shell-")&&x!==CACHE).map(x=>caches.delete(x)))),self.clients.claim()])));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const url=new URL(e.request.url),root=new URL("./",self.registration.scope);
  if(url.origin!==root.origin||!url.href.startsWith(root.href))return;
  const path=url.pathname.slice(root.pathname.length);
  if(!PATHS.includes(path))return; // Never cache auth, diary content, private images or API requests.
  e.respondWith(fetch(e.request).then(r=>{if(r.ok)caches.open(CACHE).then(c=>c.put(e.request,r.clone()));return r;})
    .catch(async()=>await caches.match(e.request,{ignoreSearch:true})|| (e.request.mode==="navigate"?await caches.match("./index.html"):Response.error())));
});