'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const M = require('../functions/newsletter-model');
const {createNewsletterService} = require('../functions/newsletter-service');
const clone = value => value === undefined ? undefined : structuredClone(value);

// An in-memory Firestore double with atomic transactions and read-before-write checks.
// No Firebase SDK, credentials, HTTP requests, or SMTP transport is loaded in this suite.
class MemoryDB {
  constructor() { this.values = new Map(); this.lock = Promise.resolve(); this.failWrite = null; }
  snap(ref) { const value = this.values.get(ref.path); return {ref, id:ref.id, exists:value !== undefined, data:() => clone(value)}; }
  doc(p) {
    const ref = {path:p, id:p.split('/').pop(), get:async () => this.snap(ref),
      set:async value => this.values.set(p, clone(value)), update:async value => this.values.set(p, {...this.values.get(p), ...clone(value)})};
    return ref;
  }
  collection(p) {
    const make = (filters = [], order = null, count = Infinity) => ({
      where:(key, op, value) => make([...filters, [key, op, value]], order, count),
      orderBy:(key, direction) => make(filters, [key, direction], count),
      limit:n => make(filters, order, n),
      get:async () => {
        let docs = [...this.values.keys()].filter(key => key.startsWith(p + '/') && !key.slice(p.length + 1).includes('/')).map(key => this.snap(this.doc(key)));
        docs = docs.filter(doc => filters.every(([key, op, value]) => op === 'in' ? value.includes(doc.data()[key]) : doc.data()[key] === value));
        if (order) docs.sort((a, b) => (a.data()[order[0]] < b.data()[order[0]] ? -1 : a.data()[order[0]] > b.data()[order[0]] ? 1 : 0) * (order[1] === 'desc' ? -1 : 1));
        docs = docs.slice(0, count); return {docs, empty:!docs.length};
      }
    }); return make();
  }
  async getAll(...refs) { return refs.map(ref => this.snap(ref)); }
  async runTransaction(fn) {
    const before = this.lock; let release; this.lock = new Promise(resolve => { release = resolve; });
    await before;
    const writes = []; let wrote = false;
    const tx = {get:async ref => { assert(!wrote, 'Firestore transactions must read before writing'); return this.snap(ref); },
      set:(ref, value) => { wrote = true; writes.push(['set',ref,clone(value)]); },
      update:(ref, value) => { wrote = true; writes.push(['update',ref,clone(value)]); },
      delete:ref => { wrote = true; writes.push(['delete',ref]); }};
    try {
      const result = await fn(tx);
      if (this.failWrite && writes.some(write => this.failWrite(...write))) { this.failWrite = null; throw Error('simulated write outage'); }
      for (const [type, ref, value] of writes) {
        if (type === 'delete') this.values.delete(ref.path);
        else if (type === 'update') { assert(this.values.has(ref.path)); this.values.set(ref.path, {...this.values.get(ref.path), ...value}); }
        else this.values.set(ref.path, value);
      }
      return result;
    } finally { release(); }
  }
}
function fixture() {
  const db = new MemoryDB(), mails = [];
  let clock = Date.parse('2026-10-27T04:00:00Z'), transport = async mail => ({accepted:[mail.to]});
  const service = createNewsletterService({db, now:() => clock, sendMail:async mail => { mails.push(clone(mail)); return transport(mail); }});
  const f = {db, service, mails, setNow:value => { clock = typeof value === 'number' ? value : Date.parse(value); },
    setTransport:fn => { transport = fn; }, read:p => clone(db.values.get(p)),
    note:(id, extra = {}) => db.values.set('notes/' + id, {status:'published', titleZh:'公開標題 ' + id, summaryZh:'公開摘要 ' + id, revision:1, publishedAt:'2026-10-26', ...extra}),
    subscriber:(email, id = M.hash(email)) => db.values.set('subscribers/' + id, {email, status:'active'})};
  f.draft = async (ids = ['one']) => {
    for (const id of ids) { if (!f.read('notes/' + id)) f.note(id); await service.admin('setSelection', {noteId:id, included:true}); }
    const state = await service.admin('getState');
    await service.admin('saveIssue', {issueId:state.issue.id, revision:state.issue.revision,
      subject:'本週觀察', intro:'本期前言', items:state.issue.items});
    return (await service.admin('getState')).issue;
  };
  f.approve = async ids => {
    const issue = await f.draft(ids);
    await service.admin('approveIssue', {issueId:issue.id, revision:issue.revision});
    return (await service.admin('getState')).issue;
  };
  f.run = async issue => { f.setNow(issue.scheduledAtMs); await service.weekly(new Date(issue.scheduledAtMs).toISOString()); };
  return f;
}
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const rejects = (fn, status = 409) => assert.rejects(fn, error => error.status === status);

