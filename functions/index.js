'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {renderNote}=require('./render-note');
initializeApp();
exports.shareNote=onRequest({region:'asia-east1',maxInstances:3,minInstances:0,memory:'256MiB',timeoutSeconds:30},async(req,res)=>{
 if(!['GET','HEAD'].includes(req.method))return res.status(405).send('Method not allowed');
 const id=req.path.split('/').filter(Boolean).pop()||'';
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id))return res.status(404).send('Note not found');
 try{
  const snap=await getFirestore().doc('notes/'+id).get();
  if(!snap.exists||snap.data().status!=='published')return res.set('Cache-Control','no-store').status(404).send('這篇筆記尚未公開或已下架。');
  const project=String(process.env.GCLOUD_PROJECT||'tanji-official-1219f').replace(/[^a-z0-9-]/g,'');
  const base='https://asia-east1-'+project+'.cloudfunctions.net/shareNote/'+encodeURIComponent(id);
  const lang=req.query.lang==='en'?'en':'zh';
  res.set('Cache-Control','public,max-age=60,s-maxage=60');
  res.set('X-Content-Type-Options','nosniff');
  res.set('Content-Security-Policy',"default-src 'none'; img-src https:; media-src https:; style-src 'unsafe-inline'; frame-src https://www.youtube-nocookie.com; base-uri 'none'; form-action 'none'");
  return res.type('html').status(200).send(renderNote({...snap.data(),id},base,lang));
 }catch(error){console.error('shareNote failed',error.code||error.message);return res.set('Cache-Control','no-store').status(503).send('暫時無法讀取文章，請稍後重試。');}
});
