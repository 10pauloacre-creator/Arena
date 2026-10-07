// Peças puras do modo offline: aleatoriedade determinística, rotas, armazenamento local e texto do selo de sincronização.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDeterministic, randomId, shortCode, randomCode, randomU32 } from '../../public/assets/js/shared/rand.js';
import { compileRoute, matchRoute } from '../../public/assets/js/shared/route.js';
import { memoryDriver, localStorageDriver } from '../../public/assets/js/offline/storage.js';
import { describeStatus } from '../../public/assets/js/offline/ui.js';
import { newPelada, getDay } from '../../public/assets/js/shared/domain/pelada.js';
import { PELADA_ACTIONS, matchPeladaAction, runPeladaAction, rememberOp, hasOp, MAX_OPS } from '../../public/assets/js/shared/domain/pelada-actions.js';

test('rand: ids saem no formato certo e, fora do escopo determinístico, nunca se repetem', () => {
  assert.match(randomId('m_'), /^m_[A-Za-z0-9_-]{12}$/);
  assert.match(shortCode(8), /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/);
  assert.match(randomCode(16), /^[A-Za-z0-9_-]{22}$/);
  const seen = new Set(Array.from({ length: 500 }, () => randomU32()));
  assert.ok(seen.size > 495);
});

test('rand: a mesma semente repete a mesma sequência; sementes diferentes divergem; o escopo não vaza', () => {
  const run = seed => withDeterministic(seed, () => [randomId('x_'), shortCode(6), randomU32()]);
  assert.deepEqual(run('op-1234567890'), run('op-1234567890'));
  assert.notDeepEqual(run('op-1234567890'), run('op-1234567891'));
  const outside = [randomId(), randomId()];
  assert.notEqual(outside[0], outside[1]);
  // aninhado: volta ao escopo de fora
  withDeterministic('a-semente-1', () => {
    const a1 = randomU32();
    withDeterministic('b-semente-2', () => randomU32());
    const a2 = randomU32();
    const again = withDeterministic('a-semente-1', () => [randomU32(), randomU32()]);
    assert.deepEqual([a1, a2], again);
  });
  assert.throws(() => withDeterministic('x-semente-3', async () => 1), /síncrona/);
  assert.equal(withDeterministic(null, () => 7), 7);
});

test('route: casa parâmetros, decodifica e ignora querystring', () => {
  const r = compileRoute('/pelada/peladas/:id/days/:dayId/attendance/:pid');
  assert.deepEqual(matchRoute(r, '/pelada/peladas/PL-ABC234/days/d_1/attendance/u%3Apl_x'), { id: 'PL-ABC234', dayId: 'd_1', pid: 'u:pl_x' });
  assert.equal(matchRoute(r, '/pelada/peladas/PL-ABC234/days/d_1'), null);
  assert.deepEqual(matchRoute(compileRoute('/a/:id'), '/a/1?x=2'), { id: '1' });
});

test('armazenamento: memória e localStorage guardam cópias, ordenam por chave e apagam', async () => {
  const fakeLs = (() => { const m = new Map(); return { get length() { return m.size; }, key: i => [...m.keys()][i] ?? null, getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } }; })();
  for (const d of [memoryDriver(), localStorageDriver(fakeLs)]) {
    const v = { a: [1, 2], n: { x: 1 } };
    await d.put('outbox', 'b', v); await d.put('outbox', 'a', { z: 1 });
    v.a.push(3);
    assert.deepEqual((await d.get('outbox', 'b')).a, [1, 2], d.kind + ': guarda uma cópia');
    assert.deepEqual((await d.all('outbox')).map(r => r.key), ['a', 'b']);
    assert.equal(await d.get('outbox', 'nada'), undefined);
    await d.del('outbox', 'a');
    assert.equal((await d.all('outbox')).length, 1);
    await d.put('cache', 'k', 1); await d.clear('outbox');
    assert.equal((await d.all('outbox')).length, 0);
    assert.equal(await d.get('cache', 'k'), 1, d.kind + ': limpar um banco não mexe nos outros');
  }
});

