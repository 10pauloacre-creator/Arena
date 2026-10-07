// Regras de domínio da pelada sem passar pela API: limites, fila com várias partidas montadas e consistência dos times.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newPelada, addDay, setPresence, addGuest, performDraw, createMatch, timerAction, addGoal, removeGoal, finishMatch, deleteMatch,
  assignPlayer, normalizeQueue, MAX_ATTENDANCE, MAX_MEMBERS, orgOf, freePids, removeMember, setLoan,
} from '../../lib/domain/pelada.js';
import { mulberry32 } from '../../public/assets/js/shared/pelada.js';

const NOW = Date.parse('2026-10-07T15:00:00Z');
const owner = { id: 'owner' };

function setup(count, min = 5, auto = {}) {
  const p = newPelada({ id: 'PL-TESTE2', owner, input: { name: 'Teste FC', gender: 'masculino', minPerTeam: min, matchMinutes: 10, ...auto, days: [{ date: '2026-10-07' }] } }, NOW);
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
  assert.deepEqual(orgOf(p, p.days[0]), { minPerTeam: 7, noTeams: false, matchMinutes: 12, autoDraw: false, autoEvery: 1 });
  assert.deepEqual(orgOf(p, p.days[1]), { minPerTeam: 4, noTeams: true, matchMinutes: 12, autoDraw: false, autoEvery: 1 });
  assert.throws(() => addDay(p, { date: '2026-10-14' }, NOW), /Já existe/);
  assert.throws(() => addDay(p, { date: 'lixo' }, NOW), /inválida/);
  assert.throws(() => addDay(p, { date: '2026-10-21', org: { minPerTeam: 99 } }, NOW), /entre 2 e 15/);
});

test('sorteio automático na configuração: padrão da pelada, personalizado por data e validação (1, 2, 3 ou nunca)', () => {
  const p = newPelada({ id: 'PL-TESTE5', owner, input: { name: 'Auto FC', gender: 'masculino', minPerTeam: 5, autoDraw: true, autoEvery: 2, days: [{ date: '2026-10-07' }, { date: '2026-10-14', org: { autoEvery: 0 } }, { date: '2026-10-21', org: { autoDraw: false } }] } }, NOW);
  assert.equal(p.autoDraw, true); assert.equal(p.autoEvery, 2);
  assert.deepEqual([orgOf(p, p.days[0]).autoDraw, orgOf(p, p.days[0]).autoEvery], [true, 2]);
  assert.deepEqual([orgOf(p, p.days[1]).autoDraw, orgOf(p, p.days[1]).autoEvery], [true, 0]); // nunca sortear
  assert.deepEqual([orgOf(p, p.days[2]).autoDraw, orgOf(p, p.days[2]).autoEvery], [false, 2]);
  assert.throws(() => newPelada({ id: 'PL-TESTE6', owner, input: { name: 'Auto FC', gender: 'masculino', minPerTeam: 5, autoEvery: 4 } }, NOW), /entre 0 e 3/);
  // pelada antiga (sem os campos) segue valendo: desligado, a cada 1
  const old = { ...p, autoDraw: undefined, autoEvery: undefined };
  assert.deepEqual([orgOf(old, { org: null }).autoDraw, orgOf(old, { org: null }).autoEvery], [false, 1]);
});

test('sorteio forma times completos e a sobra é a Cerca (convidados e retardatários entram nela)', () => {
  const { p, day } = setup(12); // 2 times de 5 + 2 na Cerca
  assert.deepEqual(day.draw.teams.map(t => t.players.length), [5, 5]);
  assert.equal(freePids(day).length, 2);
  assert.ok(day.draw.notes.some(n => /Cerca/.test(n)));
  setPresence(p, day, 'late', true, NOW + 10);
  assert.ok(freePids(day).includes('u:late'));
  addGuest(p, day, 'Zé Convidado', 'free', NOW + 20, () => '');
  assert.equal(freePids(day).length, 4);
  assert.ok(day.draw.teams.every(t => t.incomplete === undefined && t.players.length === 5));
});

const allPids = day => [...day.draw.teams.flatMap(t => t.players), ...freePids(day)].sort();
const nameOf = pid => `Jogador ${pid}`;

