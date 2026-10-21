'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
function fixture({owner=false,handler,accessLost}={}) {
 let current=true;
 const calls=[];
 function element(tag) {
  const classes=new Set();
  return {tagName:tag,children:[],hidden:false,disabled:false,value:'',textContent:'',handlers:{},
   classList:{add:x=>classes.add(x)},setAttribute(k,v){this[k]=v;},focus(){},
   append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
   addEventListener(type,fn){this.handlers[type]=fn;},
   fire(type){return this.handlers[type]?.({preventDefault(){}});}
  };
 }
 const container=element('div');
 const saved={id:'12',name:'Ali',body:'Saved comment',created_at:'2026-10-21T07:00:00Z'};
 const credentials={alias:'fixture',code:'a'.repeat(32),answers:['one','two','three']};
 const context={window:{},document:{createElement:element},crypto:webcrypto,confirm:()=>true,Date,AbortController,setTimeout,clearTimeout};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../comments.js'),'utf8'),context);
 const client={rpc(name,args){calls.push({name,args:JSON.parse(JSON.stringify(args))});return handler?.(name,args) || Promise.resolve({data:name.startsWith('get_')?{status:'ok',comments:[saved],has_more:false}:{status:'ok',comment:saved}});}};
 const widget=context.window.DiaryComments.mount(container,{client,entryId:'42',owner,credentials:owner?undefined:()=>credentials,isCurrent:()=>current,onAccessLost:data=>{current=false;accessLost?.(data);}});
 function all(node=container){return [node,...node.children.flatMap(child=>all(child))];}
 function find(text){const node=all().find(n=>n.textContent===text);assert.ok(node,'missing '+text);return node;}
 const byTag=tag=>all().filter(n=>n.tagName===tag);
 const form=byTag('form')[0],name=byTag('input')[0],body=byTag('textarea')[0];
 async function compose(text='My comment',person='Ali') {await find('Izoh yozish').fire('click');name.value=person;await find('Davom etish').fire('click');body.value=text;}
 return {container,widget,calls,credentials,form,name,body,find,all,compose,current:value=>{current=value;}};
}
test('comment composition asks for a valid name before opening the text field',async()=>{
 const p=fixture();assert.equal(p.form.hidden,true);assert.equal(p.body.disabled,true);
 await p.find('Izoh yozish').fire('click');p.name.value='123';await p.find('Davom etish').fire('click');
 assert.equal(p.body.disabled,true);assert.equal(p.calls.length,0);
 p.name.value='  Ali  Vali  ';await p.find('Davom etish').fire('click');
 assert.equal(p.body.disabled,false);assert.equal(p.name.value,'Ali Vali');
});
test('guest submission sends the correct entry, name and verified credentials without changing the source answers',async()=>{
 const p=fixture();await p.compose('  My comment  ');await p.form.fire('submit');
 const call=p.calls[0];assert.equal(call.name,'add_private_diary_comment');assert.equal(call.args.p_entry_id,'42');
 assert.equal(call.args.p_name,'Ali');assert.equal(call.args.p_body,'My comment');assert.match(call.args.p_request_id,/^[0-9a-f-]{36}$/);
 assert.deepEqual(call.args.p_answers,['one','two','three']);assert.deepEqual(p.credentials.answers,['one','two','three']);
 assert.equal(p.form.hidden,true);assert.equal(p.name.value,'');assert.equal(p.body.value,'');
 assert.ok(p.find('Izoh saqlandi.'));
});
test('pending submissions are serialized and a late result cannot restore a closed reader',async()=>{
 let resolve;
 const p=fixture({handler:name=>name.startsWith('add_')?new Promise(r=>{resolve=r;}):undefined});await p.compose();
 const pending=p.form.fire('submit');await p.form.fire('submit');assert.equal(p.calls.length,1);
 p.widget.dispose();resolve({data:{status:'ok'}});await pending;
 assert.equal(p.container.children.length,0);assert.equal(p.name.value,'');assert.equal(p.body.value,'');assert.equal(p.calls.length,1);
});
test('failed submission preserves the draft and retries with the same idempotency key',async()=>{
 let fail=true;
 const p=fixture({handler:name=>name.startsWith('add_')&&fail?Promise.reject(new Error('offline')):undefined});await p.compose('Keep this');
 await p.form.fire('submit');assert.equal(p.body.value,'Keep this');assert.equal(p.form.hidden,false);assert.equal(p.body.disabled,false);
 fail=false;await p.form.fire('submit');
 const adds=p.calls.filter(c=>c.name.startsWith('add_'));assert.equal(adds.length,2);assert.equal(adds[0].args.p_request_id,adds[1].args.p_request_id);
});
test('server-side throttling keeps the draft available',async()=>{
 const p=fixture({handler:name=>name.startsWith('add_')?Promise.resolve({data:{status:'rate_limited'}}):undefined});await p.compose();await p.form.fire('submit');
 assert.equal(p.body.value,'My comment');assert.ok(p.all().some(n=>n.textContent.includes('Bir daqiqadan')));assert.equal(p.form.hidden,false);
});
test('comment text is rendered literally without generating markup',async()=>{
 const payload='<img src=x onerror=alert(1)>';
 const p=fixture({handler:name=>name.startsWith('get_')?Promise.resolve({data:{status:'ok',comments:[{id:'1',name:'Ali',body:payload,created_at:'2026-10-21'}],has_more:false}}):undefined});
 await p.find('Izohlar').fire('click');assert.equal(p.find(payload).tagName,'p');assert.ok(!p.all().some(n=>n.tagName==='img'));
});
test('older comment pages use the last string ID as a cursor',async()=>{
 let page=0;
 const p=fixture({handler:name=>name.startsWith('get_')?Promise.resolve({data:{status:'ok',comments:[{id:page++?'5':'9007199254740999',name:'Reader',body:'Page '+page,created_at:'2026-10-21'}],has_more:page===1}}):undefined});
 await p.find('Izohlar').fire('click');await p.find('Oldingi izohlar').fire('click');
 assert.equal(p.calls[1].args.p_before_id,'9007199254740999');assert.equal(p.find('Oldingi izohlar').hidden,true);
 assert.ok(p.find('Page 1'));assert.ok(p.find('Page 2'));
});
test('a revoked guest code reports lost access and never renders comments',async()=>{
 let lost;
 const p=fixture({accessLost:data=>{lost=data;},handler:()=>Promise.resolve({data:{status:'invalid_code'}})});
 await p.find('Izohlar').fire('click');assert.equal(lost.status,'invalid_code');assert.ok(!p.all().some(n=>n.textContent==='Saved comment'));
});
test('only the owner gets moderation controls and owner RPCs do not send guest credentials',async()=>{
 const p=fixture({owner:true});await p.find('Izohlar').fire('click');
 assert.equal(p.calls[0].name,'get_my_diary_comments');assert.equal(p.calls[0].args.p_code,undefined);
 await p.find('Izohni o‘chirish').fire('click');assert.equal(p.calls[1].name,'delete_my_diary_comment');assert.equal(p.calls[1].args.p_comment_id,'12');
 const guest=fixture();await guest.find('Izohlar').fire('click');assert.ok(!guest.all().some(n=>n.textContent==='Izohni o‘chirish'));
});
test('cancel clears the entered name and comment',async()=>{
 const p=fixture();await p.compose();await p.find('Bekor qilish').fire('click');assert.equal(p.form.hidden,true);assert.equal(p.name.value,'');assert.equal(p.body.value,'');
});
