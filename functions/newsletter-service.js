'use strict';

const {randomUUID, randomBytes, timingSafeEqual} = require('node:crypto');
const M = require('./newsletter-model');

// Dependencies are injected: tests cannot initialize Firebase or a real SMTP connection.
function createNewsletterService({db, sendMail, now = Date.now, projectId = 'tanji-official-1219f'}) {
  const issueRef = id => db.doc('newsletterIssues/' + M.validId(id));
  const articleRef = id => db.doc('newsletterArticles/' + M.validId(id));
  const selectionRef = id => db.doc('newsletterSelections/' + M.validId(id));
  const counterRef = db.doc('newsletterMeta/counter');
  const deliveryRef = (id, email) => db.doc('newsletterIssues/' + M.validId(id) + '/deliveries/' + M.hash(email));
  const data = snapshot => snapshot.exists ? snapshot.data() : null;
  const revision = (issue, expected) => {
    if (!Number.isInteger(expected) || (issue?.revision || 0) !== expected) M.fail('內容已在其他視窗更新，請重新讀取。', 409);
  };
  const getDocs = async refs => refs.length ? db.getAll(...refs) : [];
  const txDocs = (tx, refs) => Promise.all(refs.map(ref => tx.get(ref)));
  function publicIssue(issue) {
    if (!issue) return null;
    const {audience, leaseToken, ...safe} = issue;
    return safe;
  }
  async function unsubscribeUrl(email) {
    email = M.emailAddress(email);
    if (!email) M.fail('信箱格式不正確。');
    const key = M.hash(email), ref = db.doc('newsletterOptOut/' + key);
    const token = await db.runTransaction(async tx => {
      const old = data(await tx.get(ref));
      if (old?.token) return old.token;
      const value = randomBytes(32).toString('hex');
      tx.set(ref, {email, token:value});
      return value;
    });
    return 'https://asia-east1-' + projectId + '.cloudfunctions.net/unsubscribe?key=' + key + '&token=' + token;
  }
  async function emailForToken(key, token) {
    if (!/^[a-f0-9]{64}$/.test(key || '') || !/^[a-f0-9]{64}$/.test(token || '')) return '';
    const record = data(await db.doc('newsletterOptOut/' + key).get());
    if (!/^[a-f0-9]{64}$/.test(record?.token || '')) return '';
    return timingSafeEqual(Buffer.from(record.token), Buffer.from(token)) ? record.email : '';
  }
  async function getState(id) {
    const next = M.nextMonday(now());
    if (id) M.validId(id);
    const [published, selections, articles, history, current] = await Promise.all([
      db.collection('notes').where('status', '==', 'published').get(),
      db.collection('newsletterSelections').get(), db.collection('newsletterArticles').get(),
      db.collection('newsletterIssues').orderBy('createdAtMs', 'desc').limit(12).get(),
      issueRef(id || next.id).get()
    ]);
    const selected = new Map(selections.docs.map(s => [s.id, s.data().included === true]));
    const records = new Map(articles.docs.map(s => [s.id, s.data()]));
    const notes = published.docs.map(s => {
      const n = s.data(), record = records.get(s.id);
      let item;
      try { item = M.sourceItem(s.id, n); } catch { return null; }
      return {...item, included:selected.get(s.id) === true, sent:!!n.newsletterSentAt || record?.state === 'sent',
        reservedBy:record?.state === 'reserved' ? record.issueId : '', publishedAt:n.publishedAt || ''};
    }).filter(Boolean).sort((a, b) => String(a.publishedAt).localeCompare(String(b.publishedAt)) || a.noteId.localeCompare(b.noteId));
    const currentIssue = data(current);
    if (id && !currentIssue) M.fail('找不到此期電子報。', 404);
    const issue = currentIssue || {id:next.id, scheduledAtMs:next.scheduledAtMs, revision:0, status:'draft',
      subject:'本週碳吉筆記', intro:'', items:notes.filter(n => n.included && !n.sent && !n.reservedBy).slice(0, M.MAX_ITEMS).map(n => ({...n}))};
    const deliveries = currentIssue?.audience ? await getDocs(currentIssue.audience.map(email => deliveryRef(issue.id, email))) : [];
    return {next, issue:publicIssue(issue), notes,
      history:history.docs.map(s => publicIssue(s.data())),
      deliveries:deliveries.filter(s => s.exists).map(s => {
        const d = s.data(); return {id:s.id, email:d.email, status:d.status, attempts:d.attempts, error:d.error || ''};
      })};
  }
  async function setSelection(input) {
    const id = M.validId(input.noteId);
    if (typeof input.included !== 'boolean') M.fail('請指定是否收錄。');
    await db.runTransaction(async tx => {
      const [note, record] = await txDocs(tx, [db.doc('notes/' + id), articleRef(id)]);
      M.sourceItem(id, data(note));
      if (data(record)?.state === 'reserved') M.fail('文章已在核准的電子報內，請先撤回該期核准。', 409);
      tx.set(selectionRef(id), {included:input.included, updatedAtMs:now(), updatedBy:M.ADMIN});
    });
    return {message:'收錄設定已儲存。'};
  }
  async function rememberLegacy(input) {
    const id = M.validId(input.noteId);
    await db.runTransaction(async tx => {
      const [note, record] = await txDocs(tx, [db.doc('notes/' + id), articleRef(id)]);
      const old = data(note);
      if (old?.newsletterSentAt && data(record)?.state !== 'sent') {
        tx.set(articleRef(id), {state:'sent', legacy:true, legacySentAt:old.newsletterSentAt});
      }
    });
    return {message:'舊版寄送紀錄已保留。'};
  }
  // All notes and selections are re-read inside one transaction before saving/approval.
  async function readSources(tx, items, owner) {
    const refs = items.flatMap(item => [db.doc('notes/' + item.noteId), selectionRef(item.noteId), articleRef(item.noteId)]);
    const docs = await txDocs(tx, refs);
    return items.map((item, i) => {
      const n = data(docs[i * 3]), selected = data(docs[i * 3 + 1]), record = data(docs[i * 3 + 2]);
      const source = M.sourceItem(item.noteId, n);
      if (!selected?.included) M.fail('請先將文章勾選為收錄電子報。', 409);
      if (n.newsletterSentAt || record?.state === 'sent') M.fail('這篇文章已正式寄送過。', 409);
      if (record?.issueId && record.issueId !== owner) M.fail('文章已收錄於另一個核准期別。', 409);
      return source;
    });
  }
  async function saveIssue(input) {
    const next = M.nextMonday(now()), id = M.validId(input.issueId), digest = M.digestInput(input);
    if (id !== next.id) M.fail('此排程時間已過，請切換到下一期後重新彙整。', 409);
    await db.runTransaction(async tx => {
      const old = data(await tx.get(issueRef(id)));
      revision(old, input.revision);
      if (old && old.status !== 'draft') M.fail('請先撤回核准，才能修改本期內容。', 409);
      const sources = await readSources(tx, digest.items, id);
      tx.set(issueRef(id), {id, status:'draft', revision:(old?.revision || 0) + 1, ...digest,
        items:digest.items.map((item, i) => ({...sources[i], ...item})),
        scheduledAtMs:next.scheduledAtMs, createdAtMs:old?.createdAtMs || now(), updatedAtMs:now(), updatedBy:M.ADMIN});
    });
    return {message:'本期草稿已儲存，尚未核准寄送。'};
  }
  async function savedIssue(id, expected) {
    const issue = data(await issueRef(id).get());
    if (!issue) M.fail('請先儲存本期電子報。', 404);
    revision(issue, expected);
    if (issue.status === 'draft') {
      await db.runTransaction(async tx => {
        const latest = data(await tx.get(issueRef(id)));
        revision(latest, expected);
        if (latest.status !== 'draft') M.fail('狀態已更新，請重新讀取。', 409);
        const sources = await readSources(tx, latest.items, id);
        if (sources.some((s, i) => s.sourceHash !== latest.items[i].sourceHash)) M.fail('公開文章已更新，請重新儲存本期並預覽。', 409);
      });
    }
    return issue;
  }
  async function previewIssue(input) {
    const issue = await savedIssue(M.validId(input.issueId), input.revision);
    const snapshot = issue.snapshot || {subject:issue.subject, intro:issue.intro, items:issue.items};
    return {...M.renderDigest(snapshot, {number:issue.number}), revision:issue.revision};
  }
  async function testIssue(input) {
    const issue = await savedIssue(M.validId(input.issueId), input.revision);
    const mail = M.renderDigest(issue.snapshot || issue, {number:issue.number, test:true});
    const info = await sendMail({from:M.FROM, to:M.ADMIN, ...mail});
    if (!info?.accepted?.some(address => M.emailAddress(address?.address || address) === M.ADMIN)) M.fail('郵件服務未確認接受測試信，請核對管理員信箱。', 503);
    return {message:'整期測試信已寄給管理員；尚未對訂閱者寄送。'};
  }
  async function approveIssue(input) {
    const id = M.validId(input.issueId);
    await db.runTransaction(async tx => {
      const issue = data(await tx.get(issueRef(id))), counter = data(await tx.get(counterRef));
      revision(issue, input.revision);
      if (!issue || issue.status !== 'draft') M.fail('只能核准已儲存的電子報草稿。', 409);
      if (counter?.activeIssueId && counter.activeIssueId !== id) M.fail('前一期尚未正式發行，請先處理該期的失敗或待核對對象，再核准下一期。', 409);
      if (id !== M.nextMonday(now()).id || issue.scheduledAtMs <= now()) M.fail('排程時間已過，請重新彙整下一期。', 409);
      const digest = M.digestInput(issue), sources = await readSources(tx, digest.items, id);
      if (sources.some((s, i) => s.sourceHash !== issue.items[i].sourceHash)) M.fail('公開文章已更新，請重新儲存本期並預覽。', 409);
      const snapshot = {subject:issue.subject, intro:issue.intro, items:issue.items, templateVersion:1};
      tx.update(issueRef(id), {status:'approved', snapshot, revision:issue.revision + 1, approvedAtMs:now(), approvedBy:M.ADMIN, updatedAtMs:now()});
      issue.items.forEach(item => tx.set(articleRef(item.noteId), {state:'reserved', issueId:id}));
    });
    return {message:'已核准並保存內容快照，將於排定的週一上午 8 點寄送。'};
  }
  async function revokeIssue(input) {
    const id = M.validId(input.issueId);
    await db.runTransaction(async tx => {
      const issue = data(await tx.get(issueRef(id))), counter = data(await tx.get(counterRef)) || {};
      revision(issue, input.revision);
      if (!issue || !['approved','blocked','partial','needs_review'].includes(issue.status) || issue.firstSentAtMs || issue.leaseUntilMs > now()) M.fail('本期已寄出或正在處理，不能撤回。', 409);
      const deliveryDocs = await txDocs(tx, (issue.audience || []).map(email => deliveryRef(id, email)));
      if (deliveryDocs.some(s => ['sent','sending','unknown'].includes(data(s)?.status))) M.fail('有寄送結果待確認，請先核對寄送紀錄。', 409);
      const future = issue.scheduledAtMs > now();
      tx.update(issueRef(id), {status:future ? 'draft' : 'cancelled', snapshot:null, audience:null, number:null,
        revision:issue.revision + 1, leaseUntilMs:0, updatedAtMs:now()});
      issue.items.forEach(item => tx.delete(articleRef(item.noteId)));
      if (counter.activeIssueId === id) tx.set(counterRef, {...counter, activeIssueId:null});
    });
    return {message:'已撤回核准；內容不會寄出，文章保留供後續收錄。'};
  }
  async function retryIssue(input) {
    const id = M.validId(input.issueId);
    await db.runTransaction(async tx => {
      const issue = data(await tx.get(issueRef(id)));
      if (!issue || !['partial','needs_review','blocked'].includes(issue.status) || issue.leaseUntilMs > now()) M.fail('本期目前不能重試。', 409);
      const docs = await txDocs(tx, issue.audience.map(email => deliveryRef(id, email)));
      const failed = docs.filter(s => data(s)?.status === 'failed');
      if (!failed.length && !docs.some(s => !s.exists)) M.fail('沒有可重試的失敗對象；結果不明者請先核對。', 409);
      failed.forEach(s => tx.update(s.ref, {attempts:0, nextAttemptAtMs:now()}));
      tx.update(issueRef(id), {status:'partial', updatedAtMs:now()});
    });
    return {message:'已安排補寄失敗對象；成功對象不會再寄。'};
  }
  async function resolveDelivery(input) {
    const id = M.validId(input.issueId), email = M.emailAddress(input.email);
    if (!email || !['sent','not_sent'].includes(input.result) || typeof input.evidence !== 'string' || input.evidence.trim().length < 5 || input.evidence.length > 500) M.fail('請填寫核對結果與至少 5 字的郵件紀錄依據。');
    if (input.result === 'sent') {
      await markAccepted(id, email, null, input.evidence.trim());
    } else {
      await db.runTransaction(async tx => {
        const issue = data(await tx.get(issueRef(id))), ref = deliveryRef(id, email), old = data(await tx.get(ref));
        if (!issue || issue.leaseUntilMs > now() || old?.status !== 'unknown') M.fail('本筆紀錄目前不能核對。', 409);
        tx.update(ref, {status:'failed', attempts:0, nextAttemptAtMs:now(), evidence:input.evidence.trim(), resolvedBy:M.ADMIN});
        tx.update(issueRef(id), {status:'partial', updatedAtMs:now()});
      });
    }
    return {message:'已保存核對結果，後續沿用本期處理。'};
  }
  async function markAccepted(id, email, attemptId, evidence) {
    await db.runTransaction(async tx => {
      const [i, c, d] = await txDocs(tx, [issueRef(id), counterRef, deliveryRef(id, email)]);
      const issue = data(i), counter = data(c) || {lastIssued:0}, delivery = data(d);
      if (evidence) {
        if (!issue || issue.leaseUntilMs > now() || delivery?.status !== 'unknown') M.fail('本筆紀錄目前不能核對。', 409);
      } else if (delivery?.attemptId !== attemptId || !['sending','unknown'].includes(delivery.status)) {
        M.fail('寄送紀錄已變更，需要人工核對。', 409);
      }
      if (!issue.firstSentAtMs) {
        if (counter.activeIssueId !== id || (counter.lastIssued || 0) + 1 !== issue.number) M.fail('期號狀態不一致，請核對寄送紀錄。', 409);
        tx.set(counterRef, {lastIssued:issue.number, activeIssueId:null});
        issue.items.forEach(item => tx.set(articleRef(item.noteId), {state:'sent', issueId:id, number:issue.number, sentAtMs:now()}));
      }
      tx.update(deliveryRef(id, email), {status:'sent', sentAtMs:now(), error:'', ...(evidence ? {evidence, resolvedBy:M.ADMIN} : {})});
      tx.update(issueRef(id), {firstSentAtMs:issue.firstSentAtMs || now(), ...(evidence ? {status:'partial'} : {}), updatedAtMs:now()});
    });
  }
  async function claimIssue(id) {
    const ref = issueRef(id), initial = data(await ref.get());
    if (!initial || !['approved','sending','partial'].includes(initial.status) || initial.scheduledAtMs > now()) return null;
    let audience = initial.audience;
    if (!audience) {
      const active = await db.collection('subscribers').where('status', '==', 'active').limit(M.MAX_AUDIENCE + 1).get();
      if (active.docs.length > M.MAX_AUDIENCE) M.fail('訂閱名單超過本服務單期處理上限，請先調整寄送服務。', 409);
      audience = [...new Set(active.docs.map(s => M.emailAddress(s.data().email)).filter(Boolean))].sort();
    }
    return db.runTransaction(async tx => {
      const [i, c] = await txDocs(tx, [ref, counterRef]);
      const issue = data(i), counter = data(c) || {lastIssued:0};
      if (!issue || !['approved','sending','partial'].includes(issue.status) || issue.leaseUntilMs > now() || issue.scheduledAtMs > now()) return null;
      if (!issue.snapshot?.items?.length) return null;
      const notes = await txDocs(tx, issue.items.map(item => db.doc('notes/' + item.noteId)));
      if (notes.some(s => data(s)?.status !== 'published')) {
        tx.update(ref, {status:'blocked', error:'本期有文章已下架，請核對後處理。', updatedAtMs:now()});
        return null;
      }
      if (!issue.firstSentAtMs && counter.activeIssueId && counter.activeIssueId !== id) return null;
      const frozenAudience = issue.audience || audience;
      if (!frozenAudience.length) {
        tx.update(ref, {status:'skipped', number:null, counts:{sent:0, skipped:0, failed:0, unknown:0, pending:0}, updatedAtMs:now()});
        issue.items.forEach(item => tx.delete(articleRef(item.noteId)));
        return null;
      }
      const number = issue.number || (counter.lastIssued || 0) + 1;
      if (!issue.firstSentAtMs) tx.set(counterRef, {...counter, activeIssueId:id});
      const claimed = {...issue, status:'sending', audience:frozenAudience, number, leaseToken:randomUUID(), leaseUntilMs:now() + M.LEASE_MS};
      tx.set(ref, claimed);
      return claimed;
    });
  }
  async function claimDelivery(issue, email) {
    return db.runTransaction(async tx => {
      const [i, d] = await txDocs(tx, [issueRef(issue.id), deliveryRef(issue.id, email)]);
      if (data(i)?.leaseToken !== issue.leaseToken || data(i).leaseUntilMs <= now()) return null;
      const old = data(d);
      if (['sent','skipped','unknown'].includes(old?.status)) return null;
      if (old?.status === 'sending') {
        tx.update(d.ref, {status:'unknown', error:'上次處理中斷，請核對 Gmail 寄件紀錄，避免重複寄送。'});
        return null;
      }
      if (old?.attempts >= M.MAX_ATTEMPTS || old?.nextAttemptAtMs > now()) return null;
      const attemptId = randomUUID();
      tx.set(deliveryRef(issue.id, email), {...old, email, status:'sending', attemptId,
        attempts:(old?.attempts || 0) + 1, totalAttempts:(old?.totalAttempts || 0) + 1, startedAtMs:now()});
      return attemptId;
    });
  }
  async function recordResult(issue, email, attemptId, fields) {
    await db.runTransaction(async tx => {
      const ref = deliveryRef(issue.id, email), old = data(await tx.get(ref));
      if (old?.attemptId !== attemptId || old.status !== 'sending') return;
      tx.update(ref, {...fields, updatedAtMs:now()});
    });
  }
  async function finishIssue(issue) {
    await db.runTransaction(async tx => {
      const [i, c] = await txDocs(tx, [issueRef(issue.id), counterRef]);
      const latest = data(i), counter = data(c) || {};
      if (latest?.leaseToken !== issue.leaseToken) return;
      const docs = await txDocs(tx, issue.audience.map(email => deliveryRef(issue.id, email)));
      const counts = {sent:0, skipped:0, failed:0, unknown:0, pending:0};
      let retryable = false;
      for (const doc of docs) {
        const d = data(doc), status = d?.status || 'pending';
        if (status === 'sending') {
          counts.unknown++;
          tx.update(doc.ref, {status:'unknown', error:'寄送中斷，請核對 Gmail 寄件紀錄，避免重複寄送。'});
        } else counts[status in counts ? status : 'pending']++;
        if (status === 'failed' && d.attempts < M.MAX_ATTEMPTS) retryable = true;
      }
      const status = counts.unknown ? 'needs_review' : counts.pending || retryable ? 'partial' : counts.failed ? 'needs_review' : counts.sent ? 'sent' : 'skipped';
      tx.update(issueRef(issue.id), {status, counts, leaseUntilMs:0, updatedAtMs:now()});
      if (status === 'skipped') {
        issue.items.forEach(item => tx.delete(articleRef(item.noteId)));
        tx.update(issueRef(issue.id), {number:null});
        if (counter.activeIssueId === issue.id) tx.set(counterRef, {...counter, activeIssueId:null});
      }
    });
  }
  async function processIssue(id) {
    const issue = await claimIssue(id);
    if (!issue) return;
    let attempts = 0;
    try {
      for (const email of issue.audience) {
        if (attempts >= M.BATCH_SIZE || now() > issue.leaseUntilMs - 60000) break;
        const attemptId = await claimDelivery(issue, email);
        if (!attemptId) continue;
        attempts++;
        let url;
        try {
          const subscribers = await db.collection('subscribers').where('email', '==', email).get();
          if (!subscribers.docs.some(s => s.data().status === 'active')) {
            await recordResult(issue, email, attemptId, {status:'skipped', error:'寄送前已退訂。'});
            continue;
          }
          url = await unsubscribeUrl(email);
        } catch {
          await recordResult(issue, email, attemptId, {status:'failed', error:'寄送前準備失敗，尚未寄信。', nextAttemptAtMs:now() + M.RETRY_MS});
          continue;
        }
        let info;
        try {
          info = await sendMail({from:M.FROM, to:email,
            messageId:'<newsletter-' + issue.id + '-' + M.hash(email).slice(0, 24) + '@tanji.tw>',
            ...M.renderDigest(issue.snapshot, {number:issue.number, unsubscribeUrl:url})});
          const accepted = info?.accepted?.some(address => M.emailAddress(address?.address || address) === email);
          if (!accepted) {
            const error = new Error('郵件服務未確認收件對象。');
            if (info?.rejected?.length) error.code = 'EENVELOPE';
            throw error;
          }
        } catch (error) {
          const failed = M.definitelyNotAccepted(error);
          await recordResult(issue, email, attemptId, {status:failed ? 'failed' : 'unknown',
            error:failed ? '郵件服務未接受，可安排補寄。' : '無法確認是否已寄出，請核對 Gmail 寄件紀錄。', nextAttemptAtMs:now() + M.RETRY_MS});
          continue;
        }
        // If persisting acceptance fails, leave the attempt in-flight. Recovery holds it for review.
        await markAccepted(issue.id, email, attemptId);
      }
    } finally {
      await finishIssue(issue);
    }
  }
  async function weekly(scheduleTime) {
    const at = new Date(scheduleTime).getTime();
    if (!Number.isFinite(at)) return;
    const local = new Date(at + 8 * 3600000);
    if (local.getUTCDay() !== 1 || local.getUTCHours() !== 8 || local.getUTCMinutes() !== 0) return;
    const id = 'week-' + local.toISOString().slice(0, 10), issue = data(await issueRef(id).get());
    if (issue?.scheduledAtMs === at && ['approved','sending','partial'].includes(issue.status)) await processIssue(id);
  }
  async function retryPending() {
    const pending = await db.collection('newsletterIssues').where('status', 'in', ['sending','partial']).get();
    for (const doc of pending.docs) await processIssue(doc.id);
  }
  async function admin(action, input = {}) {
    const actions = {getState:() => getState(input.issueId), setSelection:() => setSelection(input), rememberLegacy:() => rememberLegacy(input), saveIssue:() => saveIssue(input),
      previewIssue:() => previewIssue(input), testIssue:() => testIssue(input), approveIssue:() => approveIssue(input),
      revokeIssue:() => revokeIssue(input), retryIssue:() => retryIssue(input), resolveDelivery:() => resolveDelivery(input)};
    if (!Object.hasOwn(actions, action)) M.fail('不支援的電子報操作。');
    return actions[action]();
  }
  return {admin, weekly, retryPending, unsubscribeUrl, emailForToken};
}

module.exports = {createNewsletterService};