test('rotação da Cerca com 2 times: vencedor fica; a Cerca entra no time que perdeu e os substituídos viram a nova Cerca', () => {
  const { p, day } = setup(12, 5, { autoDraw: true, autoEvery: 1 });
  const [t1, t2] = day.draw.teams;
  const before = allPids(day), fence = freePids(day), loserPlayers = [...t2.players], winnerPlayers = [...t1.players];
  const m = createMatch(p, day, { a: t1.id, b: t2.id }, NOW);
  timerAction(m, { action: 'start' }, NOW);
  score(day, m, 2, 0, NOW);
  const r = finishMatch(p, day, m, { now: NOW + 1000, rnd: mulberry32(5), nameOf });
  assert.equal(r.info.reason, 'venceu');
  assert.ok(r.info.rotation);
  assert.deepEqual(day.draw.teams.find(t => t.id === t1.id).players, winnerPlayers, 'o vencedor mantém os jogadores');
  const lead = day.draw.teams.find(t => t.id === t2.id); // o time novo tem o número do que perdeu
  assert.ok(fence.every(pid => lead.players.includes(pid)), 'a Cerca entra obrigatoriamente');
  assert.equal(lead.players.length, 5);
  const newFence = freePids(day);
  assert.equal(newFence.length, 2);
  assert.ok(newFence.every(pid => loserPlayers.includes(pid)), 'os substituídos do time que perdeu viram a nova Cerca');
  assert.deepEqual(allPids(day), before, 'ninguém some nem se repete');
  assert.deepEqual([r.next.a, r.next.b], [t1.id, t2.id]);
  assert.equal(day.sinceDraw, 0);
  assert.ok(day.draw.log.at(-1).includes('Nova Cerca'));
  assert.ok(lead.players.includes(lead.captain) && fence.includes(lead.captain), 'o capitão é um dos integrantes principais (quem veio da Cerca)');
  // a partida encerrada guarda os elencos de quem jogou
  assert.deepEqual(m.rosters[t2.id].players, loserPlayers);
  assert.deepEqual(m.rosters[t1.id].players, winnerPlayers);
});

test('rotação da Cerca com mais de 2 times: a Cerca vira um time completado por sorteio, com número e capitão', () => {
  const { p, day } = setup(17, 5, { autoDraw: true, autoEvery: 1 }); // 3 times + Cerca de 2
  const [t1, t2, t3] = day.draw.teams;
  const before = allPids(day), fence = freePids(day), winnerPlayers = [...t1.players];
  const m = createMatch(p, day, { a: t1.id, b: t2.id }, NOW);
  timerAction(m, { action: 'start' }, NOW);
  score(day, m, 1, 0, NOW);
  const r = finishMatch(p, day, m, { now: NOW + 1000, rnd: mulberry32(9), nameOf });
  assert.ok(r.info.rotation);
  assert.deepEqual(day.draw.teams.map(t => t.number), [1, 2, 3]);
  assert.deepEqual(day.draw.teams.find(t => t.id === t1.id).players, winnerPlayers);
  const lead = day.draw.teams.find(t => t.id === r.next.b);
  assert.equal(lead.id, t2.id); // ganha o número do time que perdeu
  assert.ok(fence.every(pid => lead.players.includes(pid)));
  assert.equal(lead.players.length, 5);
  assert.ok(lead.captain && lead.players.includes(lead.captain));
  assert.deepEqual(day.draw.teams.map(t => t.players.length), [5, 5, 5]);
  assert.equal(freePids(day).length, 2);
  // a nova Cerca sai dos times que estavam fora (o que perdeu e o que esperava), nunca do vencedor
  const outBefore = new Set([...t2.players, ...t3.players]);
  assert.ok(freePids(day).every(pid => outBefore.has(pid)));
  assert.deepEqual(allPids(day), before);
  // o time que esperava foi sorteado de novo: a fila tem o outro time novo
  assert.deepEqual(day.queue, [t3.id]);
  assert.equal(day.streaks[t1.id], 1);
  assert.equal(day.streaks[t2.id], 0);
});

