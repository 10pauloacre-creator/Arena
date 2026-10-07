import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, signup } from './helpers.js';

let S;
before(async () => { S = await startServer(); });
after(async () => { await S.close(); });

test('cadastro cria sessão e /auth/me devolve o usuário', async () => {
  const c = new Client(S.base);
  const r = await c.post('/auth/signup', { name: '  Maria  Silva ', email: 'Maria@Teste.com ', password: 'senha1234' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.name, 'Maria Silva');
  assert.equal(r.data.user.email, 'maria@teste.com');
  assert.ok(!JSON.stringify(r.data).includes('passHash'));
  const me = await c.get('/auth/me');
  assert.equal(me.data.user.email, 'maria@teste.com');
});

test('cookie de sessão é HttpOnly e SameSite', async () => {
  const c = new Client(S.base);
  const res = await fetch(S.base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ana', email: 'ana@teste.com', password: 'senha1234' }) });
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.ok(c);
});

test('e-mail duplicado é recusado (sem diferenciar maiúsculas)', async () => {
  const c = new Client(S.base);
  await c.post('/auth/signup', { name: 'João', email: 'joao@teste.com', password: 'senha1234' });
  const c2 = new Client(S.base);
  const r = await c2.post('/auth/signup', { name: 'João 2', email: 'JOAO@teste.com', password: 'senha1234' });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'EMAIL_TAKEN');
});

test('validações de cadastro: e-mail, senha curta, nome curto', async () => {
  const c = new Client(S.base);
  assert.equal((await c.post('/auth/signup', { name: 'Ok Nome', email: 'invalido', password: 'senha1234' })).status, 400);
  assert.equal((await c.post('/auth/signup', { name: 'Ok Nome', email: 'x@y.com', password: '1234567' })).status, 400);
  assert.equal((await c.post('/auth/signup', { name: 'A', email: 'x2@y.com', password: 'senha1234' })).status, 400);
});

test('login correto e incorreto', async () => {
  const c = await signup(S.base, 'Pedro');
  const c2 = new Client(S.base);
  const bad = await c2.post('/auth/login', { email: c.email, password: 'errada-errada' });
  assert.equal(bad.status, 401);
  assert.equal((await c2.get('/auth/me')).data.user, null);
  const ok = await c2.post('/auth/login', { email: c.email.toUpperCase(), password: 'senha-segura-123' });
  assert.equal(ok.status, 200);
  assert.equal((await c2.get('/auth/me')).data.user.name, 'Pedro');
  assert.equal((await c2.post('/auth/login', { email: 'naoexiste@x.com', password: 'qualquercoisa' })).status, 401);
});

test('logout encerra a sessão', async () => {
  const c = await signup(S.base);
  await c.post('/auth/logout');
  assert.equal((await c.get('/auth/me')).data.user, null);
  assert.equal((await c.get('/tournaments')).status, 401);
});

test('bloqueio após muitas tentativas de login', async () => {
  const c = await signup(S.base);
  const x = new Client(S.base);
  for (let i = 0; i < 8; i++) assert.equal((await x.post('/auth/login', { email: c.email, password: 'senha-errada-' + i })).status, 401);
  const blocked = await x.post('/auth/login', { email: c.email, password: 'senha-segura-123' });
  assert.equal(blocked.status, 429);
});

test('token adulterado é rejeitado', async () => {
  const c = await signup(S.base);
  const [b, s] = c.cookie.split('=')[1].split('.');
  c.cookie = `am_session=${b}.${s.slice(0, -2)}xx`;
  assert.equal((await c.get('/auth/me')).data.user, null);
});

test('proteção CSRF: Origin de outro site e content-type errado', async () => {
  const c = await signup(S.base);
  const r1 = await c.post('/tournaments', { name: 'Torneio X', sport: 'futebol' }, { headers: { Origin: 'https://evil.example' } });
  assert.equal(r1.status, 403);
  const res = await fetch(S.base + '/api/tournaments', { method: 'POST', headers: { 'Content-Type': 'text/plain', Cookie: c.cookie }, body: '{"name":"Torneio X","sport":"futebol"}' });
  assert.equal(res.status, 415);
  const r3 = await c.post('/tournaments', { name: 'Torneio X', sport: 'futebol' }, { headers: { Origin: S.base } });
  assert.equal(r3.status, 200);
});

test('rota inexistente e método incorreto', async () => {
  const c = new Client(S.base);
  assert.equal((await c.get('/nada-aqui')).status, 404);
  assert.equal((await c.get('/auth/login')).status, 405);
});
