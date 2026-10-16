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
window.supabase = {createClient: () => ({
 auth: {
   getUser: () => mode === 'user' ? waitForReply() : Promise.resolve({data:{user}}),
   onAuthStateChange: callback => {authCallback = callback;},
   signOut: async () => {authCallback('SIGNED_OUT', null); return {};}
 },
 rpc: (name,args) => window.rpcHandler ? rpcHandler(name,args) : location.pathname.includes('visitor') || mode === 'permission' ? waitForReply() : Promise.resolve({data:true}),
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
    value:'',textContent:'',innerHTML:'',disabled:false,style:{},handlers:{},children:[],
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
  const context=vm.createContext({console,setTimeout,confirm:()=>true,addEventListener:(type,fn)=>{handlers[type]=fn;},location:{pathname:file},localStorage:{getItem(){return null;},setItem(){}},
    document:{getElementById:id=>{const found=elements.get(id)||[...elements.values()].flatMap(el=>el.children).find(el=>el.id===id);assert.ok(found,'missing element '+id);return found;},querySelectorAll:()=>[],addEventListener:(type,fn)=>{handlers[type]=fn;},body,createElement:tag=>{const node=element();node.tagName=tag;return node;}},
    window:null});
  context.window=context;
  vm.runInContext(mock,context);
  context.mode=mode;
  setup(context);
  const script=file.endsWith('.html') && !['visitor.html','sharing.html'].includes(file)? [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]:fs.readFileSync(path.join(root,file==='sharing.html'?'sharing.js':'visitor.js'),'utf8');
  vm.runInContext(script,context,{filename:file});
  return {context,handlers,get:id=>elements.get(id),hidden:id=>elements.get(id).classList.contains('hidden')};
}
const settle = () => new Promise(resolve=>setImmediate(resolve));
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
test('month and search filters show a distinct no-match result',async()=>{
 const p=page('index.html');await settle();
 p.get('monthFilter').value='2020-01';await p.get('monthFilter').fire('input');
 assert.match(p.get('entriesList').innerHTML,/mos yozuv topilmadi/);assert.equal(p.get('resultsCount').textContent,'0 / 1 ta yozuv');
 await p.get('clearFilters').fire('click');assert.match(p.get('entriesList').innerHTML,/Private title/);
 p.get('searchInput').value='No matching words';await p.get('searchInput').fire('input');assert.match(p.get('entriesList').innerHTML,/mos yozuv topilmadi/);
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
test('pagination loads beyond the first database page',async()=>{
 let ranges=[];
 const p=page('index.html','normal',context=>{
  context.queryHandler=()=>{
   let offset=0;const query={select:()=>query,eq:()=>query,order:()=>query,range:(start,end)=>{offset=start;ranges.push([start,end]);return query;},
    then:resolve=>Promise.resolve({data:offset===0?Array.from({length:500},(_,id)=>({id,title:'Page one',content:'text',entry_date:'2026-10-01',created_at:'2026-10-01'})):[{id:501,title:'Last page',content:'text',entry_date:'2026-09-01',created_at:'2026-09-01'}]}).then(resolve)};return query;
  };
 });await settle();assert.deepEqual(ranges,[[0,499],[500,999]]);assert.equal(p.get('totalStat').textContent,501);assert.match(p.get('entriesList').innerHTML,/Last page/);
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
test('JSON backup includes all loaded notes even with an empty search result',async()=>{
 const p=page('index.html');await settle();p.get('searchInput').value='no match';await p.get('searchInput').fire('input');
 let downloaded;p.context.Blob=Blob;p.context.URL={createObjectURL:blob=>{downloaded=blob;return 'blob:test';},revokeObjectURL(){}};
 await p.get('exportBtn').fire('click');const backup=JSON.parse(await downloaded.text());
 assert.equal(backup.version,1);assert.equal(backup.entries.length,1);assert.equal(backup.entries[0].title,'Private title');
 assert.equal(backup.entries[0].user_id,undefined);assert.equal(backup.entries[0].id,undefined);
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
