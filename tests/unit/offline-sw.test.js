// Service workers do ArenaMaster (/sw.js) e do Pelada (/pelada/sw.js): listas de arquivos guardados e estratégia de rede (núcleo compartilhado).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = resolve(fileURLToPath(new URL('../../public', import.meta.url)));
const read = p => readFileSync(join(PUBLIC, p), 'utf8');
const shellOf = sw => [...read(sw).match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);

function closure(entry) {
  const seen = new Set();
  const walk = file => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(/(?:from\s+|import\()\s*'(\.[^']+)'/g)) walk(resolve(dirname(file), m[1]));
  };
  walk(join(PUBLIC, entry));
  return [...seen].map(f => '/' + relative(PUBLIC, f).split(sep).join('/'));
}

for (const [name, sw, entry] of [['ArenaMaster', 'sw.js', 'assets/js/main.js'], ['Pelada', 'pelada/sw.js', 'assets/js/pelada/main.js']]) {
  test(`${name}: o service worker guarda todos os arquivos que o app usa (rode "npm run sw" se faltar algum)`, () => {
    const shell = new Set(shellOf(sw));
    for (const f of shell) assert.ok(existsSync(join(PUBLIC, f.endsWith('/') ? f + 'index.html' : f)), 'não existe: ' + f);
    assert.deepEqual(closure(entry).filter(u => !shell.has(u)), [], 'faltam na lista do service worker');
    assert.ok(shell.has('/assets/js/offline/sw-core.js') && shell.has('/assets/css/offline.css'));
    assert.ok(shell.has(sw === 'sw.js' ? '/' : '/pelada/'));
  });
}

test('ArenaMaster não carrega o domínio da pelada e o Pelada não carrega o do torneio (cada app guarda só o que usa)', () => {
  const arena = new Set(shellOf('sw.js')), pelada = new Set(shellOf('pelada/sw.js'));
  assert.ok(!arena.has('/assets/js/shared/domain/pelada.js') && !arena.has('/assets/js/pelada/main.js'));
  assert.ok(!pelada.has('/assets/js/shared/domain/bracket.js') && !pelada.has('/assets/js/pages/admin/live.js'));
  assert.ok(arena.has('/assets/js/shared/domain/tournament-actions.js') && pelada.has('/assets/js/shared/domain/pelada-actions.js'));
});

test('index.html dos dois apps carrega o CSS do modo offline e não tem script inline (CSP)', () => {
  for (const f of ['index.html', 'pelada/index.html']) {
    const html = read(f);
    assert.match(html, /\/assets\/css\/offline\.css/);
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), f + ': script inline violaria a CSP');
  }
});

