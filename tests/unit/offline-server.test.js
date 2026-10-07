// Servidor para o modo offline: operações idempotentes (X-Op-Id), horário da ação (X-Op-At), ids determinísticos e réplica do documento.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, signup, teamInput } from './helpers.js';
import { setClock } from '../../lib/clock.js';

let S;
before(async () => { S = await startServer(); });
after(async () => { setClock(null); await S.close(); });

const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
let n = 0;
async function player(name) {
  const c = new Client(S.base);
  const r = await c.post('/pelada/auth/signup', { name: name ?? `Jogador Offline ${++n} Silva`, birth: '15/05/1992' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  c.player = r.data.player;
  return c;
}
async function peladaWith(count = 6, { min = 3 } = {}) {
  const owner = await player(`Dono Offline ${++n} Souza`);
  const r = await owner.post('/pelada/peladas', { name: 'Pelada Offline', gender: 'masculino', minPerTeam: min, matchMinutes: 10, days: [{ date: today(), matches: 0 }] });
  const id = r.data.pelada.id, dayId = r.data.pelada.days[0].id;
  const all = [owner];
  for (let i = 1; i < count; i++) all.push(await player(`Atleta Offline ${++n} Lima`));
  for (const p of all) await p.post(`/pelada/peladas/${id}/days/${dayId}/presence`, { present: true });
  const base = `/pelada/peladas/${id}/days/${dayId}`;
  return { owner, all, id, dayId, base };
}
const op = (id, at) => ({ headers: { 'X-Op-Id': id, ...(at ? { 'X-Op-At': String(at) } : {}) } });

test('réplica: só vem quando pedida e quando a versão do aparelho está desatualizada', async () => {
  const s = await peladaWith(4);
  const plain = await s.owner.get(`/pelada/peladas/${s.id}`);
  assert.equal(plain.data.replica, undefined);

  const first = await s.owner.get(`/pelada/peladas/${s.id}`, { headers: { 'X-Replica': '0' } });
  assert.equal(first.status, 200);
  const { doc, users } = first.data.replica;
  assert.equal(doc.id, s.id);
  assert.ok(doc.version >= 1);
  assert.equal(doc.days[0].attendance.length, 4);
  assert.equal(users[s.owner.player.id].name, s.owner.player.name);

  // mesma versão: 304 pela etag (nada mudou) e, sem etag, 200 sem réplica
  const again = await s.owner.get(`/pelada/peladas/${s.id}`, { headers: { 'X-Replica': String(doc.version), 'If-None-Match': first.headers.get('etag') } });
  assert.equal(again.status, 304);
  const noEtag = await s.owner.get(`/pelada/peladas/${s.id}`, { headers: { 'X-Replica': String(doc.version) } });
  assert.equal(noEtag.status, 200);
  assert.equal(noEtag.data.replica, undefined);
});

test('operação repetida (mesmo X-Op-Id) não duplica gol nem muda nada', async () => {
  const s = await peladaWith(6);
  assert.equal((await s.owner.post(`${s.base}/draw`, {})).status, 200);
  const view = (await s.owner.get(`/pelada/peladas/${s.id}`)).data.pelada;
  const [t1, t2] = view.days[0].draw.teams;
  const mid = (await s.owner.post(`${s.base}/matches`, { a: t1.id, b: t2.id })).data.matchId;
  assert.equal((await s.owner.post(`${s.base}/matches/${mid}/timer`, { action: 'start' })).status, 200);

  const goal = { teamId: t1.id, pid: t1.players[0] };
  const a = await s.owner.post(`${s.base}/matches/${mid}/goals`, goal, op('op-gol-0001'));
  assert.equal(a.status, 200);
  assert.equal(a.data.replayed, undefined);
  const again = await s.owner.post(`${s.base}/matches/${mid}/goals`, goal, op('op-gol-0001'));
  assert.equal(again.status, 200);
  assert.equal(again.data.replayed, true);
  const m = again.data.pelada.days[0].matches.find(x => x.id === mid);
  assert.equal(m.goals.length, 1);
  assert.equal(m.score.a, 1);

  // outra operação (id diferente) conta normalmente
  const b = await s.owner.post(`${s.base}/matches/${mid}/goals`, goal, op('op-gol-0002'));
  assert.equal(b.data.pelada.days[0].matches.find(x => x.id === mid).goals.length, 2);
});

test('a repetição também vale para quem não é o dono (presença) e o documento guarda só as últimas operações', async () => {
  const s = await peladaWith(3);
  const late = await player();
  const r1 = await late.post(`${s.base}/presence`, { present: true }, op('op-presenca-1'));
  assert.equal(r1.status, 200);
  const r2 = await late.post(`${s.base}/presence`, { present: true }, op('op-presenca-1'));
  assert.equal(r2.data.replayed, true);
  const rep = (await s.owner.get(`/pelada/peladas/${s.id}`, { headers: { 'X-Replica': '0' } })).data.replica;
  assert.equal(rep.doc.days[0].attendance.length, 4);
  assert.ok(rep.doc.ops.includes('op-presenca-1'));
  assert.ok(rep.doc.ops.length <= 100);
});

test('X-Op-At: o cronômetro usa a hora em que a ação foi feita no aparelho (e ignora horas absurdas)', async () => {
  const s = await peladaWith(6);
  await s.owner.post(`${s.base}/draw`, {});
  const view = (await s.owner.get(`/pelada/peladas/${s.id}`)).data.pelada;
  const [t1, t2] = view.days[0].draw.teams;
  const mid = (await s.owner.post(`${s.base}/matches`, { a: t1.id, b: t2.id })).data.matchId;
  const t0 = Date.now() - 5 * 60_000;
  const start = await s.owner.post(`${s.base}/matches/${mid}/timer`, { action: 'start' }, op('op-inicio-0001', t0));
  assert.equal(start.data.pelada.days[0].matches[0].timer.startedAt, t0);
  const pause = await s.owner.post(`${s.base}/matches/${mid}/timer`, { action: 'pause' }, op('op-pausa-00001', t0 + 90_000));
  const timer = pause.data.pelada.days[0].matches[0].timer;
  assert.equal(timer.elapsedMs, 90_000);
  assert.equal(timer.startedAt, null);

  // hora no futuro distante → ignorada (vale a do servidor)
  const before = Date.now();
  const bad = await s.owner.post(`${s.base}/matches/${mid}/timer`, { action: 'start' }, op('op-futuro-0001', Date.now() + 3 * 86400_000));
  assert.ok(bad.data.pelada.days[0].matches[0].timer.startedAt >= before);
});

test('ids criados na operação são determinísticos: o mesmo X-Op-Id gera o mesmo id em qualquer pelada', async () => {
  const a = await peladaWith(6), b = await peladaWith(6);
  const ids = [];
  for (const s of [a, b]) {
    await s.owner.post(`${s.base}/draw`, {}, op('op-sorteio-0001'));
    const v = (await s.owner.get(`/pelada/peladas/${s.id}`)).data.pelada;
    const [t1, t2] = v.days[0].draw.teams;
    const r = await s.owner.post(`${s.base}/matches`, { a: t1.id, b: t2.id }, op('op-partida-0001'));
    ids.push(r.data.matchId);
  }
  assert.equal(ids[0], ids[1]);
  assert.match(ids[0], /^m_[a-z0-9]{5}$/);
});

test('torneio: a mesma operação enviada de novo não repete o lance; a réplica só vai para administradores', async () => {
  const org = await signup(S.base);
  const t = (await org.post('/tournaments', { name: 'Copa Offline Teste', sport: 'futsal', finalDate: '2026-12-12' })).data.tournament;
  await org.patch(`/tournaments/${t.id}`, { maxTeams: 4 });
  for (let i = 0; i < 4; i++) assert.equal((await org.post(`/tournaments/${t.id}/teams`, teamInput(`Equipe ${i}x`, 'futsal', { offset: i }))).status, 200);
  const drawn = await org.post(`/tournaments/${t.id}/draw`, {}, op('op-sorteio-t001'));
  assert.equal(drawn.status, 200);
  const key = drawn.data.tournament.bracket.rounds[0].matches[0].key;

  assert.equal((await org.post(`/tournaments/${t.id}/matches/${key}`, { action: 'start' }, op('op-inicio-t001'))).status, 200);
  const ev = { action: 'event', type: 'goal', team: 'a' };
  const one = await org.post(`/tournaments/${t.id}/matches/${key}`, ev, op('op-lance-t0001'));
  const two = await org.post(`/tournaments/${t.id}/matches/${key}`, ev, op('op-lance-t0001'));
  assert.equal(two.data.replayed, true);
  const goals = x => x.data.tournament.bracket.rounds[0].matches[0].events.filter(e => e.type === 'goal').length;
  assert.equal(goals(one), 1);
  assert.equal(goals(two), 1);

  const rep = await org.get(`/tournaments/${t.id}`, { headers: { 'X-Replica': '0' } });
  assert.equal(rep.data.replica.doc.id, t.id);
  assert.ok(rep.data.replica.doc.ops.includes('op-lance-t0001'));
  const users = Object.values(rep.data.replica.users);
  assert.ok(users.length >= 1 && users.every(u => !('passHash' in u)), 'a réplica não pode levar dados de senha');
  assert.equal(JSON.stringify(rep.data.replica).includes('passHash'), false);

  const stranger = await signup(S.base);
  assert.equal((await stranger.get(`/tournaments/${t.id}`, { headers: { 'X-Replica': '0' } })).status, 403);
});

test('torneio: X-Op-At define o relógio do lance (minuto do jogo conta a partir da hora real da ação)', async () => {
  const org = await signup(S.base);
  const t = (await org.post('/tournaments', { name: 'Copa do Relógio', sport: 'futsal', finalDate: '2026-12-12' })).data.tournament;
  await org.patch(`/tournaments/${t.id}`, { maxTeams: 4 });
  for (let i = 0; i < 4; i++) await org.post(`/tournaments/${t.id}/teams`, teamInput(`Time ${i}r`, 'futsal', { offset: i }));
  const key = (await org.post(`/tournaments/${t.id}/draw`)).data.tournament.bracket.rounds[0].matches[0].key;
  const t0 = Date.now() - 20 * 60_000;
  await org.post(`/tournaments/${t.id}/matches/${key}`, { action: 'start' }, op('op-inicio-t002', t0));
  const r = await org.post(`/tournaments/${t.id}/matches/${key}`, { action: 'event', type: 'goal', team: 'b' }, op('op-lance-t0002', t0 + 7 * 60_000 + 1000));
  const ev = r.data.tournament.bracket.rounds[0].matches[0].events.find(e => e.type === 'goal');
  assert.equal(ev.min, 8); // 7 min e 1 s de jogo → 8º minuto
  assert.equal(ev.at, t0 + 7 * 60_000 + 1000);
});
