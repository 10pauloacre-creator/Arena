// PWA do app Pelada: manifesto, ícones, service worker (pré-cache completo da interface) e rotas de entrega.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = resolve(fileURLToPath(new URL('../../public', import.meta.url)));
const read = p => readFileSync(join(PUBLIC, p), 'utf8');
const shellList = () => [...read('pelada/sw.js').match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);

test('manifesto: escopo /pelada/, standalone, ícones existentes e atalhos', () => {
  const m = JSON.parse(read('pelada/manifest.webmanifest'));
  assert.equal(m.scope, '/pelada/');
  assert.ok(m.start_url.startsWith('/pelada/'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.short_name, 'Pelada');
  assert.ok(m.icons.some(i => i.sizes === '192x192') && m.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(existsSync(join(PUBLIC, i.src)), i.src);
  for (const s of m.shortcuts) assert.ok(s.url.startsWith('/pelada/'));
});

test('index.html do app é um documento próprio, com manifesto, ícone de iOS e sem script inline (CSP)', () => {
  const html = read('pelada/index.html');
  assert.match(html, /<link rel="manifest" href="\/pelada\/manifest\.webmanifest">/);
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /theme-color/);
  assert.match(html, /src="\/assets\/js\/pelada\/main\.js"/);
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'script inline violaria a CSP');
});

test('service worker: pré-cache lista todos os arquivos da interface (inclui as dependências compartilhadas)', () => {
  const shell = new Set(shellList());
  for (const f of shell) assert.ok(existsSync(join(PUBLIC, f.replace(/\/$/, '/index.html').replace(/^\/pelada\/index\.html$/, '/pelada/index.html'))), 'não existe: ' + f);
  // fecho dos imports a partir do main.js (estáticos e dinâmicos)
  const seen = new Set();
  const walk = file => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:from\s+|import\()\s*'(\.[^']+)'/g)) walk(resolve(dirname(file), m[1]));
  };
  walk(join(PUBLIC, 'assets/js/pelada/main.js'));
  const missing = [...seen].map(f => '/' + relative(PUBLIC, f).split(sep).join('/')).filter(u => !shell.has(u));
  assert.deepEqual(missing, [], 'faltam no SHELL do service worker');
  assert.ok(shell.has('/pelada/'));
});

test('service worker: nunca guarda /api e só atende o próprio domínio', () => {
  const sw = read('pelada/sw.js');
  assert.match(sw, /pathname\.startsWith\('\/api\/'\)\) return/);
  assert.match(sw, /url\.origin !== self\.location\.origin/);
  assert.match(sw, /request\.method !== 'GET'/);
});

test('vercel.json: reescritas do app Pelada vêm antes do catch-all e arquivos do PWA não ficam em cache longo', () => {
  const v = JSON.parse(readFileSync(join(PUBLIC, '..', 'vercel.json'), 'utf8'));
  const idx = s => v.rewrites.findIndex(r => r.source === s);
  assert.ok(idx('/pelada/:path*') >= 0 && idx('/pelada-img/:path*') >= 0);
  assert.ok(idx('/pelada/:path*') < idx('/((?!api/|assets/).*)'));
  assert.equal(v.rewrites[idx('/pelada/:path*')].destination, '/pelada/index.html');
  assert.equal(v.rewrites[idx('/pelada-img/:path*')].destination, '/api/index?__p=pelada/img/:path*');
  // o link de convite passa pelo servidor (metatags da pré-visualização) e vem antes do app genérico
  assert.ok(idx('/pelada/p/:id') >= 0 && idx('/pelada/p/:id') < idx('/pelada/:path*'));
  assert.equal(v.rewrites[idx('/pelada/p/:id')].destination, '/api/index?__p=pelada/page/:id');
  assert.match(v.functions['api/index.js'].includeFiles, /public\/pelada\/index\.html/); // a função lê o index.html do app
  const h = v.headers.find(x => x.source.includes('sw.js'));
  assert.ok(h && h.headers.some(x => x.key === 'Cache-Control' && x.value === 'no-cache'));
});

test('atualização na primeira abertura: arquivos sempre revalidados e service worker confere a rede', () => {
  const v = JSON.parse(readFileSync(join(PUBLIC, '..', 'vercel.json'), 'utf8'));
  const assets = v.headers.find(x => x.source === '/assets/(.*)');
  assert.match(assets.headers.find(h => h.key === 'Cache-Control').value, /max-age=0, must-revalidate/); // antes: 1 hora no aparelho
  const sw = read('pelada/sw.js');
  assert.match(sw, /fetch\(request, \{ cache: 'no-cache' \}\)/); // ignora o cache HTTP do navegador
  assert.match(sw, /new Request\(url, \{ cache: 'reload' \}\)/); // pré-cache busca arquivos novos
  assert.match(sw, /keys\.filter\(k => k\.startsWith\('pelada-'\) && k !== VERSION\)/); // apaga caches antigos
  const pwa = read('assets/js/pelada/pwa.js');
  assert.match(pwa, /updateViaCache: 'none'/); assert.match(pwa, /controllerchange/); assert.match(pwa, /reg\.update\(\)/);
});

test('todos os arquivos JS da interface do app estão sob assets/js/pelada', () => {
  const dir = join(PUBLIC, 'assets/js/pelada');
  const count = d => readdirSync(d).reduce((n, f) => n + (statSync(join(d, f)).isDirectory() ? count(join(d, f)) : f.endsWith('.js') ? 1 : 0), 0);
  assert.ok(count(dir) >= 20);
});

test('celular: viewport correta, manifesto em tela cheia e CSS que evita o zoom do iOS e o "modo desktop"', () => {
  const html = read('pelada/index.html');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1[^"]*viewport-fit=cover/);
  assert.ok(!/maximum-scale|user-scalable/.test(html), 'não desativar o zoom (acessibilidade)');
  const m = JSON.parse(read('pelada/manifest.webmanifest'));
  assert.deepEqual(m.display_override.slice(0, 1), ['standalone']);
  const css = read('assets/css/pelada.css');
  assert.match(css, /\.pl input:not\(\[type=checkbox\]\)[^{]*\{ font-size: 16px; \}/, 'campos com 16px no celular');
  assert.match(css, /\.pl-bnav \{[^}]*position: fixed/, 'barra de navegação inferior');
  assert.match(css, /@media \(display-mode: standalone\)/);
  assert.match(css, /\.pl dialog \{[^}]*border-radius: 22px 22px 0 0/, 'modais como folha no celular');
  const sw = read('pelada/sw.js');
  assert.match(sw, /const VERSION = 'pelada-v(\d+)'/);
});
