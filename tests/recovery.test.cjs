const fs=require('fs'),vm=require('vm'),assert=require('assert');
const scope={window:{},URL,TextEncoder};
for(const file of ['data/content.js','assets/js/core.js','assets/js/media.js','assets/js/views.js']) vm.runInNewContext(fs.readFileSync(file,'utf8'),scope,{filename:file});
const C=scope.window.TanjiCore,UI=scope.window.TanjiUI,seed=scope.window.TANJI_SEED;
function render(c,page='projects'){return UI.renderPublic(C.toPublic(c),{page,lang:'zh',category:'all',projectsPage:1}).html;}
const original=render(seed);
assert(original.includes('class="screen-project"'),'Bundled competition projects render');
const withCoolCity=JSON.parse(JSON.stringify(seed));
withCoolCity.projects.push({...seed.projects[0],id:'coolcity',titleZh:'CoolCity',titleEn:'CoolCity',url:null,visibility:'published'});
withCoolCity.awards.push({...seed.awards[0],id:'coolcity-award',projectId:'coolcity'});
const output=render(withCoolCity);
assert(output.includes('class="screen-project"'),'Other projects survive');
assert(!output.includes('>CoolCity<'),'CoolCity is hidden until ready');
const broken=JSON.parse(JSON.stringify(seed));broken.projects[0].url=null;
assert(render(broken).includes('class="screen-project"'),'Missing URL does not crash projects');
assert(render(broken,'home').includes('class="ta-entry"'),'Missing URL does not crash home');
console.log('PASS: bundled projects, CoolCity exclusion, missing URL resilience');