test('Taipei Monday boundary and year rollover are independent of host timezone', () => {
  assert.equal(M.nextMonday(Date.parse('2026-10-25T16:00Z')).id, 'week-2026-10-26');
  assert.equal(M.nextMonday(Date.parse('2026-10-26T00:00Z')).id, 'week-2026-11-02');
  assert.equal(M.nextMonday(Date.parse('2026-12-31T23:00Z')).id, 'week-2027-01-04');
});
test('Google provider, verified email, and exact administrator are all required', () => {
  assert(M.isAdmin({email:M.ADMIN,email_verified:true,firebase:{sign_in_provider:'google.com'}}));
  for (const token of [null,{email:M.ADMIN},{email:M.ADMIN,email_verified:false,firebase:{sign_in_provider:'google.com'}},
    {email:M.ADMIN,email_verified:true,firebase:{sign_in_provider:'password'}},
    {email:'other@example.com',email_verified:true,firebase:{sign_in_provider:'google.com'}}]) assert(!M.isAdmin(token));
});
test('unpublished notes and article drafts cannot be selected or sent', async () => {
  const f = fixture(); f.note('draft', {status:'draft'}); f.db.values.set('noteDrafts/private', {titleZh:'未公開'});
  await rejects(() => f.service.admin('setSelection',{noteId:'draft',included:true}));
  await rejects(() => f.service.admin('setSelection',{noteId:'private',included:true}));
  const state = await f.service.admin('getState'); assert.equal(state.notes.length,0);
  await f.service.weekly(new Date(state.next.scheduledAtMs).toISOString()); assert.equal(f.mails.length,0);
});
test('empty, duplicate, unselected, and invalid article inputs fail closed', async () => {
  const f = fixture(); f.note('one'); const {next} = await f.service.admin('getState');
  const base = {issueId:next.id,revision:0,subject:'主旨',intro:'',items:[]};
  await rejects(() => f.service.admin('saveIssue',base),400);
  const item = {noteId:'one',title:'標題',summary:''};
  await rejects(() => f.service.admin('saveIssue',{...base,items:[item,item]}),400);
  await rejects(() => f.service.admin('saveIssue',{...base,items:[item]}));
  await rejects(() => f.service.admin('saveIssue',{...base,subject:'主旨\r\nBcc: bad',items:[item]}),400);
  await rejects(() => f.service.admin('saveIssue',{...base,items:[{...item,noteId:'../site/public'}]}),400);
});
test('preview and test use the same saved digest; test targets only admin and consumes no issue number', async () => {
  const f = fixture(), issue = await f.draft();
  f.db.values.set('noteDrafts/one',{titleZh:'未發布修改'});
  const input = {issueId:issue.id,revision:issue.revision};
  const preview = await f.service.admin('previewIssue',input);
  await f.service.admin('testIssue',input);
  assert(preview.html.includes('公開標題 one')); assert(!preview.html.includes('未發布修改'));
  assert.equal(f.mails[0].to,M.ADMIN); assert(!f.mails[0].bcc);
  assert(f.mails[0].html.includes('公開標題 one')); assert.equal(f.read('newsletterMeta/counter'),undefined);
  assert.equal(f.read('newsletterIssues/'+issue.id).status,'draft');
});
test('saving and publishing articles never dispatches a digest; drafts without approval are skipped', async () => {
  const f = fixture(), issue = await f.draft(); f.subscriber('reader@example.com');
  await f.run(issue); await f.service.retryPending(); assert.equal(f.mails.length,0);
  assert.equal(f.read('newsletterMeta/counter'),undefined);
});
test('public changes before approval require saving and previewing the revised digest', async () => {
  const f = fixture(), issue = await f.draft(); f.note('one',{titleZh:'公開新標題',revision:2});
  await rejects(() => f.service.admin('approveIssue',{issueId:issue.id,revision:issue.revision}));
  await rejects(() => f.service.admin('testIssue',{issueId:issue.id,revision:issue.revision}));
  assert.equal(f.mails.length,0);
});
test('approved snapshot is immutable, source edits do not alter mail, and early dispatch is refused', async () => {
  const f = fixture(), issue = await f.approve(); f.subscriber('reader@example.com');
  const snapshot = clone(issue.snapshot); f.note('one',{titleZh:'核准後變動',revision:2});
  await rejects(() => f.service.admin('saveIssue',{...issue,issueId:issue.id,revision:issue.revision}));
  await f.service.weekly(new Date(issue.scheduledAtMs).toISOString()); assert.equal(f.mails.length,0);
  await f.run(issue); assert.equal(f.mails.length,1); assert(f.mails[0].html.includes('公開標題 one')); assert(!f.mails[0].html.includes('核准後變動'));
  assert.deepEqual(f.read('newsletterIssues/'+issue.id).snapshot,snapshot);
});
test('unpublishing an approved source blocks broadcast and permits revocation before any send', async () => {
  const f = fixture(), issue = await f.approve(); f.subscriber('reader@example.com'); f.db.values.delete('notes/one');
  await f.run(issue); assert.equal(f.mails.length,0); assert.equal(f.read('newsletterIssues/'+issue.id).status,'blocked');
  await f.service.admin('revokeIssue',{issueId:issue.id,revision:issue.revision});
  assert.equal(f.read('newsletterArticles/one'),undefined);
});
test('no active subscribers skips without consuming a number or marking articles sent', async () => {
  const f = fixture(), issue = await f.approve(); await f.run(issue);
  const done = f.read('newsletterIssues/'+issue.id); assert.equal(done.status,'skipped'); assert.equal(done.number,null);
  assert.equal(f.read('newsletterMeta/counter'),undefined); assert.equal(f.read('newsletterArticles/one'),undefined);
});
test('partial failure retries same issue only for unaccepted recipients and deduplicates addresses', async () => {
  const f = fixture(), issue = await f.approve(); f.subscriber('a@example.com','a'); f.subscriber('a@example.com','a-duplicate'); f.subscriber('b@example.com','b');
  let fail = true;
  f.setTransport(async mail => { if (mail.to === 'b@example.com' && fail) { const e = Error('rejected'); e.code = 'EENVELOPE'; throw e; } return {accepted:[mail.to]}; });
  await f.run(issue); assert.equal(f.mails.length,2); assert.equal(f.read('newsletterMeta/counter').lastIssued,1);
  fail = false; f.setNow(issue.scheduledAtMs + M.RETRY_MS); await f.service.retryPending();
  assert.deepEqual(f.mails.map(m=>m.to),['a@example.com','b@example.com','b@example.com']);
  assert.equal(f.read('newsletterIssues/'+issue.id).status,'sent'); assert.equal(f.read('newsletterIssues/'+issue.id).number,1);
  assert(f.mails.every(mail => !mail.bcc && mail.html.includes('取消訂閱') && mail.text.includes('key=')));
  await f.service.retryPending(); assert.equal(f.mails.length,3);
});
test('audience is frozen, batches continue, and subscribers joining later do not enter a running issue', async () => {
  const f = fixture(), issue = await f.approve(); for(let i=0;i<25;i++)f.subscriber('reader'+i+'@example.com');
  await f.run(issue); assert.equal(f.mails.length,20); assert.equal(f.read('newsletterIssues/'+issue.id).counts.pending,5);
  f.subscriber('late@example.com'); await f.service.retryPending();
  assert.equal(f.mails.length,25); assert(!f.mails.some(mail=>mail.to==='late@example.com')); assert.equal(f.read('newsletterIssues/'+issue.id).status,'sent');
});
test('unsubscribe is rechecked before each recipient is sent', async () => {
  const f = fixture(), issue = await f.approve(); f.subscriber('a@example.com','a'); f.subscriber('b@example.com','b');
  f.setTransport(async mail=>{f.db.values.set('subscribers/b',{email:'b@example.com',status:'unsubscribed'});return {accepted:[mail.to]};});
  await f.run(issue); assert.deepEqual(f.mails.map(m=>m.to),['a@example.com']); assert.equal(f.read('newsletterIssues/'+issue.id).counts.skipped,1);
});
test('concurrent schedule invocations cannot deliver the same audience twice', async () => {
  const f = fixture(), issue = await f.approve(); f.subscriber('reader@example.com'); f.setNow(issue.scheduledAtMs);
  const at = new Date(issue.scheduledAtMs).toISOString(); await Promise.all([f.service.weekly(at),f.service.weekly(at),f.service.retryPending()]);
  assert.equal(f.mails.length,1); assert.equal(f.read('newsletterMeta/counter').lastIssued,1);
});
test('ambiguous SMTP timeout is held for evidence rather than automatically resent', async () => {
  const f = fixture(), issue = await f.approve(); f.subscriber('reader@example.com');
  f.setTransport(async()=>{const e=Error('timeout');e.code='ETIMEDOUT';e.command='DATA';throw e;});
  await f.run(issue); assert.equal(f.read('newsletterIssues/'+issue.id).status,'needs_review');
  f.setNow(issue.scheduledAtMs + M.RETRY_MS); await f.service.retryPending(); assert.equal(f.mails.length,1);
  await rejects(()=>f.service.admin('retryIssue',{issueId:issue.id}));
  await f.service.admin('resolveDelivery',{issueId:issue.id,email:'reader@example.com',result:'not_sent',evidence:'已核對郵件服務紀錄，確認未寄出'});
  f.setTransport(async mail=>({accepted:[mail.to]})); await f.service.retryPending();
  assert.equal(f.mails.length,2); assert.equal(f.read('newsletterMeta/counter').lastIssued,1);
});
test('crash after SMTP acceptance never causes blind resend; evidence commits the original number', async () => {
  const f = fixture(), issue = await f.approve(); f.subscriber('reader@example.com');
  f.db.failWrite=(type,ref,value)=>ref.path.includes('/deliveries/')&&value?.status==='sent';
  await assert.rejects(()=>f.run(issue),/simulated write outage/);
  assert.equal(f.read('newsletterIssues/'+issue.id).status,'needs_review');
  await f.service.retryPending(); assert.equal(f.mails.length,1);
  await f.service.admin('resolveDelivery',{issueId:issue.id,email:'reader@example.com',result:'sent',evidence:'已確認 Gmail 寄件紀錄中有本期郵件'});
  await f.service.retryPending(); assert.equal(f.mails.length,1); assert.equal(f.read('newsletterMeta/counter').lastIssued,1); assert.equal(f.read('newsletterIssues/'+issue.id).status,'sent');
});
test('five explicit rejections stop automatic retries; cancellation frees the reserved number', async () => {
  const f = fixture(), issue = await f.approve(); f.subscriber('reader@example.com');
  f.setTransport(async()=>{const e=Error('rejected');e.responseCode=550;throw e;});
  await f.run(issue);
  for(let i=1;i<7;i++){f.setNow(issue.scheduledAtMs+i*M.RETRY_MS);await f.service.retryPending();}
  assert.equal(f.mails.length,5); assert.equal(f.read('newsletterMeta/counter').lastIssued,0);
  await f.service.admin('revokeIssue',{issueId:issue.id,revision:issue.revision});
  assert.equal(f.read('newsletterMeta/counter').activeIssueId,null); assert.equal(f.read('newsletterArticles/one'),undefined);
});
test('global issue numbers continue across skipped weeks and years', async () => {
  const f = fixture(); f.db.values.set('newsletterMeta/counter',{lastIssued:7}); f.setNow('2026-12-25T04:00Z');
  const first = await f.approve(['one']); f.subscriber('reader@example.com'); await f.run(first); assert.equal(f.read('newsletterMeta/counter').lastIssued,8);
  f.setNow('2027-01-01T04:00Z'); const second = await f.approve(['two']); await f.run(second);
  assert.equal(f.read('newsletterIssues/'+second.id).number,9); assert.equal(f.read('newsletterMeta/counter').lastIssued,9);
});
test('an unresolved unissued number blocks approval of a newer week until cancelled', async () => {
  const f=fixture(),first=await f.approve();f.subscriber('reader@example.com');
  f.setTransport(async()=>{const error=Error('rejected');error.code='EENVELOPE';throw error;});
  await f.run(first);f.setNow(first.scheduledAtMs+24*3600000);
  const second=await f.draft(['two']);
  await rejects(()=>f.service.admin('approveIssue',{issueId:second.id,revision:second.revision}));
  await f.service.admin('revokeIssue',{issueId:first.id,revision:first.revision});
  await f.service.admin('approveIssue',{issueId:second.id,revision:second.revision});
  assert.equal(f.read('newsletterMeta/counter').lastIssued,0);
});
test('old broadcast markers exclude previously sent articles without modifying legacy site content', async () => {
  const f = fixture(); f.note('old',{newsletterSentAt:{seconds:123},newsletterCount:3});
  f.db.values.set('site/public',{content:{projects:['kept']}}); const before=clone(f.read('site/public'));
  await f.service.admin('setSelection',{noteId:'old',included:true}); const state=await f.service.admin('getState'); assert.equal(state.issue.items.length,0);
  await rejects(()=>f.service.admin('saveIssue',{issueId:state.next.id,revision:0,subject:'主旨',intro:'',items:[{noteId:'old',title:'舊文',summary:''}]}));
  assert.deepEqual(f.read('site/public'),before);
});
test('revocation releases reservations and stale revisions cannot overwrite changes', async () => {
  const f=fixture(),issue=await f.approve(); await rejects(()=>f.service.admin('setSelection',{noteId:'one',included:false}));
  await rejects(()=>f.service.admin('revokeIssue',{issueId:issue.id,revision:1}));
  await f.service.admin('revokeIssue',{issueId:issue.id,revision:issue.revision}); assert.equal(f.read('newsletterArticles/one'),undefined);
  await rejects(()=>f.service.admin('approveIssue',{issueId:issue.id,revision:issue.revision}));
});
test('legacy sends remain excluded after unpublishing and republishing an article', async () => {
  const f=fixture();f.note('old',{newsletterSentAt:'legacy-sent',newsletterCount:3});
  await f.service.admin('rememberLegacy',{noteId:'old'});
  f.db.values.delete('notes/old');f.note('old',{revision:1});
  await f.service.admin('setSelection',{noteId:'old',included:true});
  const state=await f.service.admin('getState');assert.equal(state.notes[0].sent,true);assert.equal(state.issue.items.length,0);
});
test('all previewed and sent text is escaped and unsubscribe tokens are unguessable per address', async () => {
  const f=fixture(), html=M.renderDigest({subject:'<img onerror="bad">',intro:'<script>bad</script>',items:[{title:'<svg onload="bad">',summary:'& untrusted',url:'https://tanji.tw/#/notes/a'}]}).html;
  assert(!html.includes('<script>')); assert(!html.includes('<svg')); assert(html.includes('&lt;img'));
  const one=new URL(await f.service.unsubscribeUrl('a@example.com')),two=new URL(await f.service.unsubscribeUrl('b@example.com'));
  assert.notEqual(one.searchParams.get('token'),two.searchParams.get('token')); assert(!one.search.includes('email='));
  assert.equal(await f.service.emailForToken(one.searchParams.get('key'),one.searchParams.get('token')),'a@example.com');
  assert.equal(await f.service.emailForToken(one.searchParams.get('key'),'0'.repeat(64)),'');
});
test('HTTP endpoints retire immediate broadcasts and enforce verified Google admin before service access', async () => {
  const db=new MemoryDB(), schedules=[], endpoints={}, root=path.resolve(__dirname,'..'); let decoded, serviceCalls=0;
  const context={exports:endpoints,process:{env:{}},console:{error(){}},Buffer,require:name=>{
    if(name==='dotenv')return {config(){}};
    if(name==='firebase-functions/v2/https')return {onRequest:(_options,fn)=>fn};
    if(name==='firebase-functions/v2/scheduler')return {onSchedule:(options,fn)=>{schedules.push(options);return fn;}};
    if(name==='firebase-admin/app')return {initializeApp(){}};
    if(name==='firebase-admin/firestore')return {getFirestore:()=>db,FieldValue:{serverTimestamp:()=>123}};
    if(name==='firebase-admin/auth')return {getAuth:()=>({verifyIdToken:async()=>decoded})};
    if(name==='nodemailer')return {createTransport(){throw Error('real mail forbidden in test');}};
    if(name==='./render-note')return {renderNote:()=>''};
    if(name==='./newsletter-service')return {createNewsletterService:()=>({admin:async()=>{serviceCalls++;return {};},emailForToken:async()=> 'reader@example.com'})};
    if(name==='./newsletter-model')return M;
    throw Error('Unexpected dependency '+name);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(root,'functions/index.js'),'utf8'),context);
  const request=async(fn,req)=>{const response={code:200,body:null,status(n){this.code=n;return this;},set(){return this;},type(){return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;}};await fn(req,response);return response;};
  assert.equal((await request(endpoints.sendNewsletter,{method:'POST',body:{noteId:'draft',isTest:false}})).code,410);
  assert.equal((await request(endpoints.newsletterAdmin,{method:'POST',headers:{},body:{action:'getState'}})).code,401);
  for(const token of [{email:M.ADMIN},{email:M.ADMIN,email_verified:true,firebase:{sign_in_provider:'password'}}]){
    decoded=token;assert.equal((await request(endpoints.newsletterAdmin,{method:'POST',headers:{authorization:'Bearer fake'},body:{action:'getState'}})).code,403);
  }
  assert.equal(serviceCalls,0);decoded={email:M.ADMIN,email_verified:true,firebase:{sign_in_provider:'google.com'}};
  assert.equal((await request(endpoints.newsletterAdmin,{method:'POST',headers:{authorization:'Bearer fake'},body:{action:'getState'}})).code,200);assert.equal(serviceCalls,1);
  db.values.set('subscribers/reader',{email:'reader@example.com',status:'active'});
  await request(endpoints.unsubscribe,{method:'GET',query:{email:'reader@example.com'}});assert.equal(db.values.get('subscribers/reader').status,'active');
  await request(endpoints.unsubscribe,{method:'POST',query:{email:'reader@example.com'}});assert.equal(db.values.get('subscribers/reader').status,'unsubscribed');
  assert(schedules.some(s=>s.schedule==='0 8 * * 1'&&s.timeZone==='Asia/Taipei'));
});

if (require.main === module) (async()=>{for(const [name,fn]of tests){await fn();console.log('PASS: '+name);}console.log('PASS: '+tests.length+' isolated newsletter checks; zero production access or real mail.');})().catch(error=>{console.error(error);process.exitCode=1;});
module.exports = {MemoryDB, fixture};
