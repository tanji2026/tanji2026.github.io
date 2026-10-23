const {readFileSync:read} = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const rootPath = path.resolve(__dirname,'..');
async function checkSubmission(fails) {
  const events = {};
  let reset = false, writes = 0;
  const button = {disabled:false};
  const result = {textContent:'',setAttribute(){}};
  const form = {matches:()=>true,reportValidity:()=>true,reset(){reset=true;},querySelector:s=>s==='[type="submit"]'?button:result};
  const app = {innerHTML:''};
  const root = {querySelector:s=>s==='.preview-app'?app:null,lang:'',addEventListener:(k,f)=>events[k]=f};
  const scope = {
    URL,TextEncoder,location:{hash:'#/contact',protocol:'file:'},
    document:{getElementById:()=>root,documentElement:{},querySelector:()=>({content:''})},
    localStorage:{getItem:()=>null},requestAnimationFrame(){},console:{warn(){},info(){}},
    FormData:class {get(key){return {name:'Test',email:'test@example.com',organization:'',subject:'Test message',message:'A test message.'}[key];}},
    window:{addEventListener(){}}
  };
  for (const name of ['data/content.js','assets/js/core.js','assets/js/media.js','assets/js/views.js']) vm.runInNewContext(read(path.join(rootPath,name),'utf8'),scope);
  scope.window.TanjiCloud = {async sendInquiry(data){writes++;assert.equal(data.email,'test@example.com');if(fails)throw {code:'permission-denied'};}};
  vm.runInNewContext(read(path.join(rootPath,'assets/js/site.js'),'utf8'),scope);
  await events.submit({target:form,preventDefault(){}});
  assert.equal(writes,1);
  assert.equal(reset,!fails);
  assert.equal(button.disabled,false);
  assert(result.textContent.includes(fails?'未送出':'已送出'));
}
(async()=>{await checkSubmission(false);await checkSubmission(true);console.log('PASS: contact clears only after confirmed write; failed delivery retains input and reports failure.');})().catch(error=>{console.error(error);process.exitCode=1;});
