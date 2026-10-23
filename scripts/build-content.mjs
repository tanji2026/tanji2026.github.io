// Optional: regenerate the bundled content after editing seed.json locally.
// Normal content updates can still be made through admin.html.
import {readFile,writeFile} from 'node:fs/promises';
const root = new URL('../',import.meta.url);
const content = JSON.parse(await readFile(new URL('seed.json',root),'utf8'));
for (const type of ['projects','awards','news','topics']) {
  if (!Array.isArray(content[type])) throw new Error('Missing content collection: '+type);
}
await writeFile(new URL('data/content.js',root),'window.TANJI_SEED='+JSON.stringify(content)+';\n');
console.log('Updated data/content.js from seed.json.');
