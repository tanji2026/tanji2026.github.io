(function(){'use strict';
const TYPES=['projects','awards','news','topics'];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=v=>JSON.parse(JSON.stringify(v));
function safeUrl(v,image=false){v=String(v||'').trim();if(image&&/^\.\/(assets|images)\/[a-zA-Z0-9_./-]+$/.test(v)&&!v.includes('..'))return v;try{const u=new URL(v);return u.protocol==='https:'?u.href:''}catch{return ''}}
function sorted(rows){return [...(rows||[])].sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0)||String(a.id).localeCompare(String(b.id)));}
function nextOrder(rows){return Math.min(0,...(rows||[]).map(r=>Number(r.order)||0))-1;}
function removeRecord(content,type,id){if(!TYPES.includes(type))throw Error('不支援的資料類型');const c=clone(content);if(!c[type].some(r=>r.id===id))throw Error('找不到資料');const removed={...c.settings.deletedRecords};const ids=[id];if(type==='projects'){const related=c.awards.filter(a=>a.projectId===id);removed.awards=[...new Set([...(removed.awards||[]),...related.map(a=>a.id)])];c.awards=c.awards.filter(a=>a.projectId!==id);c.news=c.news.map(n=>n.projectId===id?{...n,projectId:''}:n);}removed[type]=[...new Set([...(removed[type]||[]),...ids])];c.settings.deletedRecords=removed;c[type]=c[type].filter(r=>r.id!==id);return c;}
function visible(rows){return sorted(rows).filter(r=>!r.archived&&r.visibility!=='draft');}
function cleanContent(raw){if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('資料格式不正確');const x={settings:{...raw.settings}};for(const type of TYPES){if(!Array.isArray(raw[type]))throw Error('缺少 '+type+' 資料');if(raw[type].length>300)throw Error('單一類型最多 300 筆');x[type]=raw[type].filter(r=>!(x.settings.deletedRecords?.[type]||[]).includes(r.id)).map(r=>({...r}));}return clone(x);}
// Legacy sites shipped their portfolio in files while cloud documents could contain settings only.
// Explicit complete snapshots are authoritative, including intentionally empty sections.
function mergeContent(base,remote){
 const original=cleanContent(base);
 if(!remote||typeof remote!=='object'||Array.isArray(remote))throw Error('雲端內容格式不正確');
 const complete=remote.settings?.contentMode==='complete-v1';
 const result={settings:{...original.settings,...remote.settings}};
 for(const type of TYPES){
  if(complete&&!Array.isArray(remote[type]))throw Error('完整發布內容缺少 '+type);
  const incoming=Array.isArray(remote[type])?remote[type]:[];
  if(complete){result[type]=incoming.map(r=>({...r}));continue;}
  const rows=new Map(original[type].map(r=>[r.id,{...r}]));
  for(const row of incoming)rows.set(row.id,{...rows.get(row.id),...row});
  result[type]=[...rows.values()];
 }
 return cleanContent(result);
}
function assertPublishSafe(previous,next){
 if(!previous)return;
 for(const type of TYPES){
  const old=visible(previous[type]),rows=next[type]||[],removed=new Set(next.settings?.deletedRecords?.[type]||[]);
  if(old.length&&!rows.length&&old.some(r=>!removed.has(r.id)))throw Error('偵測到 '+type+' 原本有內容，但目前草稿為空；已停止發布。請重新讀取，或先從版本備份還原內容。');
 }
}

function validate(content,publicOnly=false){const c=cleanContent(content);for(const type of TYPES){const ids=new Set();for(const r of c[type]){if(!/^[a-zA-Z0-9_-]{1,80}$/.test(r.id||''))throw Error('資料 ID 格式不正確');if(ids.has(r.id))throw Error('重複 ID：'+r.id);ids.add(r.id);if(!publicOnly||(!r.archived&&r.visibility==='published')){if(!String(r.titleZh||'').trim()||!String(r.titleEn||'').trim())throw Error('請補齊中英文標題：'+r.id);if(r.url&&!safeUrl(r.url))throw Error('網址須為 HTTPS：'+r.id);if(r.image&&!safeUrl(r.image,true))throw Error('圖片網址格式不正確：'+r.id);}}}if(c.settings.youtube&&!safeUrl(c.settings.youtube))throw Error('YouTube 須填寫 HTTPS 網址');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.settings.email||''))throw Error('請填寫有效聯絡信箱');if(new TextEncoder().encode(JSON.stringify(c)).length>650000)throw Error('內容太大，請以圖片網址取代圖片資料');return c;}
function toPublic(content){const c=validate(content,true);c.settings.contentMode='complete-v1';for(const type of TYPES)c[type]=visible(c[type]).map(r=>({...r,visibility:'published',archived:false}));return c;}
function pagesFor(rows,page,size=6){const total=Math.max(1,Math.ceil(rows.length/size));page=Math.max(1,Math.min(Number(page)||1,total));return {page,total,rows:rows.slice((page-1)*size,page*size),count:rows.length};}
window.TanjiCore={TYPES,esc,clone,safeUrl,sorted,nextOrder,removeRecord,visible,mergeContent,assertPublishSafe,cleanContent,validate,toPublic,pagesFor};
})();
