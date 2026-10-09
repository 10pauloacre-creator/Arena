// Regras de domínio da pelada sem passar pela API: limites, fila com várias partidas montadas e consistência dos times.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newPelada, addDay, setPresence, addGuest, performDraw, createMatch, timerAction, addGoal, removeGoal, finishMatch, deleteMatch,
  assignPlayer, normalizeQueue, MAX_ATTENDANCE, MAX_MEMBERS, orgOf, freePids, removeMember, setLoan, manualDraw, settleArrivals, fixTeams, unfixTeams,
} from '../../lib/domain/pelada.js';
import { dayStats, pairHistory } from '../../lib/domain/pelada-engine.js';
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
  assert.deepEqual(orgOf(p, p.days[0]), { minPerTeam: 7, noTeams: false, matchMinutes: 12, autoDraw: false, generalDraw: false, generalEvery: 3 });
  assert.deepEqual(orgOf(p, p.days[1]), { minPerTeam: 4, noTeams: true, matchMinutes: 12, autoDraw: false, generalDraw: false, generalEvery: 3 });
  assert.throws(() => addDay(p, { date: '2026-10-14' }, NOW), /Já existe/);
  assert.throws(() => addDay(p, { date: 'lixo' }, NOW), /inválida/);
  assert.throws(() => addDay(p, { date: '2026-10-21', org: { minPerTeam: 99 } }, NOW), /entre 2 e 15/);
});

