import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../../lib/store/memory.js';
import { FileStore } from '../../lib/store/file.js';
import { RedisStore } from '../../lib/store/redis.js';
import { SupabaseStore } from '../../lib/store/supabase.js';
import { pickEnv, storageNote } from '../../lib/store/index.js';

async function exerciseStore(s) {
  assert.equal(await s.get('x'), null);
  await s.set('x', { a: 1, b: [1, 2] });
  assert.deepEqual(await s.get('x'), { a: 1, b: [1, 2] });
  const copy = await s.get('x'); copy.a = 99;
  assert.equal((await s.get('x')).a, 1, 'get devolve cópia');
  assert.equal(await s.setNX('x', 'outro'), false);
  assert.equal(await s.setNX('novo', 'v'), true);
  assert.equal(await s.get('novo'), 'v');
  await s.del('x');
  assert.equal(await s.get('x'), null);
  await s.set('ttl', 'v', { ttlMs: 40 });
  assert.equal(await s.get('ttl'), 'v');
  await new Promise(r => setTimeout(r, 70));
  assert.equal(await s.get('ttl'), null);
}

async function exerciseLock(s) {
  let active = 0, maxActive = 0, counter = 0;
  const work = async () => {
    const release = await s.lock('k');
    try {
      active++; maxActive = Math.max(maxActive, active);
      const v = counter; await new Promise(r => setTimeout(r, 5)); counter = v + 1;
      active--;
    } finally { await release(); }
  };
  await Promise.all(Array.from({ length: 12 }, work));
  assert.equal(maxActive, 1, 'exclusão mútua');
  assert.equal(counter, 12);
}

test('MemoryStore: get/set/del/setNX/ttl e locks', async () => {
  const s = new MemoryStore();
  await exerciseStore(s);
  await exerciseLock(s);
});

test('FileStore: persiste em disco e recarrega', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'arena-'));
  const file = join(dir, 'db.json');
  try {
    const s = new FileStore(file);
    await exerciseStore(s);
    await exerciseLock(s);
    await s.set('persist', { ok: true });
    await s.set('lock:fake', 'x');
    const s2 = new FileStore(file);
    assert.deepEqual(await s2.get('persist'), { ok: true });
    assert.equal(await s2.get('lock:fake'), null, 'locks não são persistidos');
    assert.ok(JSON.parse(readFileSync(file, 'utf8')).persist);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/** Servidor Redis-REST falso (suporta GET/SET[NX,PX,EX]/DEL). */
function fakeRedisRest({ failFirst = 0 } = {}) {
  const data = new Map();
  let calls = 0, failures = failFirst;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      calls++;
      if (req.headers.authorization !== 'Bearer tok') { res.statusCode = 401; return res.end(JSON.stringify({ error: 'Unauthorized' })); }
      if (failures > 0) { failures--; res.statusCode = 503; return res.end('{}'); }
      const [cmd, key, val, ...rest] = JSON.parse(body);
      const now = Date.now();
      const live = () => { const e = data.get(key); if (e && e.exp && e.exp <= now) { data.delete(key); return null; } return e || null; };
      let result = null;
      if (cmd === 'GET') result = live()?.v ?? null;
      else if (cmd === 'DEL') { result = data.delete(key) ? 1 : 0; }
      else if (cmd === 'SET') {
        const nx = rest.includes('NX'); const pi = rest.indexOf('PX');
        if (nx && live()) result = null;
        else { data.set(key, { v: val, exp: pi >= 0 ? now + rest[pi + 1] : 0 }); result = 'OK'; }
      } else { res.statusCode = 400; return res.end(JSON.stringify({ error: 'ERR unknown command' })); }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ result }));
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(x => server.close(x)), calls: () => calls })));
}

test('RedisStore (API REST Upstash/Vercel KV): comandos, TTL, NX e locks', async () => {
  const fake = await fakeRedisRest();
  try {
    const s = new RedisStore({ url: fake.url, token: 'tok' });
    await exerciseStore(s);
    await exerciseLock(s);
    assert.equal(s.describe().persistent, true);
  } finally { await fake.close(); }
});

test('RedisStore: repete em falhas temporárias e falha com token inválido', async () => {
  const flaky = await fakeRedisRest({ failFirst: 2 });
  try {
    const s = new RedisStore({ url: flaky.url, token: 'tok' });
    await s.set('a', 1);
    assert.equal(await s.get('a'), 1);
    assert.ok(flaky.calls() >= 4);
    const bad = new RedisStore({ url: flaky.url, token: 'errado' });
    await assert.rejects(() => bad.get('a'), /Redis REST 401/);
  } finally { await flaky.close(); }
});

