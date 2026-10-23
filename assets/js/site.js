/* Public website controller. Content and rendering live in separate files. */
(() => {
  'use strict';
  const root = document.getElementById('tanji-approved-preview');
  const app = root.querySelector('.preview-app');
  const C = window.TanjiCore;
  const bundledContent = C.toPublic(window.TANJI_SEED);
  let content = bundledContent;
  const state = {page:'home',lang:'zh',category:'all',projectsPage:1,awardsPage:1};
  const routes = new Set(['home','about','topics','projects','contact']);
  let sending = false;
  try { state.lang = localStorage.getItem('tanji-lang') === 'en' ? 'en' : 'zh'; } catch {}
  function route() {
    const name = (location.hash || '#/home').slice(2).split('/')[0];
    state.page = routes.has(name) ? name : 'missing';
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
    let view;
    try { view = window.TanjiUI.renderPublic(content,state); }
    catch (error) {
      console.error('TanJi published content rendering failed; restoring bundled projects:',error);
      content = bundledContent;
      view = window.TanjiUI.renderPublic(content,state);
    }
    app.innerHTML = view.html;
    root.lang = document.documentElement.lang = state.lang === 'zh' ? 'zh-Hant' : 'en';
    document.title = view.title;
    document.querySelector('meta[name="description"]').content = view.description;
    root.querySelector('.ta-track')?.addEventListener('scroll',syncCarousel,{passive:true});
    requestAnimationFrame(syncCarousel);
  }
  root.addEventListener('click',event => {
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
  // Render bundled content immediately. Published Firebase content wins when available.
  if (location.protocol !== 'file:') window.TanjiCloud.loadPublic().then(remote=>{
    if (!remote) return;
    // Keep the last known-good projects if an incomplete publish hides them.
    // Never silently substitute an empty or unrelated cloud portfolio.
    let candidate;
    try { candidate = C.toPublic(remote.content); }
    catch (error) { console.warn('TanJi rejected invalid published content:',error); return; }
    // A newly published project must not be rejected merely because it has no award yet.
    // Preserve existing bundled entries when a partial cloud publish omits them.
    if (!Array.isArray(candidate.projects) || !Array.isArray(candidate.awards)) {
      console.warn('TanJi rejected incomplete published portfolio.');
      return;
    }
    const cloudProjectIds = new Set(candidate.projects.map(p=>p.id));
    const cloudAwardIds = new Set(candidate.awards.map(a=>a.id));
    for (const p of bundledContent.projects) if (!cloudProjectIds.has(p.id)) candidate.projects.push(p);
    for (const a of bundledContent.awards) if (!cloudAwardIds.has(a.id)) candidate.awards.push(a);
    content = candidate;
    // Do not replace a form while a visitor is typing or sending it.
    if (state.page !== 'contact' && !sending) render();
  }).catch(error=>console.info('TanJi uses bundled content:',error?.code||'offline'));
})();
