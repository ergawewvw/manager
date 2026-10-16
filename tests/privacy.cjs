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
 rpc: () => location.pathname.includes('visitor') || mode === 'permission' ? waitForReply() : Promise.resolve({data:true}),
 from: () => {
   const query = {select:()=>query,eq:()=>query,order:()=>query,
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
    focus(){},scrollIntoView(){},reset(){}
  };
}
function page(file, mode = 'normal') {
  const html = fs.readFileSync(path.join(root,file),'utf8');
  const elements = new Map();
  for(const tag of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) elements.set(tag[1],element(/class="([^"]*)"/.exec(tag[0])?.[1]));
  if(elements.has('entryForm')) elements.get('entryForm').reset=()=>{
    for(const id of ['editId','entryTitle','entryDate','entryContent']) elements.get(id).value='';
  };
  const body=element();
  const context=vm.createContext({console,setTimeout,location:{pathname:file},localStorage:{getItem(){return null;},setItem(){}},
    document:{getElementById:id=>{assert.ok(elements.has(id),'missing element '+id);return elements.get(id);},querySelectorAll:()=>[],body,createElement:()=>element()},
    window:null});
  context.window=context;
  vm.runInContext(mock,context);
  context.mode=mode;
  const script=file==='index.html'? [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]:fs.readFileSync(path.join(root,'visitor.js'),'utf8');
  vm.runInContext(script,context,{filename:file});
  return {context,get:id=>elements.get(id),hidden:id=>elements.get(id).classList.contains('hidden')};
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
test('closing a guest read discards its response while a fresh read succeeds',async()=>{
  const p=page('visitor.html');p.get('alias').value='diary';p.get('code').value='a'.repeat(32);
  const first=p.get('accessForm').fire('submit');assert.equal(p.hidden('closeBtn'),false);
  await p.get('closeBtn').fire('click');p.get('code').value='b'.repeat(32);
  const second=p.get('accessForm').fire('submit');assert.equal(p.context.pending.length,2);
  p.context.resolvePending({data:[{title:'Stale note',content:'secret',entry_date:'2026-10-16'}]});await first;
  assert.equal(p.hidden('readSection'),true);assert.equal(p.get('notes').children.length,0);
  assert.equal(p.get('openBtn').disabled,true);assert.equal(p.get('code').value,'b'.repeat(32));
  p.context.resolvePending({data:[{title:'Current note',content:'allowed',entry_date:'2026-10-16'}]});await second;
  assert.equal(p.hidden('readSection'),false);assert.equal(p.get('notes').children[0].children[0].textContent,'Current note');
  await p.get('closeBtn').fire('click');assert.equal(p.get('notes').children.length,0);assert.equal(p.get('code').value,'');
});
test('closing a guest read also ignores a late rejected request',async()=>{
  const p=page('visitor.html');p.get('alias').value='diary';p.get('code').value='a'.repeat(32);
  const request=p.get('accessForm').fire('submit');await p.get('closeBtn').fire('click');
  p.context.resolvePending({error:{message:'Old request failed'}});await request;
  assert.equal(p.get('message').textContent,'Kundalik yopildi.');assert.equal(p.hidden('readSection'),true);
});
