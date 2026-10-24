const {readFileSync:read} = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const scope = {window:{},URL,TextEncoder};
for (const file of ['data/content.js','assets/js/core.js','assets/js/media.js','assets/js/views.js']) {
  vm.runInNewContext(read(path.join(root,file),'utf8'),scope,{filename:file});
}
const {TanjiUI:UI,TanjiCore:C,TANJI_SEED:seed} = scope.window;
const content = C.toPublic(seed);
const render = (page,extra={})=>UI.renderPublic(content,{page,lang:'zh',category:'all',projectsPage:1,...extra}).html;
const home = render('home');
assert.equal((home.match(/class="ta-entry"/g)||[]).length,8);
assert.deepEqual([...home.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map(x=>x[1]),['關於碳吉','探索方向','競賽作品','碳吉筆記','聯絡我們']);
assert(!home.includes('hero-tag') && !home.includes('進一步認識碳吉'));
assert(!home.includes('href="#/project/') && !home.includes('href="#/baby'));
assert(!home.match(/<footer[\s\S]*mailto:/));
assert.equal((home.match(/<strong>TanJi<\/strong><span>碳吉<\/span>/g)||[]).length,2);
assert(!render('about').includes('class="subnav"'));
assert(!render('topics').includes('class="topic-note"'));
const first = render('projects');
const second = render('projects',{projectsPage:2});
assert.equal((first.match(/class="screen-project"/g)||[]).length,6);
assert.equal((second.match(/class="screen-project"/g)||[]).length,2);
assert(!first.includes('企業綠色融資暨碳管理平台'));
assert(!second.includes('低碳改造讓社區碳吉'));
assert(!/\s↗/.test(home));
const contact = render('contact');
assert(contact.includes('送出訊息') && !contact.includes('準備郵件'));
assert(!contact.includes('尚未開放實際送出'));
for (const name of ['name','email','organization','subject','message']) assert(contact.includes('name="'+name+'"'));
// Existing cloud content must not reintroduce non-competing projects.
const legacy = JSON.parse(JSON.stringify(seed));
for (const project of legacy.projects) project.visibility='published';
const legacyHtml = UI.renderPublic(C.toPublic(legacy),{page:'projects',lang:'zh',category:'all',projectsPage:2}).html;
assert.equal((legacyHtml.match(/class="screen-project"/g)||[]).length,2);
// New published award/project records appear without adding renderer branches.
const future = JSON.parse(JSON.stringify(seed));
future.projects.push({...seed.projects[0],id:'future',titleZh:'未來參賽作品',visibility:'published',order:100});
future.awards.push({...seed.awards[0],id:'future-award',projectId:'future',order:100});
const futureHtml = UI.renderPublic(C.toPublic(future),{page:'projects',lang:'zh',category:'all',projectsPage:2}).html;
assert(futureHtml.includes('未來參賽作品'));
for (const lang of ['zh','en']) for (const page of ['home','about','topics','projects','contact']) {
  const html=UI.renderPublic(content,{page,lang,projectsPage:1,category:'all'}).html;
  assert(!html.includes('src="undefined"'));
}
console.log('PASS: page order, 7 competing projects, 8 awards, legacy cloud compatibility, future additions, links, bilingual views, contact fields.');

// New records go before existing records, including negative manual orders.
assert.equal(C.nextOrder([]),-1);
assert.equal(C.nextOrder([{order:-4},{order:8}]),-5);
for(const type of C.TYPES){
 const rows=seed[type];
 const record={...rows[0],id:'latest-'+type,order:C.nextOrder(rows),visibility:'published',archived:false};
 assert.equal(C.visible([...rows,record])[0].id,record.id);
}
const recent=JSON.parse(JSON.stringify(seed));
recent.projects.push({...seed.projects[0],id:'latest-project',titleZh:'最新作品排序測試',visibility:'published',order:C.nextOrder(seed.projects)});
recent.awards.push({...seed.awards[0],id:'latest-award',projectId:'latest-project',titleZh:'最新競賽排序測試',winner:false,year:'2020',visibility:'published',order:C.nextOrder(seed.awards)});
const latestContent=C.toPublic(recent);
for(const lang of ['zh','en']){
 const state={lang,projectsPage:1,category:'all'};
 const homeHtml=UI.renderPublic(latestContent,{...state,page:'home'}).html;
 const projectsHtml=UI.renderPublic(latestContent,{...state,page:'projects'}).html;
 const homeFirst=homeHtml.match(/class="ta-entry"[\s\S]*?class="ta-plain-title">([^<]+)/)[1];
 const pageFirst=projectsHtml.match(/class="screen-title">([^<]+)/)[1];
 assert.equal(homeFirst,pageFirst);
 if(lang==='zh')assert.equal(homeFirst,'最新作品排序測試');
}
