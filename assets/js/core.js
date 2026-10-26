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

window.TANJI_SCREENS={"tj1": "./assets/images/tj1.jpg", "tj3": "./assets/images/tj3.jpg", "tj7": "./assets/images/tj7.jpg", "tj9": "./assets/images/tj9.jpg", "tj8": "./assets/images/tj8.jpg", "tj5": "./assets/images/tj5.jpg", "tj6": "./assets/images/tj6.jpg", "tj4": "./assets/images/tj4.jpg", "tj2": "./assets/images/tj2.jpg"};
window.TANJI_ART={"climate": "./assets/images/climate.svg", "finance": "./assets/images/finance.svg", "learning": "./assets/images/learning.svg"};
window.TANJI_BABY="./assets/images/tanjibaby.png";

/* Independent notes model. Existing site/public content is deliberately unchanged. */
(function(){'use strict';
const C=window.TanjiCore,E=C.esc;
const FORMATS={note:['一般筆記','Personal note'],article:['議題文章','Perspective'],news:['新聞評論','News commentary']};
const IMAGE_EXT=['jpg','jpeg','png','gif','webp','avif','bmp','svg','ico','heic','heif','tif','tiff','jxl','apng'];
const VIDEO_EXT=['mp4','m4v','mov','webm','ogv','ogg','avi','mkv','3gp','3g2','mpeg','mpg','mts','m2ts','ts','flv','wmv'];
const MIMES={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',avif:'image/avif',bmp:'image/bmp',svg:'image/svg+xml',ico:'image/x-icon',heic:'image/heic',heif:'image/heif',tif:'image/tiff',tiff:'image/tiff',jxl:'image/jxl',apng:'image/apng',mp4:'video/mp4',m4v:'video/x-m4v',mov:'video/quicktime',webm:'video/webm',ogv:'video/ogg',ogg:'video/ogg',avi:'video/x-msvideo',mkv:'video/x-matroska','3gp':'video/3gpp','3g2':'video/3gpp2',mpeg:'video/mpeg',mpg:'video/mpeg',mts:'video/mp2t',m2ts:'video/mp2t',ts:'video/mp2t',flv:'video/x-flv',wmv:'video/x-ms-wmv'};
const accept=[...IMAGE_EXT,...VIDEO_EXT].map(x=>'.'+x).join(',')+',image/*,video/*';
const text=(r,k,lang='zh')=>r?.[k+(lang==='en'?'En':'Zh')]||r?.[k+'Zh']||r?.[k+'En']||'';
function sorted(rows){return [...(rows||[])].sort((a,b)=>String(b.publishedAt||b.createdAt||'').localeCompare(String(a.publishedAt||a.createdAt||''))||String(b.id).localeCompare(String(a.id)));}
function safeLink(v){return C.safeUrl(v)||'';}
function mediaUrl(v){return C.safeUrl(v,true)||'';}
function youtube(v){try{const u=new URL(v);let id;if(u.hostname==='youtu.be')id=u.pathname.slice(1);else if(['youtube.com','www.youtube.com','m.youtube.com','www.youtube-nocookie.com'].includes(u.hostname))id=u.searchParams.get('v')||u.pathname.split('/').filter(Boolean).pop();return /^[a-zA-Z0-9_-]{11}$/.test(id||'')?'https://www.youtube-nocookie.com/embed/'+id:'';}catch{return '';}}
function sanitize(html){
 if(!window.DOMPurify)return '<p>'+E(String(html||'').replace(/<[^>]*>/g,''))+'</p>';
 const clean=window.DOMPurify.sanitize(String(html||''),{ALLOWED_TAGS:['p','br','div','span','h2','h3','h4','strong','b','em','i','u','s','blockquote','ul','ol','li','a','hr','pre','code','table','thead','tbody','tr','th','td','figure','figcaption','img','video','source','iframe'],ALLOWED_ATTR:['href','src','alt','title','width','height','colspan','rowspan','scope','controls','preload','playsinline','poster','type','allowfullscreen','style'],ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false});
 const box=document.createElement('div');box.innerHTML=clean;
 box.querySelectorAll('*').forEach(el=>{
  const align=el.style.textAlign,width=el.style.width;
  el.removeAttribute('style');
  if(['left','center','right','justify'].includes(align))el.style.textAlign=align;
  if(/^(25|50|75|100)%$/.test(width)&&['FIGURE','IMG','VIDEO','TABLE'].includes(el.tagName))el.style.width=width;
  for(const attr of ['src','href','poster'])if(el.hasAttribute(attr)&&!mediaUrl(el.getAttribute(attr)))el.removeAttribute(attr);
  if(el.tagName==='IFRAME'){
   const url=youtube(el.getAttribute('src'));
   if(!url){el.remove();return;}el.src=url;el.title=el.title||'YouTube';el.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation');el.setAttribute('allowfullscreen','');el.setAttribute('loading','lazy');
  }
  if(el.tagName==='A'){el.target='_blank';el.rel='noopener noreferrer';}
  if(el.tagName==='IMG'){el.loading='lazy';el.decoding='async';}
  if(el.tagName==='VIDEO'){el.controls=true;el.preload='metadata';el.setAttribute('playsinline','');el.removeAttribute('autoplay');}
 });
 return box.innerHTML;
}
function validate(input,publishing=false){
 const n={...input};
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(n.id||''))throw Error('網址名稱請使用英文字母、數字、連字號或底線，最多 80 字。');
 for(const key of ['titleZh','titleEn','summaryZh','summaryEn','author','categoryId','cover','sourceTitle','sourceName','sourceDate','sourceUrl','publishedAt','createdAt'])n[key]=String(n[key]||'').trim();
 n.author=n.author||'Coco';n.format=FORMATS[n.format]?n.format:'note';n.tags=[...new Set((Array.isArray(n.tags)?n.tags:[]).map(x=>String(x).trim()).filter(Boolean))].slice(0,15);
 n.bodyZh=sanitize(n.bodyZh);n.bodyEn=sanitize(n.bodyEn);
 if(publishing&&(!n.titleZh&&!n.titleEn))throw Error('請至少填寫一種語言的文章標題。');
 if(publishing&&!String(n.bodyZh+n.bodyEn).replace(/<[^>]*>/g,'').trim()&&!/<(img|video|iframe)\b/i.test(n.bodyZh+n.bodyEn))throw Error('請填寫文章內容。');
 if(n.cover&&!mediaUrl(n.cover))throw Error('封面請使用 HTTPS 網址或 ./assets/ 內的相對路徑。');
 if(n.sourceUrl&&!safeLink(n.sourceUrl))throw Error('新聞原文請使用 HTTPS 網址。');
 if(publishing&&n.format==='news'&&(!n.sourceTitle||!n.sourceName||!n.sourceUrl))throw Error('新聞評論請填寫新聞標題、來源媒體及原文網址。');
 if(publishing&&n.publishedAt&&isNaN(Date.parse(n.publishedAt)))throw Error('發布日期不正確。');
 if(n.titleZh.length>200||n.titleEn.length>200||n.summaryZh.length>1000||n.summaryEn.length>1000||n.author.length>100||n.tags.some(t=>t.length>50))throw Error('標題、摘要、作者或標籤太長。');
 if(new TextEncoder().encode(JSON.stringify(n)).length>700000)throw Error('單篇文章內容過大，請將圖片及影片上傳為媒體，不要貼入檔案資料。');
 return n;
}
function fileInfo(file){
 const ext=String(file.name||'').split('.').pop().toLowerCase();
 const kind=IMAGE_EXT.includes(ext)||file.type?.startsWith('image/')?'image':VIDEO_EXT.includes(ext)||file.type?.startsWith('video/')?'video':'';
 if(!kind)throw Error('請選擇圖片或影片檔案。');
 const max=kind==='image'?25*1024*1024:500*1024*1024;
 if(!file.size||file.size>max)throw Error(kind==='image'?'圖片上限為 25 MB。':'影片上限為 500 MB。');
 return {kind,ext:ext.replace(/[^a-z0-9]/g,'').slice(0,10)||'bin',mime:MIMES[ext]||file.type||(kind==='image'?'image/octet-stream':'video/octet-stream')};
}
function mediaHTML(m){const url=mediaUrl(m.url),name=E(m.name||''),caption=E(m.caption||''),alt=E(m.alt||m.caption||m.name||'');if(!url)return '';
 return '<figure style="width:100%">'+(m.kind==='video'?'<video controls playsinline preload="metadata" src="'+E(url)+'">'+name+'</video>':'<img src="'+E(url)+'" alt="'+alt+'">')+'<figcaption>'+caption+'</figcaption><a href="'+E(url)+'" target="_blank" rel="noopener noreferrer">開啟原始檔案↗</a></figure><p><br></p>';
}
function sourceHTML(n,lang){if(n.format!=='news'||!safeLink(n.sourceUrl))return '';return '<aside class="note-source"><span>'+(lang==='en'?'NEWS SOURCE':'新聞來源')+'</span><h2>'+E(n.sourceTitle)+'</h2><p>'+E(n.sourceName)+(n.sourceDate?' · '+E(n.sourceDate):'')+'</p><a href="'+E(n.sourceUrl)+'" target="_blank" rel="noopener noreferrer">'+(lang==='en'?'Read original↗':'閱讀原文↗')+'</a></aside>';}
function shareUrl(n,settings={},lang='zh'){const base=safeLink(settings.notesShareBase);if(base)return base.replace(/\/$/,'')+'/'+encodeURIComponent(n.id)+(lang==='en'?'?lang=en':'');return new URL('./index.html#/notes/'+encodeURIComponent(n.id),location.href).href;}
window.TanjiNotes={FORMATS,text,sorted,sanitize,validate,fileInfo,accept,youtube,mediaHTML,sourceHTML,shareUrl};
})();