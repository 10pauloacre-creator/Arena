// Regras de domínio da pelada sem passar pela API: limites, fila com várias partidas montadas e consistência dos times.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newPelada, addDay, setPresence, addGuest, performDraw, createMatch, timerAction, addGoal, finishMatch, deleteMatch,
  assignPlayer, normalizeQueue, MAX_ATTENDANCE, MAX_MEMBERS, orgOf,
} from '../../lib/domain/pelada.js';
import { mulberry32 } from '../../public/assets/js/shared/pelada.js';

const NOW = Date.parse('2026-10-07T15:00:00Z');
const owner = { id: 'owner' };

function setup(count, min = 5) {
  const p = newPelada({ id: 'PL-TESTE2', owner, input: { name: 'Teste FC', gender: 'masculino', minPerTeam: min, matchMinutes: 10, days: [{ date: '2026-10-07' }] } }, NOW);
  const day = p.days[0];
  const users = Array.from({ length: count }, (_, i) => `u${i + 1}`);
  users.forEach(u => setPresence(p, day, u, true, NOW));
  const players = day.attendance.map(a => ({ pid: a.pid, name: `Jogador ${a.pid}`, guest: false }));
  performDraw(p, day, players, { by: 'owner', now: NOW, rnd: mulberry32(11) });
  return { p, day, users };
}
const score = (day, m, a, b, now) => {
  for (let i = 0; i < a; i++) addGoal(day, m, { teamId: m.a, pid: day.draw.teams.find(t => t.id === m.a).players[0] }, now);
  for (let i = 0; i < b; i++) addGoal(day, m, { teamId: m.b, pid: day.draw.teams.find(t => t.id === m.b).players[0] }, now);
};

test('limites: lista de presença, participantes e convidados', () => {
  const p = newPelada({ id: 'PL-TESTE3', owner, input: { name: 'Limite FC', gender: 'feminino', minPerTeam: 5, days: [{ date: '2026-10-07' }] } }, NOW);
  const day = p.days[0];
  for (let i = 0; i < MAX_ATTENDANCE; i++) setPresence(p, day, `x${i}`, true, NOW);
  assert.throws(() => setPresence(p, day, 'extra', true, NOW), /cheia/);
  // retirar libera vaga
  setPresence(p, day, 'x0', false, NOW);
  setPresence(p, day, 'extra', true, NOW);
  assert.ok(p.members.length <= MAX_MEMBERS);
  assert.throws(() => addGuest(p, day, 'Zé', undefined, NOW, () => ''), /cheia/);
});

test('data personalizada herda ou sobrescreve a organização padrão', () => {
  const p = newPelada({ id: 'PL-TESTE4', owner, input: { name: 'Org FC', gender: 'masculino', minPerTeam: 7, matchMinutes: 12, days: [{ date: '2026-10-07' }, { date: '2026-10-14', org: { minPerTeam: 4, noTeams: true } }] } }, NOW);
  assert.deepEqual(orgOf(p, p.days[0]), { minPerTeam: 7, noTeams: false, matchMinutes: 12 });
  assert.deepEqual(orgOf(p, p.days[1]), { minPerTeam: 4, noTeams: true, matchMinutes: 12 });
  assert.throws(() => addDay(p, { date: '2026-10-14' }, NOW), /Já existe/);
  assert.throws(() => addDay(p, { date: 'lixo' }, NOW), /inválida/);
  assert.throws(() => addDay(p, { date: '2026-10-21', org: { minPerTeam: 99 } }, NOW), /entre 2 e 15/);
});

test('duas partidas montadas: ao encerrar a primeira, os times entram na fila e a próxima sai quando a segunda terminar', () => {
  const { p, day } = setup(20); // 4 times de 5
  const [t1, t2, t3, t4] = day.draw.teams.map(t => t.id);
  const m1 = createMatch(p, day, { a: t1, b: t2 }, NOW);
  const m2 = createMatch(p, day, { a: t3, b: t4 }, NOW);
  assert.deepEqual(day.queue, []);
  timerAction(m1, { action: 'start' }, NOW);
  score(day, m1, 1, 0, NOW);
  const f1 = finishMatch(p, day, m1, { now: NOW + 1000 });
  assert.equal(f1.next, null); assert.equal(f1.info.planned, true); // já havia outra partida montada: não cria uma terceira
  assert.deepEqual(day.queue, [t1, t2]); // vencedor primeiro na fila
  assert.equal(day.matches.length, 2);
  timerAction(m2, { action: 'start' }, NOW);
  score(day, m2, 2, 1, NOW);
  const f2 = finishMatch(p, day, m2, { now: NOW + 2000 });
  assert.deepEqual([f2.next.a, f2.next.b], [t3, t1]); // t3 venceu e fica; entra o primeiro da fila
  assert.deepEqual(day.queue, [t2, t4]);
  assert.equal(day.matches.length, 3);
  assert.equal(day.streaks[t3], 1); assert.equal(day.streaks[t4], 0);
});

test('excluir partida encerrada não mexe na fila; excluir aberta devolve os times ao início', () => {
  const { p, day } = setup(15);
  const [t1, t2, t3] = day.draw.teams.map(t => t.id);
  const m = createMatch(p, day, { a: t1, b: t2 }, NOW);
  score(day, m, 1, 0, NOW);
  finishMatch(p, day, m, { now: NOW + 500 });
  const next = day.matches[1];
  assert.deepEqual([next.a, next.b], [t1, t3]);
  const before = [...day.queue];
  deleteMatch(day, m);
  assert.deepEqual(day.queue, before);
  deleteMatch(day, next);
  assert.deepEqual(day.queue.slice(0, 2), [t1, t3]); // quem ia jogar volta para o começo da fila
});

test('quem sai da lista deixa o time (capitão é trocado) e avulsos podem ser encaixados', () => {
  const { p, day } = setup(10);
  const t = day.draw.teams[0];
  const cap = t.captain, size = t.players.length;
  setPresence(p, day, cap.slice(2), false, NOW);
  assert.equal(t.players.length, size - 1);
  assert.ok(t.captain && t.captain !== cap && t.players.includes(t.captain));
  setPresence(p, day, 'late', true, NOW + 10);
  assert.deepEqual(day.attendance.filter(a => !day.draw.teams.some(x => x.players.includes(a.pid))).map(a => a.pid), ['u:late']);
  assignPlayer(day, 'u:late', t.id);
  assert.ok(t.players.includes('u:late'));
  normalizeQueue(day);
  assert.equal(new Set(day.queue).size, day.queue.length);
});

test('encerrar com tempo automático só vale depois de acabar o tempo e é limitado ao tempo regulamentar', () => {
  const { p, day } = setup(10);
  const m = createMatch(p, day, { a: day.draw.teams[0].id, b: day.draw.teams[1].id }, NOW);
  timerAction(m, { action: 'start' }, NOW);
  assert.throws(() => finishMatch(p, day, m, { auto: true, now: NOW + 5 * 60_000 }), /ainda não acabou/);
  const r = finishMatch(p, day, m, { auto: true, now: NOW + 10 * 60_000 + 3_000 });
  assert.equal(m.timer.elapsedMs, 10 * 60_000);
  assert.equal(r.info.reason, 'empate');
  assert.throws(() => timerAction(m, { action: 'start' }, NOW), /encerrada/);
});
