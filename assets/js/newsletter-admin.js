/* Read-only automatic weekly preview. Publishing and mailing remain separate. */
(function(){
 'use strict';
 const E=window.TanjiCore.esc;
 const S={status:'idle',data:null,busy:false,message:'',error:false,generation:0};
 let bridge;
 const time=ms=>new Date(ms).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
 const api=(action,input={})=>window.TanjiCloud.newsletter(action,input);
 async function refresh(id){
  const generation=++S.generation;S.status='loading';bridge?.render();
  try{const data=await api('automaticState',id?{issueId:id}:{});if(generation!==S.generation)return;S.data=data;S.status='ready';}
  catch(e){if(generation!==S.generation)return;S.status='error';S.message=e.message;S.error=true;}
  if(generation===S.generation)bridge?.render();
 }
 function panel(b){
  bridge=b;
  if(S.status==='idle'){S.status='loading';Promise.resolve().then(()=>refresh());}
  let html='<div id="newsletter-admin"><div class="admin-panel-head"><div><h2>本週電子報</h2><p>文章自動排版，你確認後才寄送。</p></div><button type="button" class="small-btn" data-week="refresh" '+(S.busy?'disabled':'')+'>重新讀取</button></div>';
  if(S.message)html+='<p class="admin-message '+(S.error?'error':'')+'" role="'+(S.error?'alert':'status')+'">'+E(S.message)+'</p>';
  if(S.status!=='ready')return html+'<p role="status">'+(S.status==='error'?'暫時無法讀取，請按重新讀取。':'正在自動整理本週文章…')+'</p></div>';
  const d=S.data,issue=d.issue,p=d.period;
  const labels={draft:'尚未確認，不會寄送',approved:'已確認，等待寄送',sending:'正在寄送',partial:'系統正在補寄',needs_review:'有寄送結果需要核對',sent:'本期已寄出',skipped:'本期跳過',blocked:'寄送暫停',cancelled:'本期已取消'};
  html+='<p style="margin-bottom:12px">收錄期間：'+E(time(p.startAtMs))+' 至 '+E(time(p.endAtMs))+' 前（臺北時間）<br>寄送時間：'+E(time(p.scheduledAtMs))+'<br><strong>'+E(labels[issue.status]||issue.status)+'</strong> · '+issue.items.length+' 篇文章</p>';
  if(d.changed)html+='<p class="admin-message" role="status">文章有變更，請看過更新後的預覽，再確認一次。</p>';
  if(issue.items.length){
   html+='<iframe id="week-preview" title="本週電子報完整預覽" sandbox="" style="display:block;width:100%;height:65vh;border:1px solid #4a4060;border-radius:12px;background:#0d0b12" srcdoc="'+E(d.html)+'"></iframe>';
   html+='<div class="button-row"><button type="button" class="btn" data-week="test" '+(S.busy?'disabled':'')+'>寄測試信給我</button><button type="button" class="btn primary" data-week="approve" '+(S.busy||!d.canApprove?'disabled':'')+'>'+(p.scheduledAtMs<=Date.now()?'確認補寄本週電子報':'確認本週寄送')+'</button>';
   if(issue.status==='approved'&&!issue.firstSentAtMs)html+='<button type="button" class="small-btn" data-week="cancel" '+(S.busy?'disabled':'')+'>取消本週寄送</button>';
   html+='</div><p class="admin-help">不用另外編輯電子報。內容來自該週已發布文章；不想收錄的文章可先下架。到時間但未確認，也不會寄出。</p>';
  }else html+='<p class="empty">這一週沒有可寄送的公開文章，不會寄出空信。</p>';
  if(issue.counts)html+='<p role="status">已接受 '+issue.counts.sent+' · 待寄 '+issue.counts.pending+' · 失敗 '+issue.counts.failed+' · 待核對 '+issue.counts.unknown+'</p>';
  if(['needs_review','blocked'].includes(issue.status))html+='<p class="admin-message" role="alert">'+E(issue.error||'有郵件寄送結果待核對，系統已暫停自動重寄，避免重複寄送。')+'</p>';
  return html+'</div>';
 }
 document.addEventListener('click',async e=>{
  const action=e.target.closest('[data-week]')?.dataset.week;
  if(!action||S.busy)return;
  if(action==='refresh'){S.message='';S.error=false;refresh();return;}
  const generation=S.generation,data=S.data,input={issueId:data.issue.id,revision:data.issue.revision,previewHash:data.previewHash};
  S.busy=true;S.message='';S.error=false;bridge?.render();
  try{
   const result=await api({test:'testAutomatic',approve:'approveAutomatic',cancel:'revokeIssue'}[action],input);
   if(generation!==S.generation)return;
   const updated=await api('automaticState',{issueId:input.issueId});
   if(generation!==S.generation)return;
   S.data=updated;S.message=result.message;
  }catch(error){if(generation===S.generation){S.message=error.message;S.error=true;}}
  finally{if(generation===S.generation){S.busy=false;bridge?.render();}}
 });
 window.TanjiNewsletterAdmin={panel,reset(){S.generation++;S.status='idle';S.data=null;S.busy=false;S.message='';S.error=false;}};
})();
