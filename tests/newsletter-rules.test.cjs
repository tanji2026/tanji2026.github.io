/* Run only against a local Firestore emulator; never a real Firebase project. */
'use strict';
const {initializeTestEnvironment, assertSucceeds, assertFails} = require('@firebase/rules-unit-testing');
const {doc, setDoc, getDoc, serverTimestamp, Timestamp, setLogLevel} = require('firebase/firestore');
setLogLevel('silent'); // Permission-denied assertions below are expected.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const env = await initializeTestEnvironment({projectId:'demo-tanji-newsletter', firestore:{host:'127.0.0.1', port:8080,
    rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
  try {
    await env.clearFirestore();
    const admin = env.authenticatedContext('admin',{email:'tanji2026@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
    const guest = env.unauthenticatedContext().firestore();
    const other = env.authenticatedContext('other',{email:'other@example.com',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
    const password = env.authenticatedContext('password',{email:'tanji2026@gmail.com',email_verified:true,firebase:{sign_in_provider:'password'}}).firestore();
    const base = {id:'legacy',titleZh:'標題',titleEn:'',summaryZh:'',summaryEn:'',bodyZh:'<p>文章</p>',bodyEn:'',author:'Coco',format:'note',categoryId:'',tags:[],revision:1,status:'published',updatedBy:'tanji2026@gmail.com'};
    const sentAt = Timestamp.fromMillis(123000);
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(),'notes/legacy'),{...base,newsletterSentAt:sentAt,newsletterCount:3});
      await setDoc(doc(context.firestore(),'noteDrafts/private'),{...base,id:'private',status:'draft'});
      for (const collection of ['newsletterIssues','newsletterArticles','newsletterSelections','newsletterMeta','newsletterOptOut'])
        await setDoc(doc(context.firestore(),collection+'/private'),{private:true});
      await setDoc(doc(context.firestore(),'newsletterIssues/private/deliveries/recipient'),{email:'private@example.com'});
    });
    const updated = {...base,titleZh:'修改標題',revision:2,updatedAt:serverTimestamp(),newsletterSentAt:sentAt,newsletterCount:3};
    await assertSucceeds(setDoc(doc(admin,'notes/legacy'),updated));
    await assertFails(setDoc(doc(admin,'notes/legacy'),{...updated,newsletterCount:99}));
    await assertFails(setDoc(doc(admin,'notes/new'),{...updated,id:'new'}));
    await assertFails(setDoc(doc(admin,'noteDrafts/new'),{...updated,id:'new',revision:1,status:'draft'}));
    await assertSucceeds(setDoc(doc(admin,'noteDrafts/legacy'),{...base,status:'draft',updatedAt:serverTimestamp()}));
    await assertFails(setDoc(doc(guest,'notes/legacy'),updated));
    await assertFails(setDoc(doc(other,'notes/legacy'),updated));
    await assertFails(setDoc(doc(password,'notes/legacy'),updated));
    await assertSucceeds(getDoc(doc(guest,'notes/legacy')));
    await assertFails(getDoc(doc(guest,'noteDrafts/private')));
    for(const collection of ['newsletterIssues','newsletterArticles','newsletterSelections','newsletterMeta','newsletterOptOut']) {
      for(const db of [guest,other,admin]) {
        await assertFails(getDoc(doc(db,collection+'/private')));
        await assertFails(setDoc(doc(db,collection+'/private'),{private:false}));
      }
    }
    await assertFails(getDoc(doc(guest,'newsletterIssues/private/deliveries/recipient')));
    assert.equal((await getDoc(doc(admin,'notes/legacy'))).data().newsletterCount,3);
    console.log('PASS: emulator validates unchanged legacy markers, rejects forged markers, keeps drafts private and all newsletter state server-only.');
  } finally { await env.cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
