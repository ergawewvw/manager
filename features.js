"use strict";
(() => {
  const token=/\[\[(img|photo)\|([0-9a-zA-Z_./-]+)\|(25|50|75|100)\]\]/g;
  const localMarker=(id,width=75)=>"[[img|"+id+"|"+width+"]]";
  const allowed=file=>file&&["image/png","image/jpeg","image/webp"].includes(file.type)&&file.size>0&&file.size<=5242880;
  const localId=id=>/^[0-9a-f-]{36}$/i.test(id);
  function init({client,getUser,diaryMarkup}){
    const $=id=>document.getElementById(id),drafts=window.DailyDrafts;
    const images=new Map(),urls=new Map();
    let timer=null,restoring=false,syncing=false,owner=null;
    const entry=$("entryContent"),input=$("entryPhoto"),preview=$("inlinePreview"),status=$("draftStatus");
    function own(){return getUser()?.id||null;}
    function signature(){return [...images].map(([id,file])=>[id,file.size,file.lastModified]);}
    function clearFiles(){
      for(const url of urls.values())URL.revokeObjectURL(url);
      urls.clear();images.clear();
      if(preview){preview.replaceChildren();preview.classList.add("hidden");}
    }
    function reset(){clearTimeout(timer);clearFiles();if(status)status.textContent="";if(input)input.value="";}
    function localUrl(id,file){
      if(!urls.has(id))urls.set(id,URL.createObjectURL(file));
      return urls.get(id);
    }
    function emitChange(){
      entry.dispatchEvent(new Event("input",{bubbles:true}));
      renderPreview();scheduleSave();
    }
    function insertFile(file){
      if(!allowed(file)){status.textContent="Faqat JPG, PNG, WebP — 5 MB gacha.";return;}
      if(images.size>=8){status.textContent="Bir postga ko‘pi bilan 8 ta yangi rasm qo‘shing.";return;}
      const id=crypto.randomUUID();
      images.set(id,file);
      const pos=typeof entry.selectionStart==="number"?entry.selectionStart:entry.value.length;
      const end=typeof entry.selectionEnd==="number"?entry.selectionEnd:pos;
      const marker="\n"+localMarker(id)+"\n";
      if(entry.setRangeText)entry.setRangeText(marker,pos,end,"end");
      else entry.value=entry.value.slice(0,pos)+marker+entry.value.slice(end);
      emitChange();entry.focus();
      status.textContent="Rasm kursor turgan joyga qo‘yildi. Pastda to‘liq ko‘rinishi bor.";
    }
    // Capture ensures previous single-photo handler does not attach the image twice.
    input.addEventListener("change",e=>{
      e.stopImmediatePropagation();
      if(!own())return;
      for(const file of Array.from(input.files||[]))insertFile(file);
      input.value="";
    },true);
    entry.addEventListener("paste",e=>{
      const photo=Array.from(e.clipboardData?.items||[]).find(item=>item.kind==="file"&&item.type.startsWith("image/"));
      if(!photo||!own())return;
      e.preventDefault();e.stopImmediatePropagation();insertFile(photo.getAsFile());
    },true);
    function pieces(container,text,authorizedOwner,editable){
      container.replaceChildren();
      let cursor=0;
      for(const found of String(text||"").matchAll(token)){
        const prefix=text.slice(cursor,found.index);
        if(prefix){
          const node=document.createElement("div");
          node.style.whiteSpace="pre-wrap";
          node.innerHTML=diaryMarkup(prefix);
          container.append(node);
        }
        cursor=found.index+found[0].length;
        const wrap=document.createElement("div"),img=document.createElement("img");
        wrap.style.cssText="margin:12px 0;max-width:100%;";
        img.alt="Kundalik rasmi";img.loading="lazy";
        img.style.cssText="display:block;max-width:100%;max-height:580px;object-fit:contain;border-radius:10px";
        img.style.width=found[3]+"%";
        wrap.append(img);
        if(found[1]==="img"&&images.has(found[2])){
          img.src=localUrl(found[2],images.get(found[2]));
        }else if(found[1]==="photo" && found[2].startsWith(authorizedOwner+"/") && /^[a-z0-9_./-]+$/i.test(found[2])){
          client.storage.from("diary-photos").createSignedUrl(found[2],300).then(({data,error})=>{
            if(!error&&data?.signedUrl&&own()===authorizedOwner&&img.isConnected)img.src=data.signedUrl;
          }).catch(()=>{});
        }else{
          const note=document.createElement("small");
          note.textContent="Rasm topilmadi.";wrap.append(note);
        }
        if(editable){
          const controls=document.createElement("div");controls.style.cssText="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0";
          for(const [label,next] of [["−",Math.max(25,Number(found[3])-25)],["+",Math.min(100,Number(found[3])+25)]]){
            const b=document.createElement("button");b.type="button";b.className="btn";b.textContent=label;b.title="Rasm eni "+next+"%";
            b.addEventListener("click",()=>{
              entry.value=entry.value.replace(found[0],"[["+found[1]+"|"+found[2]+"|"+next+"]]");
              emitChange();
            });controls.append(b);
          }
          const remove=document.createElement("button");remove.className="btn";remove.type="button";remove.textContent="Olib tashlash";
          remove.addEventListener("click",()=>{entry.value=entry.value.replace(found[0],"");emitChange();});
          controls.append(remove);wrap.append(controls);
        }
        container.append(wrap);
      }
      const tail=text.slice(cursor);
      if(tail){const el=document.createElement("div");el.style.whiteSpace="pre-wrap";el.innerHTML=diaryMarkup(tail);container.append(el);}
    }
    function renderPreview(){
      const text=entry.value||"";
      const shown=text.includes("[[img|")||text.includes("[[photo|");
      preview.classList.toggle("hidden",!shown);
      if(shown&&own())pieces(preview,text,own(),true);
      else preview.replaceChildren();
    }
    function snapshot(id){
      return {owner:id,key:"editing:"+id,kind:"editing",title:$("entryTitle").value,
        date:$("entryDate").value,content:entry.value,editId:$("editId").value,
        tags:$("entryTags").value,pinned:$("entryPinned").checked,
        private_only:$("entryPrivate").checked,
        images:[...images].map(([key,file])=>({id:key,file})),savedAt:Date.now()};
    }
    async function persist(){
      const id=own();
      if(!id||!drafts||restoring)return;
      const item=snapshot(id);
      if(!item.title&&!item.content&&!item.images.length)return;
      try{await drafts.put(item);if(own()===id)status.textContent="✓ Qoralama qurilmada saqlandi.";}
      catch(e){if(own()===id)status.textContent="Qoralama saqlanmadi: "+e.message;}
    }
    function scheduleSave(){
      if(!own()||restoring||!drafts)return;
      clearTimeout(timer);status.textContent="Qoralama saqlanmoqda...";
      timer=setTimeout(()=>void persist(),650);
    }
    $("entryForm").addEventListener("input",()=>{renderPreview();scheduleSave();});
    $("entryForm").addEventListener("change",scheduleSave);
    async function restore(id){
      const item=await drafts.get("editing:"+id).catch(()=>null);
      if(!item||own()!==id||!(item.content||item.title))return;
      if(!confirm("Saqlanmagan kundalik qoralamasi topildi. Uni tiklaysizmi?"))return;
      restoring=true;
      try{
        clearFiles();
        $("editId").value=item.editId||"";$("entryTitle").value=item.title||"";
        $("entryDate").value=item.date||$("entryDate").value;entry.value=item.content||"";
        $("entryTags").value=item.tags||"";$("entryPinned").checked=!!item.pinned;
        $("entryPrivate").checked=!!item.private_only;
        for(const photo of item.images||[])if(localId(photo?.id)&&allowed(photo.file))images.set(photo.id,photo.file);
        renderPreview();status.textContent="Saqlanmagan qoralama tiklandi.";
      }finally{restoring=false;}
    }
    async function prepare(content,id,fileMap=images){
      let updated=content;
      const used=[...fileMap].filter(([imageId])=>content.includes("[[img|"+imageId+"|"));
      const count=[...content.matchAll(/\[\[(?:img|photo)\|[^\]]+\]\]/g)].length;
      if(count>8)throw new Error("Bitta postda ko‘pi bilan 8 ta rasm bo‘lishi mumkin.");
      let projected=content;
      for(const [imageId,file] of used){
        const ext=file.type==="image/png"?"png":file.type==="image/webp"?"webp":"jpg";
        projected=projected.replace(new RegExp("\\[\\[img\\|"+imageId+"\\|(25|50|75|100)\\]\\]","g"),(_,w)=>"[[photo|"+id+"/inline/"+imageId+"."+ext+"|"+w+"]]");
      }
      if(projected.length>20000)throw new Error("Rasmlar bilan matn 20000 belgidan oshib ketdi.");
      for(const [imageId,file] of used){
        if(!localId(imageId)||!allowed(file))throw new Error("Rasm noto‘g‘ri.");
        const ext=file.type==="image/png"?"png":file.type==="image/webp"?"webp":"jpg";
        const path=id+"/inline/"+imageId+"."+ext;
        const result=await client.storage.from("diary-photos").upload(path,file,{contentType:file.type,cacheControl:"60",upsert:false});
        const error=result.error;
        if(error&&String(error.statusCode)!=="409"&&!/duplicate|already exists/i.test(error.message||""))throw error;
        updated=updated.replace(new RegExp("\\[\\[img\\|"+imageId+"\\|(25|50|75|100)\\]\\]","g"),(_,width)=>"[[photo|"+path+"|"+width+"]]");
      }
      if(updated.includes("[[img|"))throw new Error("Ba’zi suratlar ushbu qurilmada topilmadi.");
      return updated;
    }
    async function queueOffline(data){
      const id=own();
      if(!id||!drafts)throw new Error("Offline saqlash mavjud emas.");
      const item={owner:id,key:"queue:"+id+":"+crypto.randomUUID(),title:data.title,content:data.content,date:data.date,
        images:[...images].map(([key,file])=>({id:key,file})),tags:data.tags,pinned:data.pinned,
        private_only:data.private_only,kind:"queue",savedAt:Date.now()};
      clearTimeout(timer);
      await drafts.put(item);
      await drafts.remove("editing:"+id);
    }
    async function syncQueue(){
      const id=own();
      if(syncing||!drafts||!id||!navigator.onLine)return;
      syncing=true;
      try{
        const list=await drafts.list(id);
        let completed=0;
        for(const item of list){
          if(own()!==id||!navigator.onLine)break;
          if(!item.title||!item.content||!item.date)continue;
          const map=new Map((item.images||[]).filter(x=>localId(x?.id)&&allowed(x.file)).map(x=>[x.id,x.file]));
          const content=await prepare(item.content,id,map);
          if(own()!==id)return;
          const previous=await client.from("diary_entries").select("id").eq("user_id",id).eq("entry_date",item.date).eq("title",item.title).eq("content",content).limit(1);
          if(previous.error)throw previous.error;
          if(!previous.data?.length){
            const inserted=await client.from("diary_entries").insert({user_id:id,title:item.title,content,entry_date:item.date,
              tags:Array.isArray(item.tags)?item.tags:[],pinned:!!item.pinned,private_only:item.private_only!==false}).select("id");
            if(inserted.error||!inserted.data?.length)throw inserted.error||new Error("Offline post yozilmadi.");
          }
          if(own()!==id)return;
          await drafts.remove(item.key);
          completed++;
          status.textContent="✓ Offline yozuvlar sinxronlandi.";
        }
        if(completed&&own()===id){
          if(typeof window.dispatchEvent==="function")window.dispatchEvent(new Event("daily-diary:sync-complete"));
          else window.location?.reload?.();
        }
      }catch(e){if(own()===id)status.textContent="Sinxronlash kutilmoqda: "+e.message;}
      finally{syncing=false;}
    }
    async function login(user){
      if(!user?.id||!drafts)return;
      owner=user.id;
      drafts.remember(owner);
      await restore(owner);
      void syncQueue();
    }
    async function saved(){
      clearTimeout(timer);
      const id=own();if(drafts&&id)await drafts.remove("editing:"+id).catch(()=>{});
    }
    function edited(){renderPreview();}
    function renderReader(content,target,id){pieces(target,content,id,false);}
    function beforeClear(){clearTimeout(timer);if(own())void persist();}
    function discard(){clearTimeout(timer);const id=own();if(drafts&&id)void drafts.remove("editing:"+id);}
    window.addEventListener("online",()=>void syncQueue());
    if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
    return {signature,reset,persist,prepare,queueOffline,renderReader,edited,login,saved,beforeClear,discard};
  }
  window.DiaryFeatures={init};
})();