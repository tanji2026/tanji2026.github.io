'use strict';
require('dotenv').config();
const {onRequest} = require('firebase-functions/v2/https');
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
    auth: { user, pass }
  });
}

function getUnsubscribeUrl(email) {
  const project = String(process.env.GCLOUD_PROJECT || 'tanji-official-1219f').replace(/[^a-z0-9-]/g, '');
  return `https://asia-east1-${project}.cloudfunctions.net/unsubscribe?email=${encodeURIComponent(email)}`;
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
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email).trim())) {
    return res.status(400).json({error: '電子信箱格式不正確'});
  }
  const cleanEmail = String(email).trim().toLowerCase();
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
      await doc.ref.update({status: 'active', updatedAt: FieldValue.serverTimestamp()});
    } else {
      await db.collection('subscribers').add({
        email: cleanEmail,
        language: lang,
        status: 'active',
        createdAt: FieldValue.serverTimestamp()
      });
    }

    const unsubsLink = getUnsubscribeUrl(cleanEmail);
    const mailer = getTransporter();
    await mailer.sendMail({
      from: '"TanJi 碳吉" <tanji2026@gmail.com>',
      to: cleanEmail,
      subject: '歡迎訂閱「碳吉筆記」！🌱',
      html: `
        <div style="max-width:600px;margin:0 auto;background:#181622;color:#f3f0fa;padding:32px 24px;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.6;">
          <h2 style="color:#c6b6ff;margin-top:0;">探索永續解方的新創團隊 ── 碳吉</h2>
          <p>哈囉！感謝您訂閱碳吉筆記。</p>
          <p>未來每當團隊發布關於氣候科技、永續解方或競賽進程的深入洞察時，我們都會第一時間寄送給您。</p>
          <div style="margin:28px 0;text-align:center;">
            <a href="https://tanji.tw/#/notes" style="background:#c6b6ff;color:#181622;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">瀏覽最新筆記 ↗</a>
          </div>
          <hr style="border:none;border-top:1px solid #332d4a;margin:24px 0;" />
          <p style="font-size:12px;color:#9b94b3;margin:0;line-height:1.8;">
            這封信是由系統自動發送至 ${cleanEmail}。<br>
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
    console.error('subscribe error:', error);
    return res.status(500).json({error: '訂閱過程發生異常，請稍後再試。'});
  }
});

// 3. 處理點擊退訂（GET /unsubscribe）
exports.unsubscribe = onRequest({region: 'asia-east1', maxInstances: 3, timeoutSeconds: 30}, async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).send('無效的取消訂閱連結');
  }

  try {
    const db = getFirestore();
    const snap = await db.collection('subscribers').where('email', '==', email).get();
    if (!snap.empty) {
      for (const doc of snap.docs) {
        await doc.ref.update({status: 'unsubscribed', unsubscribedAt: FieldValue.serverTimestamp()});
      }
    }

    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="zh-TW">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>已成功取消訂閱 ｜ TanJi 碳吉</title>
        <style>
          body { margin:0; padding:40px 20px; background:#0d0b12; color:#f3f0fa; font-family:-apple-system,BlinkMacSystemFont,sans-serif; display:flex; justify-content:center; align-items:center; min-height:80vh; }
          .card { max-width:480px; width:100%; background:#181622; border:1px solid rgba(198,182,255,0.2); border-radius:12px; padding:36px 28px; text-align:center; box-sizing:border-box; }
          h2 { color:#c6b6ff; margin-top:0; font-size:1.4rem; }
          p { color:#d8d2ea; font-size:0.95rem; line-height:1.6; }
          .btn { display:inline-block; margin-top:20px; padding:10px 24px; background:#c6b6ff; color:#181622; text-decoration:none; border-radius:6px; font-weight:bold; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>已成功取消訂閱 🌱</h2>
          <p>您的信箱（<strong>${email}</strong>）已從「碳吉筆記」寄送名單中移除，未來將不再主動寄送電子報給您。</p>
          <p style="font-size:0.85rem;color:#9b94b3;">若您未來想重新追蹤永續解方進程，隨時歡迎至官網重新訂閱！</p>
          <a href="https://tanji.tw" class="btn">返回碳吉官方網站 ↗</a>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('unsubscribe error:', err);
    return res.status(500).send('處理退訂時發生錯誤，請稍後重試。');
  }
});

// 4. 管理員後台群發或單寄測試信
exports.sendNewsletter = onRequest({region: 'asia-east1', cors: true, maxInstances: 3, timeoutSeconds: 120}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({error: '僅接受 POST 請求'});

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({error: '未授權的操作'});
  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    if (decoded.email !== 'tanji2026@gmail.com') return res.status(403).json({error: '僅限碳吉管理員操作'});

    const {noteId, isTest} = req.body || {};
    if (!noteId) return res.status(400).json({error: '請指定要發送的筆記 ID'});

    const db = getFirestore();
    const noteSnap = await db.doc('notes/' + noteId).get();
    if (!noteSnap.exists) return res.status(404).json({error: '找不到該篇筆記'});
    const note = noteSnap.data();

    const title = note.titleZh || '碳吉筆記最新文章';
    const summary = note.summaryZh || '點擊連結閱讀全文深入內容...';
    const noteUrl = 'https://tanji.tw/#/notes/' + encodeURIComponent(noteId);
    const mailer = getTransporter();

    // 測試模式：僅寄給管理員 tanji2026@gmail.com
    if (isTest) {
      await mailer.sendMail({
        from: '"TanJi 碳吉" <tanji2026@gmail.com>',
        to: 'tanji2026@gmail.com',
        subject: `【預覽測試】碳吉筆記：${title}`,
        html: `
          <div style="background:#2b1b3d;color:#ffdfba;padding:10px 16px;border-radius:6px;margin-bottom:16px;font-size:13px;text-align:center;">
            ⚠️ 這是給管理員的<strong>排版測試信</strong>，未對真實訂閱者發送。
          </div>
          <div style="max-width:600px;margin:0 auto;background:#181622;color:#f3f0fa;padding:32px 24px;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.7;">
            <div style="font-size:12px;color:#c6b6ff;letter-spacing:1px;margin-bottom:8px;">TANJI NOTES · 碳吉筆記</div>
            <h1 style="color:#ffffff;font-size:22px;margin:0 0 16px 0;">${title}</h1>
            <p style="color:#d8d2ea;font-size:15px;margin-bottom:28px;">${summary}</p>
            <div style="margin:32px 0;text-align:center;">
              <a href="${noteUrl}" style="background:#c6b6ff;color:#181622;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">閱讀完整內容 ↗</a>
            </div>
            <hr style="border:none;border-top:1px solid #332d4a;margin:32px 0;" />
            <p style="font-size:12px;color:#9b94b3;margin:0;line-height:1.8;">
              您會收到這封信是因為您在碳吉官網（tanji.tw）訂閱了電子報。<br>
              若不想再收到電子報，可點此取消訂閱。<br>
              © TanJi 碳吉 · <a href="https://tanji.tw" style="color:#c6b6ff;text-decoration:none;">tanji.tw</a>
            </p>
          </div>
        `
      });
      return res.status(200).json({success: true, isTest: true, message: '測試信已成功寄送至 tanji2026@gmail.com！請至信箱確認排版。'});
    }

    // 正式群發模式：抓取所有 active 訂閱者
    const subSnap = await db.collection('subscribers').where('status', '==', 'active').get();
    if (subSnap.empty) return res.status(200).json({success: true, count: 0, message: '目前尚無有效訂閱者'});

    const emails = subSnap.docs.map(d => d.data().email).filter(Boolean);

    await mailer.sendMail({
      from: '"TanJi 碳吉" <tanji2026@gmail.com>',
      to: 'tanji2026@gmail.com',
      bcc: emails,
      subject: `【碳吉筆記】${title}`,
      html: `
        <div style="max-width:600px;margin:0 auto;background:#181622;color:#f3f0fa;padding:32px 24px;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.7;">
          <div style="font-size:12px;color:#c6b6ff;letter-spacing:1px;margin-bottom:8px;">TANJI NOTES · 碳吉筆記</div>
          <h1 style="color:#ffffff;font-size:22px;margin:0 0 16px 0;">${title}</h1>
          <p style="color:#d8d2ea;font-size:15px;margin-bottom:28px;">${summary}</p>
          <div style="margin:32px 0;text-align:center;">
            <a href="${noteUrl}" style="background:#c6b6ff;color:#181622;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">閱讀完整內容 ↗</a>
          </div>
          <hr style="border:none;border-top:1px solid #332d4a;margin:32px 0;" />
          <p style="font-size:12px;color:#9b94b3;margin:0;line-height:1.8;">
            您會收到這封信是因為您在碳吉官網（tanji.tw）訂閱了電子報。<br>
            若您不想再收到電子報，可點此取消訂閱。<br>
            © TanJi 碳吉 · <a href="https://tanji.tw" style="color:#c6b6ff;text-decoration:none;">tanji.tw</a>
          </p>
        </div>
      `
    });

    await noteSnap.ref.update({
      newsletterSentAt: FieldValue.serverTimestamp(),
      newsletterCount: emails.length
    });

    return res.status(200).json({success: true, count: emails.length, message: `已成功正式群發給 ${emails.length} 位訂閱者！`});
  } catch (error) {
    console.error('sendNewsletter error:', error);
    return res.status(500).json({error: error.message || '發送失敗'});
  }
});