/** PostgREST falso da tabela arena_kv (filtros key=eq., expires_at=lt.; Prefer: merge/ignore-duplicates). */
function fakePostgrest({ missingTable = false } = {}) {
  const rows = new Map();
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      res.setHeader('Content-Type', 'application/json');
      if (req.headers.apikey !== 'sb_secret_x') { res.statusCode = 401; return res.end(JSON.stringify({ message: 'Invalid API key' })); }
      if (missingTable) { res.statusCode = 404; return res.end(JSON.stringify({ code: 'PGRST205', message: 'Could not find the table' })); }
      const prefer = req.headers.prefer || '';
      const key = u.searchParams.get('key')?.replace(/^eq\./, '');
      const lt = u.searchParams.get('expires_at')?.replace(/^lt\./, '');
      if (req.method === 'GET') {
        const r = rows.get(key);
        return res.end(JSON.stringify(r ? [{ value: r.value, expires_at: r.expires_at }] : []));
      }
      if (req.method === 'DELETE') {
        const r = rows.get(key);
        if (r && (!lt || (r.expires_at && r.expires_at < lt))) rows.delete(key);
        res.statusCode = 204; return res.end();
      }
      if (req.method === 'POST') {
        const row = JSON.parse(body); const exists = rows.has(row.key);
        if (exists && prefer.includes('ignore-duplicates')) { res.statusCode = 201; return res.end('[]'); }
        rows.set(row.key, { value: row.value, expires_at: row.expires_at });
        res.statusCode = 201;
        return res.end(prefer.includes('return=representation') ? JSON.stringify([row]) : '');
      }
      res.statusCode = 405; res.end('{}');
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(x => server.close(x)) })));
}

test('SupabaseStore (PostgREST): get/set/del/setNX/ttl e locks', async () => {
  const fake = await fakePostgrest();
  try {
    const s = new SupabaseStore({ url: fake.url, key: 'sb_secret_x' });
    await exerciseStore(s);
    await exerciseLock(s);
    assert.equal(s.describe().persistent, true);
    assert.equal(s.headers.Authorization, undefined, 'chave nova só em apikey');
    assert.equal(new SupabaseStore({ url: fake.url, key: 'eyJabc' }).headers.Authorization, 'Bearer eyJabc');
  } finally { await fake.close(); }
});

test('SupabaseStore: chave inválida e tabela ausente dão erro claro (sem repetir)', async () => {
  const ok = await fakePostgrest();
  const missing = await fakePostgrest({ missingTable: true });
  try {
    await assert.rejects(() => new SupabaseStore({ url: ok.url, key: 'errada' }).get('a'), /Supabase REST 401/);
    await assert.rejects(() => new SupabaseStore({ url: missing.url, key: 'sb_secret_x' }).get('a'), /arena_kv.*não existe.*arena_kv\.sql/s);
  } finally { await ok.close(); await missing.close(); }
});

test('variáveis do banco: aceita nomes padrão e com prefixo da Vercel; aviso diz o que falta', () => {
  assert.equal(pickEnv({ SUPABASE_URL: 'a' }, ['SUPABASE_URL'], ['SUPABASE_URL']), 'a');
  assert.equal(pickEnv({ STORAGE_SUPABASE_URL: 'b' }, ['SUPABASE_URL'], ['SUPABASE_URL']), 'b', 'prefixo personalizado');
  assert.equal(pickEnv({ NEXT_PUBLIC_SUPABASE_URL: 'c' }, ['SUPABASE_URL'], ['SUPABASE_URL']), '', 'NEXT_PUBLIC_ só pelo nome exato');
  assert.match(storageNote({}), /supabase\/arena_kv\.sql.*Redeploy/s);
  assert.match(storageNote({ SUPABASE_URL: 'x' }), /falta a chave de servidor/);
  assert.match(storageNote({ STORAGE_SUPABASE_SERVICE_ROLE_KEY: 'k' }), /SUPABASE_URL/);
  assert.match(storageNote({ KV_REST_API_URL: 'x' }), /token/);
  assert.ok(!storageNote({ SUPABASE_URL: 'segredo-url' }).includes('segredo-url'), 'não revela valores');
});
