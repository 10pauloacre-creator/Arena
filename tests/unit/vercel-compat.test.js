// Simula o ambiente da Vercel: reescrita /api/:path* → /api/index?__p=:path*, corpo JSON já interpretado em req.body.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MemoryStore } from '../../lib/store/memory.js';
import { setStore } from '../../lib/store/index.js';
import { setProvider } from '../../lib/payments/index.js';
import { mockProvider } from '../../lib/payments/mock.js';
import handler from '../../api/index.js';

let server, base;
before(async () => {
  setStore(new MemoryStore()); setProvider(mockProvider);
  server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    // 1) reescrita
    // (vercel.json) /pelada-img/:path* → /api/index?__p=pelada/img/:path*
    const path = u.pathname.startsWith('/pelada-img/') ? 'pelada/img/' + u.pathname.slice('/pelada-img/'.length) : u.pathname.replace(/^\/api\/?/, '');
    const q = new URLSearchParams(u.search); q.set('__p', path);
    req.url = `/api/index?${q.toString()}`;
    // 2) corpo já interpretado, como no runtime da Vercel
    if (req.method !== 'GET' && String(req.headers['content-type'] || '').includes('application/json')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const text = Buffer.concat(chunks).toString();
      try { req.body = text ? JSON.parse(text) : {}; } catch { req.body = text; }
    }
    return handler(req, res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(r => server.close(r)));

const call = async (method, path, body, cookie) => {
  const res = await fetch(base + '/api' + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
};

test('rotas funcionam com a reescrita da Vercel (__p) e corpo pré-interpretado', async () => {
  assert.equal((await call('GET', '/health')).data.ok, true);
  const su = await call('POST', '/auth/signup', { name: 'Vercel Teste', email: 'v@teste.com', password: 'senha-segura-1' });
  assert.equal(su.status, 200);
  const t = await call('POST', '/tournaments', { name: 'Copa Vercel', sport: 'futsal' }, su.cookie);
  assert.equal(t.status, 200);
  const id = t.data.tournament.id;
  const pub = await call('GET', `/public/${id}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.tournament.name, 'Copa Vercel');
  // segmentos aninhados com query string original preservada
  const team = await call('GET', `/public/${id}/teams/xx?code=ABC`);
  assert.equal(team.status, 403);
  assert.equal((await call('GET', '/rota/que/nao/existe')).status, 404);
});

test('corpo vazio em POST sem JSON (logout) e métodos incorretos', async () => {
  assert.equal((await call('POST', '/auth/logout')).status, 200);
  assert.equal((await call('GET', '/auth/login')).status, 405);
});

test('app Pelada: conta, pelada e imagem funcionam com a reescrita da Vercel (/pelada-img → __p)', async () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const su = await call('POST', '/pelada/auth/signup', { name: 'Vercel Pelada', birth: '10/10/1990', avatar: PNG });
  assert.equal(su.status, 200);
  assert.match(su.cookie, /^pl_session=/);
  const made = await call('POST', '/pelada/peladas', { name: 'Pelada Vercel', gender: 'feminino', minPerTeam: 5, days: [{ date: '2030-01-01' }] }, su.cookie);
  assert.equal(made.status, 200);
  const id = made.data.pelada.id;
  assert.equal((await call('GET', `/pelada/peladas/${id}`)).data.pelada.invite, undefined);
  assert.equal((await call('GET', `/pelada/peladas/${id}`, undefined, su.cookie)).data.pelada.invite.id, id);
  // a URL pública das imagens é /pelada-img/...; a Vercel reescreve para /api/index?__p=pelada/img/...
  const res = await fetch(`${base}/pelada-img/u/${su.data.player.id}?v=1`);
  assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal((await call('POST', '/pelada/auth/logout', undefined, su.cookie)).status, 200);
});
