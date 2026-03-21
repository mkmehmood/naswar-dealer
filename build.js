import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  readFileSync, writeFileSync, copyFileSync,
  mkdirSync, unlinkSync, existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT  = __dirname;
const DIST  = join(ROOT, 'dist');
const ESBUILD = join(ROOT, 'node_modules/.bin/esbuild');

function run(args) {
  execFileSync(ESBUILD, args, { stdio: ['ignore', 'inherit', 'inherit'] });
}
function contentHash(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex').slice(0, 8);
}
function write(filePath, content) { writeFileSync(filePath, content, 'utf8'); }
function read(filePath) { return readFileSync(filePath, 'utf8'); }
function rm(filePath) { if (existsSync(filePath)) unlinkSync(filePath); }

mkdirSync(DIST, { recursive: true });

const CORE_FILES = [
  'constants.js', 'business.js', 'admin-data.js',
  'sync.js', 'utilities.js', 'customers.js',
];

const coreTmp    = join(DIST, '_core.js');
const coreMinTmp = join(DIST, '_core_min.js');
write(coreTmp, CORE_FILES.map(f => read(join(ROOT, f))).join('\n'));
run([coreTmp, '--bundle=false', '--minify', '--platform=browser', '--target=es2018', `--outfile=${coreMinTmp}`]);
const coreHash = contentHash(coreMinTmp);
const coreOut  = `app.${coreHash}.js`;
copyFileSync(coreMinTmp, join(DIST, coreOut));

const factoryMinTmp = join(DIST, '_factory_min.js');
run([join(ROOT, 'factory.js'), '--bundle=false', '--minify', '--platform=browser', '--target=es2018', `--outfile=${factoryMinTmp}`]);
const factoryHash = contentHash(factoryMinTmp);
const factoryOut  = `factory.${factoryHash}.js`;
copyFileSync(factoryMinTmp, join(DIST, factoryOut));

const repMinTmp = join(DIST, '_rep_min.js');
run([join(ROOT, 'rep-sales.js'), '--bundle=false', '--minify', '--platform=browser', '--target=es2018', `--outfile=${repMinTmp}`]);
const repHash = contentHash(repMinTmp);
const repOut  = `rep-sales.${repHash}.js`;
copyFileSync(repMinTmp, join(DIST, repOut));

const cssMinTmp = join(DIST, '_app_min.css');
run([join(ROOT, 'app.css'), '--bundle=false', '--minify', `--outfile=${cssMinTmp}`]);
const cssHash = contentHash(cssMinTmp);
const cssOut  = `app.${cssHash}.css`;
copyFileSync(cssMinTmp, join(DIST, cssOut));

for (const t of [coreTmp, coreMinTmp, factoryMinTmp, repMinTmp, cssMinTmp]) rm(t);

for (const f of ['manifest.json','192.png','512.png','sql-wasm.js','sql-wasm.wasm','sql.js']) {
  copyFileSync(join(ROOT, f), join(DIST, f));
}

let html = read(join(ROOT, 'index.html'));

html = html.replace(
  '<link rel="preload" href="admin-data.js" as="script">',
  `<link rel="preload" href="${coreOut}" as="script">`,
);
html = html.replace(
  '<link rel="stylesheet" href="app.css">',
  `<link rel="stylesheet" href="${cssOut}">`,
);

const lazyStub = `<script src="${coreOut}" defer></script>
<script>
(function(){
  var _fl=false,_rl=false;
  function _load(src,cb){var s=document.createElement('script');s.src=src;s.defer=true;s.onload=cb;s.onerror=cb;document.head.appendChild(s);}
  window._lazyLoadFactory=function(cb){if(_fl){if(cb)cb();return;}_load('${factoryOut}',function(){_fl=true;if(cb)cb();});};
  window._lazyLoadRep=function(cb){if(_rl){if(cb)cb();return;}_load('${repOut}',function(){_rl=true;if(cb)cb();});};
})();
</script>`;

html = html.replace(
  `<script src="constants.js" defer></script>\n<script src="business.js" defer></script>\n<script src="admin-data.js" defer></script>\n<script src="sync.js" defer></script>\n<script src="utilities.js" defer></script>\n<script src="factory.js" defer></script>\n<script src="customers.js" defer></script>\n<script src="rep-sales.js" defer></script>`,
  lazyStub,
);

write(join(DIST, 'index.html'), html);

const ASSETS_TO_CACHE_BLOCK =
`const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './${cssOut}',
  './${coreOut}',
  './${factoryOut}',
  './${repOut}',
  './manifest.json',
  './192.png',
  './512.png',

  './sql-wasm.js',
  './sql-wasm.wasm',
  './sql.js'
];`;

let sw = read(join(ROOT, 'sw.js'));
sw = sw.replace(/const BUILD_HASH = '[^']+';/, `const BUILD_HASH = 'naswar-dealer-${coreHash}';`);
sw = sw.replace(/const ASSETS_TO_CACHE = \[[\s\S]*?\];/, ASSETS_TO_CACHE_BLOCK);
write(join(DIST, 'sw.js'), sw);

const kb = f => (readFileSync(join(DIST, f)).length / 1024).toFixed(1);
console.log('\nBuild complete:\n');
console.log(`  ${coreOut.padEnd(40)} ${kb(coreOut)} KB  (core bundle)`);
console.log(`  ${factoryOut.padEnd(40)} ${kb(factoryOut)} KB  (lazy — factory tab)`);
console.log(`  ${repOut.padEnd(40)} ${kb(repOut)} KB  (lazy — rep tab)`);
console.log(`  ${cssOut.padEnd(40)} ${kb(cssOut)} KB  (styles)`);
console.log(`\n  SW cache key: naswar-dealer-${coreHash}`);
console.log(`  Output:       dist/\n`);
