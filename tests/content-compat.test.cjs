/* Reproduces the production failure: empty legacy Firebase lists replacing file-backed content. */
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
function setup(hash='home',lang='zh'){
 const dom=new JSDOM('<!doctype html><html><head><meta name="description"></head><body><div id="tanji-approved-preview"><div class="preview-app"></div></div><div id="admin-app"></div><dialog id="editor-dialog"></dialog><dialog id="confirm-dialog"></dialog></body></html>',{url:'https://tanji.tw/#/'+hash,runScripts:'outside-only'}),w=dom.window;
 w.TextEncoder=TextEncoder;w.requestAnimationFrame=()=>{};w.scrollTo=()=>{};w.console={...console,info(){},warn(){},error:console.error};w.localStorage.setItem('tanji-lang',lang);
 for(const file of ['data/content.js','assets/js/core.js','assets/js/media.js','assets/vendor/purify.min.js','assets/js/notes.js','assets/js/notes-views.js','assets/js/views.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8'));
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};return {dom,w,load:file=>w.eval(fs.readFileSync(path.join(root,file),'utf8'))};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 const {dom,w}=setup(),C=w.TanjiCore,seed=w.TANJI_SEED,copy=x=>JSON.parse(JSON.stringify(x));
 const empty={settings:{...seed.settings,introZh:'雲端更新過的介紹'},projects:[],awards:[],topics:[],news:[]};
 const before=JSON.stringify(seed),merged=C.mergeContent(seed,empty);
 assert.equal(merged.projects.length,9);assert.equal(merged.awards.length,8);assert.equal(merged.topics.length,4);assert.equal(merged.settings.introZh,'雲端更新過的介紹');assert.equal(JSON.stringify(seed),before);
 const partial=copy(empty);partial.projects=[{...seed.projects[0],titleZh:'雲端修改的作品',order:-20}];partial.topics=[{...seed.topics[0],titleZh:'雲端修改的方向',order:-20}];const updated=C.mergeContent(seed,partial);assert.equal(updated.projects.length,9);assert.equal(updated.projects.find(x=>x.id===partial.projects[0].id).titleZh,'雲端修改的作品');assert.equal(updated.topics.length,4);
 const hidden=copy(partial);hidden.projects[0].visibility='draft';const hiddenResult=C.toPublic(C.mergeContent(seed,hidden));assert(!hiddenResult.projects.some(x=>x.id===hidden.projects[0].id));
 const deleted=C.removeRecord(seed,'projects','tj5');const legacyDeletion={...empty,settings:deleted.settings};const afterDelete=C.toPublic(C.mergeContent(seed,legacyDeletion));assert(!afterDelete.projects.some(x=>x.id==='tj5'));assert(!afterDelete.awards.some(x=>x.projectId==='tj5'));
 const intentional={...copy(empty),settings:{...empty.settings,contentMode:'complete-v1'}};assert.equal(C.mergeContent(seed,intentional).projects.length,0);assert.equal(C.mergeContent(seed,intentional).topics.length,0);
 assert.throws(()=>C.assertPublishSafe(C.toPublic(seed),empty));const allArchived=copy(seed);for(const type of C.TYPES)allArchived[type].forEach(x=>x.archived=true);assert.doesNotThrow(()=>C.assertPublishSafe(C.toPublic(seed),allArchived));let allDeleted=copy(seed);for(const type of C.TYPES)for(const row of [...allDeleted[type]])allDeleted=C.removeRecord(allDeleted,type,row.id);assert.doesNotThrow(()=>C.assertPublishSafe(C.toPublic(seed),allDeleted));
 const missingURL=copy(seed);delete missingURL.projects[0].url;assert.doesNotThrow(()=>w.TanjiUI.renderPublic(C.toPublic(missingURL),{page:'home',lang:'zh'}));
 dom.window.close();
 // Exercise the actual controller after its asynchronous cloud response for both languages/pages.
 for(const lang of ['zh','en'])for(const page of ['home','projects','topics']){
  const rt=setup(page,lang);rt.w.TanjiCloud={async loadPublic(){return {content:empty,revision:9};},async loadNotes(){throw {code:'permission-denied'};}};rt.load('assets/js/site.js');await tick();await tick();const d=rt.w.document;
  assert.equal(d.querySelectorAll('.ta-entry').length,page==='home'?8:0);
  if(page==='projects')assert.equal(d.querySelectorAll('.screen-project').length,6);
  if(page==='topics')assert.equal(d.querySelectorAll('.topic-tj-card').length,4);
  assert.equal(d.querySelectorAll('.desktop-nav .nav-link').length,6);assert(!d.body.textContent.includes('undefined'));rt.dom.window.close();
 }
 // A complete publish can deliberately hide a section; it must not be resurrected by the repair.
 const rt=setup('topics');rt.w.TanjiCloud={async loadPublic(){return {content:intentional,revision:10};}};rt.load('assets/js/site.js');await tick();assert.equal(rt.w.document.querySelectorAll('.topic-tj-card').length,0);rt.dom.window.close();
 // The real admin must hydrate legacy lists before saving unrelated settings.
 const adm=setup(),aw=adm.w;let saved=null;
 aw.TanjiCloud={isAdmin:()=>true,async watchAuth(cb){await cb({email:'tanji2026@gmail.com'});},async loadAdmin(){return {draft:{content:empty,revision:10},live:{content:empty,revision:9}};},async saveDraft(c){saved=copy(c);return 11;},errorMessage:e=>e.message};
 adm.load('assets/js/notes-admin.js');adm.load('assets/js/admin.js');await tick();aw.document.querySelector('[data-action="save"]').click();await tick();assert(saved);assert.equal(saved.projects.length,9);assert.equal(saved.topics.length,4);assert.equal(saved.settings.introZh,'雲端更新過的介紹');adm.dom.window.close();
 console.log('PASS: production empty-cloud regression, legacy/partial merge, current edits, explicit deletion/drafts, complete empty snapshots, publish guard, actual async public/admin controllers.');
})().catch(e=>{console.error(e);process.exitCode=1;});
