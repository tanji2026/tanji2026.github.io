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
function sourceItem(id, note) {
  if (!note || note.status !== 'published') fail('電子報只能收錄已正式發布的文章。', 409);
  const item = {noteId:validId(id), title: String(note.titleZh || note.titleEn || '').trim(),
    summary:String(note.summaryZh || note.summaryEn || '').trim(),
    url:'https://tanji.tw/#/notes/' + encodeURIComponent(id), revision:Number(note.revision) || 0};
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
  const items = snapshot.items.map(item => `<section style="margin:28px 0"><h2 style="font-size:20px;color:#fff">${escapeHTML(item.title)}</h2><p style="white-space:pre-wrap">${escapeHTML(item.summary)}</p><a style="color:#c6b6ff" href="${escapeHTML(item.url)}">閱讀完整內容 ↗</a></section>`).join('');
  const optOut = unsubscribeUrl ? `<a style="color:#c6b6ff" href="${escapeHTML(unsubscribeUrl)}">取消訂閱</a>` : '測試／預覽不提供退訂操作';
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#0d0b12;padding:24px;font-family:-apple-system,BlinkMacSystemFont,sans-serif"><main style="max-width:600px;margin:auto;background:#181622;color:#d8d2ea;padding:32px 24px;border-radius:12px;line-height:1.8">${test ? '<p style="color:#ffdfba">這是管理員測試信，未對訂閱者發送。</p>' : ''}<p style="color:#c6b6ff">TANJI NOTES · ${label}</p><h1 style="font-size:24px;color:#fff">${escapeHTML(snapshot.subject)}</h1><p style="white-space:pre-wrap">${escapeHTML(snapshot.intro)}</p>${items}<hr style="border:0;border-top:1px solid #332d4a"><p style="font-size:12px">您因訂閱 tanji.tw 的碳吉筆記而收到此信。${optOut}<br>© TanJi 碳吉 · <a style="color:#c6b6ff" href="https://tanji.tw">tanji.tw</a></p></main></body></html>`;
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
  hash, escapeHTML, fail, validId, emailAddress, isAdmin, nextMonday, sourceItem, digestInput, renderDigest, definitelyNotAccepted};