test('sorteio automático a cada N partidas; desligado ou "nunca" mantém a fila clássica e a Cerca espera', () => {
  const play = (day, p, m, goalsA = 1) => { timerAction(m, { action: 'start' }, NOW); score(day, m, goalsA, 0, NOW); return finishMatch(p, day, m, { now: NOW + 1000, rnd: mulberry32(3), nameOf }); };
  // a cada 2 partidas
  let { p, day } = setup(17, 5, { autoDraw: true, autoEvery: 2 });
  const fence0 = freePids(day), [t1, t2, t3] = day.draw.teams.map(t => t.id);
  const m1 = createMatch(p, day, { a: t1, b: t2 }, NOW);
  const r1 = play(day, p, m1);
  assert.equal(r1.info.rotation, null);           // 1ª partida: fila clássica
  assert.deepEqual([r1.next.a, r1.next.b], [t1, t3]);
  assert.deepEqual(freePids(day), fence0);          // a Cerca continua esperando
  assert.equal(day.sinceDraw, 1);
  const r2 = play(day, p, r1.next);
  assert.ok(r2.info.rotation);                      // 2ª partida: sorteio automático
  assert.equal(day.sinceDraw, 0);
  assert.ok(fence0.every(pid => day.draw.teams.find(t => t.id === r2.next.b).players.includes(pid)));
  // desligado
  ({ p, day } = setup(17, 5, { autoDraw: false, autoEvery: 1 }));
  const fence1 = freePids(day);
  const [a1, b1] = day.draw.teams.map(t => t.id);
  const off = play(day, p, createMatch(p, day, { a: a1, b: b1 }, NOW));
  assert.equal(off.info.rotation, null); assert.deepEqual(freePids(day), fence1);
  // ligado, mas "nunca"
  ({ p, day } = setup(17, 5, { autoDraw: true, autoEvery: 0 }));
  const never = play(day, p, createMatch(p, day, { a: day.draw.teams[0].id, b: day.draw.teams[1].id }, NOW));
  assert.equal(never.info.rotation, null);
});

test('sorteio manual segue ativo com partida em andamento: times em quadra se mantêm e a Cerca é obrigatória na próxima composição', () => {
  const { p, day } = setup(17, 5, { autoDraw: true, autoEvery: 0 });
  const [t1, t2, t3] = day.draw.teams;
  const m = createMatch(p, day, { a: t1.id, b: t2.id }, NOW);
  timerAction(m, { action: 'start' }, NOW);
  const playing = [...t1.players, ...t2.players], fence = freePids(day), idsBefore = day.draw.id;
  const players = day.attendance.map(a => ({ pid: a.pid, name: nameOf(a.pid), guest: false }));
  const draw = performDraw(p, day, players, { by: 'owner', now: NOW + 5000, rnd: mulberry32(21) });
  assert.notEqual(draw.id, idsBefore);
  assert.deepEqual(day.draw.teams.find(t => t.id === t1.id).players, t1.players);
  assert.deepEqual(day.draw.teams.find(t => t.id === t2.id).players, t2.players);
  const next = day.draw.teams.find(t => t.id === t3.id); // o time de fora foi sorteado de novo (mesmo número)
  assert.ok(fence.every(pid => next.players.includes(pid)), 'a Cerca entra na próxima composição (sorteio automático marcado)');
  assert.equal(next.players.length, 5);
  assert.ok(freePids(day).every(pid => !playing.includes(pid)), 'quem está em quadra não vai para a Cerca');
  assert.deepEqual(day.queue, [t3.id]);
  assert.equal(allPids(day).length, 17);
  // sem o sorteio automático marcado, a Cerca não tem entrada garantida
  const free = setup(17, 5, { autoDraw: false });
  const mm = createMatch(free.p, free.day, { a: free.day.draw.teams[0].id, b: free.day.draw.teams[1].id }, NOW);
  timerAction(mm, { action: 'start' }, NOW);
  let leftOut = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const f = setup(17, 5, { autoDraw: false });
    const x = createMatch(f.p, f.day, { a: f.day.draw.teams[0].id, b: f.day.draw.teams[1].id }, NOW);
    timerAction(x, { action: 'start' }, NOW);
    const fence2 = freePids(f.day);
    performDraw(f.p, f.day, f.day.attendance.map(a => ({ pid: a.pid, name: nameOf(a.pid) })), { by: 'owner', now: NOW, rnd: mulberry32(seed) });
    if (freePids(f.day).some(pid => fence2.includes(pid))) leftOut++;
  }
  assert.ok(leftOut > 0, 'sem a opção marcada, quem estava na Cerca pode ficar de fora de novo');
});

