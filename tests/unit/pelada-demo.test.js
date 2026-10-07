// Pelada demo: jogo de hoje com 17 jogadores (nome em 2 palavras + foto) já confirmados, para testar o sorteio e as partidas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client } from './helpers.js';
import { setClock } from '../../lib/clock.js';
import { mulberry32 } from '../../public/assets/js/shared/pelada.js';
import { DEMO_SIZE, isDemoPlayerId, demoPlayer, demoAvatar, newDemoPelada } from '../../lib/domain/pelada-demo.js';

let srv;
before(async () => { srv = await startServer(); });
after(async () => { setClock(null); await srv.close(); });

let n = 0;
async function newPlayer(name) {
  const c = new Client(srv.base);
  const r = await c.post('/pelada/auth/signup', { name: name ?? `Dono Demo ${++n} Silva`, birth: '15/05/1992' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return c;
}
const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

test('elenco demo: IDs próprios, nomes de 2 palavras sem repetição e um avatar SVG para cada um', () => {
  const all = Array.from({ length: 60 }, (_, i) => `pl_demo${String(i).padStart(2, '0')}`).filter(isDemoPlayerId);
  assert.ok(all.length >= DEMO_SIZE, 'o elenco precisa ter jogadores de sobra para o sorteio variar');
  const names = all.map(id => demoPlayer(id).name);
  assert.equal(new Set(names).size, names.length, 'nomes repetidos');
  for (const name of names) assert.match(name, /^\S+ \S+$/u, `"${name}" não tem exatamente 2 nomes`);
  const avatars = all.map(id => demoAvatar(id));
  for (const a of avatars) {
    assert.equal(a.mime, 'image/svg+xml');
    const svg = Buffer.from(a.b64, 'base64').toString();
    assert.match(svg, /^<svg [^>]*viewBox="0 0 128 128"/);
    assert.ok(!/<script|\son[a-z]+=|href=/i.test(svg), 'SVG sem script nem links');
  }
  assert.equal(new Set(avatars.map(a => a.b64)).size, avatars.length, 'cada jogador tem uma foto diferente');
  // IDs reais de conta nunca colidem: têm 12 caracteres depois de "pl_" e o prefixo do demo é fixo
  assert.ok(!isDemoPlayerId('pl_Abc123Def456') && !isDemoPlayerId('pl_demo00') && !isDemoPlayerId('pl_demo99') && !isDemoPlayerId('u:pl_demo01'));
  assert.equal(demoPlayer('pl_qualquer'), null); assert.equal(demoAvatar('pl_qualquer'), null);
});

test('newDemoPelada: 17 confirmados de hoje, sem sorteio, e o elenco varia conforme o sorteio aleatório', () => {
  const owner = { id: 'pl_dono' };
  const mk = seed => newDemoPelada({ id: 'PL-ABC234', owner, date: '2026-10-07', rnd: mulberry32(seed) }, Date.UTC(2026, 9, 7, 15));
  const a = mk(1), b = mk(1), c = mk(2);
  assert.equal(a.demo, true);
  assert.equal(a.days.length, 1);
  const day = a.days[0];
  assert.equal(day.date, '2026-10-07');
  assert.equal(day.attendance.length, DEMO_SIZE);
  assert.equal(day.draw, null);
  assert.equal(new Set(day.attendance.map(x => x.pid)).size, DEMO_SIZE);
  assert.ok(day.attendance.every(x => x.pid.startsWith('u:pl_demo') && !x.guest));
  const times = day.attendance.map(x => x.at);
  assert.deepEqual(times, [...times].sort((x, y) => x - y), 'confirmações em ordem de chegada');
  assert.ok(times.every(t => t < Date.UTC(2026, 9, 7, 15)));
  assert.deepEqual(a.members.map(m => m.userId).slice(0, 1), ['pl_dono']);
  assert.equal(a.members.length, DEMO_SIZE + 1);
  assert.deepEqual(day.attendance.map(x => x.pid), b.days[0].attendance.map(x => x.pid), 'mesma semente, mesmo elenco');
  assert.notDeepEqual(day.attendance.map(x => x.pid), c.days[0].attendance.map(x => x.pid), 'outra semente, outro elenco');
});

test('POST /pelada/peladas/demo: exige conta, cria a pelada do dia com 17 jogadores com foto e entra em "Minhas peladas"', async () => {
  assert.equal((await new Client(srv.base).post('/pelada/peladas/demo')).status, 401);

  const owner = await newPlayer();
  const r = await owner.post('/pelada/peladas/demo');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const p = r.data.pelada, day = p.days[0];
  assert.equal(p.demo, true);
  assert.equal(p.name, 'Pelada Demo');
  assert.equal(p.gender, 'masculino');
  assert.equal(p.days.length, 1);
  assert.equal(day.id, r.data.dayId);
  assert.equal(day.date, today());
  assert.equal(day.isToday, true);
  assert.equal(day.attendance.length, DEMO_SIZE);
  assert.equal(day.draw, null);
  assert.equal(p.viewer.isOwner, true);
  assert.ok(p.invite?.url.endsWith(`/pelada/p/${p.id}`));

  // 17 pessoas com nome de 2 palavras e foto que de fato carrega
  for (const a of day.attendance) {
    const who = p.people[a.pid];
    assert.match(who.name, /^\S+ \S+$/u);
    assert.ok(who.av > 0 && !a.guest);
    const img = await fetch(`${srv.base}/pelada-img/u/${a.pid.slice(2)}?v=${who.av}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/svg+xml');
    assert.match(img.headers.get('cache-control'), /immutable/);
    assert.match(await img.text(), /^<svg /);
  }

  // aparece no painel com a marca de demonstração
  const mine = (await owner.get('/pelada/mine')).data;
  assert.deepEqual(mine.created.map(x => [x.id, x.demo]), [[p.id, true]]);
  // e uma pelada comum não é marcada
  const normal = await owner.post('/pelada/peladas', { name: 'Pelada Normal', gender: 'masculino', minPerTeam: 5, days: [{ date: today() }] });
  assert.equal(normal.data.pelada.demo, false);
  assert.equal((await owner.get('/pelada/mine')).data.created.find(x => x.id === normal.data.pelada.id).demo, false);
});

test('pelada demo: o dono sorteia 17 em 3 times (sobras distribuídas), cria partida e anota gol de quem veio da lista', async () => {
  const owner = await newPlayer();
  const { pelada: p, dayId } = (await owner.post('/pelada/peladas/demo')).data;
  const base = `/pelada/peladas/${p.id}/days/${dayId}`;

  const draw = await owner.post(`${base}/draw`);
  assert.equal(draw.status, 200, JSON.stringify(draw.data));
  const d = draw.data.pelada.days[0];
  assert.deepEqual(d.draw.teams.map(t => t.players.length).sort(), [5, 6, 6]);
  assert.equal(new Set(d.draw.teams.flatMap(t => t.players)).size, DEMO_SIZE);
  assert.ok(d.draw.teams.every(t => /^Time \d - \S+$/.test(t.label)), 'rótulo "Time N - Nome"');

  const [t1, t2] = d.draw.teams;
  const m = await owner.post(`${base}/matches`, { a: t1.id, b: t2.id });
  assert.equal(m.status, 200, JSON.stringify(m.data));
  const mid = m.data.matchId;
  const scorer = t1.players[0];
  const g = await owner.post(`${base}/matches/${mid}/goals`, { teamId: t1.id, pid: scorer });
  assert.equal(g.status, 200, JSON.stringify(g.data));
  const ranking = g.data.pelada.days[0].ranking;
  assert.deepEqual(ranking.map(r => [r.pid, r.goals]), [[scorer, 1]]);
  assert.ok(g.data.pelada.people[scorer].name, 'artilheiro com nome');
});

test('excluir a pelada demo não deixa rastro; jogadores demo não entram por login nem reservam nomes', async () => {
  const owner = await newPlayer();
  const { pelada: p } = (await owner.post('/pelada/peladas/demo')).data;
  const names = p.days[0].attendance.map(a => p.people[a.pid].name);

  assert.equal((await owner.del(`/pelada/peladas/${p.id}`)).status, 200);
  assert.equal((await owner.get('/pelada/mine')).data.created.length, 0);
  assert.equal((await owner.get(`/pelada/peladas/${p.id}`)).status, 404);
  for (const k of ['pum:pl_demo01', 'pu:pl_demo01', 'pua:pl_demo01']) assert.ok(!(await srv.store.get(k)), `${k} não deveria existir no banco`);

  // um nome do elenco continua livre para uma conta real, e a conta demo não tem como logar
  const real = names[0];
  const signup = await new Client(srv.base).post('/pelada/auth/signup', { name: real, birth: '01/01/1990' });
  assert.equal(signup.status, 200, 'nome do elenco demo não fica reservado');
  assert.equal((await new Client(srv.base).post('/pelada/auth/login', { name: 'Fantasma Qualquer', secret: '01011990' })).status, 401);
});

test('limite de peladas demo por hora e por pessoa', async () => {
  const owner = await newPlayer();
  for (let i = 0; i < 10; i++) assert.equal((await owner.post('/pelada/peladas/demo')).status, 200);
  assert.equal((await owner.post('/pelada/peladas/demo')).status, 429);
  const other = await newPlayer();
  assert.equal((await other.post('/pelada/peladas/demo')).status, 200);
});
