const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const write = (f, d) => fs.writeFileSync(path.join(root, f), d, 'utf8');
const rm = (f) => { try { fs.unlinkSync(path.join(root, f)); } catch(e){} };

// 1. 合併 JavaScript 核心檔案
console.log('1. 正在整併 JS 檔案...');
const coreJs = [read('assets/js/core.js'), read('assets/js/media.js'), read('assets/js/notes.js')].join('\n');
const cloudJs = [read('assets/js/firebase-config.js'), read('assets/js/cloud.js')].join('\n');

let viewsJsText = read('assets/js/views.js');
// 將 YouTube 社群從聯絡我們移除
viewsJsText = viewsJsText.replace(
  /\$\{C\.safeUrl\(s\.youtube\)\?`<div class="contact-social".*?<\/div>`:''\}/,
  ''
);
// 在「關於碳吉」加入支援 YouTube/Instagram/Threads 的動態顯示區塊
const aboutSocial = `${(C.safeUrl(s.youtube,true)||C.safeUrl(s.instagram,true)||C.safeUrl(s.threads,true))?\`<div class="about-social-block" style="margin-top:40px;text-align:center"><h2>\${E(t.social)}</h2><div class="social-links" style="display:flex;gap:16px;justify-content:center;margin-top:16px">\${C.safeUrl(s.youtube,true)?\`<a class="tj-btn text-link" href="\${E(C.safeUrl(s.youtube,true))}" target="_blank" rel="noopener noreferrer">YouTube ↗</a>\`:\'\'}\${C.safeUrl(s.instagram,true)?\`<a class="tj-btn text-link" href="\${E(C.safeUrl(s.instagram,true))}" target="_blank" rel="noopener noreferrer">Instagram ↗</a>\`:\'\'}\${C.safeUrl(s.threads,true)?\`<a class="tj-btn text-link" href="\${E(C.safeUrl(s.threads,true))}" target="_blank" rel="noopener noreferrer">Threads ↗</a>\`:\'\'}</div></div>\`:\'\'}`;
viewsJsText = viewsJsText.replace('</div></section>`;', '</div>' + aboutSocial + '</div></section>`;');

const viewsJs = [viewsJsText, read('assets/js/notes-views.js')].join('\n');
const adminJs = [read('assets/js/admin.js'), read('assets/js/notes-admin.js')].join('\n');

write('assets/js/core.js', coreJs);
write('assets/js/cloud.js', cloudJs);
write('assets/js/views.js', viewsJs);
write('assets/js/admin.js', adminJs);

// 2. 移除已經合併的碎片檔案
console.log('2. 正在移除已整併的碎片 JS 檔案...');
['media.js', 'notes.js', 'firebase-config.js', 'notes-views.js', 'notes-admin.js'].forEach(f => rm('assets/js/' + f));

// 3. 更新 HTML 的載入標籤
console.log('3. 正在更新 HTML 標籤...');
const scriptRegex = /<script defer src="\.\/assets\/js\/.*?<\/script>/g;
const htmlCore = `<script defer src="./assets/js/core.js?v=20261026"></script>\n<script defer src="./assets/vendor/purify.min.js?v=20261026"></script>\n<script defer src="./assets/js/cloud.js?v=20261026"></script>`;

['index.html', '404.html'].forEach(f => {
  let html = read(f);
  html = html.replace(/<script defer src="\.\/assets\/vendor\/purify\.min\.js.*?<\/script>/g, '');
  html = html.replace(scriptRegex, '');
  html = html.replace(/<script defer src="\.\/data\/content\.js"><\/script>/, `<script defer src="./data/content.js"></script>\n${htmlCore}\n<script defer src="./assets/js/views.js?v=20261026"></script>\n<script defer src="./assets/js/site.js?v=20261026"></script>`);
  write(f, html);
});

let admHtml = read('admin.html');
admHtml = admHtml.replace(/<script defer src="\.\/assets\/vendor\/purify\.min\.js.*?<\/script>/g, '');
admHtml = admHtml.replace(scriptRegex, '');
admHtml = admHtml.replace(/<script defer src="\.\/data\/content\.js"><\/script>/, `<script defer src="./data/content.js"></script>\n${htmlCore}\n<script defer src="./assets/js/admin.js?v=20261026"></script>`);
write('admin.html', admHtml);

// 4. 更新自動化測試的路徑參照
console.log('4. 正在更新測試檔案相依性...');
const tests = ['admin-loading.test.cjs', 'admin-notes.test.cjs', 'contact.test.cjs', 'content-compat.test.cjs', 'notes.test.cjs', 'site.test.cjs'];
tests.forEach(t => {
  let text = read('tests/' + t);
  text = text.replace(/'assets\/js\/media\.js',?/g, '');
  text = text.replace(/'assets\/js\/notes\.js',?/g, '');
  text = text.replace(/'assets\/js\/notes-views\.js',?/g, '');
  text = text.replace(/'assets\/js\/notes-admin\.js',?/g, '');
  write('tests/' + t, text);
});

// 5. 清理過時修補文件
console.log('5. 清除 5 份過時的維護說明文件...');
['UPDATE.txt', 'UPDATE-NOTES.md', 'CONTENT-FIX.md', 'ADMIN-LOADING-FIX.md', 'YOUTUBE-LINK-FIX.md'].forEach(f => rm(f));

console.log('✅ 執行完成！');
