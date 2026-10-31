"use strict";
const {test}=require("node:test"), assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {randomUUID}=require("node:crypto");
const root=path.join(__dirname,"..");
const owner="00000000-0000-4000-a000-000000000001";
function mockElement(){
  const handlers={};
  const el={value:"",children:[],files:[],style:{},src:"",checked:false,handlers,
    classList:{states:new Set(["hidden"]),add(x){this.states.add(x)},remove(x){this.states.delete(x)},toggle(x,on){if(on)this.add(x);else this.remove(x)},contains(x){return this.states.has(x)}},
    addEventListener(type,fn){(handlers[type]||=([])).push(fn)},
    dispatchEvent(e){for(const fn of handlers[e.type]||[])fn(e);return true},
    setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end)},
    replaceChildren(){this.children=[]},
    append(...nodes){this.children.push(...nodes)},
    focus(){},setAttribute(){},removeAttribute(){},
    get selectionStart(){return this.value.length},
    get selectionEnd(){return this.value.length}
  };
  return el;
}
function harness(){
  const ids=new Map(), saved=new Map(),uploads=[], inserted=[], events={};
  const $=id=>{if(!ids.has(id))ids.set(id,mockElement());return ids.get(id)};
  const client={
    storage:{from:()=>({
      async upload(path,file){uploads.push({path,type:file.type,size:file.size});return {data:{path},error:null}},
      async createSignedUrl(path){return {data:{signedUrl:"https://example.test/private/"+path},error:null}}
    })},
    from:()=>({
      select(){return this},eq(){return this},limit(){return Promise.resolve({data:[],error:null})},
      insert(row){inserted.push(row);return {select:async()=>({data:[{id:inserted.length}],error:null})}}
    })
  };
  const drafts={
    put:async record=>{saved.set(record.key,record)},
    get:async key=>saved.get(key),
    remove:async key=>saved.delete(key),
    list:async id=>[...saved.values()].filter(x=>x.owner===id&&x.key.startsWith("queue:"+id+":")),
    remember:()=>{}
  };
  const ctx=vm.createContext({console,URL,Event,Blob,crypto:{randomUUID},navigator:{onLine:true},setTimeout,clearTimeout,
    document:{getElementById:$,createElement:()=>mockElement()},
    window:{DailyDrafts:drafts,addEventListener:(type,fn)=>{events[type]=fn},location:{reload:()=>{events.reloads=(events.reloads||0)+1}}}
  });
  const code=fs.readFileSync(path.join(root,"features.js"),"utf8");
  vm.runInContext(code,ctx,{filename:"features.js"});
  const api=ctx.window.DiaryFeatures.init({client,getUser:()=>({id:owner}),diaryMarkup:s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")});
  return {api,$,uploads,inserted,saved,events,owner};
}
test("clipboard image inserts a marker at the cursor, and upload makes a private path",async()=>{
  const p=harness(),img=new Blob(["png"],{type:"image/png"});
  p.$("entryContent").value="Old text";
  p.$("entryPhoto").files=[img];
  p.$("entryPhoto").dispatchEvent(new Event("change"));
  const content=p.$("entryContent").value;
  assert.match(content,/Old text/);
  assert.match(content,/\[\[img\|[0-9a-f-]{36}\|75\]\]/i);
  assert.equal(p.$("inlinePreview").classList.contains("hidden"),false);
  const result=await p.api.prepare(content,p.owner);
  assert.equal(p.uploads.length,1);
  assert.match(p.uploads[0].path,new RegExp("^"+p.owner+"/inline/[0-9a-f-]+\\.png$"));
  assert.match(result,new RegExp("\\[\\[photo\\|"+p.owner+"/inline/"));
  assert.doesNotMatch(result,/\[\[img\|/);
});
test("preview arrow swaps the order of two inline images",()=>{
  const p=harness();
  p.$("entryPhoto").files=[new Blob(["a"],{type:"image/png"}),new Blob(["b"],{type:"image/png"})];
  p.$("entryPhoto").dispatchEvent(new Event("change"));
  const before=[...p.$("entryContent").value.matchAll(/\[\[img\|([0-9a-f-]+)\|75\]\]/g)].map(x=>x[1]);
  assert.equal(before.length,2);
  function walk(node){return [node,...(node.children||[]).flatMap(walk)]}
  const down=walk(p.$("inlinePreview")).find(x=>x.textContent==="↓");
  assert.ok(down);
  down.dispatchEvent(new Event("click"));
  const after=[...p.$("entryContent").value.matchAll(/\[\[img\|([0-9a-f-]+)\|75\]\]/g)].map(x=>x[1]);
  assert.deepEqual(after,[before[1],before[0]]);
});
test("autosaved draft is stored locally and removed after successful save",async()=>{
  const p=harness();
  p.$("entryTitle").value="Local draft";p.$("entryContent").value="Not sent yet";p.$("entryDate").value="2026-10-31";
  await p.api.persist();
  assert.equal(p.saved.get("editing:"+p.owner).content,"Not sent yet");
  await p.api.saved();
  assert.equal(p.saved.has("editing:"+p.owner),false);
});
test("offline queued entries are scoped to account and converted into saved posts",async()=>{
  const p=harness();
  await p.api.queueOffline({title:"Offline note",content:"Testing offline",date:"2026-10-31",tags:[],pinned:false,private_only:true});
  const queue=[...p.saved.values()].filter(x=>x.kind==="queue");
  assert.equal(queue.length,1);assert.equal(queue[0].owner,p.owner);
  await p.api.login({id:p.owner});
  for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(p.inserted.length,1);
  assert.equal(p.inserted[0].title,"Offline note");
  assert.equal([...p.saved.values()].filter(x=>x.kind==="queue").length,0);
});
test("PWA manifest and service worker contain offline shell without caching private APIs",()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,"manifest.webmanifest"),"utf8"));
  assert.equal(manifest.display,"standalone");
  assert.ok(manifest.icons.some(x=>x.sizes==="192x192"));
  assert.ok(manifest.icons.some(x=>x.sizes==="512x512"));
  const sw=fs.readFileSync(path.join(root,"sw.js"),"utf8");
  for(const file of ["offline.html","offline.js","drafts.js","features.js","app.js"])assert.ok(sw.includes(file));
  assert.match(sw,/url\.origin!==root\.origin/);
  assert.doesNotMatch(sw,/supabase\.co/);
});