test('sorteios automáticos na configuração: padrão da pelada, personalizado por data e validação (geral a cada 1 a 10 partidas)', () => {
  const p = newPelada({ id: 'PL-TESTE5', owner, input: { name: 'Auto FC', gender: 'masculino', minPerTeam: 5, autoDraw: true, generalDraw: true, generalEvery: 2, days: [{ date: '2026-10-07' }, { date: '2026-10-14', org: { generalEvery: 5 } }, { date: '2026-10-21', org: { autoDraw: false, generalDraw: false } }] } }, NOW);
  assert.deepEqual([p.autoDraw, p.generalDraw, p.generalEvery], [true, true, 2]);
  const org = i => orgOf(p, p.days[i]);
  assert.deepEqual([org(0).autoDraw, org(0).generalDraw, org(0).generalEvery], [true, true, 2]);
  assert.deepEqual([org(1).autoDraw, org(1).generalDraw, org(1).generalEvery], [true, true, 5]);
  assert.deepEqual([org(2).autoDraw, org(2).generalDraw, org(2).generalEvery], [false, false, 2]);
  assert.throws(() => newPelada({ id: 'PL-TESTE6', owner, input: { name: 'Auto FC', gender: 'masculino', minPerTeam: 5, generalEvery: 11 } }, NOW), /entre 1 e 10/);
  assert.throws(() => newPelada({ id: 'PL-TESTE6', owner, input: { name: 'Auto FC', gender: 'masculino', minPerTeam: 5, generalEvery: 0 } }, NOW), /entre 1 e 10/);
  // pelada antiga (sem os campos) segue valendo: tudo desligado, geral a cada 3
  const old = { ...p, autoDraw: undefined, generalDraw: undefined, generalEvery: undefined };
  assert.deepEqual([orgOf(old, { org: null }).autoDraw, orgOf(old, { org: null }).generalDraw, orgOf(old, { org: null }).generalEvery], [false, false, 3]);
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

const play = (p, day, m, ga = 1, gb = 0, now = NOW, rnd = mulberry32(3)) => { timerAction(m, { action: 'start' }, now); score(day, m, ga, gb, now); return finishMatch(p, day, m, { now: now + 1000, rnd, nameOf }); };

test('sorteio da Cerca com 2 times: vencedor fica; a Cerca entra no time que perdeu no lugar de quem mais fez gols e os substituídos viram a nova Cerca', () => {
  const { p, day } = setup(12, 5, { autoDraw: true });
  const [t1, t2] = day.draw.teams;
  const before = allPids(day), fence = freePids(day), loserPlayers = [...t2.players], winnerPlayers = [...t1.players];
  const m = createMatch(p, day, { a: t1.id, b: t2.id }, NOW);
  timerAction(m, { action: 'start' }, NOW);
  score(day, m, 3, 0, NOW);
  addGoal(day, m, { teamId: t2.id, pid: loserPlayers[0] }, NOW); // o perdedor também fez um gol: quem faz gols sai primeiro
  addGoal(day, m, { teamId: t2.id, pid: loserPlayers[1] }, NOW);
  const r = finishMatch(p, day, m, { now: NOW + 1000, rnd: mulberry32(5), nameOf });
  assert.equal(r.info.reason, 'venceu');
  assert.equal(r.info.rotation.kind, 'fence');
  assert.deepEqual(day.draw.teams.find(t => t.id === t1.id).players, winnerPlayers, 'o vencedor mantém os jogadores');
  const lead = day.draw.teams.find(t => t.id === t2.id); // o time perdedor mantém a identidade (id, número, nome) com novos integrantes
  assert.ok(fence.every(pid => lead.players.includes(pid)), 'a Cerca entra obrigatoriamente');
  assert.equal(lead.players.length, 5);
  const newFence = freePids(day);
  assert.equal(newFence.length, 2);
  assert.deepEqual([...newFence].sort(), [loserPlayers[0], loserPlayers[1]].sort(), 'saem os que mais fizeram gols');
  assert.deepEqual(allPids(day), before, 'ninguém some nem se repete');
  assert.deepEqual([r.next.a, r.next.b], [t1.id, t2.id]);
  assert.equal(r.next.stay, t1.id);
  assert.ok(day.draw.log.at(-1).includes('Nova Cerca'));
  assert.deepEqual(m.rosters[t2.id].players, loserPlayers); // a súmula guarda quem jogou
  assert.deepEqual(m.rosters[t1.id].players, winnerPlayers);
  assert.deepEqual(r.info.rotation.fenceIn.sort(), [...fence].sort());
  assert.deepEqual(r.info.rotation.fenceOut.sort(), [...newFence].sort());
});

test('sorteio da Cerca com mais de 2 times: o time que esperava joga e o perdedor (com a Cerca) entra depois', () => {
  const { p, day } = setup(17, 5, { autoDraw: true }); // 3 times + Cerca de 2
  const [t1, t2, t3] = day.draw.teams;
  const before = allPids(day), fence = freePids(day), winnerPlayers = [...t1.players], waiting = [...t3.players], loserPlayers = [...t2.players];
  const r = play(p, day, createMatch(p, day, { a: t1.id, b: t2.id }, NOW), 1, 0, NOW, mulberry32(9));
  assert.equal(r.info.rotation.kind, 'fence');
  assert.deepEqual([r.next.a, r.next.b], [t1.id, t3.id], 'o time que esperava enfrenta o vencedor');
  assert.deepEqual(day.draw.teams.find(t => t.id === t3.id).players, waiting, 'quem esperava não muda');
  assert.deepEqual(day.draw.teams.find(t => t.id === t1.id).players, winnerPlayers);
  const loser = day.draw.teams.find(t => t.id === t2.id);
  assert.ok(fence.every(pid => loser.players.includes(pid)), 'a Cerca entrou no time derrotado');
  assert.deepEqual(day.queue, [t2.id], 'o time derrotado (com a Cerca) joga depois');
  assert.equal(freePids(day).length, 2);
  assert.ok(freePids(day).every(pid => loserPlayers.includes(pid)), 'os substituídos vêm do time derrotado');
  assert.deepEqual(allPids(day), before);
  assert.equal(day.streaks[t2.id], 0);
});

test('Cerca completa vira um time novo (com identidade nova) que enfrenta o vencedor; o incompleto entra no derrotado', () => {
  const { p, day } = setup(16, 5, { autoDraw: true }); // 3 times de 5? 16/5 = 3 -> 3 times + Cerca de 1
  assert.equal(day.draw.teams.length, 3);
  // 4 chegadas: Cerca de 5 = um time completo
  for (const u of ['x1', 'x2', 'x3', 'x4']) { setPresence(p, day, u, true, NOW); settleArrivals(p, day, { rnd: mulberry32(1), nameOf }); }
  assert.equal(day.draw.teams.length, 4, 'a Cerca de 5 virou o time 4');
  const t4 = day.draw.teams.at(-1);
  assert.equal(t4.number, 4);
  assert.ok(t4.name && t4.emb);
  assert.deepEqual(day.draw.teams.slice(0, 3).map(t => t.name).includes(t4.name), false, 'nome novo do catálogo');
  assert.deepEqual(freePids(day), []);
  assert.deepEqual(day.queue, [day.draw.teams[0].id, day.draw.teams[1].id, day.draw.teams[2].id, t4.id]);
  // Cerca incompleta (3) + um time completo na espera: entram em lugares diferentes
  for (const u of ['y1', 'y2', 'y3', 'y4', 'y5', 'y6', 'y7']) setPresence(p, day, u, true, NOW);
  const [a, b, c] = day.draw.teams.map(t => t.id);
  const r = play(p, day, createMatch(p, day, { a, b }, NOW));
  // a Cerca (7) formou o time 5 e o incompleto (2) entrou no derrotado
  assert.equal(day.draw.teams.length, 5);
  assert.deepEqual([r.next.a, r.next.b], [a, c], 'o time que esperava joga primeiro');
  assert.deepEqual(day.queue.at(-1), b, 'o derrotado vai por último');
  assert.equal(freePids(day).length, 2);
  assert.ok(day.draw.teams.every(t => t.players.length === 5));
});

test('sorteio automático geral a cada N partidas refaz todos os times, a Cerca tem prioridade e quem descansou joga primeiro', () => {
  const { p, day } = setup(17, 5, { generalDraw: true, generalEvery: 2 });
  const [t1, t2, t3] = day.draw.teams.map(t => t.id);
  const fence0 = freePids(day);
  const r1 = play(p, day, createMatch(p, day, { a: t1, b: t2 }, NOW));
  assert.equal(r1.info.rotation, null);                // 1ª partida: fila clássica
  assert.deepEqual([r1.next.a, r1.next.b], [t1, t3]);
  assert.deepEqual(freePids(day), fence0);               // sem o sorteio da Cerca, ela segue esperando
  assert.equal(day.sinceDraw, 1);
  const played = new Set([...day.draw.teams.find(t => t.id === t1).players, ...day.draw.teams.find(t => t.id === t3).players]);
  const r2 = play(p, day, r1.next);
  assert.equal(r2.info.rotation.kind, 'general');       // 2ª partida: sorteio geral
  assert.equal(day.sinceDraw, 0);
  assert.equal(day.draw.teams.length, 3);
  assert.ok(day.draw.teams.every(t => t.players.length === 5));
  assert.equal(allPids(day).length, 17);
  assert.ok(fence0.every(pid => !freePids(day).includes(pid)), 'quem estava na Cerca entrou');
  const next = [r2.next.a, r2.next.b].flatMap(id => day.draw.teams.find(t => t.id === id).players);
  const rested = day.attendance.map(a => a.pid).filter(pid => !played.has(pid) && !freePids(day).includes(pid));
  assert.ok(next.filter(pid => !played.has(pid)).length >= Math.min(rested.length, next.length), 'a vez é de quem não jogou a última partida');
  assert.equal(r2.next.stay, null);
});

test('sorteio geral mantém os ids e números dos times e evita repetir duplas', () => {
  const { p, day } = setup(20, 5);
  const ids = day.draw.teams.map(t => t.id), names = day.draw.teams.map(t => t.name);
  const key = (a, b) => [a, b].sort().join('|');
  // sem partidas: 4 times de 5 podem ser refeitos repetindo só 1 dupla por time (mínimo possível)
  const old = pairHistory(day);
  manualDraw(p, day, 'general', { rnd: mulberry32(40), nameOf, by: 'owner', now: NOW });
  assert.deepEqual(day.draw.teams.map(t => t.id), ids, 'os times seguem os mesmos');
  assert.deepEqual(day.draw.teams.map(t => t.name), names);
  let rep = 0;
  for (const t of day.draw.teams) for (let x = 0; x < t.players.length; x++) for (let y = x + 1; y < t.players.length; y++) if (old.get(key(t.players[x], t.players[y]))) rep++;
  assert.ok(rep <= 8, `duplas repetidas: ${rep}`);
  assert.equal(allPids(day).length, 20);
  // com partida encerrada: quem descansou ocupa os dois primeiros times
  const m = createMatch(p, day, { a: ids[0], b: ids[1] }, NOW);
  const r = play(p, day, m);
  const onCourt = new Set([...m.rosters[ids[0]].players, ...m.rosters[ids[1]].players]);
  const g = manualDraw(p, day, 'general', { rnd: mulberry32(41), nameOf, by: 'owner', now: NOW + 5000 });
  assert.equal(g.kind, 'general');
  const first = [r.next.a, r.next.b].map(id => day.draw.teams.find(t => t.id === id).players);
  assert.ok(first.flat().every(pid => !onCourt.has(pid)), 'a vez é de quem não estava em quadra');
});

test('sorteio manual com partida em andamento: o da Cerca define o próximo time agora; o geral fica combinado e vale no fim da partida', () => {
  const { p, day } = setup(22, 5); // 4 times + Cerca de 2
  const [t1, t2] = day.draw.teams.map(t => t.id);
  const m = createMatch(p, day, { a: t1, b: t2 }, NOW);
  timerAction(m, { action: 'start' }, NOW);
  // Cerca pequena: não dá para formar o próximo time
  assert.throws(() => manualDraw(p, day, 'fence', { rnd: mulberry32(1), nameOf, by: 'owner', now: NOW }), /ao menos 5/);
  for (const g of ['Ana1', 'Ana2', 'Ana3', 'Ana4', 'Ana5']) addGuest(p, day, g + 'x', 'free', NOW, nameOf);
  assert.equal(freePids(day).length, 7);
  const r = manualDraw(p, day, 'fence', { rnd: mulberry32(2), nameOf, by: 'owner', now: NOW + 1 });
  assert.equal(r.kind, 'fence');
  assert.equal(day.draw.teams.length, 5, 'um time novo nasceu da Cerca');
  assert.equal(freePids(day).length, 2, 'a Cerca incompleta fica para o time derrotado');
  assert.deepEqual(day.draw.teams.find(t => t.id === t1).players.length, 5);
  assert.ok(day.queue.includes(day.draw.teams.at(-1).id));
  // geral combinado: nada muda agora
  const teamsBefore = JSON.stringify(day.draw.teams);
  const g = manualDraw(p, day, 'general', { rnd: mulberry32(3), nameOf, by: 'owner', now: NOW + 2 });
  assert.equal(g.later, true);
  assert.equal(JSON.stringify(day.draw.teams), teamsBefore);
  assert.ok(day.pending && day.pending.teams.length >= 2);
  const onCourt = new Set([...day.draw.teams.find(t => t.id === t1).players, ...day.draw.teams.find(t => t.id === t2).players]);
  const firstTwo = day.pending.teams.slice(0, 2).flatMap(t => t.players);
  assert.ok(firstTwo.every(pid => !onCourt.has(pid)), 'quem está em quadra não está nos dois primeiros times do geral');
  const before = day.pending.teams.map(t => t.players);
  const r2 = play(p, day, m, 1, 0, NOW + 3);
  assert.equal(r2.info.rotation.kind, 'general');
  assert.equal(day.pending, null);
  assert.deepEqual([r2.next.a, r2.next.b].map(id => day.draw.teams.find(t => t.id === id).players), before.slice(0, 2));
  assert.equal(allPids(day).length, 27);
});

test('sorteio manual sem partida em quadra vale na hora; com times fixos não sorteia', () => {
  const { p, day } = setup(17, 5);
  const [t1, t2] = day.draw.teams.map(t => t.id);
  const r1 = play(p, day, createMatch(p, day, { a: t1, b: t2 }, NOW));
  // Cerca + time derrotado: a Cerca (2) entra no derrotado
  const fence = freePids(day), loser = r1.info.leaver;
  const r = manualDraw(p, day, 'fence', { rnd: mulberry32(8), nameOf, by: 'owner', now: NOW + 5000 });
  assert.equal(r.leaver, loser);
  assert.ok(fence.every(pid => day.draw.teams.find(t => t.id === loser).players.includes(pid)));
  assert.equal(allPids(day).length, 17);
  // geral na hora
  const g = manualDraw(p, day, 'general', { rnd: mulberry32(9), nameOf, by: 'owner', now: NOW + 6000 });
  assert.equal(g.kind, 'general'); assert.equal(day.pending, null);
  assert.equal(day.sinceDraw, 0);
  assert.equal(allPids(day).length, 17);
  day.fixed = { at: NOW };
  assert.throws(() => manualDraw(p, day, 'general', { rnd: mulberry32(9), nameOf, by: 'owner', now: NOW }), /fixos/);
  assert.throws(() => manualDraw(p, day, 'xyz', { rnd: mulberry32(9), nameOf, by: 'owner', now: NOW }), /fixos/);
});

test('contadores do dia: partidas por jogador (incluindo emprestados) vêm das partidas encerradas', () => {
  const { p, day } = setup(12, 5);
  const [t1, t2] = day.draw.teams;
  const outsider = freePids(day)[0];
  const m = createMatch(p, day, { a: t1.id, b: t2.id }, NOW);
  timerAction(m, { action: 'start' }, NOW);
  setLoan(day, m, { teamId: t1.id, pid: outsider });
  score(day, m, 1, 0, NOW);
  finishMatch(p, day, m, { now: NOW + 1000, rnd: mulberry32(1), nameOf });
  const { games, goals } = dayStats(day);
  assert.equal(games[t1.players[0]], 1); assert.equal(games[t2.players[0]], 1); assert.equal(games[outsider], 1);
  assert.equal(goals[t1.players[0]], 1);
  const idle = freePids(day).find(pid => pid !== outsider);
  assert.equal(games[idle] || 0, 0);
});

test('partida encerrada pode ser corrigida: gols de quem jogou (elenco da época) e placar recalculado', () => {
  const { p, day } = setup(12, 5, { autoDraw: true });
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

test('fixar times: os mesmos jogadores seguem nos mesmos times, sem sorteios; as próximas datas herdam os times e quem volta entra no seu time', () => {
  const p = newPelada({ id: 'PL-FIXOS1', owner, input: { name: 'Fixos FC', gender: 'feminino', minPerTeam: 5, autoDraw: true, generalDraw: true, generalEvery: 1, days: [{ date: '2026-10-07' }, { date: '2026-10-14' }] } }, NOW);
  const [d1, d2] = p.days;
  for (let i = 1; i <= 17; i++) setPresence(p, d1, `u${i}`, true, NOW);
  assert.throws(() => fixTeams(p, d1, { by: 'o', now: NOW }), /sorteio antes/);
  performDraw(p, d1, d1.attendance.map(a => ({ pid: a.pid, name: a.pid })), { by: 'o', now: NOW, rnd: mulberry32(4) });
  assert.equal(d2.draw, null);
  fixTeams(p, d1, { by: 'o', now: NOW });
  const snapshot = JSON.stringify(d1.draw.teams.map(t => t.players));
  // com a Cerca e o geral ligados, nada é sorteado: o vencedor fica e o perdedor vai para o fim da fila
  let m = createMatch(p, d1, { a: d1.draw.teams[0].id, b: d1.draw.teams[1].id }, NOW);
  for (let i = 0; i < 4; i++) {
    const r = play(p, d1, m, 1, 0, NOW + i);
    assert.equal(r.info.rotation, null);
    m = r.next;
  }
  assert.equal(JSON.stringify(d1.draw.teams.map(t => t.players)), snapshot);
  assert.throws(() => manualDraw(p, d1, 'general', { nameOf, by: 'o', now: NOW }), /fixos/);
  assert.throws(() => manualDraw(p, d1, 'fence', { nameOf, by: 'o', now: NOW }), /fixos/);
  const fence = freePids(d1);
  setPresence(p, d1, 'chegou', true, NOW);
  for (let i = 0; i < 4; i++) setPresence(p, d1, 'cheg' + i, true, NOW);
  assert.equal(settleArrivals(p, d1, { nameOf }), null, 'com os times fixos a Cerca não vira time sozinha');
  assert.equal(freePids(d1).length, fence.length + 5);
  // a data seguinte (já criada) herdou os times: mesmos ids, nomes e emblemas, ainda sem jogadores
  assert.ok(d2.fixed.inherited);
  assert.deepEqual(d2.draw.teams.map(t => [t.id, t.number, t.name]), d1.draw.teams.map(t => [t.id, t.number, t.name]));
  assert.ok(d2.draw.teams.every(t => t.players.length === 0 && t.emb));
  assert.match(d2.draw.notes[0], /mantidos do último dia de jogo \(07\/10\)/);
  // quem estava num time volta a ele ao confirmar presença; quem era da Cerca ou chega agora fica na Cerca
  const first = d1.draw.teams[0], member = first.players[0], cercaPid = fence[0];
  setPresence(p, d2, member.slice(2), true, NOW + 10);
  setPresence(p, d2, cercaPid.slice(2), true, NOW + 10);
  assert.ok(d2.draw.teams.find(t => t.id === first.id).players.includes(member));
  assert.ok(freePids(d2).includes(cercaPid));
  setPresence(p, d2, member.slice(2), false, NOW + 20);
  assert.ok(!d2.draw.teams.find(t => t.id === first.id).players.includes(member));
  setPresence(p, d2, member.slice(2), true, NOW + 30);
  assert.ok(d2.draw.teams.find(t => t.id === first.id).players.includes(member), 'volta ao mesmo time');
  assert.throws(() => manualDraw(p, d2, 'general', { nameOf, by: 'o', now: NOW }), /fixos/);
  // uma data criada depois também herda; liberar o dia de origem solta as que herdaram e não começaram
  const d3 = addDay(p, { date: '2026-10-21' }, NOW);
  assert.ok(d3.fixed?.inherited && d3.draw.teams.length === 3);
  unfixTeams(p, d1);
  assert.equal(d1.fixed, null);
  assert.equal(d2.fixed?.inherited, undefined);
  assert.equal(d2.draw, null);
  assert.equal(d3.fixed, null, 'a cadeia de heranças também é solta');
  manualDraw(p, d1, 'general', { nameOf, by: 'o', now: NOW, rnd: mulberry32(2) }); // volta a sortear
});
