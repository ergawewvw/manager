'use strict';
// Dependency-free DOM/event harness; Supabase responses are controlled, never live.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const mock = `
window.pending = [];
window.resolvePending = value => pending.shift()(value);
window.waitForReply = () => new Promise(resolve => pending.push(resolve));
window.authCallback = () => {};
window.mode = 'normal';
const user = {id:'owner',email:'owner@example.test'};
const entry = {id:1,title:'Private title',content:'Private body',entry_date:'2026-10-16',created_at:'2026-10-16',updated_at:'2026-10-16'};
window.fixtureEntries = [entry];
window.rpcCalls = [];
window.authCalls = [];
window.supabase = {createClient: () => ({
 auth: {
   signInWithPassword: async args => {authCalls.push(['login',args]);return {};},
   signUp: async args => {authCalls.push(['signup',args]);return {data:{}};},
   resetPasswordForEmail: async (...args) => {authCalls.push(['recovery',args]);return {};},
   resend: async args => {authCalls.push(['resend',args]);return {};},
   updateUser: async args => {authCalls.push(['update',args]);return {};},
   getUser: () => mode === 'user' ? waitForReply() : Promise.resolve({data:{user}}),
   onAuthStateChange: callback => {authCallback = callback;},
   signOut: async () => {authCallback('SIGNED_OUT', null); return {};}
 },
 rpc: (name,args) => {
   rpcCalls.push({name,args});
   const custom=window.rpcHandler?.(name,args);if(custom!==undefined)return custom;
   if(location.pathname.includes('visitor') || (mode === 'permission' && name==='am_i_diary_admin'))return waitForReply();
   if(name==='get_my_diary_page'){
    const selected=fixtureEntries.filter(e=>(!args.p_search||(e.title+' '+e.content).toLowerCase().includes(args.p_search.toLowerCase()))&&(!args.p_month||e.entry_date.startsWith(args.p_month))&&(!args.p_before_id||e.entry_date<args.p_before_date||(e.entry_date===args.p_before_date&&e.id<Number(args.p_before_id)))).sort((a,b)=>b.entry_date.localeCompare(a.entry_date)||b.id-a.id);
    return Promise.resolve({data:{entries:selected.slice(0,40).map(e=>({id:String(e.id),title:e.title,entry_date:e.entry_date,preview:e.content.slice(0,320),truncated:e.content.length>320})),has_more:selected.length>40,stats:{total:fixtureEntries.length,today:0,month:fixtureEntries.length}}});
   }
   if(name==='export_my_diary_page')return Promise.resolve({data:{entries:fixtureEntries,has_more:false,max_id:'1',next_id:'1'}});
   return Promise.resolve({data:true});
 },
 from: () => {
   if(window.queryHandler)return queryHandler();
   const query = {select:()=>query,eq:()=>query,order:()=>query,range:()=>query,
     then:(resolve,reject)=>Promise.resolve({data:[entry]}).then(resolve,reject)};
   return query;
 }
})};`;
function element(classes = '') {
  const tokens = new Set(classes.split(/\s+/).filter(Boolean));
  return {
    value:'',textContent:'',innerHTML:'',disabled:false,style:{},handlers:{},children:[],files:[],
    classList:{add:v=>tokens.add(v),remove:v=>tokens.delete(v),contains:v=>tokens.has(v),toggle(v,on){if(on===undefined)on=!tokens.has(v);on?tokens.add(v):tokens.delete(v);}},
    addEventListener(type,handler){this.handlers[type]=handler;},
    async fire(type){return this.handlers[type]?.({preventDefault(){},target:this});},
    append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},
    querySelectorAll(tag){return this.children.flatMap(child=>[...(child.tagName===tag?[child]:[]),...child.querySelectorAll(tag)]);},
    querySelector(tag){return this.querySelectorAll(tag)[0];},
    focus(){},scrollIntoView(){},reset(){},click(){},remove(){}
  };
}
function page(file, mode = 'normal', setup = () => {}) {
  const html = fs.readFileSync(path.join(root,file),'utf8');
  const elements = new Map();
  for(const tag of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) elements.set(tag[1],element(/class="([^"]*)"/.exec(tag[0])?.[1]));
  if(elements.has('entryForm')) elements.get('entryForm').reset=()=>{
    for(const id of ['editId','entryTitle','entryDate','entryContent']) elements.get(id).value='';
  };
  const body=element();
  const handlers={};
  const context=vm.createContext({console,setTimeout,clearTimeout,URL,confirm:()=>true,addEventListener:(type,fn)=>{handlers[type]=fn;},location:{pathname:file,href:'https://ergawewvw.github.io/manager/'+file},localStorage:{getItem(){return null;},setItem(){}},
    document:{getElementById:id=>{const found=elements.get(id)||[...elements.values()].flatMap(el=>el.children).find(el=>el.id===id);assert.ok(found,'missing element '+id);return found;},querySelectorAll:()=>[],addEventListener:(type,fn)=>{handlers[type]=fn;},body,createElement:tag=>{const node=element();node.tagName=tag;return node;}},
    window:null});
  context.window=context;
  vm.runInContext(mock,context);
  context.mode=mode;
  setup(context);
  const script=fs.readFileSync(path.join(root,({'index.html':'app.js','admin.html':'admin.js','sharing.html':'sharing.js','visitor.html':'visitor.js'})[file]),'utf8');
  vm.runInContext(script,context,{filename:file});
  return {context,handlers,get:id=>elements.get(id),hidden:id=>elements.get(id).classList.contains('hidden')};
}
const settle = () => new Promise(resolve=>setImmediate(resolve));
test('pasted screenshot is previewed without replacing typed text', async () => {
  const p=page('index.html'); await settle();
  p.get('entryContent').value='This diary entry stays intact.';
  const image=new Blob(['image'],{type:'image/png'});
  let prevented=false;
  await p.get('entryContent').handlers.paste({clipboardData:{items:[{kind:'file',type:'image/png',getAsFile:()=>image}]},preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.equal(p.get('entryContent').value,'This diary entry stays intact.');
  assert.equal(p.hidden('photoPreview'),false);
  assert.match(p.get('photoPreviewImage').src,/^blob:/);
  await p.get('removePhotoBtn').fire('click');
  assert.equal(p.hidden('photoPreview'),true);
  assert.equal(p.get('photoPreviewImage').src,'');
});
test('ordinary text paste still works', async () => {
  const p=page('index.html'); await settle();
  let prevented=false;
  await p.get('entryContent').handlers.paste({clipboardData:{items:[{kind:'string',type:'text/plain'}]},preventDefault(){prevented=true;}});
  assert.equal(prevented,false);
});
test('mood tracker UI and logic are gone', async () => {
  const p=page('index.html'); await settle();
  assert.equal(p.get('entryMood'),undefined);
  assert.equal(p.get('moodSuggestion'),undefined);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'app.js'),'utf8'),/\bmood\b|\bmoodNames\b|\binferMood\b/i);
});
test('session expiry clears notes, editor draft, search and owner identity', async () => {
  const p=page('index.html');await settle();assert.equal(p.hidden('appView'),false);
  for(const id of ['entryTitle','entryContent','searchInput'])p.get(id).value='Private draft';
  p.context.authCallback('SIGNED_OUT',null);
  assert.equal(p.hidden('appView'),true);
  for(const id of ['entryTitle','entryContent','searchInput','editId'])assert.equal(p.get(id).value,'');
  assert.equal(p.get('userLabel').textContent,'');
  assert.doesNotMatch(p.get('entriesList').innerHTML,/Private title|Private body/);
});
for(const mode of ['user','permission'])test('delayed '+mode+' verification cannot reopen a signed-out diary',async()=>{
  const p=page('index.html',mode);await settle();assert.equal(p.context.pending.length,1);
  p.context.authCallback('SIGNED_OUT',null);
  p.context.resolvePending(mode==='user'?{data:{user:{id:'owner'}}}:{data:true});await settle();
  assert.equal(p.hidden('appView'),true);assert.equal(p.hidden('adminLink'),true);
});
const challenge = {status:'questions_required',questions:[1,2,3].map(number=>({number,text:'Question '+number}))};
test('dashboard diary links prefill only the alias and still require the two-stage gate',()=>{
 const p=page('visitor.html','normal',context=>{context.location.href='https://ergawewvw.github.io/manager/visitor.html?diary=My_Diary&code=ignored&answers=ignored';});
 assert.equal(p.get('alias').value,'my_diary');assert.equal(p.get('code').value,'');
 assert.equal(p.hidden('questionForm'),true);assert.equal(p.hidden('readSection'),true);
 assert.equal(p.context.rpcCalls.length,0);assert.equal(p.context.authCalls.length,0);
});
test('malformed diary aliases in a link never populate the access form',()=>{
 for(const alias of ['<script>','a','a'.repeat(33),'../diary']){
  const p=page('visitor.html','normal',context=>{context.location.href='https://ergawewvw.github.io/manager/visitor.html?diary='+encodeURIComponent(alias);});
  assert.equal(p.get('alias').value,'');assert.equal(p.context.rpcCalls.length,0);
 }
});
test('closing a guest read discards its response while a fresh two-stage read succeeds',async()=>{
  const p=page('visitor.html');p.get('alias').value='diary';p.get('code').value='a'.repeat(32);
  const first=p.get('accessForm').fire('submit');assert.equal(p.hidden('closeBtn'),false);
  await p.get('closeBtn').fire('click');p.get('code').value='b'.repeat(32);
  const second=p.get('accessForm').fire('submit');assert.equal(p.context.pending.length,2);
  p.context.resolvePending({data:challenge});await first;
  assert.equal(p.hidden('questionForm'),true);assert.equal(p.get('notes').children.length,0);
  assert.equal(p.get('openBtn').disabled,true);
  p.context.resolvePending({data:challenge});await second;
  assert.equal(p.hidden('questionForm'),false);assert.equal(p.hidden('readSection'),true);
  for(const input of p.get('questionFields').children.filter(n=>n.tagName==='input'))input.value='fixture';
  const verify=p.get('questionForm').fire('submit');
  p.context.resolvePending({data:{status:'ok',entries:[{title:'Current note',content:'allowed',entry_date:'2026-10-16'}],has_more:false}});await verify;
  assert.equal(p.hidden('readSection'),false);assert.equal(p.get('notes').children[0].children[0].textContent,'Current note');
  await p.get('closeBtn').fire('click');assert.equal(p.get('notes').children.length,0);assert.equal(p.get('code').value,'');
});
test('closing a guest read also ignores a late rejected request',async()=>{
  const p=page('visitor.html');p.get('alias').value='diary';p.get('code').value='a'.repeat(32);
  const request=p.get('accessForm').fire('submit');await p.get('closeBtn').fire('click');
  p.context.resolvePending({error:{message:'Old request failed'}});await request;
  assert.equal(p.get('message').textContent,'Kundalik yopildi.');assert.equal(p.hidden('readSection'),true);
});
test('new/cancel preserve an unsaved draft when discard is declined',async()=>{
 const p=page('index.html');await settle();p.context.confirm=()=>false;
 p.get('entryContent').value='Keep my draft';
 await p.get('newBtn').fire('click');assert.equal(p.get('entryContent').value,'Keep my draft');
 await p.get('cancelBtn').fire('click');assert.equal(p.get('entryContent').value,'Keep my draft');
 let warned=false;p.handlers.beforeunload({preventDefault(){warned=true;}});assert.equal(warned,true);
 p.context.confirm=()=>true;await p.get('cancelBtn').fire('click');assert.equal(p.get('entryContent').value,'');
});
test('server filters reset pagination and show a distinct no-match result',async()=>{
 const p=page('index.html');await settle();let scheduled;
 p.context.setTimeout=fn=>{scheduled=fn;return 1;};p.context.clearTimeout=()=>{};
 p.get('monthFilter').value='2020-01';await p.get('monthFilter').fire('input');scheduled();await settle();
 assert.match(p.get('entriesList').innerHTML,/mos yozuv topilmadi/);assert.match(p.get('resultsCount').textContent,/0 ta · jami 1/);
 await p.get('clearFilters').fire('click');await settle();assert.match(p.get('entriesList').innerHTML,/Private title/);
 p.get('searchInput').value='No matching words';await p.get('searchInput').fire('input');scheduled();await settle();assert.match(p.get('entriesList').innerHTML,/mos yozuv topilmadi/);
 assert.equal(p.context.rpcCalls.filter(c=>c.name==='get_my_diary_page').at(-1).args.p_search,'No matching words');
});
test('word count and save shortcut work without discarding text',async()=>{
 const p=page('index.html');await settle();p.get('entryContent').value='bir ikki\nuch';await p.get('entryForm').fire('input');
 assert.match(p.get('wordCount').textContent,/3 ta so‘z/);
 let submitted=false;p.get('entryForm').requestSubmit=()=>{submitted=true;};let prevented=false;
 p.handlers.keydown({ctrlKey:true,key:'s',preventDefault(){prevented=true;}});assert.equal(submitted,true);assert.equal(prevented,true);
});
test('saving is serialized and late save responses cannot restore signed-out notes',async()=>{
 const p=page('index.html');await settle();let calls=0;
 p.context.queryHandler=()=>({insert:()=>({select:()=>{calls++;return p.context.waitForReply();}})});
 p.get('entryTitle').value='New title';p.get('entryContent').value='New body';
 const save=p.get('entryForm').fire('submit');await p.get('entryForm').fire('submit');assert.equal(calls,1);assert.equal(p.get('newBtn').disabled,true);
 p.context.authCallback('SIGNED_OUT',null);p.context.resolvePending({data:[{id:2,title:'New title',content:'New body',entry_date:'2026-10-16',created_at:'2026-10-16'}]});await save;
 assert.equal(p.hidden('appView'),true);assert.doesNotMatch(p.get('entriesList').innerHTML,/New body/);assert.equal(p.get('saveMessage').textContent,'');
});
test('initial read is bounded and keyset navigation preserves full totals',async()=>{
 const p=page('index.html','normal',context=>{context.fixtureEntries=Array.from({length:501},(_,i)=>({id:i+1,title:'Note '+(i+1),content:'body',entry_date:'2026-10-01'}));});
 await settle();assert.equal(p.context.rpcCalls.filter(c=>c.name==='get_my_diary_page').length,1);
 assert.equal(p.get('totalStat').textContent,501);assert.equal((p.get('entriesList').innerHTML.match(/<article/g)||[]).length,40);
 assert.match(p.get('entriesList').innerHTML,/Note 501/);assert.doesNotMatch(p.get('entriesList').innerHTML,/Note 461</);
 await p.get('nextPageBtn').fire('click');
 assert.equal(p.context.rpcCalls.filter(c=>c.name==='get_my_diary_page').at(-1).args.p_before_id,'462');
 assert.match(p.get('entriesList').innerHTML,/Note 461/);assert.equal(p.get('pageLabel').textContent,'2-sahifa');
 await p.get('prevPageBtn').fire('click');assert.match(p.get('entriesList').innerHTML,/Note 501/);assert.equal(p.get('pageLabel').textContent,'1-sahifa');
});
test('sharing creation/revocation cannot overlap, and sign-out erases late codes',async()=>{
 const p=page('sharing.html');await settle();assert.equal(p.hidden('ownerPanel'),false);let calls=[];
 p.context.rpcHandler=name=>{calls.push(name);return p.context.waitForReply();};p.get('alias').value='diary';p.get('days').value='7';
 const create=p.get('shareForm').fire('submit');await p.get('revokeBtn').fire('click');assert.deepEqual(calls,['create_private_diary_code']);
 p.context.authCallback('SIGNED_OUT',null);p.context.resolvePending({data:[{share_alias:'diary',share_code:'secret'}]});await create;
 assert.equal(p.hidden('ownerPanel'),true);assert.equal(p.get('outCode').textContent,'');assert.equal(p.hidden('result'),true);
});
test('a generated trust code is removed from DOM on session expiry',async()=>{
 const p=page('sharing.html');await settle();
 p.context.rpcHandler=async name=>({data:name==='create_private_diary_code'?[{share_alias:'diary',share_code:'secret'}]:[]});
 await p.get('shareForm').fire('submit');assert.equal(p.get('outCode').textContent,'secret');
 p.context.authCallback('SIGNED_OUT',null);assert.equal(p.get('outCode').textContent,'');assert.equal(p.get('outAlias').textContent,'');
});
test('admin list and a delayed refresh are cleared when the session ends',async()=>{
 const p=page('admin.html','normal',context=>{
  context.rpcHandler=async name=>({data:name==='am_i_diary_admin'?true:[{email:'private@example.test'}]});
 });await settle();assert.equal(p.get('rows').children.length,1);
 p.context.rpcHandler=()=>p.context.waitForReply();const refresh=p.get('refresh').fire('click');
 p.context.authCallback('SIGNED_OUT',null);assert.equal(p.get('rows').children.length,0);
 p.context.resolvePending({data:[{email:'private@example.test'}]});await refresh;
 assert.equal(p.get('rows').children.length,0);assert.equal(p.hidden('dashboard'),true);
});
test('JSON backup exports independently of the current search filter',async()=>{
 const p=page('index.html');await settle();p.get('searchInput').value='no match';await p.get('searchInput').fire('input');
 let downloaded;p.context.Blob=Blob;p.context.URL={createObjectURL:blob=>{downloaded=blob;return 'blob:test';},revokeObjectURL(){}};
 await p.get('exportBtn').fire('click');const backup=JSON.parse(await downloaded.text());
 assert.equal(backup.version,1);assert.equal(backup.entries.length,1);assert.equal(backup.entries[0].title,'Private title');
 assert.equal(backup.entries[0].user_id,undefined);assert.equal(backup.entries[0].id,undefined);
});
test('Android backup uses the native save picker without exporting owner identifiers',async()=>{
 const p=page('index.html');await settle();let request;
 p.context.DailyDiaryExport={postMessage:message=>{request=JSON.parse(message);}};
 await p.get('exportBtn').fire('click');
 assert.match(request.filename,/^daily-diary-[0-9-]+\.json$/);
 const backup=JSON.parse(request.content);
 assert.equal(backup.entries[0].title,'Private title');
 assert.equal(backup.entries[0].user_id,undefined);assert.equal(backup.entries[0].id,undefined);
 assert.match(p.get('backupMessage').textContent,/Android/);
});
test('failed deletion leaves the note intact and restores controls',async()=>{
 const p=page('index.html');await settle();const del={dataset:{delete:'1'},disabled:false};
 p.context.queryHandler=()=>{const query={delete:()=>query,eq:()=>query,select:async()=>({error:{message:'Connection failed'}})};return query;};
 await p.get('entriesList').handlers.click({target:{closest:selector=>selector==='[data-delete]'?del:null}});
 assert.match(p.get('entriesList').innerHTML,/Private title/);assert.match(p.get('saveMessage').textContent,/Connection failed/);
 assert.equal(del.disabled,false);assert.equal(p.get('saveBtn').disabled,false);
});
async function openGuestChallenge(p) {
 p.get('alias').value='diary';p.get('code').value='a'.repeat(32);
 const request=p.get('accessForm').fire('submit');p.context.resolvePending({data:challenge});await request;
 for(const input of p.get('questionFields').children.filter(n=>n.tagName==='input'))input.value='fixture';
}
test('guest reader mounts comments for the correct entry and disposes them when closed',async()=>{
 let mounted,disposed=false;
 const p=page('visitor.html','normal',context=>{context.DiaryComments={mount:(container,options)=>{mounted=options;return {dispose(){disposed=true;}};}};});
 await openGuestChallenge(p);const verify=p.get('questionForm').fire('submit');
 p.context.resolvePending({data:{status:'ok',entries:[{id:'9007199254740999',title:'Fixture note',content:'body',entry_date:'2026-10-21'}],has_more:false}});await verify;
 assert.equal(mounted.entryId,'9007199254740999');assert.equal(mounted.owner,false);assert.equal(mounted.isCurrent(),true);
 assert.equal(mounted.credentials().answers[0],'fixture');
 await p.get('closeBtn').fire('click');assert.equal(disposed,true);assert.equal(mounted.isCurrent(),false);assert.equal(mounted.credentials(),null);
});
test('owner full-note reader mounts moderation and disposes comments on session expiry',async()=>{
 let mounted,disposed=false;
 const p=page('index.html','normal',context=>{context.DiaryComments={mount:(container,options)=>{mounted=options;return {dispose(){disposed=true;}};}};});await settle();
 p.context.queryHandler=()=>{const q={select:()=>q,eq:()=>q,single:async()=>({data:{id:'1',title:'Private title',content:'Private body',entry_date:'2026-10-16'}})};return q;};
 await p.get('entriesList').handlers.click({target:{closest:selector=>selector==='[data-read]'?{dataset:{read:'1'}}:null}});
 assert.equal(mounted.owner,true);assert.equal(mounted.entryId,'1');assert.equal(mounted.isCurrent(),true);
 p.context.authCallback('SIGNED_OUT',null);assert.equal(disposed,true);assert.equal(mounted.isCurrent(),false);assert.equal(p.hidden('readerCard'),true);
});
test('wrong answers reveal no notes and retain the challenge for another try',async()=>{
 const p=page('visitor.html');await openGuestChallenge(p);const verify=p.get('questionForm').fire('submit');
 p.context.resolvePending({data:{status:'invalid_answers',attempts_remaining:4}});await verify;
 assert.equal(p.hidden('readSection'),true);assert.equal(p.hidden('questionForm'),false);assert.match(p.get('message').textContent,/4/);
 assert.ok(p.get('questionFields').children.filter(n=>n.tagName==='input').every(n=>n.value===''));
});
test('closing during second-stage verification discards late private notes',async()=>{
 const p=page('visitor.html');await openGuestChallenge(p);const verify=p.get('questionForm').fire('submit');
 await p.get('closeBtn').fire('click');
 p.context.resolvePending({data:{status:'ok',entries:[{title:'Late secret',content:'private'}],has_more:false}});await verify;
 assert.equal(p.hidden('readSection'),true);assert.equal(p.get('notes').children.length,0);assert.equal(p.get('questionFields').children.length,0);
});
test('lockout clears credentials and requires the code step again',async()=>{
 const p=page('visitor.html');await openGuestChallenge(p);const verify=p.get('questionForm').fire('submit');
 p.context.resolvePending({data:{status:'blocked',blocked_until:new Date(Date.now()+900000).toISOString()}});await verify;
 assert.equal(p.hidden('questionForm'),true);assert.equal(p.hidden('accessForm'),false);assert.equal(p.get('code').value,'');assert.equal(p.get('questionFields').children.length,0);
});
test('a verified empty diary is shown as empty rather than an invalid code',async()=>{
 const p=page('visitor.html');await openGuestChallenge(p);const verify=p.get('questionForm').fire('submit');
 p.context.resolvePending({data:{status:'ok',entries:[],has_more:false}});await verify;
 assert.equal(p.hidden('readSection'),false);assert.match(p.get('message').textContent,/hozircha bo‘sh/);
});

test('a stale page response cannot replace a newer filter result',async()=>{
 const p=page('index.html','normal',context=>{context.fixtureEntries=Array.from({length:45},(_,i)=>({id:i+1,title:'Note '+i,content:'text',entry_date:'2026-10-01'}));});await settle();
 p.context.rpcHandler=name=>name==='get_my_diary_page'?p.context.waitForReply():undefined;
 const old=p.get('nextPageBtn').fire('click');let scheduled;
 p.context.setTimeout=fn=>{scheduled=fn;return 1;};p.context.clearTimeout=()=>{};
 p.get('searchInput').value='fresh';await p.get('searchInput').fire('input');scheduled();
 p.context.resolvePending({data:{entries:[{id:'1',title:'Old result',entry_date:'2026-10-01'}],stats:{total:45,today:0,month:45},has_more:false}});await old;
 assert.doesNotMatch(p.get('entriesList').innerHTML,/Old result/);
 p.context.resolvePending({data:{entries:[{id:'2',title:'Fresh result',entry_date:'2026-10-01'}],stats:{total:45,today:0,month:45},has_more:false}});await settle();
 assert.match(p.get('entriesList').innerHTML,/Fresh result/);assert.equal(p.get('pageLabel').textContent,'1-sahifa');
});
test('export collects every backup page and excludes owner IDs',async()=>{
 const p=page('index.html');await settle();let pageNo=0,downloaded;
 p.context.rpcHandler=name=>name==='export_my_diary_page'?Promise.resolve({data:{entries:[{title:'Backup '+(++pageNo),content:'Full body',entry_date:'2026-10-01',user_id:'not-exported'}],has_more:pageNo===1,next_id:String(pageNo),max_id:'2'}}):undefined;
 p.context.Blob=Blob;p.context.URL={createObjectURL:blob=>{downloaded=blob;return 'blob:test';},revokeObjectURL(){}};
 await p.get('exportBtn').fire('click');const backup=JSON.parse(await downloaded.text());
 assert.equal(backup.entries.length,2);assert.equal(backup.entries[1].title,'Backup 2');assert.equal(backup.entries[0].user_id,undefined);
});
test('sign-out cancels an in-progress export before a file can be downloaded',async()=>{
 const p=page('index.html');await settle();let downloaded=false;
 p.context.rpcHandler=name=>name==='export_my_diary_page'?p.context.waitForReply():undefined;
 p.context.Blob=Blob;p.context.URL={createObjectURL(){downloaded=true;return 'blob:test';},revokeObjectURL(){}};
 const task=p.get('exportBtn').fire('click');p.context.authCallback('SIGNED_OUT',null);
 p.context.resolvePending({data:{entries:[{title:'Private export',content:'body'}],has_more:false}});await task;
 assert.equal(downloaded,false);assert.equal(p.get('backupMessage').textContent,'');
});
test('import strips untrusted owner IDs and reports duplicate skips',async()=>{
 const p=page('index.html');await settle();let batch;
 p.context.rpcHandler=(name,args)=>{if(name==='import_my_diary_entries'){batch=args.p_entries;return Promise.resolve({data:{inserted:0,skipped:1}});}};
 const json={version:1,entries:[{title:'Restored',content:'private text',entry_date:'2026-10-01',user_id:'another-owner',id:900}]};
 p.get('importFile').files=[{size:500,text:async()=>JSON.stringify(json)}];
 await p.get('importFile').fire('change');assert.equal(batch.length,1);assert.equal(batch[0].user_id,undefined);assert.equal(batch[0].id,undefined);
 assert.match(p.get('backupMessage').textContent,/0 ta yozuv qo‘shildi; 1 ta takroriy/);
});
test('invalid backup dates abort before any import is sent',async()=>{
 const p=page('index.html');await settle();
 p.get('importFile').files=[{size:100,text:async()=>JSON.stringify({version:1,entries:[{title:'Bad date',content:'body',entry_date:'2026-02-30'}]})}];
 await p.get('importFile').fire('change');assert.equal(p.context.rpcCalls.filter(c=>c.name==='import_my_diary_entries').length,0);
 assert.match(p.get('backupMessage').textContent,/noto‘g‘ri/);assert.equal(p.get('saveBtn').disabled,false);
});
test('a late full-note response is discarded after sign-out',async()=>{
 const p=page('index.html');await settle();
 p.context.queryHandler=()=>{const q={select:()=>q,eq:()=>q,single:()=>p.context.waitForReply()};return q;};
 const read={dataset:{read:'1'}};
 const task=p.get('entriesList').handlers.click({target:{closest:s=>s==='[data-read]'?read:null}});
 p.context.authCallback('SIGNED_OUT',null);p.context.resolvePending({data:{id:'1',title:'Late secret',content:'Hidden full body',entry_date:'2026-10-01'}});await task;
 assert.equal(p.hidden('readerCard'),true);assert.equal(p.get('readerContent').textContent,'');
});
test('recovery events open the password form without exposing the diary',async()=>{
 const p=page('index.html');await settle();p.context.authCallback('PASSWORD_RECOVERY',{user:{id:'owner'}});
 assert.equal(p.hidden('appView'),true);assert.equal(p.hidden('recoveryView'),false);
 p.get('newPassword').value='different1';p.get('confirmPassword').value='different2';await p.get('recoveryForm').fire('submit');
 assert.equal(p.context.authCalls.filter(c=>c[0]==='update').length,0);
 p.get('confirmPassword').value='different1';await p.get('recoveryForm').fire('submit');
 assert.equal(p.context.authCalls.filter(c=>c[0]==='update').length,1);assert.equal(p.hidden('recoveryView'),true);
 assert.equal(p.get('newPassword').value,'');assert.match(p.get('message').textContent,/Parol yangilandi/);
});
test('confirmation email requests include the production redirect and enforce a cooldown',async()=>{
 const p=page('index.html');await settle();p.context.authCallback('SIGNED_OUT',null);p.get('email').value='fixture@example.test';
 await p.get('resendBtn').fire('click');await p.get('resendBtn').fire('click');
 const calls=p.context.authCalls.filter(c=>c[0]==='resend');assert.equal(calls.length,1);
 assert.equal(calls[0][1].options.emailRedirectTo,'https://ergawewvw.github.io/manager/index.html');
 assert.match(p.get('message').textContent,/soniya kuting/);
});
test('guest verification loads one page and later pages are reverified and discarded on close',async()=>{
 const p=page('visitor.html');await openGuestChallenge(p);let verify=p.get('questionForm').fire('submit');
 p.context.resolvePending({data:{status:'ok',entries:[{title:'First page',content:'body',entry_date:'2026-10-01'}],has_more:true,next_offset:40}});await verify;
 assert.equal(p.context.pending.length,0);assert.equal(p.get('guestNextBtn').disabled,false);
 let requested;
 p.context.rpcHandler=(name,args)=>{requested={name,args:{...args,p_answers:args.p_answers.slice()}};return p.context.waitForReply();};
 const next=p.get('guestNextBtn').fire('click');assert.equal(requested.args.p_offset,40);assert.deepEqual(Array.from(requested.args.p_answers),['fixture','fixture','fixture']);
 await p.get('closeBtn').fire('click');p.context.resolvePending({data:{status:'ok',entries:[{title:'Late page',content:'private'}],has_more:false}});await next;
 assert.equal(p.hidden('readSection'),true);assert.equal(p.get('notes').children.length,0);assert.equal(p.get('guestNextBtn').disabled,true);
});
