/* Real Admin SDK integration, fixed to the local demo emulator and a fake mailer. */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const {createRequire} = require('node:module');
const requireFunctions = createRequire(require('node:path').resolve(__dirname,'../functions/index.js'));
const {Firestore} = requireFunctions('firebase-admin/firestore');
const {createNewsletterService} = require('../functions/newsletter-service');
const assert = require('node:assert/strict');

(async()=>{
  const db = new Firestore({projectId:'demo-tanji-newsletter-service',ssl:false,customHeaders:{Authorization:'Bearer owner'}}), mails = [];
  let clock = Date.parse('2026-10-27T04:00:00Z'), rejectB = true;
  try {
    const clear = await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-tanji-newsletter-service/databases/(default)/documents',{method:'DELETE'});
    assert(clear.ok);
    await db.doc('notes/one').set({status:'published',titleZh:'已發布的原文',summaryZh:'原文摘要',revision:1});
    for(const id of ['a','b'])await db.doc('subscribers/'+id).set({email:id+'@example.com',status:'active'});
    const service = createNewsletterService({db,now:()=>clock,sendMail:async mail=>{
      mails.push(mail);
      if(mail.to==='b@example.com'&&rejectB){const error=Error('rejected');error.code='EENVELOPE';throw error;}
      return {accepted:[mail.to]};
    }});
    await service.admin('setSelection',{noteId:'one',included:true});
    let state=await service.admin('getState');
    await service.admin('saveIssue',{issueId:state.issue.id,revision:0,subject:'本期整合測試',intro:'前言',items:state.issue.items});
    state=await service.admin('getState');
    await service.admin('approveIssue',{issueId:state.issue.id,revision:state.issue.revision});
    await db.doc('notes/one').update({titleZh:'核准後修改',revision:2});
    clock=state.issue.scheduledAtMs;
    await service.weekly(new Date(clock).toISOString());
    assert.equal(mails.length,2);assert(mails[0].html.includes('已發布的原文'));assert(!mails[0].html.includes('核准後修改'));
    assert.equal((await db.doc('newsletterMeta/counter').get()).data().lastIssued,1);
    rejectB=false;clock+=30*60*1000;
    await service.retryPending();
    assert.deepEqual(mails.map(m=>m.to),['a@example.com','b@example.com','b@example.com']);
    const done=(await db.doc('newsletterIssues/'+state.issue.id).get()).data();
    assert.equal(done.status,'sent');assert.equal(done.number,1);assert.equal(done.counts.sent,2);
    await service.retryPending();assert.equal(mails.length,3);
    console.log('PASS: real Firestore Admin SDK transactions preserve approved content, commit a single number and retry only rejected recipients on the local emulator.');
  } finally { await db.terminate(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
