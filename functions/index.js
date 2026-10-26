'use strict';
require('dotenv').config();
const {onRequest} = require('firebase-functions/v2/https');
const {onSchedule} = require('firebase-functions/v2/scheduler');
const M = require('./newsletter-model');
const {createNewsletterService} = require('./newsletter-service');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore, FieldValue} = require('firebase-admin/firestore');
const {getAuth} = require('firebase-admin/auth');
const nodemailer = require('nodemailer');
const {renderNote} = require('./render-note');

initializeApp();

function getTransporter() {
  const user = process.env.GMAIL_USER || 'tanji2026@gmail.com';
  const pass = process.env.GMAIL_APP_PASS;
  if (!pass) throw new Error('尚未設定 GMAIL_APP_PASS 應用程式密碼');
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
  });
}

let newsletter;
function newsletterService() {
  if (!newsletter) newsletter = createNewsletterService({
    db: getFirestore(), sendMail: mail => getTransporter().sendMail(mail),
    projectId: String(process.env.GCLOUD_PROJECT || 'tanji-official-1219f').replace(/[^a-z0-9-]/g, '')
  });
  return newsletter;
}

// 1. 社群分享預覽（OG Tags）
exports.shareNote = onRequest({region: 'asia-east1', maxInstances: 3, minInstances: 0, memory: '256MiB', timeoutSeconds: 30}, async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).send('Method not allowed');
  const id = req.path.split('/').filter(Boolean).pop() || '';
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return res.status(404).send('Note not found');
  try {
    const snap = await getFirestore().doc('notes/' + id).get();
    if (!snap.exists || snap.data().status !== 'published') return res.set('Cache-Control', 'no-store').status(404).send('這篇筆記尚未公開或已下架。');
    const project = String(process.env.GCLOUD_PROJECT || 'tanji-official-1219f').replace(/[^a-z0-9-]/g, '');
    const base = 'https://asia-east1-' + project + '.cloudfunctions.net/shareNote/' + encodeURIComponent(id);
    const lang = req.query.lang === 'en' ? 'en' : 'zh';
    res.set('Cache-Control', 'public,max-age=60,s-maxage=60');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; img-src https:; media-src https:; style-src 'unsafe-inline'; frame-src https://www.youtube-nocookie.com; base-uri 'none'; form-action 'none'");
    return res.type('html').status(200).send(renderNote({...snap.data(), id}, base, lang));
  } catch (error) {
    console.error('shareNote failed', error.code || error.message);
    return res.set('Cache-Control', 'no-store').status(503).send('暫時無法讀取文章，請稍後重試。');
  }
});

// 2. 訪客訂閱電子報（發送歡迎信）
exports.subscribeNewsletter = onRequest({region: 'asia-east1', cors: true, maxInstances: 5, timeoutSeconds: 30}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({error: '僅接受 POST 請求'});
  const {email, language} = req.body || {};
  if (!M.emailAddress(email)) {
    return res.status(400).json({error: '電子信箱格式不正確'});
  }
  const cleanEmail = M.emailAddress(email);
  const lang = language === 'en' ? 'en' : 'zh';
  const db = getFirestore();

  try {
    const existing = await db.collection('subscribers').where('email', '==', cleanEmail).get();
    let alreadySubscribed = false;
    if (!existing.empty) {
      const doc = existing.docs[0];
      if (doc.data().status === 'active') {
        alreadySubscribed = true;
      }
      await doc.ref.update({status: 'active', language:lang, updatedAt: FieldValue.serverTimestamp()});
    } else {
      await db.collection('subscribers').add({
        email: cleanEmail,
        language: lang,
        status: 'active',
        createdAt: FieldValue.serverTimestamp()
      });
    }

    const unsubsLink = await newsletterService().unsubscribeUrl(cleanEmail);
    const mailer = getTransporter();
    await mailer.sendMail({
      from: '"TanJi 碳吉" <tanji2026@gmail.com>',
      to: cleanEmail,
      subject: '歡迎訂閱「碳吉筆記」！🌱',
      html: `
        <div style="max-width:600px;margin:0 auto;background:#181622;color:#f3f0fa;padding:32px 24px;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.6;">
          <h2 style="color:#c6b6ff;margin-top:0;">探索永續解方的新創團隊 ── 碳吉</h2>
          <p>哈囉！感謝您訂閱碳吉筆記。</p>
          <p>我們會將已公開、選擇收錄的筆記整理成電子報，經團隊確認後於週一上午寄送；沒有新內容時會暫停一期。</p>
          <div style="margin:28px 0;text-align:center;">
            <a href="https://tanji.tw/#/notes" style="background:#c6b6ff;color:#181622;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">瀏覽最新筆記 ↗</a>
          </div>
          <hr style="border:none;border-top:1px solid #332d4a;margin:24px 0;" />
          <p style="font-size:12px;color:#9b94b3;margin:0;line-height:1.8;">
            這封信是由系統自動發送至 ${M.escapeHTML(cleanEmail)}。<br>
            若您不想再收到電子報，可點此 <a href="${unsubsLink}" style="color:#c6b6ff;text-decoration:underline;">取消訂閱</a>。<br>
            © TanJi 碳吉 · <a href="https://tanji.tw" style="color:#c6b6ff;text-decoration:none;">tanji.tw</a>
          </p>
        </div>
      `
    });

    const successMsg = alreadySubscribed
      ? '歡迎信已重新補寄至您的信箱！感謝支持碳吉。'
      : '訂閱成功！歡迎信已送至您的信箱。';
    return res.status(200).json({success: true, message: successMsg});
  } catch (error) {
    console.error('subscribe failed', error.code || 'unknown');
    return res.status(500).json({error: '訂閱過程發生異常，請稍後再試。'});
  }
});

