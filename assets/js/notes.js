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