test('sorteio entre partidas: o vencedor que continua na próxima partida se mantém e a partida ganha o novo desafiante', () => {
  const { p, day } = setup(17, 5, { autoDraw: false });
  const [t1, t2] = day.draw.teams.map(t => t.id);
  const m = createMatch(p, day, { a: t1, b: t2 }, NOW);
  timerAction(m, { action: 'start' }, NOW);
  score(day, m, 1, 0, NOW);
  const r = finishMatch(p, day, m, { now: NOW + 1000, nameOf });
  const winner = [...day.draw.teams.find(t => t.id === t1).players];
  performDraw(p, day, day.attendance.map(a => ({ pid: a.pid, name: nameOf(a.pid) })), { by: 'owner', now: NOW + 2000, rnd: mulberry32(2) });
  assert.deepEqual(day.draw.teams.find(t => t.id === t1).players, winner);
  assert.equal(r.next.a, t1); assert.ok(r.next.b && r.next.b !== t1);
  assert.equal(allPids(day).length, 17);
});

test('partida encerrada pode ser corrigida: gols de quem jogou (elenco da época) e placar recalculado', () => {
  const { p, day } = setup(12, 5, { autoDraw: true, autoEvery: 1 });
  const [t1, t2] = day.draw.teams;
  const outsider = freePids(day)[0]; // estava na Cerca durante a partida
  const m = createMatch(p, day, { a: t1.id, b: t2.id }, NOW);
  timerAction(m, { action: 'start' }, NOW);
  score(day, m, 1, 0, NOW);
  finishMatch(p, day, m, { now: NOW + 1000, rnd: mulberry32(6), nameOf });
  assert.deepEqual(m.result, { a: 1, b: 0 });
  const oldTeammate = m.rosters[t2.id].players[0]; // hoje esse jogador pode estar em outro time/Cerca
  addGoal(day, m, { teamId: t2.id, pid: oldTeammate }, NOW + 2000);
  addGoal(day, m, { teamId: t2.id, pid: null }, NOW + 2000);
  assert.deepEqual(m.result, { a: 1, b: 2 });
  removeGoal(m, m.goals[0].id);
  assert.deepEqual(m.result, { a: 0, b: 2 });
  assert.throws(() => addGoal(day, m, { teamId: t1.id, pid: m.rosters[t2.id].players[1] }, NOW), /não está neste time/);
  // jogador de fora também pode ser lançado depois do apito
  setLoan(day, m, { teamId: t1.id, pid: outsider });
  addGoal(day, m, { teamId: t1.id, pid: outsider }, NOW + 3000);
  assert.deepEqual(m.result, { a: 1, b: 2 });
});

test('sair da pelada: tira o jogador das listas de hoje em diante, não mexe nos gols e o organizador não sai', () => {
  const p = newPelada({ id: 'PL-TESTE7', owner, input: { name: 'Sai FC', gender: 'masculino', minPerTeam: 5, days: [{ date: '2026-10-01' }, { date: '2026-10-07' }, { date: '2026-10-14' }] } }, NOW);
  const [past, today, future] = p.days;
  for (const d of p.days) setPresence(p, d, 'ze', true, NOW);
  past.looseGoals['u:ze'] = 3;
  assert.throws(() => removeMember(p, 'owner', '2026-10-07'), /não pode sair/);
  assert.throws(() => removeMember(p, 'ninguem', '2026-10-07'), /não participa/);
  removeMember(p, 'ze', '2026-10-07');
  assert.ok(!p.members.some(m => m.userId === 'ze'));
  assert.ok(past.attendance.some(a => a.pid === 'u:ze'), 'histórico de datas passadas fica');
  assert.ok(!today.attendance.some(a => a.pid === 'u:ze') && !future.attendance.some(a => a.pid === 'u:ze'));
  assert.equal(past.looseGoals['u:ze'], 3);
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
