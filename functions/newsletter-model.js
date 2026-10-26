'use strict';

const {createHash} = require('node:crypto');
const ADMIN = 'tanji2026@gmail.com';
const FROM = '"TanJi 碳吉" <tanji2026@gmail.com>';
const MAX_ITEMS = 30;
const MAX_AUDIENCE = 2000;
const BATCH_SIZE = 20;
const LEASE_MS = 10 * 60 * 1000;
const RETRY_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const escapeHTML = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function validId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) fail('資料 ID 格式不正確。');
  return value;
}
function emailAddress(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 200 && /^[^@\s<>"&]+@[^@\s<>"&]+\.[^@\s<>"&]+$/.test(email) ? email : '';
}
function isAdmin(token) {
  return token?.email === ADMIN && token.email_verified === true && token.firebase?.sign_in_provider === 'google.com';
}
function text(value, max, label) {
  if (typeof value !== 'string' || value.length > max) fail(label + '格式或長度不正確。');
  return value.trim();
}
// Taiwan has no DST. Use UTC arithmetic so the server's own timezone never changes the result.
function nextMonday(now) {
  const local = new Date(Number(now) + 8 * 3600000);
  const day = local.getUTCDay();
  let delta = (8 - day) % 7;
  if (delta === 0 && local.getUTCHours() >= 8) delta = 7;
  const at = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + delta, 0);
  return {id: 'week-' + new Date(at + 8 * 3600000).toISOString().slice(0, 10), scheduledAtMs: at};
}
function period(id) {
  validId(id);
  if (!/^week-\d{4}-\d{2}-\d{2}$/.test(id)) fail('週別格式不正確。');
  const end = Date.parse(id.slice(5)+'T00:00:00+08:00');
  if (!Number.isFinite(end) || new Date(end+8*3600000).getUTCDay()!==1 || new Date(end+8*3600000).toISOString().slice(0,10)!==id.slice(5)) fail('週別必須是星期一。');
  return {id,startAtMs:end-7*86400000,endAtMs:end,scheduledAtMs:end+8*3600000};
}
function currentPeriods(now) {
  const local=new Date(Number(now)+8*3600000);
  const monday=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()-((local.getUTCDay()+6)%7));
  return [period('week-'+new Date(monday).toISOString().slice(0,10)),period('week-'+new Date(monday+7*86400000).toISOString().slice(0,10))];
}
function publishedMillis(value) {
  if(value?.toMillis)return value.toMillis();
  if(typeof value!=='string')return NaN;
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))value+='T00:00:00+08:00';
  else if(!/(Z|[+-]\d{2}:\d{2})$/.test(value))value+='+08:00';
  return Date.parse(value);
}
function sourceItem(id, note) {
  if (!note || note.status !== 'published') fail('電子報只能收錄已正式發布的文章。', 409);
  const item = {noteId:validId(id), title: String(note.titleZh || note.titleEn || '').trim(),
    summary:String(note.summaryZh || note.summaryEn || String(note.bodyZh||note.bodyEn||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').slice(0,200)).trim(),
    url:'https://tanji.tw/#/notes/' + encodeURIComponent(id), cover:/^https:\/\//i.test(note.cover||'')?String(note.cover):'', revision:Number(note.revision) || 0};
  if (!item.title) fail('已發布文章缺少標題。', 409);
  return {...item, sourceHash:hash(JSON.stringify(item))};
}
function digestInput(input) {
  if (!Array.isArray(input?.items) || !input.items.length || input.items.length > MAX_ITEMS) fail('請選擇 1–30 篇已發布筆記。');
  const ids = new Set();
  const items = input.items.map(item => {
    const noteId = validId(item.noteId);
    if (ids.has(noteId)) fail('同一期不能重複收錄文章。');
    ids.add(noteId);
    return {noteId, title:text(item.title, 200, '文章標題'), summary:text(item.summary, 1000, '文章摘要')};
  });
  if (items.some(item => !item.title)) fail('請填寫文章標題。');
  const subject = text(input.subject, 160, '信件主旨');
  if (!subject || /[\r\n]/.test(subject)) fail('請填寫單行信件主旨。');
  return {subject, intro:text(input.intro, 4000, '本期前言'), items};
}
function renderDigest(snapshot, {number = null, unsubscribeUrl = '', test = false} = {}) {
  const label = number ? '第 ' + number + ' 期' : '期號於正式發行時編定';
  const subject = (test ? '【測試信】' : '') + '【碳吉筆記' + (number ? ' 第 ' + number + ' 期' : '') + '】' + snapshot.subject;
  const items = snapshot.items.map(item => `<tr><td bgcolor="#181622" style="background-color:#181622;padding:28px 24px 12px;font-family:Arial,sans-serif;color:#f3f0fa;">${item.cover?`<img src="${escapeHTML(item.cover)}" alt="" width="552" style="display:block;width:100%;max-width:552px;height:auto;border-radius:10px;margin-bottom:20px;">`:''}<h2 style="color:#ffffff;font-size:22px;line-height:1.5;margin:0 0 16px;font-weight:700;">${escapeHTML(item.title)}</h2><p style="color:#e6e0f0;font-size:16px;line-height:1.85;margin:0 0 24px;white-space:pre-wrap;">${escapeHTML(item.summary)}</p><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#c6b6ff" style="background-color:#c6b6ff;border-radius:6px;"><a href="${escapeHTML(item.url)}" style="display:inline-block;padding:12px 28px;color:#181622;font-size:15px;font-weight:700;text-decoration:none;">閱讀完整內容 ↗</a></td></tr></table></td></tr>`).join('');
  const optOut = unsubscribeUrl ? `<a style="color:#c6b6ff;text-decoration:underline;" href="${escapeHTML(unsubscribeUrl)}">取消訂閱</a>` : '這是預覽／測試，不會變更訂閱狀態';
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head><body bgcolor="#0d0b12" style="margin:0;padding:24px 12px;background-color:#0d0b12;color:#f3f0fa;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#0d0b12"><tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" bgcolor="#181622" style="width:100%;max-width:600px;background-color:#181622;border-radius:12px;"><tr><td bgcolor="#181622" style="padding:32px 24px 4px;background-color:#181622;font-family:Arial,sans-serif;color:#f3f0fa;">${test?'<p style="color:#ffdfba;font-size:14px;">管理員測試信，未對訂閱者寄送。</p>':''}<p style="color:#c6b6ff;font-size:13px;letter-spacing:1px;margin:0 0 12px;">TANJI NOTES · 碳吉筆記${number?' · 第 '+number+' 期':''}</p><h1 style="color:#ffffff;font-size:26px;line-height:1.5;margin:0;font-weight:700;">${escapeHTML(snapshot.subject)}</h1>${snapshot.intro?`<p style="color:#e6e0f0;font-size:16px;line-height:1.85;">${escapeHTML(snapshot.intro)}</p>`:''}</td></tr>${items}<tr><td bgcolor="#181622" style="padding:28px 24px 32px;background-color:#181622;"><hr style="border:0;border-top:1px solid #4a4060;margin:0 0 20px;"><p style="font-family:Arial,sans-serif;color:#c9c0d9;font-size:13px;line-height:1.85;margin:0;">您因在 tanji.tw 訂閱碳吉筆記而收到此信。<br>${optOut}<br>© TanJi 碳吉 · <a href="https://tanji.tw" style="color:#c6b6ff;text-decoration:none;">tanji.tw</a></p></td></tr></table></td></tr></table></body></html>`;
  const plain = ['碳吉筆記 · ' + label, snapshot.subject, snapshot.intro,
    ...snapshot.items.map(item => item.title + '\n' + item.summary + '\n' + item.url),
    unsubscribeUrl ? '取消訂閱：' + unsubscribeUrl : '測試／預覽不提供退訂操作'].join('\n\n');
  return {subject, html, text:plain};
}
// A timeout after SMTP DATA may already have delivered mail. Never blindly retry it.
function definitelyNotAccepted(error) {
  return ['EAUTH','EENVELOPE','EDNS','ECONNECTION'].includes(error?.code)
    || (Number(error?.responseCode) >= 400 && Number(error?.responseCode) < 600)
    || (error?.code === 'ETIMEDOUT' && ['CONN','EHLO','HELO','AUTH'].includes(error?.command));
}

module.exports = {ADMIN, FROM, MAX_ITEMS, MAX_AUDIENCE, BATCH_SIZE, LEASE_MS, RETRY_MS, MAX_ATTEMPTS,
  hash, escapeHTML, fail, validId, period, currentPeriods, publishedMillis, emailAddress, isAdmin, nextMonday, sourceItem, digestInput, renderDigest, definitelyNotAccepted};
