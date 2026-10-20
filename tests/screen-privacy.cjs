'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

// Controlled focus/visibility events; no credentials or live Supabase calls.
function fixture({visible = true, focused = true, inert = false} = {}) {
  const windowEvents = {}, documentEvents = {};
  let mutate = () => {};
  function node() {
    const classes = new Set();
    return {children: [], hidden: false, inert: false, isConnected: true, handlers: {},
      classList: {add(v) {classes.add(v);}, remove(v) {classes.delete(v);}, contains(v) {return classes.has(v);}, toggle(v, on) {on ? classes.add(v) : classes.delete(v);}},
      append(...nodes) {this.children.push(...nodes);}, setAttribute(k,v) {this[k] = v;},
      addEventListener(type, fn) {(this.handlers[type] ||= []).push(fn);},
      focus() {document.activeElement = this;}, closest() {return null;}
    };
  }
  const surface = node(); surface.hidden = !visible; surface.inert = inert;
  const draft = node(); draft.value = 'Unsent private draft';
  const document = {documentElement: node(), body: node(), hidden: false, activeElement: draft,
    hasFocus: () => focused, querySelectorAll: () => [surface], createElement: node,
    addEventListener(type, fn) {(documentEvents[type] ||= []).push(fn);}
  };
  const window = {addEventListener(type, fn) {(windowEvents[type] ||= []).push(fn);}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'privacy.js'),'utf8'), {
    window, document, Date, Map,
    getComputedStyle: el => ({display: el.hidden ? 'none' : 'block'}),
    MutationObserver: class {constructor(fn) {mutate = fn;} observe() {}}
  });
  const [watermark,dock,curtain] = document.body.children;
  const resume = curtain.children[0].children[2];
  function fire(scope, type, args = {}) {
    const event = {key:'',preventDefault() {this.prevented = true;}, ...args};
    for (const fn of scope[type] || []) fn(event);
    return event;
  }
  return {document,surface,draft,dock,curtain,resume,watermark,
    locked: () => document.documentElement.classList.contains('dd-locked'),
    window: (type,args) => fire(windowEvents,type,args),
    event: (type,args) => fire(documentEvents,type,args),
    click: el => fire(el.handlers,'click'),
    focus(value) {focused = value;},
    visible(value) {surface.hidden = !value; mutate();}
  };
}
test('backgrounding hides a draft and requires an explicit resume, preserving text and focus', () => {
  const p=fixture(); assert.equal(p.curtain.hidden,true);
  p.focus(false); p.window('blur'); assert.equal(p.locked(),true); assert.equal(p.surface.inert,true);
  p.click(p.resume); assert.equal(p.locked(),true);
  p.focus(true); p.window('focus'); assert.equal(p.locked(),true);
  assert.equal(p.document.activeElement,p.resume);
  assert.equal(p.event('keydown',{key:'Tab',shiftKey:true}).prevented,true);
  p.click(p.resume); assert.equal(p.locked(),false); assert.equal(p.surface.inert,false);
  assert.equal(p.draft.value,'Unsent private draft'); assert.equal(p.document.activeElement,p.draft);
});
test('tab visibility and history restore keep the curtain closed until resumed', () => {
  const p=fixture(); p.document.hidden=true; p.event('visibilitychange'); assert.equal(p.locked(),true);
  p.document.hidden=false; p.event('visibilitychange'); p.window('pageshow'); assert.equal(p.locked(),true);
  p.click(p.resume); p.window('pagehide'); p.window('pageshow'); assert.equal(p.locked(),true);
});
test('login pages have no curtain; a background response revealing private content is shielded', () => {
  const p=fixture({visible:false}); assert.equal(p.dock.hidden,true); assert.equal(p.watermark.hidden,true);
  p.window('blur'); assert.equal(p.locked(),false);
  p.focus(false); p.visible(true); assert.equal(p.locked(),true);
});
test('sign-out removes the curtain and watermark without reopening a private section', () => {
  const p=fixture(); p.click(p.dock.children[0]); assert.equal(p.locked(),true);
  p.draft.value=''; p.visible(false);
  assert.equal(p.locked(),false); assert.equal(p.curtain.hidden,true);
  assert.equal(p.dock.hidden,true); assert.equal(p.watermark.hidden,true); assert.equal(p.surface.hidden,true);
});
for (const args of [{key:'Escape'},{key:'PrintScreen'},{key:'s',metaKey:true,shiftKey:true},{key:'4',metaKey:true,shiftKey:true},{key:'p',ctrlKey:true}]) {
  test(`delivered ${JSON.stringify(args)} shortcut shields content`, () => {
    const p=fixture(); assert.equal(p.event('keydown',args).prevented,true); assert.equal(p.locked(),true);
  });
}
test('print menu and PrintScreen keyup also shield content; regular copy/save keys are retained', () => {
  for (const key of ['c','s']) {const p=fixture(); assert.equal(p.event('keydown',{key,ctrlKey:true}).prevented,undefined); assert.equal(p.locked(),false);}
  const p=fixture(); p.window('beforeprint'); assert.equal(p.locked(),true);
  p.click(p.resume); p.event('keyup',{key:'PrintScreen'}); assert.equal(p.locked(),true);
});
test('resuming preserves a pre-existing inert state', () => {
  const p=fixture({inert:true}); p.window('blur'); p.click(p.resume); assert.equal(p.surface.inert,true);
});
test('all sensitive pages load the shared guard, including print CSS without JavaScript', () => {
  for (const file of ['index.html','visitor.html','sharing.html','admin.html']) {
    const html=fs.readFileSync(path.join(root,file),'utf8');
    assert.match(html,/data-private-surface/);
    assert.match(html,/rel="stylesheet" href="\.\/privacy\.css\?v=/);
    assert.match(html,/src="\.\/privacy\.js\?v=[^"]+" defer/);
  }
  const css=fs.readFileSync(path.join(root,'privacy.css'),'utf8');
  assert.match(css,/@media print/);
  assert.match(css,/html body > \*[^\n]+display:none!important/);
});