// GET only displays confirmation; email scanners/prefetching must not unsubscribe people.
// Existing email-only links remain usable through the confirmation form.
exports.unsubscribe = onRequest({region:'asia-east1', maxInstances:3, timeoutSeconds:30}, async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).send('Method not allowed');
  try {
    const query = req.query || {};
    const email = query.key || query.token
      ? await newsletterService().emailForToken(String(query.key || ''), String(query.token || ''))
      : M.emailAddress(query.email);
    res.set('Cache-Control', 'no-store');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (!email) return res.status(400).send('無效的取消訂閱連結');
    const confirmed = req.method === 'POST';
    if (confirmed) {
      const snap = await getFirestore().collection('subscribers').where('email', '==', email).get();
      for (const doc of snap.docs) await doc.ref.update({status:'unsubscribed', unsubscribedAt:FieldValue.serverTimestamp()});
    }
    return res.type('html').send(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>取消訂閱｜TanJi 碳吉</title></head><body style="background:#0d0b12;color:#f3f0fa;font-family:sans-serif;padding:40px 20px;text-align:center"><main style="max-width:480px;margin:auto"><h1>${confirmed ? '已成功取消訂閱' : '取消訂閱碳吉筆記'}</h1><p>${confirmed ? '未來不會再主動寄送電子報至此信箱。' : '確認後，將停止寄送電子報至此信箱。'}</p>${confirmed ? '' : '<form method="post"><button type="submit">確認取消訂閱</button></form>'}<p><a style="color:#c6b6ff" href="https://tanji.tw">返回碳吉官網 ↗</a></p></main></body></html>`);
  } catch (error) {
    console.error('unsubscribe failed', error.code || 'unknown');
    return res.status(503).send('暫時無法處理，請稍後重試。');
  }
});

// Retain the old URL but fail closed: no per-article immediate broadcast, even for an admin.
exports.sendNewsletter = onRequest({region:'asia-east1', cors:true, maxInstances:1}, (req, res) => {
  return res.status(410).json({error:'單篇直接寄送已停用，請使用「電子報管理」預覽、測試及核准整期。'});
});

exports.newsletterAdmin = onRequest({region:'asia-east1', cors:['https://tanji.tw','https://www.tanji.tw','https://tanji2026.github.io'], maxInstances:3, timeoutSeconds:120}, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({error:'僅接受 POST 請求'});
  const match = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
  if (!match) return res.status(401).json({error:'請先登入管理員帳號。'});
  let token;
  try { token = await getAuth().verifyIdToken(match[1], true); }
  catch { return res.status(401).json({error:'登入已失效，請重新登入。'}); }
  if (!M.isAdmin(token)) return res.status(403).json({error:'僅限指定的 Google 管理員操作。'});
  try {
    const result = await newsletterService().admin(req.body?.action, req.body?.input || {});
    return res.json(result);
  } catch (error) {
    if (!error.status) console.error('newsletterAdmin failed', error.code || 'unknown');
    return res.status(error.status || 503).json({error:error.status ? error.message : '操作未完成，請稍後重試；系統不會自動群發。'});
  }
});

exports.weeklyNewsletter = onSchedule({region:'asia-east1', schedule:'0 8 * * 1', timeZone:'Asia/Taipei',
  maxInstances:1, concurrency:1, timeoutSeconds:300, retryCount:3, minBackoffSeconds:60}, async event => {
  await newsletterService().weekly(event.scheduleTime);
});
exports.retryNewsletter = onSchedule({region:'asia-east1', schedule:'every 15 minutes', timeZone:'Asia/Taipei',
  maxInstances:1, concurrency:1, timeoutSeconds:300}, async () => {
  await newsletterService().retryPending();
});
