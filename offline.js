"use strict";
(async()=>{
  const $=id=>document.getElementById(id),store=window.DailyDrafts,owner=store.owner(),files=new Map();
  if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
  $("date").value=new Date().toLocaleDateString("en-CA");
  if(!owner){
    for(const el of $("offlineForm").elements)el.disabled=true;
    $("status").textContent="Offline yozishdan oldin saytda akkauntingizga bir marta kiring.";return;
  }
  const working="offlineWorking:"+owner;
  let timer;
  function record(){return {key:working,owner,title:$("title").value,content:$("content").value,date:$("date").value,images:[...files].map(([id,file])=>({id,file})),savedAt:Date.now()};}
  async function save(){
    try{await store.put(record());$("draftStatus").textContent="✓ Qoralama qurilmada saqlandi.";}
    catch(e){$("draftStatus").textContent="Saqlash xatosi: "+e.message;}
  }
  function update(){
    $("preview").replaceChildren();
    for(const [id,file] of files)if($("content").value.includes("[[img|"+id+"|")){
      const img=document.createElement("img"),url=URL.createObjectURL(file);img.src=url;img.onload=()=>URL.revokeObjectURL(url);$("preview").append(img);
    }
    clearTimeout(timer);$("draftStatus").textContent="Saqlanmoqda...";timer=setTimeout(()=>void save(),650);
  }
  function insert(file){
    if(!file||!["image/jpeg","image/png","image/webp"].includes(file.type)||!file.size||file.size>5242880){$("status").textContent="Rasm JPG, PNG yoki WebP va 5 MB gacha bo‘lishi kerak.";return;}
    if(files.size>=8){$("status").textContent="8 tadan ortiq rasm qo‘yib bo‘lmaydi.";return;}
    const id=crypto.randomUUID();files.set(id,file);const el=$("content");
    el.setRangeText("\n[[img|"+id+"|75]]\n",el.selectionStart,el.selectionEnd,"end");update();el.focus();
  }
  $("photos").addEventListener("change",event=>{for(const f of Array.from(event.target.files||[]))insert(f);event.target.value="";});
  $("content").addEventListener("paste",event=>{const item=Array.from(event.clipboardData?.items||[]).find(x=>x.kind==="file"&&x.type.startsWith("image/"));if(item){event.preventDefault();insert(item.getAsFile());}});
  $("offlineForm").addEventListener("input",update);$("offlineForm").addEventListener("change",update);
  async function refresh(){
    $("queue").replaceChildren();
    const items=await store.list(owner);
    if(!items.length)$("queue").textContent="Navbat bo‘sh.";
    for(const item of items){
      const p=document.createElement("p"),text=document.createElement("span"),button=document.createElement("button");
      text.textContent=item.title+" · "+item.date+"   ";button.type="button";button.textContent="O‘chirish";
      button.addEventListener("click",async()=>{if(confirm("O‘chirishni tasdiqlaysizmi?")){await store.remove(item.key);await refresh();}});
      p.append(text,button);$("queue").append(p);
    }
  }
  try{
    const draft=await store.get(working);
    if(draft){
      $("title").value=draft.title||"";$("content").value=draft.content||"";$("date").value=draft.date||$("date").value;
      for(const item of draft.images||[])if(item?.id&&item.file)files.set(item.id,item.file);
      update();$("draftStatus").textContent="Oldingi qoralama tiklandi.";
    }
    await refresh();
  }catch(e){$("status").textContent=e.message;}
  $("offlineForm").addEventListener("submit",async event=>{
    event.preventDefault();clearTimeout(timer);
    const item=record(),title=item.title.trim(),content=item.content.trim();
    if(!title||!content||!item.date)return;
    const used=item.images.filter(x=>content.includes("[[img|"+x.id+"|"));
    if(/\[\[img\|/.test(content)&&used.length===0){$("status").textContent="Rasmlar topilmadi.";return;}
    try{
      await store.put({...item,key:"queue:"+owner+":"+crypto.randomUUID(),title,content,images:used,private_only:true});
      await store.remove(working);
      $("offlineForm").reset();$("date").value=new Date().toLocaleDateString("en-CA");files.clear();$("preview").replaceChildren();
      $("draftStatus").textContent="Qoralama navbatga yuborildi.";
      $("status").textContent="Internet qaytgach Daily Diary'ga kiring; navbat avtomatik sinxronlanadi.";
      await refresh();
    }catch(e){$("status").textContent="Navbat xatosi: "+e.message;}
  });
  window.addEventListener("online",()=>{$("status").textContent="Internet qaytdi. Sinxronlash uchun Daily Diary sahifasiga kiring.";});
})();