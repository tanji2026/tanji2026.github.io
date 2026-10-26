'use strict';
const {JSDOM}=require('jsdom'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
 const dom=new JSDOM('<!doctype html><body><div id="app"></div>',{runScripts:'outside-only',url:'https://tanji.tw/admin.html'}),w=dom.window;w.TextEncoder=TextEncoder;w.confirm=()=>true;w.alert=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 for(const f of ['assets/js/core.js','assets/vendor/purify.min.js'])w.eval(fs.readFileSync(path.join(root,f),'utf8'));
 let notesCalls=0,mediaCalls=0,notesResult=()=>Promise.resolve({notes:[],categories:[]}),mediaResult=()=>Promise.resolve([]),tab='notes',renders=0;
 w.TanjiCloud={loadNotesAdmin(){notesCalls++;return notesResult(notesCalls);},listMedia(){mediaCalls++;return mediaResult(mediaCalls);},errorMessage:e=>e.message||String(e)};
 w.eval(fs.readFileSync(path.join(root,'assets/js/notes-admin.js'),'utf8'));
 function render(){renders++;w.document.getElementById('app').innerHTML=w.TanjiNotesAdmin.panel(tab,{render});}
 return {dom,w,render,setTab:t=>{tab=t;render();},setNotes:f=>notesResult=f,setMedia:f=>mediaResult=f,get calls(){return {notes:notesCalls,media:mediaCalls,renders};}};
}
(async()=>{
 // Old code retries until this mock's third call; the fix must stop at exactly one failure.
 const a=setup();a.setNotes(call=>call<=2?Promise.reject({code:'permission-denied',message:'讀取被拒絕'}):new Promise(()=>{}));a.render();await tick();await tick();assert.equal(a.calls.notes,1);assert(a.w.document.querySelector('[role="alert"]').textContent.includes('讀取被拒絕'));for(let i=0;i<10;i++)a.render();await tick();assert.equal(a.calls.notes,1);
 a.setTab('noteCategories');await tick();assert.equal(a.calls.notes,1);assert(a.w.document.body.textContent.includes('筆記分類'));
 // A denied notes request must not prevent media from loading.
 a.setTab('media');await tick();assert.equal(a.calls.media,1);assert(a.w.document.body.textContent.includes('上傳圖片／影片'));assert(!a.w.document.querySelector('[role="alert"]'));
 a.setNotes(()=>Promise.resolve({notes:[],categories:[]}));a.setTab('notes');a.w.document.querySelector('[data-n-action="reload"]').click();await tick();assert.equal(a.calls.notes,2);assert(a.w.document.querySelector('[data-n-action="new"]'));a.dom.window.close();
 // Media failures are not silently presented as an empty successful library and never auto-retry.
 const b=setup();b.setMedia(call=>call<=2?Promise.reject(Error('媒體權限不足')):new Promise(()=>{}));b.setTab('media');await tick();await tick();assert.equal(b.calls.media,1);assert(b.w.document.querySelector('[role="alert"]').textContent.includes('媒體權限不足'));b.setTab('notes');await tick();assert(b.w.document.querySelector('[data-n-action="new"]'));b.dom.window.close();
 // Pending network request times out once; later results cannot erase the error or trigger a loop.
 const c=setup();let resolveLate;const timers=new Map();let seq=0;c.w.setTimeout=(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id;};c.w.clearTimeout=id=>timers.delete(id);c.setNotes(()=>new Promise(resolve=>resolveLate=resolve));c.render();await tick();for(let i=0;i<5;i++)c.render();assert.equal(c.calls.notes,1);const deadline=[...timers.values()].find(x=>x.ms===12000);assert(deadline);deadline.fn();await tick();assert(c.w.document.body.textContent.includes('12 秒'));assert.equal(c.calls.notes,1);resolveLate({notes:[],categories:[]});await tick();assert(c.w.document.querySelector('[role="alert"]'));c.dom.window.close();
 // Logging out invalidates in-flight responses, preventing stale account data from reappearing.
 const d=setup();let resolveOld;d.setNotes(()=>new Promise(resolve=>resolveOld=resolve));d.render();await tick();d.w.TanjiNotesAdmin.reset();d.setNotes(()=>Promise.resolve({notes:[],categories:[]}));d.render();await tick();resolveOld({notes:[{id:'old',titleZh:'舊帳號資料',revision:1,tags:[]}],categories:[]});await tick();assert(!d.w.document.body.textContent.includes('舊帳號資料'));assert.equal(d.calls.notes,2);d.dom.window.close();
 console.log('PASS: denied reads stop after one attempt, explicit retry recovers, notes/media load independently, timeout/late responses and logout remain safe.');
})().catch(e=>{console.error(e);process.exitCode=1;});
