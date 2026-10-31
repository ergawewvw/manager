"use strict";
(() => {
  let opening;
  function db() {
    if(!indexedDB) return Promise.reject(new Error("IndexedDB mavjud emas"));
    if(!opening) opening=new Promise((resolve,reject)=>{
      const req=indexedDB.open("daily-diary-drafts-v1",1);
      req.onupgradeneeded=()=>req.result.createObjectStore("notes",{keyPath:"key"});
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    }).catch(e=>{opening=null;throw e;});
    return opening;
  }
  async function act(mode,run) {
    const connection=await db();
    return new Promise((resolve,reject)=>{
      const tx=connection.transaction("notes",mode),req=run(tx.objectStore("notes"));
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
      tx.onabort=()=>reject(tx.error);
    });
  }
  const valid=owner=>typeof owner==="string"&&/^[0-9a-f-]{36}$/i.test(owner);
  window.DailyDrafts={
    put(value){
      if(!valid(value?.owner)||!String(value.key).includes(":"+value.owner))return Promise.reject(new Error("Ega identifikatori noto‘g‘ri"));
      return act("readwrite",store=>store.put(value));
    },
    get:key=>act("readonly",store=>store.get(key)),
    remove:key=>act("readwrite",store=>store.delete(key)),
    async list(owner) {
      if(!valid(owner))return [];
      const all=await act("readonly",store=>store.getAll());
      return all.filter(x=>x.owner===owner && x.key.startsWith("queue:"+owner+":")).sort((a,b)=>a.savedAt-b.savedAt);
    },
    owner() {try{const x=localStorage.getItem("dd-last-offline-owner");return valid(x)?x:null;}catch{return null;}},
    remember(owner){if(valid(owner))try{localStorage.setItem("dd-last-offline-owner",owner);}catch{}}
  };
})();