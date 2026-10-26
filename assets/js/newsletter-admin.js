/* Newsletter issues are independent from article drafts and site/public. */
(function () {
  'use strict';
  const E = window.TanjiCore.esc;
  const S = {status:'idle', data:null, form:null, dirty:false, busy:false, message:'', error:false, generation:0, previewedRevision:null};
  const labels = {draft:'尚未核准', approved:'已核准待寄', sending:'寄送中', partial:'等待續寄／補寄',
    needs_review:'需要核對寄送紀錄', sent:'已發行', skipped:'本期跳過', cancelled:'已取消', blocked:'文章已下架，寄送暫停'};
  let bridge;
  const copy = value => JSON.parse(JSON.stringify(value));
  const editable = () => S.form?.status === 'draft' && S.form.id === S.data?.next.id;
  const time = value => new Date(value).toLocaleString('zh-TW', {timeZone:'Asia/Taipei', hour12:false});
  const call = (action, input = {}) => window.TanjiCloud.newsletter(action, input);
  function changed() {
    S.dirty = true; S.previewedRevision = null;
    const status = document.getElementById('nl-save-status');
    if (status) status.textContent = '有未儲存的電子報變更';
    const approve = document.querySelector('[data-nl="approve"]');
    if (approve) approve.disabled = true;
  }
  function accept(data) {
    S.data = data; S.form = copy(data.issue); S.dirty = false; S.previewedRevision = null; S.status = 'ready';
  }
  async function load(id) {
    const generation = ++S.generation;
    S.status = 'loading'; bridge?.render();
    try {
      const result = await call('getState', id ? {issueId:id} : {});
      if (generation !== S.generation) return;
      accept(result);
    } catch (error) {
      if (generation !== S.generation) return;
      S.status = 'error'; S.message = error.message; S.error = true;
    }
    if (generation === S.generation) bridge?.render();
  }
  function button(action, label, primary = false, disabled = false) {
    return `<button type="button" class="${primary ? 'btn primary' : 'btn'}" data-nl="${action}" ${S.busy || disabled ? 'disabled' : ''}>${label}</button>`;
  }
  function panel(api) {
    bridge = api;
    if (S.status === 'idle') { S.status = 'loading'; Promise.resolve().then(() => load()); }
    let html = '<div id="newsletter-admin"><div class="admin-panel-head"><div><h2>電子報管理</h2><p>只收錄已發布文章；核准後於週一上午 8 點（臺北時間）寄送。</p></div>' + button('reload','重新讀取') + '</div>';
    if (S.message) html += `<p class="admin-message ${S.error ? 'error' : ''}" role="${S.error ? 'alert' : 'status'}">${E(S.message)}</p>`;
    if (S.status !== 'ready') return html + `<p role="status">${S.status === 'error' ? '請確認電子報後端已部署，再按重新讀取。' : '正在讀取電子報…'}</p></div>`;
    const f = S.form, canEdit = editable(), locked = canEdit && !S.busy ? '' : 'disabled';
    html += `<section class="admin-flow"><div class="nl-heading"><div><h3>${f.number ? (f.firstSentAtMs ? '第 ' : '預留第 ') + E(f.number) + ' 期' : '本期電子報'}</h3><p>${E(labels[f.status] || f.status)} · ${E(time(f.scheduledAtMs))}</p></div><span id="nl-save-status" role="status">${S.dirty ? '有未儲存的電子報變更' : '內容已同步'}</span></div>`;
    if (f.status === 'approved') html += '<p class="admin-help">核准內容已保存。原文章後續修改不影響本期；如需調整電子報，請先撤回核准。</p>';
    if (f.error) html += `<p role="alert">${E(f.error)}</p>`;
    if (canEdit) {
      html += '<h4>選擇收錄的公開文章</h4><p class="admin-help">先勾選文章，再按「彙整選擇文章」。只會加入尚未寄過、未被其他期別保留的文章，每期最多 30 篇。</p><div class="nl-candidates">';
      html += S.data.notes.map(n => {
        const unavailable = n.sent || !!n.reservedBy;
        return `<label class="nl-candidate"><input type="checkbox" data-nl-include="${E(n.noteId)}" ${n.included ? 'checked' : ''} ${unavailable || S.busy ? 'disabled' : ''}><span>${E(n.title)}${n.sent ? '（已寄過）' : n.reservedBy ? '（已核准收錄）' : ''}</span><a href="${E(n.url)}" target="_blank" rel="noopener">查看文章 ↗</a></label>`;
      }).join('') || '<p>尚無已發布文章。請先至「碳吉筆記」發布文章。</p>';
      html += '</div><div class="button-row">' + button('compose','彙整選擇文章') + '</div>';
    }
    html += `<form id="nl-issue-form"><div class="form-grid"><label class="field wide"><span>信件主旨</span><input name="subject" maxlength="160" value="${E(f.subject)}" ${locked}></label><label class="field wide"><span>本期前言</span><textarea name="intro" maxlength="4000" rows="4" ${locked}>${E(f.intro)}</textarea></label></div><div class="nl-items">`;
    html += f.items.map((item, i) => `<article class="nl-item"><div class="nl-heading"><h4>${i + 1}. <a href="${E(item.url)}" target="_blank" rel="noopener">查看已發布文章 ↗</a></h4>${canEdit ? `<div class="record-actions"><button type="button" class="small-btn" data-nl-move="${i}" data-step="-1" ${S.busy || i === 0 ? 'disabled' : ''} aria-label="向前移動">↑</button><button type="button" class="small-btn" data-nl-move="${i}" data-step="1" ${S.busy || i === f.items.length - 1 ? 'disabled' : ''} aria-label="向後移動">↓</button><button type="button" class="small-btn" data-nl-remove="${i}" ${S.busy ? 'disabled' : ''}>移出本期</button></div>` : ''}</div><label class="field"><span>電子報文章標題</span><input data-nl-item="${i}" data-key="title" maxlength="200" value="${E(item.title)}" ${locked}></label><label class="field"><span>電子報摘要</span><textarea data-nl-item="${i}" data-key="summary" maxlength="1000" rows="3" ${locked}>${E(item.summary)}</textarea></label></article>`).join('') || '<p class="empty">沒有可寄送的文章。本期不會寄出空信。</p>';
    html += '</div><div class="button-row nl-actions">';
    if (canEdit) html += button('save','儲存本期草稿',false,!f.items.length);
    if (canEdit && S.dirty) html += button('discard','放棄未儲存變更');
    html += button('preview','預覽整期',false,!f.items.length) + button('test','寄整期測試信給我',false,!f.items.length);
    if (canEdit) html += button('approve','核准並排定週一寄送',true,S.dirty || !f.revision || S.previewedRevision !== f.revision || !f.items.length);
    if (['approved','blocked','partial','needs_review'].includes(f.status) && !f.firstSentAtMs) html += button('revoke','撤回核准／取消本期');
    if (['partial','needs_review','blocked'].includes(f.status) && (f.audience || f.counts || f.firstSentAtMs)) html += button('retry','只補寄未成功的對象');
    html += '</div></form>';
    if (canEdit) html += '<p class="admin-help">請先儲存並預覽整期，才可核准。電子報中的標題與摘要調整不會修改原文章。</p>';
    if (f.counts) html += `<p role="status">已接受 ${f.counts.sent} · 已退訂跳過 ${f.counts.skipped} · 失敗 ${f.counts.failed} · 待核對 ${f.counts.unknown} · 待寄 ${f.counts.pending}</p>`;
    html += '</section>';
    const unknown = S.data.deliveries.filter(d => d.status === 'unknown');
    if (unknown.length) html += `<section class="admin-flow"><h3>核對寄送結果</h3><p>連線中斷時，郵件可能已寄出。請先核對 Gmail 寄件紀錄，再指定結果，避免重複寄信。</p>${unknown.map(d => `<form class="nl-resolve" data-delivery="${E(d.id)}"><p>${E(d.email)}</p><label class="field"><span>核對結果</span><select name="result" required><option value="">請選擇</option><option value="sent">已確認郵件服務接受寄送</option><option value="not_sent">已確認未寄出，可補寄</option></select></label><label class="field"><span>核對依據</span><input name="evidence" required minlength="5" maxlength="500" placeholder="請填寫寄件紀錄時間或核對結果"></label><button class="btn" type="submit" ${S.busy ? 'disabled' : ''}>保存核對結果</button></form>`).join('')}</section>`;
    html += '<section class="admin-flow"><div class="admin-panel-head"><h3>最近期別</h3>' + button('next','查看下一次排程') + '</div><div class="admin-list">';
    html += S.data.history.map(issue => `<article class="admin-record"><div><h4>${issue.number ? '第 ' + E(issue.number) + ' 期 · ' : ''}${E(issue.subject)}</h4><p>${E(labels[issue.status] || issue.status)} · ${E(time(issue.scheduledAtMs))}</p></div><button type="button" class="small-btn" data-nl-open="${E(issue.id)}" ${S.busy ? 'disabled' : ''}>查看本期</button></article>`).join('') || '<p>尚無已儲存期別。期號只隨正式發行累計，不按年度歸零。</p>';
    return html + '</div></section></div>';
  }
  async function run(task) {
    if (S.busy) return;
    const generation = S.generation;
    S.busy = true; S.message = ''; S.error = false; bridge?.render();
    try { await task(generation); }
    catch (error) { if (generation === S.generation) { S.message = error.message; S.error = true; } }
    finally { if (generation === S.generation) { S.busy = false; bridge?.render(); } }
  }
  async function save(generation) {
    const f = S.form;
    await call('saveIssue', {issueId:f.id, revision:f.revision, subject:f.subject, intro:f.intro, items:f.items});
    const result = await call('getState', {issueId:f.id});
    if (generation !== S.generation) return false;
    accept(result); return true;
  }
  async function prepare(generation) {
    if (S.dirty || !S.form.revision) return save(generation);
    return true;
  }
  function preview(mail) {
    let d = document.getElementById('nl-preview');
    if (!d) { d = document.createElement('dialog'); d.id = 'nl-preview'; d.className = 'dialog'; document.body.append(d); }
    d.innerHTML = `<div class="dialog-head"><h2>整期電子報預覽</h2><button type="button" class="close-dialog" aria-label="關閉預覽">×</button></div><p class="nl-preview-subject">${E(mail.subject)}</p><iframe class="nl-preview-frame" title="電子報內容" sandbox=""></iframe><div class="dialog-footer"><button type="button" class="btn">關閉預覽</button></div>`;
    d.querySelector('iframe').srcdoc = mail.html;
    d.querySelectorAll('button').forEach(b => { b.onclick = () => d.close(); });
    if (!d.open) d.showModal();
  }
  document.addEventListener('input', e => {
    if (!editable() || S.busy || !e.target.closest('#nl-issue-form')) return;
    if (e.target.dataset.nlItem !== undefined) S.form.items[Number(e.target.dataset.nlItem)][e.target.dataset.key] = e.target.value;
    else if (['subject','intro'].includes(e.target.name)) S.form[e.target.name] = e.target.value;
    changed();
  });
  document.addEventListener('change', e => {
    const id = e.target.dataset?.nlInclude;
    if (!id || !editable() || S.busy) return;
    const included = e.target.checked;
    run(async generation => {
      const result = await call('setSelection', {noteId:id, included});
      if (generation !== S.generation) return;
      S.data.notes.find(n => n.noteId === id).included = included;
      if (!included) { S.form.items = S.form.items.filter(n => n.noteId !== id); changed(); }
      S.message = result.message;
    });
  });
  document.addEventListener('click', e => {
    if (S.busy) return;
    const open = e.target.closest('[data-nl-open]');
    if (open) { if (S.dirty) { S.message = '請先儲存本期草稿，再查看其他期別。'; S.error = true; bridge?.render(); } else load(open.dataset.nlOpen); return; }
    const move = e.target.closest('[data-nl-move]'), remove = e.target.closest('[data-nl-remove]');
    if (editable() && (move || remove)) {
      if (remove) S.form.items.splice(Number(remove.dataset.nlRemove), 1);
      else { const i = Number(move.dataset.nlMove), j = i + Number(move.dataset.step); if (j >= 0 && j < S.form.items.length) [S.form.items[i],S.form.items[j]] = [S.form.items[j],S.form.items[i]]; }
      changed(); bridge?.render(); return;
    }
    const action = e.target.closest('[data-nl]')?.dataset.nl;
    if (!action) return;
    if (action === 'discard') { S.dirty = false; load(S.form.revision ? S.form.id : null); return; }
    if (action === 'reload' || action === 'next') {
      if (S.dirty) { S.message = '請先儲存本期草稿，再重新讀取或切換期別。'; S.error = true; bridge?.render(); }
      else load(action === 'reload' ? S.form?.revision ? S.form.id : null : null);
      return;
    }
    if (action === 'compose' && editable()) {
      const eligible = S.data.notes.filter(n => n.included && !n.sent && !n.reservedBy);
      S.form.items = eligible.slice(0, 30).map(n => copy(n)); changed();
      S.message = eligible.length > 30 ? '本期已彙整前 30 篇，其餘保留至下期。' : '已從已發布文章彙整，請編輯並儲存本期。';
      S.error = false; bridge?.render(); return;
    }
    run(async generation => {
      if (['save','preview','test'].includes(action) && !(await prepare(generation))) return;
      if (action === 'save') { S.message = '本期草稿已儲存，尚未核准寄送。'; return; }
      const input = {issueId:S.form.id, revision:S.form.revision};
      if (action === 'preview') {
        const mail = await call('previewIssue', input);
        if (generation !== S.generation) return;
        S.previewedRevision = mail.revision; preview(mail); return;
      }
      const actions = {test:'testIssue', approve:'approveIssue', revoke:'revokeIssue', retry:'retryIssue'};
      if (!actions[action]) return;
      if (action === 'approve' && (S.dirty || S.previewedRevision !== S.form.revision)) throw Error('請先預覽目前儲存的整期內容。');
      const result = await call(actions[action], input);
      if (generation !== S.generation) return;
      if (action !== 'test') {
        const updated = await call('getState', {issueId:input.issueId});
        if (generation !== S.generation) return;
        accept(updated);
      }
      S.message = result.message;
    });
  });
  document.addEventListener('submit', e => {
    if (e.target.id === 'nl-issue-form') { e.preventDefault(); return; }
    if (!e.target.matches('.nl-resolve')) return;
    e.preventDefault();
    const form = e.target, delivery = S.data.deliveries.find(d => d.id === form.dataset.delivery), values = new FormData(form);
    if (!form.reportValidity()) return;
    run(async generation => {
      const result = await call('resolveDelivery', {issueId:S.form.id, email:delivery.email, result:values.get('result'), evidence:values.get('evidence')});
      const updated = await call('getState', {issueId:S.form.id});
      if (generation !== S.generation) return;
      accept(updated); S.message = result.message;
    });
  });
  window.addEventListener('beforeunload', e => { if (S.dirty || S.busy) { e.preventDefault(); e.returnValue = ''; } });
  window.TanjiNewsletterAdmin = {panel, reset() {
    S.generation++; S.status = 'idle'; S.data = null; S.form = null; S.dirty = false; S.busy = false; S.message = ''; S.error = false; S.previewedRevision = null;
    document.getElementById('nl-preview')?.close();
  }};
})();
