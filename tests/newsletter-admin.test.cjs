'use strict';
const {JSDOM} = require('jsdom');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {fixture} = require('./newsletter.test.cjs');
const root = path.resolve(__dirname, '..');
const settle = async () => { for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve)); };
function setup(api) {
  const dom = new JSDOM('<!doctype html><body><div id="app"></div>', {runScripts:'outside-only',url:'https://tanji.tw/admin.html'}), w = dom.window;
  w.TextEncoder = TextEncoder;
  w.HTMLDialogElement.prototype.showModal = function(){ this.open = true; };
  w.HTMLDialogElement.prototype.close = function(){ this.open = false; };
  w.eval(fs.readFileSync(path.join(root,'assets/js/core.js'),'utf8'));
  w.TanjiCloud = {newsletter:api};
  w.eval(fs.readFileSync(path.join(root,'assets/js/newsletter-admin.js'),'utf8'));
  const render = () => { w.document.getElementById('app').innerHTML = w.TanjiNewsletterAdmin.panel({render}); };
  const click = action => w.document.querySelector('[data-nl="'+action+'"]').click();
  const input = (selector,value) => { const el=w.document.querySelector(selector);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true})); };
  return {dom,w,render,click,input};
}
(async()=>{
  const f=fixture(),calls=[];f.note('one');f.db.values.set('noteDrafts/private',{titleZh:'私人草稿不應顯示'});
  const ui=setup(async(action,input)=>{calls.push(action);return f.service.admin(action,JSON.parse(JSON.stringify(input)));});
  const {w}=ui;ui.render();await settle();
  assert(!w.document.body.textContent.includes('私人草稿不應顯示'));assert.equal(w.document.querySelectorAll('[data-nl-include]').length,1);
  const include=w.document.querySelector('[data-nl-include]');include.checked=true;include.dispatchEvent(new w.Event('change',{bubbles:true}));await settle();
  ui.click('compose');ui.input('[name="subject"]','我們的本期觀察');ui.input('[data-key="summary"]','編輯過的電子報摘要');
  assert(w.document.querySelector('[data-nl="approve"]').disabled);
  ui.click('preview');await settle();assert(calls.includes('saveIssue'));assert(calls.includes('previewIssue'));
  assert(w.document.getElementById('nl-preview').open);assert(w.document.querySelector('#nl-preview iframe').srcdoc.includes('編輯過的電子報摘要'));
  assert.equal(w.document.querySelector('#nl-preview iframe').getAttribute('sandbox'),'');
  w.document.getElementById('nl-preview').close();assert(!w.document.querySelector('[data-nl="approve"]').disabled);
  ui.input('[name="intro"]','再修改前言');assert(w.document.querySelector('[data-nl="approve"]').disabled);
  ui.click('preview');await settle();w.document.getElementById('nl-preview').close();
  ui.click('test');await settle();assert.equal(f.mails.length,1);assert.equal(f.mails[0].to,'tanji2026@gmail.com');assert(f.mails[0].html.includes('編輯過的電子報摘要'));
  assert(!f.read('newsletterMeta/counter'));
  ui.click('approve');await settle();assert(w.document.body.textContent.includes('已核准待寄'));
  assert(w.document.querySelector('[name="subject"]').disabled);assert(!w.document.querySelector('[data-nl="approve"]'));
  const issue=(await f.service.admin('getState')).issue;assert.equal(issue.snapshot.intro,'再修改前言');assert.equal(f.mails.length,1);
  assert(!w.document.body.textContent.includes('正式群發給所有訂閱者'));
  ui.dom.window.close();
  console.log('PASS: actual newsletter UI selects only published notes, edits/saves/previews/tests an issue, invalidates stale previews and approves a frozen snapshot.');

  let requests=0;
  const denied=setup(async()=>{requests++;throw Error('權限被拒絕');});denied.render();await settle();
  assert.equal(requests,1);assert(denied.w.document.querySelector('[role="alert"]').textContent.includes('權限被拒絕'));
  for(let i=0;i<5;i++)denied.render();await settle();assert.equal(requests,1);
  denied.w.TanjiCloud.newsletter=async()=>f.service.admin('getState');denied.click('reload');await settle();assert(denied.w.document.body.textContent.includes('已核准待寄'));
  denied.dom.window.close();
  console.log('PASS: newsletter load failures stop retry loops and explicit retry recovers.');

  let resolveOld;
  const stale=setup(()=>new Promise(resolve=>{resolveOld=resolve;}));stale.render();await settle();
  stale.w.TanjiNewsletterAdmin.reset();stale.w.TanjiCloud.newsletter=async()=>f.service.admin('getState');stale.render();await settle();
  const old=await f.service.admin('getState');old.issue.subject='舊帳號內容';resolveOld(old);await settle();
  assert(!stale.w.document.body.textContent.includes('舊帳號內容'));stale.dom.window.close();
  console.log('PASS: logout invalidates old newsletter responses.');

  // Exercise real cloud.saveNote with a fake client SDK, including public-only legacy articles.
  const cloudDOM=new JSDOM('<!doctype html><body>',{runScripts:'outside-only',url:'https://tanji.tw/admin.html'}),cw=cloudDOM.window;
  cw.TextEncoder=TextEncoder;
  for(const file of ['assets/js/core.js','assets/vendor/purify.min.js'])cw.eval(fs.readFileSync(path.join(root,file),'utf8'));
  const records=new Map(),writes=[];
  const user={email:'tanji2026@gmail.com',emailVerified:true,providerData:[{providerId:'google.com'}],getIdToken:async()=> 'isolated-test-token'};
  const apiActions=[];
  cw.fetch=async(_url,options)=>{apiActions.push(JSON.parse(options.body).action);return {ok:true,json:async()=>({})};};
  cw.AbortController=AbortController;
  const readRecord=ref=>({exists:()=>records.has(ref),data:()=>records.get(ref)});
  cw.fake={auth:{currentUser:user},db:{},f:{doc:(_db,...parts)=>parts.join('/'),serverTimestamp:()=> 'server-time',
    getDoc:async ref=>readRecord(ref),
    runTransaction:async(_db,fn)=>fn({get:async ref=>readRecord(ref),set:(ref,value)=>{writes.push({ref,value});records.set(ref,value);},update:(ref,value)=>records.set(ref,{...records.get(ref),...value}),delete:ref=>records.delete(ref)})}};
  let cloudSource=fs.readFileSync(path.join(root,'assets/js/cloud.js'),'utf8');
  cloudSource=cloudSource.replace(/^async function authInit\(\).*$/m,'async function authInit(){return window.fake;}');
  cw.eval(cloudSource);
  const legacy={id:'legacy',titleZh:'原文章',titleEn:'',bodyZh:'<p>正文</p>',bodyEn:'',revision:4,status:'published',newsletterSentAt:'old-sent',newsletterCount:3};
  records.set('notes/legacy',legacy);
  const saved=await cw.TanjiCloud.saveNote({...legacy,titleZh:'未公開修改',live:true},false);
  assert.equal(saved.revision,1);assert.equal(records.get('notes/legacy').titleZh,'原文章');
  assert(!('newsletterSentAt' in records.get('noteDrafts/legacy')));assert(!('live' in records.get('noteDrafts/legacy')));
  await cw.TanjiCloud.saveNote({...saved,titleZh:'正式修改',extraUIField:'not persisted'},true);
  assert.equal(records.get('notes/legacy').titleZh,'正式修改');assert.equal(records.get('notes/legacy').newsletterSentAt,'old-sent');
  assert(!('extraUIField' in records.get('notes/legacy')));
  records.set('notes/legacy-only',{...legacy,id:'legacy-only'});
  await cw.TanjiCloud.unpublishNote('legacy-only');
  assert(apiActions.includes('rememberLegacy'));assert(!records.has('notes/legacy-only'));
  assert.equal(records.get('noteDrafts/legacy-only').status,'draft');assert(records.get('noteDrafts/legacy-only').bodyZh.includes('正文'));
  cloudDOM.window.close();
  assert(!fs.readFileSync(path.join(root,'assets/js/notes-admin.js'),'utf8').includes('data-newsletter-preview'));
  console.log('PASS: legacy public-only articles can save a separate clean draft and republish while preserving historical sent markers.');
})().catch(error=>{console.error(error);process.exitCode=1;});
