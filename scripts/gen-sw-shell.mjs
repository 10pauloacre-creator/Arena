// Atualiza a lista SHELL dos service workers (arquivos guardados para o app abrir sem internet).
// Os módulos JS vêm do "fecho" de imports a partir do main.js de cada app; css, fontes e imagens ficam como estão.
//   npm run sw          → reescreve public/sw.js e public/pelada/sw.js
//   npm run sw -- --check → só confere (sai com erro se estiver desatualizado)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = resolve(ROOT, 'public');
const CHECK = process.argv.includes('--check');

/** Arquivos JS alcançados por imports (estáticos e dinâmicos) a partir de `entry`. */
export function closure(entry) {
  const seen = new Set();
  const walk = file => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(/(?:from\s+|import\()\s*'(\.[^']+)'/g)) walk(resolve(dirname(file), m[1]));
  };
  walk(resolve(PUBLIC, entry));
  return [...seen].map(f => '/' + relative(PUBLIC, f).split(sep).join('/')).sort();
}

// arquivos de JS carregados por <script>/importScripts (fora do fecho de imports)
const EXTRA_JS = ['/assets/js/theme.js', '/assets/js/vendor/qrcode.js', '/assets/js/offline/sw-core.js'];
const APPS = [
  { sw: 'public/sw.js', entry: 'assets/js/main.js' },
  { sw: 'public/pelada/sw.js', entry: 'assets/js/pelada/main.js' },
];

let stale = false;
for (const app of APPS) {
  const file = resolve(ROOT, app.sw);
  const src = readFileSync(file, 'utf8');
  const m = /const SHELL = \[([\s\S]*?)\];/.exec(src);
  const current = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  const statics = current.filter(u => !u.startsWith('/assets/js/'));
  const next = [...statics, ...EXTRA_JS, ...closure(app.entry).filter(u => !EXTRA_JS.includes(u))];
  const block = `const SHELL = [\n${next.map(u => `  '${u}',`).join('\n')}\n];`;
  if (block === m[0]) continue;
  stale = true;
  if (!CHECK) { writeFileSync(file, src.replace(m[0], () => block)); console.log('atualizado:', app.sw); }
  else console.error('desatualizado:', app.sw);
}
if (CHECK && stale) process.exit(1);
if (!stale) console.log('listas dos service workers em dia');
