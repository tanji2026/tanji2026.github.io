/* Public website controller. Content and rendering live in separate files. */
(() => {
  'use strict';
  const root = document.getElementById('tanji-approved-preview');
  const app = root.querySelector('.preview-app');
  const C = window.TanjiCore;
  let content = C.toPublic(window.TANJI_SEED);
  const state = {page:'home',lang:'zh',category:'all',projectsPage:1,awardsPage:1,notes:[],noteCategories:[],notesPage:1,noteCategory:'all',noteSearch:'',noteTag:'',notesLoading:true};
  const routes = new Set(['home','about','topics','projects','notes','contact']);
  let sending = false;
  try { state.lang = localStorage.getItem('tanji-lang') === 'en' ? 'en' : 'zh'; } catch {}
  function route() {
    const parts=(location.hash || '#/home').slice(2).split('/'),name=parts[0];
    state.page = name==='notes'&&parts[1]?'note':routes.has(name)?name:'missing';
    try{state.noteId=decodeURIComponent(parts[1]||'');}catch{state.noteId='';}
  }
  function syncCarousel() {
    const track = root.querySelector('.ta-track');
    if (!track) return;
    const left = root.querySelector('[data-slide="-1"]');
    const right = root.querySelector('[data-slide="1"]');
    left.disabled = track.scrollLeft <= 2;
    right.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
  }
  function render() {
    const view = window.TanjiUI.renderPublic(content,state);
    app.innerHTML = view.html;
    root.lang = document.documentElement.lang = state.lang === 'zh' ? 'zh-Hant' : 'en';
    document.title = view.title;
    document.querySelector('meta[name="description"]').content = view.description;
    for(const [key,value]of [['og:title',view.title],['og:description',view.description],['og:image',view.image||'']]){let meta=document.querySelector('meta[property="'+key+'"]');if(!meta){meta=document.createElement('meta');meta.setAttribute('property',key);document.head.append(meta);}meta.content=value;}
    root.querySelectorAll('.note-body img,.note-cover').forEach(img=>img.addEventListener('error',()=>{img.hidden=true;if(!img.parentElement.querySelector('.image-format-hint')){const hint=document.createElement('p');hint.className='image-format-hint';hint.textContent=state.lang==='zh'?'此圖片格式無法在這個瀏覽器顯示。':'This image format cannot be displayed in this browser.';const a=document.createElement('a');a.href=img.src;a.target='_blank';a.rel='noopener noreferrer';a.textContent=state.lang==='zh'?'開啟原始檔案↗':'Open original file↗';hint.append(' ',a);img.after(hint);}}));
    root.querySelectorAll('.note-body video').forEach(video=>video.addEventListener('error',()=>{let hint=video.parentElement.querySelector('.media-error');if(!hint){hint=document.createElement('p');hint.className='media-error';hint.textContent=state.lang==='zh'?'此瀏覽器無法播放這個影片格式，請使用原始檔案連結。':'This browser cannot play this format. Please use the original-file link.';video.after(hint);}}));
    root.querySelector('.ta-track')?.addEventListener('scroll',syncCarousel,{passive:true});
    requestAnimationFrame(syncCarousel);
  }
  root.addEventListener('click',async event => {
    const filter=event.target.closest('[data-note-category]');if(filter){state.noteCategory=filter.dataset.noteCategory;state.notesPage=1;render();return;}
    const notesPage=event.target.closest('[data-notes-page]');if(notesPage){state.notesPage=Number(notesPage.dataset.notesPage);render();root.querySelector('#notes-results')?.scrollIntoView({block:'start'});return;}
    const tag=event.target.closest('[data-note-tag]');if(tag){state.noteTag=tag.dataset.noteTag;state.noteCategory='all';state.noteSearch='';state.notesPage=1;location.hash='#/notes';return;}
    if(event.target.closest('[data-clear-note-tag]')){state.noteTag='';render();return;}
    const share=event.target.closest('[data-share-note],[data-copy-note]');if(share){const note=state.notes.find(n=>n.id===(share.dataset.shareNote||share.dataset.copyNote));if(!note)return;const url=window.TanjiNotes.shareUrl(note,content.settings,state.lang),status=root.querySelector('.note-share-status');try{if(share.hasAttribute('data-share-note')&&navigator.share)await navigator.share({title:window.TanjiNotes.text(note,'title',state.lang),url});else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);status.textContent=state.lang==='zh'?'連結已複製':'Link copied';}else{status.textContent=url;}}catch(e){if(e.name!=='AbortError')status.textContent=url;}return;}
    if (event.target.closest('#language')) {
      state.lang = state.lang === 'zh' ? 'en' : 'zh';
      try { localStorage.setItem('tanji-lang',state.lang); } catch {}
      render(); return;
    }
    const menu = event.target.closest('#mobile-toggle');
    if (menu) {
      const nav = root.querySelector('#mobile-nav');
      nav.hidden = !nav.hidden;
      menu.setAttribute('aria-expanded',String(!nav.hidden)); return;
    }
    const category = event.target.closest('[data-category]');
    if (category) { state.category = category.dataset.category; state.projectsPage = 1; render(); return; }
    const page = event.target.closest('[data-page-key]');
    if (page && !page.disabled) {
      state.projectsPage = Number(page.dataset.pageNumber);
      render(); root.querySelector('#project-results')?.scrollIntoView({block:'start'}); return;
    }
    const slide = event.target.closest('[data-slide]');
    if (slide && !slide.disabled) {
      const track = root.querySelector('.ta-track');
      const items = track.querySelectorAll('.ta-entry');
      const distance = items.length > 1 ? items[1].offsetLeft-items[0].offsetLeft : track.clientWidth;
      track.scrollBy({left:Number(slide.dataset.slide)*distance,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    }
  });
  root.addEventListener('submit',async event => {
    if(event.target.matches('.notes-search')){event.preventDefault();state.noteSearch=String(new FormData(event.target).get('q')||'');state.notesPage=1;render();return;}
    if (!event.target.matches('.contact-form')) return;
    event.preventDefault();
    const form = event.target;
    if (sending || !form.reportValidity()) return;
    const result = form.querySelector('.contact-form-result');
    const button = form.querySelector('[type="submit"]');
    const values = new FormData(form);
    const inquiry = Object.fromEntries(['name','email','organization','subject','message'].map(key=>[key,String(values.get(key)||'').trim()]));
    inquiry.language = state.lang;
    sending = true; button.disabled = true;
    result.setAttribute('role','status');
    result.textContent = state.lang==='zh'?'正在送出…':'Sending…';
    try {
      await window.TanjiCloud.sendInquiry(inquiry);
      form.reset();
      result.textContent = state.lang==='zh'?'已收到你的訊息，謝謝你的來信。':'We have received your message. Thank you.';
    } catch (error) {
      result.setAttribute('role','alert');
      result.textContent = state.lang==='zh'?'訊息未送出，填寫內容已保留。請稍後重試，或直接來信 '+content.settings.email+'。':'Your message was not sent. Your input has been kept; please retry or email '+content.settings.email+'.';
      console.warn('TanJi contact delivery failed:',error?.code||'unknown');
    } finally { sending = false; button.disabled = false; }
  });
  root.addEventListener('keydown',event => {
    if (event.key !== 'Escape') return;
    const nav = root.querySelector('#mobile-nav');
    if (nav) nav.hidden = true;
    root.querySelector('#mobile-toggle')?.setAttribute('aria-expanded','false');
  });
  window.addEventListener('hashchange',()=>{route();state.projectsPage=1;render();window.scrollTo({top:0,behavior:'instant'});});
  window.addEventListener('resize',syncCarousel);
  route(); render();
  if(location.protocol!=='file:'&&window.TanjiCloud.loadNotes)window.TanjiCloud.loadNotes().then(data=>{state.notes=data.notes;state.noteCategories=data.categories;state.notesLoading=false;if(state.page!=='contact'&&!sending)render();}).catch(error=>{state.notesLoading=false;if(state.page==='note')render();console.info('TanJi notes unavailable:',error?.code||'offline');});
  // Render bundled content immediately. Published Firebase content wins when available.
  if (location.protocol !== 'file:') window.TanjiCloud.loadPublic().then(remote=>{
    if (!remote) return;
    content = C.toPublic(remote.content);
    // Do not replace a form while a visitor is typing or sending it.
    if (state.page !== 'contact' && !sending) render();
  }).catch(error=>console.info('TanJi uses bundled content:',error?.code||'offline'));
})();