test('selo de sincronização: texto e prioridade (entrar → sem internet → sincronizando → aguardando → problemas → ok)', () => {
  const s = (o = {}) => ({ online: true, syncing: false, needsLogin: false, pending: 0, failed: 0, ...o });
  assert.equal(describeStatus(s()), null, 'tudo em dia: selo escondido');
  assert.equal(describeStatus(s(), { justSynced: true }).state, 'ok');
  assert.match(describeStatus(s({ online: false })).text, /Sem internet · o app continua funcionando/);
  assert.match(describeStatus(s({ online: false, pending: 1 })).text, /1 alteração guardada/);
  assert.match(describeStatus(s({ online: false, pending: 5 })).text, /5 alterações guardadas/);
  assert.equal(describeStatus(s({ pending: 2 })).state, 'pending');
  assert.equal(describeStatus(s({ pending: 2, syncing: true })).state, 'syncing');
  assert.match(describeStatus(s({ failed: 1 })).text, /1 alteração não foi sincronizada/);
  assert.match(describeStatus(s({ failed: 3 })).text, /3 alterações não foram sincronizadas/);
  assert.equal(describeStatus(s({ pending: 2, needsLogin: true, online: false })).state, 'login');
  assert.equal(describeStatus(s({ pending: 2, syncing: true, online: false })).state, 'offline', 'tentativa de envio sem conexão não vira "sincronizando"');
  assert.equal(describeStatus(s({ online: false, pending: 2, failed: 1 })).state, 'offline');
});

test('ações da pelada: todas têm rota única, rótulo e as do dono recusam outras pessoas', () => {
  const keys = new Set(), routes = new Set();
  for (const a of PELADA_ACTIONS) {
    assert.ok(!keys.has(a.key) && !routes.has(a.method + a.path), 'duplicada: ' + a.key);
    keys.add(a.key); routes.add(a.method + a.path);
    assert.ok(typeof a.label === 'string' || typeof a.label === 'function');
  }
  const p = newPelada({ id: 'PL-ABC234', owner: { id: 'pl_dono' }, input: { name: 'Pelada X', gender: 'masculino', days: [{ date: '2030-01-05' }] } }, 1000);
  const dayId = getDay(p, p.days[0].id).id;
  const m = matchPeladaAction('POST', `/pelada/peladas/PL-ABC234/days/${dayId}/matches`);
  assert.equal(m.action.key, 'match.add');
  assert.throws(() => runPeladaAction(p, m.action, { params: m.params, body: {}, now: 2000, me: { id: 'pl_intruso' }, nameOf: () => '' }), e => e.status === 403);
  assert.equal(matchPeladaAction('GET', '/pelada/peladas/PL-ABC234'), null);
});

test('ações da pelada: mesma operação + mesmo documento ⇒ mesmo resultado (ids e horários), e o documento lembra só as últimas operações', () => {
  const make = () => newPelada({ id: 'PL-ABC234', owner: { id: 'pl_dono' }, input: { name: 'Pelada X', gender: 'masculino', matchMinutes: 10, days: [{ date: '2030-01-05' }] } }, 1000);
  const a = make(), b = make();
  const run = p => {
    const dayId = p.days[0].id;
    const m = matchPeladaAction('POST', `/pelada/peladas/PL-ABC234/days/${dayId}/presence`);
    runPeladaAction(p, m.action, { params: m.params, body: { present: true }, now: 5000, me: { id: 'pl_dono' }, nameOf: () => '' }, 'op-presenca-abc');
    rememberOp(p, 'op-presenca-abc');
    return p;
  };
  // os dois documentos nascem com ids de dia diferentes (aleatórios): compara só o que depende da operação
  assert.deepEqual(run(a).days[0].attendance, run(b).days[0].attendance);
  assert.ok(hasOp(a, 'op-presenca-abc') && !hasOp(a, 'outra'));
  for (let i = 0; i < MAX_OPS + 20; i++) rememberOp(a, 'op-' + i + '-xxxxxx');
  assert.equal(a.ops.length, MAX_OPS);
  assert.ok(!hasOp(a, 'op-presenca-abc'), 'as mais antigas saem');
});
