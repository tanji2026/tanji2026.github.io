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
    const tx = {get:async ref => { assert(!wrote, 'Firestore transactions must read before writing'); return ref.path ? this.snap(ref) : ref.get(); },
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
const tests=[];const test=(name,fn)=>tests.push([name,fn]);
const approve=async f=>{const state=await f.service.admin('automaticState');await f.service.admin('approveAutomatic',{issueId:state.issue.id,revision:state.issue.revision,previewHash:state.previewHash});return state;};
test('seven Taipei days include all Sunday and exclude both adjacent weeks',async()=>{
 const f=fixture();f.setNow('2026-11-02T03:00Z');
 f.note('before',{publishedAt:'2026-10-25T23:59:59+08:00'});f.note('start',{publishedAt:'2026-10-26T00:00:00+08:00'});
 f.note('sunday',{publishedAt:'2026-11-01T23:59:59+08:00'});f.note('after',{publishedAt:'2026-11-02T00:00:00+08:00'});
 f.note('private',{status:'draft',publishedAt:'2026-10-28'});
 const d=await f.service.admin('automaticState');assert.deepEqual(d.issue.items.map(n=>n.noteId),['start','sunday']);assert.equal(d.period.endAtMs-d.period.startAtMs,7*86400000);
});
test('all published weekly articles are automatic, old selection flags do not matter',async()=>{
 const f=fixture();f.note('one');f.note('two');f.db.values.set('newsletterSelections/one',{included:false});
 const d=await f.service.admin('automaticState');assert.equal(d.issue.items.length,2);assert(d.html.includes('公開標題 one'));
 assert(!d.html.includes('undefined'));assert.equal(d.issue.intro,'');
});
test('neither the clock nor a test email grants approval',async()=>{
 const f=fixture();f.note('one');f.subscriber('reader@example.com');let d=await f.service.admin('automaticState');
 await f.service.admin('testAutomatic',{issueId:d.issue.id,previewHash:d.previewHash});assert.equal(f.mails.length,1);assert.equal(f.mails[0].to,M.ADMIN);
 f.setNow(d.period.scheduledAtMs);await f.service.weekly(new Date(d.period.scheduledAtMs).toISOString());await f.service.retryPending();assert.equal(f.mails.length,1);assert(!f.read('newsletterMeta/counter'));
});
test('early approval waits until Monday 08:00',async()=>{
 const f=fixture();f.note('one');f.subscriber('reader@example.com');const d=await approve(f);await f.service.retryPending();assert.equal(f.mails.length,0);
 f.setNow(d.period.scheduledAtMs);await f.service.weekly(new Date(d.period.scheduledAtMs).toISOString());assert.equal(f.mails.length,1);assert.equal(f.read('newsletterMeta/counter').lastIssued,1);
});
test('late approval is allowed, automatic retry starts only after explicit approval',async()=>{
 const f=fixture();f.note('one');f.subscriber('reader@example.com');f.setNow('2026-11-02T03:00Z');
 await f.service.retryPending();assert.equal(f.mails.length,0);const d=await approve(f);assert.equal(d.issue.id,'week-2026-11-02');
 await f.service.retryPending();assert.equal(f.mails.length,1);await f.service.retryPending();assert.equal(f.mails.length,1);
});
test('new articles after approval invalidate consent rather than silently changing mail',async()=>{
 const f=fixture();f.note('one');f.subscriber('reader@example.com');const d=await approve(f);f.note('two');
 f.setNow(d.period.scheduledAtMs);await f.service.retryPending();assert.equal(f.mails.length,0);assert.equal(f.read('newsletterIssues/'+d.issue.id).status,'draft');
 await approve(f);await f.service.retryPending();assert.equal(f.mails.length,1);assert(f.mails[0].html.includes('公開標題 two'));
});
test('unpublished articles disappear, requiring fresh consent before sending remaining articles',async()=>{
 const f=fixture();f.note('one');f.note('two');f.subscriber('reader@example.com');const d=await approve(f);f.db.values.delete('notes/two');
 f.setNow(d.period.scheduledAtMs);await f.service.retryPending();assert.equal(f.mails.length,0);const updated=await f.service.admin('automaticState');assert.equal(updated.issue.items.length,1);
 await approve(f);await f.service.retryPending();assert.equal(f.mails.length,1);assert(!f.mails[0].html.includes('公開標題 two'));
});
test('source edits invalidate a stale preview and require a new approval',async()=>{
 const f=fixture();f.note('one');const d=await f.service.admin('automaticState');f.note('one',{titleZh:'新標題',revision:2});
 await assert.rejects(()=>f.service.admin('approveAutomatic',{issueId:d.issue.id,revision:d.issue.revision,previewHash:d.previewHash}),e=>e.status===409);
 await assert.rejects(()=>f.service.admin('testAutomatic',{issueId:d.issue.id,previewHash:d.previewHash}),e=>e.status===409);assert.equal(f.mails.length,0);
});
test('empty and already-sent articles cannot create an empty issue or consume a number',async()=>{
 const f=fixture();f.note('one',{newsletterSentAt:'old'});const d=await f.service.admin('automaticState');assert.equal(d.issue.items.length,0);
 await assert.rejects(()=>approve(f),e=>e.status===409);await f.service.retryPending();assert.equal(f.mails.length,0);assert(!f.read('newsletterMeta/counter'));
});
test('partial failures reuse one number and only retry the rejected address',async()=>{
 const f=fixture();f.note('one');f.subscriber('a@example.com');f.subscriber('b@example.com');const d=await approve(f);let failed=true;
 f.setTransport(async mail=>{if(mail.to==='b@example.com'&&failed){const e=Error('rejected');e.code='EENVELOPE';throw e;}return {accepted:[mail.to]};});
 f.setNow(d.period.scheduledAtMs);await f.service.retryPending();failed=false;f.setNow(d.period.scheduledAtMs+M.RETRY_MS);await f.service.retryPending();
 assert.deepEqual(f.mails.map(m=>m.to),['a@example.com','b@example.com','b@example.com']);assert.equal(f.read('newsletterMeta/counter').lastIssued,1);
});
test('old editorial approvals are paused until automatic-week consent is given',async()=>{
 const f=fixture();f.note('one');f.subscriber('reader@example.com');const old=await f.approve();f.setNow(old.scheduledAtMs);await f.service.retryPending();assert.equal(f.mails.length,0);
 assert.equal(f.read('newsletterIssues/'+old.id).status,'blocked');await approve(f);await f.service.retryPending();assert.equal(f.mails.length,1);
});
test('SMTP ambiguity is held for review, never blindly re-sent',async()=>{
 const f=fixture();f.note('one');f.subscriber('reader@example.com');const d=await approve(f);
 f.setTransport(async()=>{const e=Error('timeout');e.code='ETIMEDOUT';e.command='DATA';throw e;});f.setNow(d.period.scheduledAtMs);await f.service.retryPending();await f.service.retryPending();
 assert.equal(f.mails.length,1);assert.equal(f.read('newsletterIssues/'+d.issue.id).status,'needs_review');
});
test('purple email uses explicit inline text/background colors and cover images',()=>{
 const item=M.sourceItem('x',{status:'published',titleZh:'<unsafe>',summaryZh:'摘要',cover:'https://example.com/image.jpg'});
 const html=M.renderDigest({subject:'本週碳吉筆記',intro:'',items:[item]}).html;
 assert(html.includes('bgcolor="#181622"'));assert(html.includes('color:#e6e0f0;font-size:16px'));assert(html.includes('color:#ffffff;font-size:22px'));
 assert(html.includes('https://example.com/image.jpg'));assert(html.includes('&lt;unsafe&gt;'));assert(!html.includes('<unsafe>'));
});
if(require.main===module)(async()=>{for(const [name,fn]of tests){await fn();console.log('PASS: '+name);}console.log('PASS: '+tests.length+' automatic weekly newsletter checks');})().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={MemoryDB,fixture};
