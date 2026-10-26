/* Visual notes editor and media library; does not alter legacy site content. */
(function(){'use strict';
const C=window.TanjiCore,N=window.TanjiNotes,cloud=window.TanjiCloud,E=C.esc;
const loadState=()=>({status:'idle',error:'',generation:0});
const S={notes:[],categories:[],media:[],loads:{notes:loadState(),media:loadState()},tab:'notes',query:''};
let api=null,editing=null,dirty=false,busy=false,activeLang='zh',savedRange=null,pickerTarget='body',notice='',localTimer;
const field=(key,label,value='',type='text',extra='')=>`<label class="field"><span>${E(label)}</span><input name="${key}" type="${type}" value="${E(value)}" ${extra}></label>`;
const resourceFor=tab=>tab==='media'?'media':'notes';
function withTimeout(task){let timer;const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('讀取超過 12 秒，請檢查網路後按「重新讀取」。')),12000);});return Promise.race([task,deadline]).finally(()=>clearTimeout(timer));}
function invalidate(kind){const r=S.loads[kind];r.generation++;r.status='idle';r.error='';}
function ensureLoaded(kind){
 const r=S.loads[kind];if(r.status!=='idle')return;
 const generation=++r.generation;r.status='loading';r.error='';
 const task=Promise.resolve().then(()=>kind==='media'?cloud.listMedia():cloud.loadNotesAdmin());
 withTimeout(task).then(data=>{
  if(r.generation!==generation)return;
  if(kind==='media'){if(!Array.isArray(data))throw Error('媒體資料格式不正確，請重新讀取。');S.media=data;}
  else{if(!Array.isArray(data?.notes)||!Array.isArray(data?.categories))throw Error('筆記資料格式不正確，請重新讀取。');S.notes=data.notes;S.categories=data.categories;}
  r.status='ready';
 }).catch(error=>{
  if(r.generation!==generation)return;
  r.status='error';r.error=cloud.errorMessage(error);
 }).finally(()=>{
  if(r.generation!==generation)return;
  const picker=document.getElementById('media-picker');if(kind==='media'&&picker?.open)renderMediaPicker(picker);
  api?.render();
 });
}
function panel(tab,bridge){api=bridge;S.tab=tab;const kind=resourceFor(tab),resource=S.loads[kind];ensureLoaded(kind);
 let html=`<div id="notes-admin"><div class="admin-panel-head"><div><h2>${{notes:'碳吉筆記',noteCategories:'筆記分類',media:'媒體管理'}[tab]}</h2><p>筆記獨立儲存，不需按頁首的「發布網站內容」。</p></div><button class="small-btn" data-n-action="reload" ${resource.status==='loading'?'disabled':''}>${resource.status==='loading'?'讀取中…':'重新讀取'}</button></div>${notice?`<p class="admin-message" role="status">${E(notice)}</p>`:''}`;
 if(resource.status==='loading')return html+`<p role="status">${kind==='media'?'正在讀取媒體…':'正在讀取筆記與分類…'}</p></div>`;
 if(resource.status==='error')return html+`<p class="admin-message error" role="alert">${E(resource.error)}</p><p class="admin-help">其他後台頁面仍可使用。請排除錯誤後按「重新讀取」，此頁不會持續自動重試。</p></div>`;
 if(tab==='notes'){
  html+=`<div class="notes-admin-tools"><button class="btn primary" data-n-action="new">新增筆記</button><button class="btn" data-n-action="backup">匯出筆記備份</button><label class="btn">匯入筆記備份<input type="file" id="notes-import" accept=".json,application/json" hidden></label><button class="btn" data-n-action="recover">還原本機未儲存筆記</button></div><label class="field"><span>搜尋文章</span><input id="admin-note-query" type="search" value="${E(S.query)}" placeholder="標題、分類或標籤"></label><div class="admin-list">`;
  const rows=N.sorted(S.notes).filter(n=>[n.titleZh,n.titleEn,...n.tags||[]].join(' ').toLowerCase().includes(S.query.toLowerCase()));
  html+=rows.map(n=>`<article class="admin-record"><div><h3><span class="record-badge ${n.live?'published':'draft'}">${n.live?'已公開':'草稿'}</span>${E(N.text(n,'title')||'未命名筆記')}</h3><p>${E(n.author||'Coco')} · ${E(n.publishedAt?new Date(n.publishedAt).toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei'}):'尚未發布')}</p></div><div class="record-actions"><button class="small-btn" data-n-edit="${E(n.id)}">編輯</button>${n.live?`<a class="small-btn" href="./index.html#/notes/${E(n.id)}" target="_blank" rel="noopener">查看文章↗</a><button class="small-btn archive" data-n-unpublish="${E(n.id)}">下架</button>`:''}</div></article>`).join('')||'<p class="empty">還沒有筆記，按「新增筆記」開始。</p>';
  html+='</div><p class="admin-help">已公開文章可繼續存草稿；只有「發布文章」才會更新讀者看到的版本。分享封面預覽需完成 UPDATE-NOTES.md 的分享服務設定。</p>';
 }else if(tab==='noteCategories'){
  html+=`<div class="notes-admin-tools"><button class="btn primary" data-n-action="new-category">新增分類</button></div><div class="admin-list">${C.sorted(S.categories).map(c=>`<article class="admin-record"><div><h3>${E(c.titleZh)}</h3><p>${E(c.titleEn)} · 排序 ${Number(c.order)||0}${c.archived?' · 已停用':''}</p></div><button class="small-btn" data-n-category="${E(c.id)}">編輯</button></article>`).join('')||'<p class="empty">尚無分類。你可以自行建立，例如日常隨想、議題觀察或參賽紀錄。</p>'}</div>`;
 }else{
  html+=`<p class="admin-help">接受常見圖片與影片原檔，圖片上限 25 MB，影片上限 500 MB。格式能否直接顯示取決於瀏覽器；原檔連結仍可保留。媒體網址可供文章讀者開啟，請勿上傳私人檔案。</p><label class="btn primary">上傳圖片／影片<input id="library-upload" type="file" accept="${E(N.accept)}" multiple hidden></label><p id="library-progress" role="status"></p><div class="media-library">${mediaCards(false)}</div><p class="admin-help">顯示最近 100 個檔案；文章引用的舊檔案不會被移除。</p>`;
 }
 return html+'</div>';
}
function mediaCards(picking){return S.media.map(m=>`<article class="media-item">${m.kind==='image'?`<img src="${E(m.url)}" alt="" loading="lazy">`:'<div class="video-file">影片</div>'}<h3>${E(m.name)}</h3><p>${m.kind==='video'?'影片':'圖片'} · ${(m.size/1024/1024).toFixed(1)} MB</p>${picking?`<button type="button" class="small-btn" data-pick-media="${E(m.id)}">插入</button>`:`<button class="small-btn" data-copy-media="${E(m.id)}">複製網址</button><a class="small-btn" href="${E(m.url)}" target="_blank" rel="noopener">開啟原檔↗</a>`}</article>`).join('')||'<p>還沒有媒體檔案。</p>';}
function dialog(id){let d=document.getElementById(id);if(!d){d=document.createElement('dialog');d.id=id;d.className='dialog';document.body.append(d);}return d;}
function localDate(iso){const d=iso?new Date(iso):new Date();if(isNaN(d))return '';return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function openNote(input){editing=input?C.clone(input):{id:'note-'+Date.now().toString(36),titleZh:'',titleEn:'',summaryZh:'',summaryEn:'',bodyZh:'<p><br></p>',bodyEn:'',author:'Coco',format:'note',categoryId:'',tags:[],cover:'',coverAlt:'',revision:0,publishedAt:'',createdAt:''};dirty=false;busy=false;activeLang='zh';savedRange=null;
 const n=editing,d=dialog('note-editor');
 d.innerHTML=`<form id="note-editor-form" method="dialog"><div class="dialog-head"><h2>${n.revision?'編輯筆記':'新增筆記'}</h2><button type="button" class="close-dialog" data-n-close aria-label="關閉筆記編輯">×</button></div><div class="dialog-body"><div class="form-grid">${field('titleZh','中文標題',n.titleZh,'text','maxlength="200"')}${field('titleEn','英文標題（選填）',n.titleEn,'text','maxlength="200"')}${field('author','作者',n.author||'Coco','text','maxlength="100"')}<label class="field"><span>文章格式</span><select name="format" id="note-format">${Object.entries(N.FORMATS).map(([v,l])=>`<option value="${v}" ${n.format===v?'selected':''}>${l[0]}</option>`).join('')}</select></label><label class="field"><span>文章分類</span><select name="categoryId"><option value="">未分類</option>${C.sorted(S.categories).filter(c=>!c.archived||c.id===n.categoryId).map(c=>`<option value="${E(c.id)}" ${n.categoryId===c.id?'selected':''}>${E(c.titleZh)}</option>`).join('')}</select></label>${field('tags','標籤，以逗號分隔',(n.tags||[]).join('，'))}${field('id','文章網址名稱',n.id,'text',n.revision?'readonly':'pattern="[a-zA-Z0-9_-]{1,80}" required')}${field('publishedAt','發布日期（留白則於首次發布時自動設定）',n.publishedAt?localDate(n.publishedAt):'','datetime-local')}<label class="field"><span>中文摘要</span><textarea name="summaryZh" maxlength="1000">${E(n.summaryZh||'')}</textarea></label><label class="field"><span>英文摘要（選填）</span><textarea name="summaryEn" maxlength="1000">${E(n.summaryEn||'')}</textarea></label>${field('cover','封面圖片網址',n.cover)}${field('coverAlt','封面圖片替代文字',n.coverAlt)}<div class="field wide"><div class="button-row"><button type="button" class="small-btn" data-n-cover-upload>上傳封面</button><button type="button" class="small-btn" data-open-media="cover">從媒體庫選封面</button></div><input id="cover-file" type="file" accept="image/*,.heic,.heif,.tif,.tiff,.avif,.jxl" hidden></div></div><fieldset class="note-news-fields" ${n.format==='news'?'':'hidden'}><legend>新聞來源</legend><div class="form-grid">${field('sourceTitle','新聞標題',n.sourceTitle)}${field('sourceName','來源媒體',n.sourceName)}${field('sourceDate','報導日期',n.sourceDate,'date')}${field('sourceUrl','原文網址',n.sourceUrl,'url')}</div><p class="admin-help">來源會自動呈現在文章前方，你的評論寫在下方內文。</p></fieldset><div class="note-editor-languages"><button type="button" class="small-btn" data-edit-language="zh" aria-pressed="true">中文內文</button><button type="button" class="small-btn" data-edit-language="en" aria-pressed="false">英文內文（選填）</button></div><div class="rich-toolbar" role="toolbar" aria-label="文章排版工具"><button type="button" data-rich="bold" title="粗體"><b>粗體</b></button><button type="button" data-rich="italic">斜體</button><button type="button" data-rich="underline">底線</button><button type="button" data-block="p">段落</button><button type="button" data-block="h2">標題</button><button type="button" data-block="h3">小標</button><button type="button" data-block="blockquote">引用</button><button type="button" data-rich="insertUnorderedList">項目清單</button><button type="button" data-rich="insertOrderedList">編號清單</button><button type="button" data-rich="justifyLeft">靠左</button><button type="button" data-rich="justifyCenter">置中</button><button type="button" data-rich="justifyRight">靠右</button><button type="button" data-rich="undo">復原</button><button type="button" data-rich="redo">重做</button><button type="button" data-insert-link>連結</button><button type="button" data-insert-table>插入表格</button><button type="button" data-table-action="row">增加列</button><button type="button" data-table-action="column">增加欄</button><button type="button" data-table-action="delete-row">刪除列</button><button type="button" data-table-action="delete-column">刪除欄</button><button type="button" data-table-action="delete">移除表格</button><button type="button" data-upload-inline>上傳圖片／影片</button><button type="button" data-open-media="body">媒體庫</button><button type="button" data-media-url>媒體網址</button><button type="button" data-youtube>YouTube</button><button type="button" data-media-size>圖片／影片大小</button></div><input id="inline-media-file" type="file" accept="${E(N.accept)}" multiple hidden><div id="note-body-zh" class="rich-editor note-body" contenteditable="true" role="textbox" aria-label="中文文章內文" aria-multiline="true">${N.sanitize(n.bodyZh)}</div><div id="note-body-en" class="rich-editor note-body" contenteditable="true" role="textbox" aria-label="英文文章內文" aria-multiline="true" hidden>${N.sanitize(n.bodyEn)}</div><p class="admin-help">表格工具會編輯游標所在的表格；圖片與影片的圖說可直接在下方輸入。英文留白時，英文頁會顯示原文。</p><p id="note-upload-progress" role="status"></p><p class="form-error" id="note-editor-error" role="alert"></p></div><div class="dialog-footer"><button class="btn" type="button" data-n-close>取消</button><button class="btn" type="button" data-note-preview>預覽</button><button class="btn" type="button" data-newsletter-preview>📧 電子報預覽</button><button class="btn" type="button" data-newsletter-preview>📧 電子報預覽</button><button class="btn" type="submit" value="draft">儲存文章草稿</button><button class="btn primary" type="submit" value="publish">發布文章</button></div></form>`;
 d.oncancel=e=>{if(busy){e.preventDefault();return;}if(dirty&&!confirm('有尚未儲存的筆記，確定關閉？'))e.preventDefault();};
 d.showModal();
}
function collect(){const form=document.getElementById('note-editor-form'),data=new FormData(form),n={...editing};for(const [k,v]of data)n[k]=String(v).trim();n.tags=String(data.get('tags')||'').split(/[,，\n]/).map(x=>x.trim()).filter(Boolean);n.publishedAt=n.publishedAt?new Date(n.publishedAt).toISOString():'';n.bodyZh=document.getElementById('note-body-zh').innerHTML;n.bodyEn=document.getElementById('note-body-en').innerHTML;return n;}
function setDirty(){dirty=true;clearTimeout(localTimer);localTimer=setTimeout(()=>{try{sessionStorage.setItem('tanji-note-local',JSON.stringify(collect()));}catch{}},400);}
function error(text){document.getElementById('note-editor-error').textContent=text;}
function restoreSelection(){const ed=document.getElementById('note-body-'+activeLang);ed.focus();const sel=window.getSelection();if(savedRange&&ed.contains(savedRange.commonAncestorContainer)){sel.removeAllRanges();sel.addRange(savedRange);}else{const r=document.createRange();r.selectNodeContents(ed);r.collapse(false);sel.removeAllRanges();sel.addRange(r);}}
function remember(){const sel=window.getSelection(),ed=document.getElementById('note-body-'+activeLang);if(sel?.rangeCount&&ed?.contains(sel.anchorNode))savedRange=sel.getRangeAt(0).cloneRange();}
function insert(html){restoreSelection();document.execCommand('insertHTML',false,N.sanitize(html));remember();setDirty();}
function selectedTable(){restoreSelection();const node=window.getSelection()?.anchorNode,el=node?.nodeType===1?node:node?.parentElement;return el?.closest('table');}
function tableAction(action){const table=selectedTable();if(!table){error('請先將游標放到要編輯的表格。');return;}const sel=window.getSelection(),el=sel.anchorNode.nodeType===1?sel.anchorNode:sel.anchorNode.parentElement,cell=el.closest('td,th'),row=cell?.parentElement;if(action==='delete')table.remove();if(action==='row'){const r=table.insertRow((row?.rowIndex??table.rows.length-1)+1);for(let i=0;i<(table.rows[0]?.cells.length||2);i++)r.insertCell().innerHTML='<br>';}
 if(action==='column')for(const r of table.rows)r.insertCell(Math.min((cell?.cellIndex??r.cells.length-1)+1,r.cells.length)).innerHTML='<br>';
 if(action==='delete-row'&&row){if(table.rows.length===1)table.remove();else row.remove();}
 if(action==='delete-column'&&cell){if(row.cells.length===1)table.remove();else{const index=cell.cellIndex;for(const r of table.rows)r.cells[index]?.remove();}}setDirty();}
async function upload(files,target){if(busy)return;const progress=document.getElementById(target==='library'?'library-progress':'note-upload-progress');busy=true;const buttons=document.querySelectorAll('#note-editor-form button');buttons.forEach(b=>b.disabled=true);const lang=activeLang;try{for(const file of files){if(target==='cover'&&N.fileInfo(file).kind!=='image')throw Error('封面請選擇圖片。');const m=await cloud.uploadMedia(file,p=>{if(progress)progress.textContent='正在上傳 '+file.name+' · '+p+'%';});S.media.unshift(m);if(target==='cover'){if(m.kind!=='image')throw Error('封面請選擇圖片。');document.querySelector('[name="cover"]').value=m.url;setDirty();}else if(target==='body'){activeLang=lang;insert(N.mediaHTML(m));}if(progress)progress.textContent='已上傳 '+file.name+'。若瀏覽器不支援此格式，可使用原始檔案連結。';}if(target==='library')api.render();}catch(e){if(progress)progress.textContent=cloud.errorMessage(e);}finally{busy=false;buttons.forEach(b=>b.disabled=false);}}
function renderMediaPicker(d){const r=S.loads.media;const content=r.status==='ready'?'<div class="media-library">'+mediaCards(true)+'</div>':r.status==='error'?'<p class="admin-message error" role="alert">'+E(r.error)+'</p><button class="small-btn" type="button" data-retry-picker>重新讀取媒體</button>':'<p role="status">正在讀取媒體…</p>';d.innerHTML='<div class="dialog-head"><h2>選擇媒體</h2><button class="close-dialog" type="button" data-close-media aria-label="關閉">×</button></div><div class="dialog-body">'+content+'</div>';}
function pickMedia(target){pickerTarget=target;const d=dialog('media-picker');ensureLoaded('media');renderMediaPicker(d);d.showModal();}
function openCategory(id){const c=S.categories.find(x=>x.id===id)||{id:'category-'+Date.now().toString(36),titleZh:'',titleEn:'',order:C.nextOrder(S.categories),archived:false};const d=dialog('note-category-dialog');d.innerHTML=`<form id="note-category-form" method="dialog"><div class="dialog-head"><h2>${id?'編輯':'新增'}分類</h2></div><div class="dialog-body"><input name="id" value="${E(c.id)}" type="hidden"><div class="form-grid">${field('titleZh','中文名稱',c.titleZh,'text','required maxlength="80"')}${field('titleEn','英文名稱（選填）',c.titleEn,'text','maxlength="80"')}${field('order','排序',c.order,'number')}<label class="check-field"><input type="checkbox" name="archived" ${c.archived?'checked':''}>停用分類（既有文章保留分類名稱）</label></div><p class="form-error" role="alert"></p></div><div class="dialog-footer"><button type="button" class="btn" data-close-category>取消</button><button class="btn primary" type="submit">儲存分類</button></div></form>`;d.showModal();}
function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function save(publishing){if(busy)return;try{const n=N.validate(collect(),publishing);busy=true;document.querySelectorAll('#note-editor-form button').forEach(b=>b.disabled=true);const saved=await cloud.saveNote(n,publishing);S.notes=S.notes.filter(x=>x.id!==saved.id);S.notes.unshift(saved);dirty=false;clearTimeout(localTimer);sessionStorage.removeItem('tanji-note-local');document.getElementById('note-editor').close();editing=null;notice=publishing?'文章已發布。':'文章草稿已儲存，公開版本保持不變。';api.render();}catch(e){error(cloud.errorMessage(e));}finally{busy=false;document.querySelectorAll('#note-editor-form button').forEach(b=>b.disabled=false);}}
document.addEventListener('paste',e=>{if(!e.target.closest?.('.rich-editor'))return;e.preventDefault();remember();const files=[...(e.clipboardData?.files||[])];if(files.length){upload(files,'body');return;}const html=e.clipboardData?.getData('text/html');insert(html||E(e.clipboardData?.getData('text/plain')||'').replace(/\n/g,'<br>'));});
document.addEventListener('drop',e=>{if(!e.target.closest?.('.rich-editor'))return;e.preventDefault();remember();const files=[...(e.dataTransfer?.files||[])];if(files.length)upload(files,'body');else insert(e.dataTransfer?.getData('text/html')||E(e.dataTransfer?.getData('text/plain')||''));});
document.addEventListener('selectionchange',remember);
document.addEventListener('pointerdown',e=>{if(e.target.closest('.rich-toolbar')){remember();e.preventDefault();}});
document.addEventListener('input',e=>{if(e.target.closest('#note-editor-form'))setDirty();if(e.target.id==='admin-note-query'){S.query=e.target.value;clearTimeout(localTimer);localTimer=setTimeout(()=>{api.render();const i=document.getElementById('admin-note-query');i.focus();i.setSelectionRange(i.value.length,i.value.length);},250);}});
document.addEventListener('change',async e=>{if(e.target.id==='note-format')document.querySelector('.note-news-fields').hidden=e.target.value!=='news';if(e.target.id==='inline-media-file')await upload([...e.target.files],'body');if(e.target.id==='cover-file')await upload([...e.target.files],'cover');if(e.target.id==='library-upload')await upload([...e.target.files],'library');if(e.target.id==='notes-import'){try{const file=e.target.files[0];if(file.size>20000000)throw Error('備份檔案過大。');const b=JSON.parse(await file.text());if(b.projectId!=='tanji-official-1219f'||!Array.isArray(b.notes))throw Error('不是本專案的筆記備份。');if(!confirm('匯入會加入備份中的筆記為草稿，不會取代同 ID 的現有文章，也不會自動發布。是否繼續？'))return;for(const n of b.notes)if(!S.notes.some(x=>x.id===n.id)){const saved=await cloud.saveNote({...n,revision:0,live:false},false);S.notes.push(saved);}for(const c of b.categories||[])if(!S.categories.some(x=>x.id===c.id)){await cloud.saveNoteCategory(c);S.categories.push(c);}notice='備份已加入；文章尚未發布。';api.render();}catch(error){notice=cloud.errorMessage(error);api.render();}}});
document.addEventListener('submit',e=>{if(e.target.getAttribute('id')==='note-editor-form'){e.preventDefault();save(e.submitter?.value==='publish');}if(e.target.getAttribute('id')==='note-category-form'){e.preventDefault();const data=Object.fromEntries(new FormData(e.target));data.archived=new FormData(e.target).has('archived');const button=e.target.querySelector('[type="submit"]');button.disabled=true;cloud.saveNoteCategory(data).then(()=>{S.categories=S.categories.filter(c=>c.id!==data.id);S.categories.push(data);document.getElementById('note-category-dialog').close();api.render();}).catch(err=>{e.target.querySelector('.form-error').textContent=cloud.errorMessage(err);}).finally(()=>button.disabled=false);}});
document.addEventListener('click',async e=>{
 const el=e.target.closest('button,a');if(!el)return;
 if(el.hasAttribute('data-n-close')){if(busy)return;if(dirty&&!confirm('有尚未儲存的筆記，確定關閉？'))return;document.getElementById('note-editor').close();editing=null;return;}
 if(el.hasAttribute('data-close-media')){document.getElementById('media-picker').close();return;}
 if(el.hasAttribute('data-retry-picker')){if(S.loads.media.status!=='loading'){invalidate('media');ensureLoaded('media');renderMediaPicker(document.getElementById('media-picker'));}return;}
 if(el.hasAttribute('data-close-category')){document.getElementById('note-category-dialog').close();return;}
 if(busy)return;
 if(el.dataset.nAction){switch(el.dataset.nAction){case 'reload':if(S.loads[resourceFor(S.tab)].status!=='loading'){invalidate(resourceFor(S.tab));api.render();}break;case 'new':openNote();break;case 'new-category':openCategory();break;case 'backup':download('tanji-notes-backup-'+new Date().toISOString().slice(0,10)+'.json',{projectId:'tanji-official-1219f',exportedAt:new Date().toISOString(),notes:S.notes,categories:S.categories,media:S.media});break;case 'recover':try{const raw=sessionStorage.getItem('tanji-note-local');if(!raw){notice='目前沒有本機未儲存的筆記。';api.render();}else{openNote(JSON.parse(raw));dirty=true;}}catch{notice='無法還原本機筆記。';api.render();}break;}return;}
 if(el.dataset.nEdit){openNote(S.notes.find(n=>n.id===el.dataset.nEdit));return;}
 if(el.dataset.nCategory){openCategory(el.dataset.nCategory);return;}
 if(el.dataset.nUnpublish){if(!confirm('確定下架這篇筆記？文章草稿與媒體會保留，讀者將無法再從官網閱讀。'))return;el.disabled=true;try{await cloud.unpublishNote(el.dataset.nUnpublish);invalidate('notes');notice='筆記已下架。';api.render();}catch(err){notice=cloud.errorMessage(err);el.disabled=false;api.render();}return;}
 if(el.dataset.copyMedia){const m=S.media.find(x=>x.id===el.dataset.copyMedia);try{await navigator.clipboard.writeText(m.url);el.textContent='已複製';}catch{notice=m.url;api.render();}return;}
 if(el.dataset.pickMedia){const m=S.media.find(x=>x.id===el.dataset.pickMedia);if(pickerTarget==='cover'){if(m.kind!=='image'){alert('封面請選擇圖片。');return;}document.querySelector('#note-editor-form [name="cover"]').value=m.url;setDirty();}else insert(N.mediaHTML(m));document.getElementById('media-picker').close();return;}
 if(!el.closest('#note-editor'))return;
 if(el.dataset.editLanguage){activeLang=el.dataset.editLanguage;savedRange=null;for(const lang of ['zh','en'])document.getElementById('note-body-'+lang).hidden=lang!==activeLang;document.querySelectorAll('[data-edit-language]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.editLanguage===activeLang)));return;}
 if(el.dataset.rich){restoreSelection();document.execCommand(el.dataset.rich,false);remember();setDirty();return;}
 if(el.dataset.block){restoreSelection();document.execCommand('formatBlock',false,el.dataset.block);remember();setDirty();return;}
 if(el.hasAttribute('data-insert-link')){const url=prompt('連結網址（完整 HTTPS）');if(!url)return;if(!C.safeUrl(url)){error('請使用完整 HTTPS 網址。');return;}restoreSelection();if(window.getSelection().isCollapsed)insert('<a href="'+E(url)+'">'+E(url)+'</a>');else{document.execCommand('createLink',false,url);setDirty();}return;}
 if(el.hasAttribute('data-insert-table')){const rows=Number(prompt('列數（包含標題列，2–20）','3'));if(!rows)return;const cols=Number(prompt('欄數（1–10）','3'));if(!Number.isInteger(rows)||rows<2||rows>20||!Number.isInteger(cols)||cols<1||cols>10){error('請輸入有效的表格列數與欄數。');return;}insert('<table><thead><tr>'+Array.from({length:cols},()=>'<th>標題</th>').join('')+'</tr></thead><tbody>'+Array.from({length:rows-1},()=>'<tr>'+Array.from({length:cols},()=>'<td><br></td>').join('')+'</tr>').join('')+'</tbody></table><p><br></p>');return;}
 if(el.dataset.tableAction){tableAction(el.dataset.tableAction);return;}
 if(el.hasAttribute('data-upload-inline')){document.getElementById('inline-media-file').click();return;}
 if(el.hasAttribute('data-n-cover-upload')){document.getElementById('cover-file').click();return;}
 if(el.dataset.openMedia){pickMedia(el.dataset.openMedia);return;}
 if(el.hasAttribute('data-media-url')){const url=prompt('圖片或影片的 HTTPS 網址');if(!url)return;if(!C.safeUrl(url)){error('請使用完整 HTTPS 網址。');return;}const video=confirm('這是影片嗎？按「確定」插入影片，按「取消」插入圖片。');insert(N.mediaHTML({url,kind:video?'video':'image',caption:'',name:''}));return;}
 if(el.hasAttribute('data-youtube')){const url=N.youtube(prompt('貼上 YouTube 影片網址'));if(!url){error('YouTube 網址不正確。');return;}insert('<figure><iframe src="'+E(url)+'" title="YouTube" allowfullscreen></iframe><figcaption></figcaption></figure><p><br></p>');return;}
 if(el.hasAttribute('data-media-size')){restoreSelection();const node=window.getSelection()?.anchorNode,element=node?.nodeType===1?node:node?.parentElement;const figure=element?.closest('figure');if(!figure){error('請先將游標放到圖片或影片的圖說中。');return;}const width=prompt('寬度百分比：25、50、75 或 100','100');if(!['25','50','75','100'].includes(width))return;figure.style.width=width+'%';setDirty();return;}
 
  if(el.hasAttribute('data-newsletter-preview')){
    const form = document.getElementById('note-editor-form');
    const data = form ? new FormData(form) : new Map();
    const titleZh = data.get('titleZh') || (editing && editing.titleZh) || '（尚未填寫中文標題）';
    const summaryZh = data.get('summaryZh') || (editing && editing.summaryZh) || '（尚未填寫前言摘要）';
    const noteId = (editing && editing.id) || 'preview-note';
    const noteUrl = 'https://tanji.tw/#/notes/' + encodeURIComponent(noteId);

    // 共用後台現成已調好 CSS 的 note-preview 彈窗容器
    const d = document.getElementById('note-preview');
    if (!d) {
      alert('找不到預覽彈窗容器');
      return;
    }

    d.innerHTML = `
      <div class="dialog-head">
        <h2>📧 電子報即時預覽（碳吉筆記）</h2>
        <button type="button" class="close-dialog" data-n-close aria-label="關閉預覽">×</button>
      </div>
      <div class="dialog-body" style="background:#0d0b12;padding:20px;max-height:70vh;overflow-y:auto;">
        <div style="background:#201b2d;border:1px solid #4a4468;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:0.9rem;color:#d8d2ea;">
          <div><strong style="color:#c6b6ff;">寄件者：</strong> TanJi 碳吉 &lt;tanji2026@gmail.com&gt;</div>
          <div style="margin-top:4px;"><strong style="color:#c6b6ff;">信件主旨：</strong> 【碳吉筆記】${E(titleZh)}</div>
        </div>

        <div style="max-width:580px;margin:0 auto;background:#181622;color:#f3f0fa;padding:32px 24px;border-radius:12px;border:1px solid rgba(198,182,255,0.2);font-family:-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.7;">
          <div style="font-size:12px;color:#c6b6ff;letter-spacing:1px;margin-bottom:8px;">TANJI NOTES · 碳吉筆記</div>
          <h1 style="color:#ffffff;font-size:22px;margin:0 0 16px 0;">${E(titleZh)}</h1>
          <p style="color:#d8d2ea;font-size:15px;margin-bottom:28px;">${E(summaryZh)}</p>
          <div style="margin:28px 0;text-align:center;">
            <a href="${noteUrl}" target="_blank" style="background:#c6b6ff;color:#181622;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">閱讀完整內容 ↗</a>
          </div>
          <hr style="border:none;border-top:1px solid #332d4a;margin:28px 0;" />
          <p style="font-size:12px;color:#9b94b3;margin:0;line-height:1.8;">
            您會收到這封信是因為您在碳吉官網（tanji.tw）訂閱了電子報。<br>
            若不想再收到電子報，可點此 <a href="#" style="color:#c6b6ff;text-decoration:underline;" onclick="return false;">取消訂閱</a>。<br>
            © TanJi 碳吉 · <a href="https://tanji.tw" style="color:#c6b6ff;text-decoration:none;">tanji.tw</a>
          </p>
        </div>

        <div id="newsletter-action-msg" style="margin-top:20px;text-align:center;font-size:0.9rem;min-height:1.4em;"></div>
      </div>
      <div class="dialog-footer" style="display:flex;justify-content:space-between;align-items:center;">
        <button class="btn" type="button" data-n-close>關閉</button>
        <div style="display:flex;gap:10px;">
          <button class="btn" type="button" id="btn-send-test-newsletter">✉️ 寄測試信給我</button>
          <button class="btn primary" type="button" id="btn-send-mass-newsletter">🚀 正式群發給所有訂閱者</button>
        </div>
      </div>
    `;

    // 關閉按鈕事件
    d.querySelectorAll('[data-n-close], .close-dialog').forEach(b => {
      b.onclick = () => d.close();
    });

    // 強制開窗
    if (typeof d.showModal === 'function' && !d.open) {
      d.showModal();
    }

    // 發送邏輯
    const actionMsg = d.querySelector('#newsletter-action-msg');
    const sendNewsletter = async (isTest) => {
      if (!isTest && !confirm('確定要將這篇筆記正式群發給所有訂閱者嗎？')) return;
      actionMsg.style.color = '#c6b6ff';
      actionMsg.textContent = isTest ? '正在寄送測試信至 tanji2026@gmail.com...' : '正在正式群發電子報...';
      try {
        const auth = window.firebase?.auth?.();
        const user = auth?.currentUser;
        if (!user) throw new Error('請先登入管理員帳號');
        const token = await user.getIdToken();

        const res = await fetch('https://asia-east1-tanji-official-1219f.cloudfunctions.net/sendNewsletter', {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
          body: JSON.stringify({noteId: noteId, isTest})
        });
        const data = await res.json();
        if (res.ok) {
          actionMsg.style.color = '#8affb2';
          actionMsg.textContent = data.message || '發送成功！';
        } else {
          actionMsg.style.color = '#ff8a8a';
          actionMsg.textContent = data.error || '發送失敗，請稍後重試。';
        }
      } catch (err) {
        actionMsg.style.color = '#ff8a8a';
        actionMsg.textContent = '操作失敗：' + (err.message || '連線異常');
      }
    };

    d.querySelector('#btn-send-test-newsletter')?.addEventListener('click', () => sendNewsletter(true));
    d.querySelector('#btn-send-mass-newsletter')?.addEventListener('click', () => sendNewsletter(false));
    return;
  }
  if(el.hasAttribute('data-newsletter-preview')){
    const form = document.getElementById('note-editor-form');
    const data = form ? new FormData(form) : new Map();
    const titleZh = data.get('titleZh') || (editing && editing.titleZh) || '（尚未填寫中文標題）';
    const summaryZh = data.get('summaryZh') || (editing && editing.summaryZh) || '（尚未填寫前言摘要）';
    const noteId = (editing && editing.id) || 'preview-note';
    const noteUrl = 'https://tanji.tw/#/notes/' + encodeURIComponent(noteId);

    const d = dialog('note-preview');
    d.innerHTML = '<div class="dialog-head">' +
      '<h2>📧 電子報即時預覽（碳吉筆記）</h2>' +
      '<button type="button" class="close-dialog" data-n-close aria-label="關閉預覽">×</button>' +
      '</div>' +
      '<div class="dialog-body" style="background:#0d0b12;padding:20px;max-height:70vh;overflow-y:auto;">' +
        '<div style="background:#201b2d;border:1px solid #4a4468;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:0.9rem;color:#d8d2ea;">' +
          '<div><strong style="color:#c6b6ff;">寄件者：</strong> TanJi 碳吉 &lt;tanji2026@gmail.com&gt;</div>' +
          '<div style="margin-top:4px;"><strong style="color:#c6b6ff;">信件主旨：</strong> 【碳吉筆記】' + E(titleZh) + '</div>' +
        '</div>' +
        '<div style="max-width:580px;margin:0 auto;background:#181622;color:#f3f0fa;padding:32px 24px;border-radius:12px;border:1px solid rgba(198,182,255,0.2);font-family:-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.7;">' +
          '<div style="font-size:12px;color:#c6b6ff;letter-spacing:1px;margin-bottom:8px;">TANJI NOTES · 碳吉筆記</div>' +
          '<h1 style="color:#ffffff;font-size:22px;margin:0 0 16px 0;">' + E(titleZh) + '</h1>' +
          '<p style="color:#d8d2ea;font-size:15px;margin-bottom:28px;">' + E(summaryZh) + '</p>' +
          '<div style="margin:28px 0;text-align:center;">' +
            '<a href="' + noteUrl + '" target="_blank" style="background:#c6b6ff;color:#181622;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">閱讀完整內容 ↗</a>' +
          '</div>' +
          '<hr style="border:none;border-top:1px solid #332d4a;margin:28px 0;" />' +
          '<p style="font-size:12px;color:#9b94b3;margin:0;line-height:1.8;">' +
            '您會收到這封信是因為您在碳吉官網（tanji.tw）訂閱了電子報。<br>' +
            '若不想再收到電子報，可點此取消訂閱。<br>' +
            '© TanJi 碳吉 · <a href="https://tanji.tw" style="color:#c6b6ff;text-decoration:none;">tanji.tw</a>' +
          '</p>' +
        '</div>' +
        '<div id="newsletter-action-msg" style="margin-top:20px;text-align:center;font-size:0.9rem;min-height:1.4em;"></div>' +
      '</div>' +
      '<div class="dialog-footer" style="display:flex;justify-content:space-between;align-items:center;">' +
        '<button class="btn" type="button" data-n-close>關閉</button>' +
        '<div style="display:flex;gap:10px;">' +
          '<button class="btn" type="button" id="btn-send-test-newsletter">✉️ 寄測試信給我</button>' +
          '<button class="btn primary" type="button" id="btn-send-mass-newsletter">🚀 正式群發給所有訂閱者</button>' +
        '</div>' +
      '</div>';

    d.querySelectorAll('[data-n-close], .close-dialog').forEach(function(b){
      b.onclick = function(){ d.close(); };
    });

    if (typeof d.showModal === 'function' && !d.open) {
      d.showModal();
    }

    const actionMsg = d.querySelector('#newsletter-action-msg');
    const sendNewsletter = async function(isTest){
      if (!isTest && !confirm('確定要將這篇筆記正式群發給所有訂閱者嗎？')) return;
      if (actionMsg) {
        actionMsg.style.color = '#c6b6ff';
        actionMsg.textContent = isTest ? '正在寄送測試信至 tanji2026@gmail.com...' : '正在正式群發電子報...';
      }
      try {
        const auth = window.firebase && window.firebase.auth ? window.firebase.auth() : null;
        const user = auth ? auth.currentUser : null;
        if (!user) throw new Error('請先登入管理員帳號');
        const token = await user.getIdToken();

        const res = await fetch('https://asia-east1-tanji-official-1219f.cloudfunctions.net/sendNewsletter', {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
          body: JSON.stringify({noteId: noteId, isTest: isTest})
        });
        const resData = await res.json();
        if (actionMsg) {
          if (res.ok) {
            actionMsg.style.color = '#8affb2';
            actionMsg.textContent = resData.message || '發送成功！';
          } else {
            actionMsg.style.color = '#ff8a8a';
            actionMsg.textContent = resData.error || '發送失敗，請稍後重試。';
          }
        }
      } catch (err) {
        if (actionMsg) {
          actionMsg.style.color = '#ff8a8a';
          actionMsg.textContent = '操作失敗：' + (err.message || '連線異常');
        }
      }
    };

    const testBtn = d.querySelector('#btn-send-test-newsletter');
    if (testBtn) testBtn.onclick = function(){ sendNewsletter(true); };
    const massBtn = d.querySelector('#btn-send-mass-newsletter');
    if (massBtn) massBtn.onclick = function(){ sendNewsletter(false); };
    return;
  }

  if(el.hasAttribute('data-newsletter-preview')){
  const form = document.getElementById('note-editor-form');
  const data = form ? new FormData(form) : new Map();
  const titleZh = data.get('titleZh') || (typeof editing !== 'undefined' && editing && editing.titleZh) || '（尚未填寫中文標題）';
  const summaryZh = data.get('summaryZh') || (typeof editing !== 'undefined' && editing && editing.summaryZh) || '（尚未填寫前言摘要）';
  const noteId = (typeof editing !== 'undefined' && editing && editing.id) || 'preview-note';
  const noteUrl = 'https://tanji.tw/#/notes/' + encodeURIComponent(noteId);

  const d = dialog('note-preview');
  d.innerHTML = `<div class="dialog-head">
    <h2>📧 電子報即時預覽（碳吉筆記）</h2>
    <button type="button" class="close-dialog" data-n-close aria-label="關閉預覽">×</button>
  </div>
  <div class="dialog-body" style="background:#0d0b12;padding:20px;max-height:70vh;overflow-y:auto;">
    <div style="background:#201b2d;border:1px solid #4a4468;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:0.9rem;color:#d8d2ea;">
      <div><strong style="color:#c6b6ff;">寄件者：</strong> TanJi 碳吉 &lt;tanji2026@gmail.com&gt;</div>
      <div style="margin-top:4px;"><strong style="color:#c6b6ff;">信件主旨：</strong> 【碳吉筆記】${E(titleZh)}</div>
    </div>
    <div style="max-width:580px;margin:0 auto;background:#181622;color:#f3f0fa;padding:32px 24px;border-radius:12px;border:1px solid rgba(198,182,255,0.2);font-family:-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.7;">
      <div style="font-size:12px;color:#c6b6ff;letter-spacing:1px;margin-bottom:8px;">TANJI NOTES · 碳吉筆記</div>
      <h1 style="color:#ffffff;font-size:22px;margin:0 0 16px 0;">${E(titleZh)}</h1>
      <p style="color:#d8d2ea;font-size:15px;margin-bottom:28px;">${E(summaryZh)}</p>
      <div style="margin:28px 0;text-align:center;">
        <a href="${noteUrl}" target="_blank" style="background:#c6b6ff;color:#181622;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">閱讀完整內容 ↗</a>
      </div>
      <hr style="border:none;border-top:1px solid #332d4a;margin:28px 0;" />
      <p style="font-size:12px;color:#9b94b3;margin:0;line-height:1.8;">
        您會收到這封信是因為您在碳吉官網（tanji.tw）訂閱了電子報。<br>
        若不想再收到電子報，可點此取消訂閱。<br>
        © TanJi 碳吉 · <a href="https://tanji.tw" style="color:#c6b6ff;text-decoration:none;">tanji.tw</a>
      </p>
    </div>
    <div id="newsletter-action-msg" style="margin-top:20px;text-align:center;font-size:0.9rem;min-height:1.4em;"></div>
  </div>
  <div class="dialog-footer" style="display:flex;justify-content:space-between;align-items:center;">
    <button class="btn" type="button" data-n-close>關閉</button>
    <div style="display:flex;gap:10px;">
      <button class="btn" type="button" id="btn-send-test-newsletter">✉️ 寄測試信給我</button>
      <button class="btn primary" type="button" id="btn-send-mass-newsletter">🚀 正式群發給所有訂閱者</button>
    </div>
  </div>`;

  d.querySelectorAll('[data-n-close], .close-dialog').forEach(b => { b.onclick = () => d.close(); });
  if (typeof d.showModal === 'function' && !d.open) d.showModal();

  const actionMsg = d.querySelector('#newsletter-action-msg');
  const sendNewsletter = async (isTest) => {
    if (!isTest && !confirm('確定要將這篇筆記正式群發給所有訂閱者嗎？')) return;
    if (actionMsg) {
      actionMsg.style.color = '#c6b6ff';
      actionMsg.textContent = isTest ? '正在寄送測試信至 tanji2026@gmail.com...' : '正在正式群發電子報...';
    }
    try {
      const auth = window.firebase && window.firebase.auth ? window.firebase.auth() : null;
      const user = auth ? auth.currentUser : null;
      if (!user) throw new Error('請先登入管理員帳號');
      const token = await user.getIdToken();
      const res = await fetch('https://asia-east1-tanji-official-1219f.cloudfunctions.net/sendNewsletter', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
        body: JSON.stringify({noteId: noteId, isTest: isTest})
      });
      const resData = await res.json();
      if (actionMsg) {
        if (res.ok) {
          actionMsg.style.color = '#8affb2';
          actionMsg.textContent = resData.message || '發送成功！';
        } else {
          actionMsg.style.color = '#ff8a8a';
          actionMsg.textContent = resData.error || '發送失敗，請稍後重試。';
        }
      }
    } catch (err) {
      if (actionMsg) {
        actionMsg.style.color = '#ff8a8a';
        actionMsg.textContent = '操作失敗：' + (err.message || '連線異常');
      }
    }
  };

  const testBtn = d.querySelector('#btn-send-test-newsletter');
  if (testBtn) testBtn.onclick = () => sendNewsletter(true);
  const massBtn = d.querySelector('#btn-send-mass-newsletter');
  if (massBtn) massBtn.onclick = () => sendNewsletter(false);
  return;
}

if(el.hasAttribute('data-note-preview')){const n=N.validate(collect(),false),d=dialog('note-preview');d.innerHTML='<div class="dialog-head"><h2>文章預覽</h2><button type="button" class="close-dialog" id="close-note-preview" aria-label="關閉預覽">×</button></div><article class="dialog-body"><h1>'+E(N.text(n,'title',activeLang)||'未命名筆記')+'</h1><p>'+E(n.author)+'</p>'+N.sourceHTML(n,activeLang)+'<div class="note-body">'+N.sanitize(N.text(n,'body',activeLang))+'</div></article>';d.querySelector('#close-note-preview').onclick=()=>d.close();d.showModal();return;}
});
window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
window.TanjiNotesAdmin={panel,reset(){invalidate('notes');invalidate('media');S.notes=[];S.categories=[];S.media=[];editing=null;dirty=false;for(const id of ['note-editor','media-picker','note-preview','note-category-dialog'])document.getElementById(id)?.close();}};
})();