test('vercel.json: service workers e o núcleo nunca ficam em cache HTTP (atualizam na hora)', () => {
  const v = JSON.parse(readFileSync(join(PUBLIC, '..', 'vercel.json'), 'utf8'));
  for (const file of ['/sw.js', '/pelada/sw.js', '/assets/js/offline/sw-core.js']) {
    const h = v.headers.filter(x => new RegExp('^' + x.source.replace(/\(/g, '(?:') + '$').test(file) || x.source.includes(file.slice(1)));
    assert.ok(h.some(x => x.headers.some(y => y.key === 'Cache-Control' && y.value.includes('no-cache'))), file + ' sem no-cache');
  }
  // a reescrita de SPA não pode engolir o service worker da raiz
  assert.ok(v.rewrites.every(r => !r.source.startsWith('/sw')));
});

// ---------------------------------------------------------------- núcleo: estratégia de rede
function sandbox(config) {
  const cacheStores = new Map();
  const mkCache = name => {
    if (!cacheStores.has(name)) cacheStores.set(name, new Map());
    const m = cacheStores.get(name);
    return {
      match: async req => m.get(typeof req === 'string' ? new URL(req, 'https://app.test').href : req.url),
      put: async (req, res) => { m.set(typeof req === 'string' ? new URL(req, 'https://app.test').href : req.url, res); },
      add: async url => { if (url.includes('quebrado')) throw new Error('404'); m.set(new URL(url, 'https://app.test').href, { ok: true, from: 'shell', clone() { return this; } }); },
    };
  };
  const listeners = {};
  const net = { mode: 'up', calls: [] };
  const self = {
    location: { origin: 'https://app.test' },
    addEventListener: (t, fn) => { listeners[t] = fn; },
    skipWaiting: async () => {}, clients: { claim: async () => {} },
  };
  const ctx = {
    self, URL, Promise, setTimeout: (fn) => { if (net.timeoutFires) fn(); return 0; }, console,
    caches: { open: async n => mkCache(n), keys: async () => [...cacheStores.keys()], delete: async n => cacheStores.delete(n) },
    fetch: async req => {
      net.calls.push(req.url);
      if (net.mode === 'down') throw new TypeError('Failed to fetch');
      if (net.mode === 'hang') return new Promise(() => {});
      return { ok: true, from: 'net', url: req.url, clone() { return this; } };
    },
    importScripts() {},
  };
  vm.createContext(ctx);
  vm.runInContext(read('assets/js/offline/sw-core.js'), ctx);
  ctx.self.arenaSW.setup(config);
  const fetchEvent = (path, { method = 'GET', mode = 'cors', origin = 'https://app.test' } = {}) => {
    let responded; const e = { request: { url: origin + path, method, mode }, respondWith: p => { responded = Promise.resolve(p); } };
    listeners.fetch(e);
    return responded;
  };
  return { net, cacheStores, listeners, fetchEvent, ctx };
}
const cfg = { prefix: 'arena-', version: 'v9', shell: ['/', '/assets/a.js', '/assets/quebrado.js'], fallback: '/', assetPrefixes: ['/assets/'], ignorePrefixes: ['/pelada/'], swr: [/^\/api\/public\/[^/]+\/emblem\//] };

test('núcleo: instala guardando a lista (arquivo ausente não impede) e apaga só caches antigos do mesmo app', async () => {
  const sb = sandbox(cfg);
  await new Promise(r => { sb.listeners.install({ waitUntil: p => p.then(r) }); });
  assert.equal(sb.cacheStores.get('arena-v9').size, 2);
  sb.cacheStores.set('arena-v1', new Map()); sb.cacheStores.set('pelada-v3', new Map());
  await new Promise(r => { sb.listeners.activate({ waitUntil: p => p.then(r) }); });
  assert.ok(!sb.cacheStores.has('arena-v1'), 'cache antigo do mesmo app foi apagado');
  assert.ok(sb.cacheStores.has('pelada-v3') && sb.cacheStores.has('arena-v9'), 'cache de outro app e o atual ficam');
});

test('núcleo: navegação com internet usa a rede e guarda a tela; sem internet abre a cópia guardada', async () => {
  const sb = sandbox(cfg);
  const online = await sb.fetchEvent('/admin/AM-2026-1234/ao-vivo', { mode: 'navigate' });
  assert.equal(online.from, 'net');
  assert.ok(sb.cacheStores.get('arena-v9').has('https://app.test/'), 'a tela fica guardada como o index do app');
  sb.net.mode = 'down';
  const offline = await sb.fetchEvent('/t/AM-2026-1234', { mode: 'navigate' });
  assert.equal(offline.from, 'net'); // a cópia guardada é a que veio da rede antes
  assert.equal(sb.net.calls.length, 2);
});

test('núcleo: internet "pendurada" (sem responder) não trava o app: depois do tempo limite usa a cópia', async () => {
  const sb = sandbox(cfg);
  await sb.fetchEvent('/', { mode: 'navigate' });
  sb.net.mode = 'hang'; sb.net.timeoutFires = true;
  const res = await sb.fetchEvent('/', { mode: 'navigate' });
  assert.equal(res.from, 'net');
});

test('núcleo: sem cópia guardada e sem internet o erro aparece (não inventa resposta)', async () => {
  const sb = sandbox(cfg);
  sb.net.mode = 'down';
  await assert.rejects(sb.fetchEvent('/assets/novo.js'), /Failed to fetch/);
});

test('núcleo: não interfere em /api, POST, outros domínios e áreas de outro service worker', () => {
  const sb = sandbox(cfg);
  assert.equal(sb.fetchEvent('/api/tournaments'), undefined);
  assert.equal(sb.fetchEvent('/assets/a.js', { method: 'POST' }), undefined);
  assert.equal(sb.fetchEvent('/assets/a.js', { origin: 'https://cdn.outro.com' }), undefined);
  assert.equal(sb.fetchEvent('/pelada/p/PL-ABC234', { mode: 'navigate' }), undefined);
  assert.equal(sb.fetchEvent('/qualquer-coisa.png'), undefined);
});

test('núcleo: emblemas dos times usam a cópia e atualizam em segundo plano', async () => {
  const sb = sandbox(cfg);
  const first = await sb.fetchEvent('/api/public/AM-2026-1234/emblem/tm_1?v=3');
  assert.equal(first.from, 'net');
  sb.net.mode = 'down';
  const again = await sb.fetchEvent('/api/public/AM-2026-1234/emblem/tm_1?v=3');
  assert.equal(again.from, 'net');
});
