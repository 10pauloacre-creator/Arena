// Regras puras do módulo Pelada: data de nascimento como senha, ID, sorteio (regras de sobra A e B), fila de partidas e artilharia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBirth, parseDateParts, normalizeSecret, maskDate, nameKey, normalizePeladaId, PELADA_ID_RE, planTeams, drawTeams, minPlayersForDraw,
  nextPairing, rankGoals, matchScore, timerRemaining, fmtClock, mulberry32, teamLabel, rangeLabel, sharePeriod,
  formTeams, GENERAL_EVERY_OPTIONS, autoDrawLabel, FENCE_DRAW_TITLE, GENERAL_DRAW_TITLE,
} from '../../public/assets/js/shared/pelada.js';

const people = n => Array.from({ length: n }, (_, i) => ({ pid: `u:${i + 1}`, name: `Jogadora ${i + 1}`, guest: i % 7 === 6 }));

test('data de nascimento: formatos aceitos, datas inválidas e futuras', () => {
  assert.deepEqual(parseDateParts('25/03/1990'), { d: 25, m: 3, y: 1990 });
  assert.deepEqual(parseDateParts('25031990'), { d: 25, m: 3, y: 1990 });
  assert.deepEqual(parseDateParts('1990-03-25'), { d: 25, m: 3, y: 1990 });
  assert.equal(parseDateParts('31/02/1990'), null);
  assert.equal(parseDateParts('29/02/2023'), null);
  assert.deepEqual(parseDateParts('29/02/2024'), { d: 29, m: 2, y: 2024 });
  assert.equal(parseDateParts('10/10/1850'), null);
  const now = Date.parse('2026-10-07T12:00:00Z');
  assert.equal(parseBirth('01/01/2030', now), null);
  assert.deepEqual(parseBirth('07/10/2026', now), { iso: '2026-10-07', label: '07/10/2026' });
  assert.equal(maskDate('25031990'), '25/03/1990');
  assert.equal(maskDate('2503'), '25/03');
});

test('senha: data vira DDMMAAAA em qualquer formato; senha personalizada fica como digitada', () => {
  assert.equal(normalizeSecret('25/03/1990'), '25031990');
  assert.equal(normalizeSecret('1990-03-25'), '25031990');
  assert.equal(normalizeSecret(' 25-03-1990 '), '25031990');
  assert.equal(normalizeSecret('Minha Senha 9'), 'Minha Senha 9');
  assert.equal(normalizeSecret('  abc '), 'abc');
});

test('nome de usuário e ID da pelada', () => {
  assert.equal(nameKey('  Valéria   da  SILVA '), 'valeria da silva');
  assert.equal(nameKey('José'), nameKey('jose'));
  assert.equal(normalizePeladaId('#pl-7k3m9q'), 'PL-7K3M9Q');
  assert.equal(normalizePeladaId('7k3m9q'), 'PL-7K3M9Q');
  assert.equal(normalizePeladaId('https://arena.vercel.app/pelada/p/PL-7K3M9Q?x=1'), 'PL-7K3M9Q');
  assert.ok(PELADA_ID_RE.test('PL-7K3M9Q'));
  assert.ok(!PELADA_ID_RE.test('PL-0O1IL2'));
});

test('sorteio — planejamento: times completos e a sobra vai para a Cerca (sem time incompleto)', () => {
  const plan = n => planTeams(n, 5);
  assert.deepEqual(plan(25).sizes, [5, 5, 5, 5, 5]); assert.equal(plan(25).fence, 0);
  for (const [n, fence] of [[24, 4], [23, 3], [26, 1], [27, 2]]) {
    const r = plan(n);
    assert.ok(r.ok); assert.deepEqual(r.sizes, [5, 5, 5, 5, 5].slice(0, Math.floor(n / 5))); assert.equal(r.fence, fence, `n=${n}`);
  }
  assert.deepEqual(plan(10).sizes, [5, 5]);
  // precisa de 2 times COMPLETOS: 8 presentes com mínimo 5 não bastam
  for (const n of [0, 5, 6, 7, 8, 9]) assert.equal(plan(n).ok, false, `n=${n}`);
  assert.match(plan(8).error, /10 presentes \(há 8\)/);
  assert.equal(minPlayersForDraw(5), 10);
  assert.equal(minPlayersForDraw(2), 4);
  assert.equal(planTeams(14, 11).ok, false);
  assert.deepEqual(planTeams(22, 11).sizes, [11, 11]);
});

test('sorteio — todos entram uma única vez: times de exatamente `min` e quem sobra é a Cerca', () => {
  for (let n = 8; n <= 41; n++) {
    for (const min of [4, 5, 7]) {
      const plan = planTeams(n, min);
      const res = drawTeams(people(n), min, mulberry32(n * 31 + min));
      assert.equal(res.ok, plan.ok, `n=${n} min=${min}`);
      if (!res.ok) continue;
      const inTeams = res.teams.flatMap(t => t.players);
      const all = [...inTeams, ...res.fence];
      assert.equal(all.length, n);
      assert.equal(new Set(all).size, n, `duplicados n=${n} min=${min}`);
      assert.equal(res.teams.length, Math.floor(n / min));
      assert.ok(res.teams.every(t => t.players.length === min));
      assert.equal(res.fence.length, n % min);
      res.teams.forEach((t, i) => { assert.equal(t.number, i + 1); assert.ok(t.players.includes(t.captain)); assert.equal(t.incomplete, undefined); });
    }
  }
});

test('sorteio — a Cerca anterior (`must`) entra obrigatoriamente, nos dois primeiros times, e o capitão é um deles', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const list = people(17);
    const must = ['u:3', 'u:9'];
    const res = drawTeams(list, 5, mulberry32(seed), { must });
    assert.ok(res.ok);
    assert.ok(must.every(pid => !res.fence.includes(pid)), 'quem estava na Cerca não pode sobrar de novo');
    const first = res.teams.slice(0, 2);
    assert.ok(must.every(pid => first.some(t => t.players.includes(pid))), `seed ${seed}: Cerca nos 2 primeiros times`);
    assert.equal(res.fence.length, 2);
  }
  // formTeams: com um único time à frente, a Cerca inteira vai junto e o time é completado por sorteio
  const f = formTeams(people(12), 5, mulberry32(4), { must: ['u:1', 'u:2'], mustTeams: 1 });
  assert.ok(f.teams[0].players.includes('u:1') && f.teams[0].players.includes('u:2'));
  assert.ok(['u:1', 'u:2'].includes(f.teams[0].captain)); // capitão: integrante principal (quem veio da Cerca)
  assert.equal(f.teams[0].players.length, 5);
  assert.equal(f.fence.length, 2);
  // mais gente na Cerca do que cabe em um time: o excedente segue para o time seguinte
  const big = formTeams(people(20), 5, mulberry32(2), { must: people(7).map(p => p.pid), mustTeams: 1 });
  assert.equal(big.teams[0].players.filter(pid => Number(pid.slice(2)) <= 7).length, 5);
  assert.equal(big.teams[1].players.filter(pid => Number(pid.slice(2)) <= 7).length, 2);
});

test('sorteio — capitão evita convidados quando há jogadores com conta e a semente reproduz o resultado', () => {
  const list = people(10).map((p, i) => ({ ...p, guest: i >= 1 }));
  const a = drawTeams(list, 5, mulberry32(7)), b = drawTeams(list, 5, mulberry32(7));
  assert.deepEqual(a.teams, b.teams);
  const c = drawTeams(list, 5, mulberry32(8));
  assert.notDeepEqual(a.teams.map(t => t.players), c.teams.map(t => t.players));
  const guests = new Set(list.filter(p => p.guest).map(p => p.pid));
  for (const t of a.teams) { const hasReal = t.players.some(pid => !guests.has(pid)); if (hasReal) assert.ok(!guests.has(t.captain)); }
  // o nome do time vem do catálogo (não leva mais o capitão, que pode sair numa derrota)
  assert.equal(teamLabel({ number: 2, name: 'Leões', emb: { g: 'crown', p: 0, s: 0 } }), 'Time 2 - Leões');
  assert.match(teamLabel(a.teams[0], 'dia1', 'masculino'), /^Time 1 - \S+/);
});

test('sorteio — as notas explicam a Cerca', () => {
  const b = drawTeams(people(27), 5, mulberry32(1));
  assert.ok(b.notes.some(n => /Sobraram 2 jogadores/.test(n) && /Cerca/.test(n) && /time que perder/.test(n)));
  assert.ok(!b.notes.some(n => /incompleto|distribuíd/.test(n)));
  const none = drawTeams(people(25), 5, mulberry32(1));
  assert.equal(none.notes.length, 1);
  assert.ok(drawTeams(people(12), 5, mulberry32(1), { must: ['u:1'] }).notes.some(n => /Cerca anterior/.test(n)));
});

test('sorteios automáticos: títulos, rótulos e opções (geral a cada 1 a 10 partidas)', () => {
  assert.equal(FENCE_DRAW_TITLE, 'Sorteio automático da Cerca');
  assert.equal(GENERAL_DRAW_TITLE, 'Sorteio automático geral');
  assert.deepEqual(GENERAL_EVERY_OPTIONS.map(o => o[0]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(autoDrawLabel({ autoDraw: false, generalDraw: false, generalEvery: 3 }), 'Sorteios automáticos desligados');
  assert.equal(autoDrawLabel({ autoDraw: true, generalDraw: false, generalEvery: 3 }), 'Sorteio da Cerca automático');
  assert.equal(autoDrawLabel({ autoDraw: false, generalDraw: true, generalEvery: 1 }), 'Sorteio geral a cada partida');
  assert.equal(autoDrawLabel({ autoDraw: true, generalDraw: true, generalEvery: 3 }), 'Sorteio da Cerca automático · Sorteio geral a cada 3 partidas');
});

test('fila de partidas: quem ganha fica; perdedor vai para o fim; empate tira quem está há mais tempo', () => {
  // A vence B; fila [C, D]
  let r = nextPairing({ a: 'A', b: 'B', scoreA: 2, scoreB: 1, queue: ['C', 'D'], streaks: { A: 1, B: 1 } });
  assert.deepEqual([r.a, r.b, r.queue, r.leaver], ['A', 'C', ['D', 'B'], 'B']);
  // B vence A → B passa a ser o time A da próxima
  r = nextPairing({ a: 'A', b: 'B', scoreA: 0, scoreB: 3, queue: ['C'], streaks: { A: 2, B: 1 } });
  assert.deepEqual([r.a, r.b, r.queue], ['B', 'C', ['A']]);
  // empate: sai quem tem maior sequência
  r = nextPairing({ a: 'A', b: 'B', scoreA: 1, scoreB: 1, queue: ['C'], streaks: { A: 3, B: 1 } });
  assert.deepEqual([r.a, r.b, r.leaver], ['B', 'C', 'A']);
  r = nextPairing({ a: 'A', b: 'B', scoreA: 1, scoreB: 1, queue: ['C'], streaks: { A: 1, B: 4 } });
  assert.deepEqual([r.a, r.b, r.leaver], ['A', 'C', 'B']);
  // empate com sequência igual: sai o time A
  r = nextPairing({ a: 'A', b: 'B', scoreA: 0, scoreB: 0, queue: ['C'], streaks: { A: 1, B: 1 } });
  assert.deepEqual([r.a, r.b, r.leaver], ['B', 'C', 'A']);
  // só dois times: revanche
  r = nextPairing({ a: 'A', b: 'B', scoreA: 4, scoreB: 2, queue: [], streaks: { A: 1, B: 1 } });
  assert.deepEqual([r.a, r.b, r.queue], ['A', 'B', []]);
});

test('placar a partir dos gols, cronômetro e relógio', () => {
  const m = { a: 'X', b: 'Y', goals: [{ teamId: 'X' }, { teamId: 'X' }, { teamId: 'Y' }] };
  assert.deepEqual(matchScore(m), { X: 2, Y: 1 });
  assert.deepEqual(matchScore({ a: 'X', b: 'Y', goals: [] }), { X: 0, Y: 0 });
  const t = { durationMs: 600_000, elapsedMs: 60_000, startedAt: 1_000_000 };
  assert.equal(timerRemaining(t, 1_000_000 + 30_000), 510_000);
  assert.equal(timerRemaining(t, 1_000_000 + 9_999_999), 0);
  assert.equal(timerRemaining({ durationMs: 600_000, elapsedMs: 0, startedAt: null }, 5), 600_000);
  assert.equal(fmtClock(600_000), '10:00');
  assert.equal(fmtClock(59_100), '01:00');
  assert.equal(fmtClock(0), '00:00');
});

test('artilharia: ordem, empates dividem a colocação e a medalha', () => {
  const names = { a: 'Ana', b: 'Bia', c: 'Cris', d: 'Dani', e: 'Eva' };
  const r = rankGoals({ a: 5, b: 5, c: 3, d: 3, e: 1, z: 0 }, pid => names[pid] || pid);
  assert.deepEqual(r.map(x => [x.pid, x.rank, x.medal]), [['a', 1, 'gold'], ['b', 1, 'gold'], ['c', 3, 'bronze'], ['d', 3, 'bronze'], ['e', 5, null]]);
  const r2 = rankGoals({ a: 4, b: 3, c: 2, d: 1 }, pid => names[pid]);
  assert.deepEqual(r2.map(x => x.medal), ['gold', 'silver', 'bronze', null]);
  assert.deepEqual(rankGoals({}), []);
});

test('período do compartilhamento: início da pelada até o dia da emissão', () => {
  assert.equal(rangeLabel('2026-09-07', '2026-10-20'), '07/09 - 20/10');
  assert.equal(rangeLabel('2025-12-20', '2026-01-10'), '20/12/2025 - 10/01/2026');
  assert.equal(rangeLabel('2026-10-07', '2026-10-07'), '07/10/2026');
  // geral: primeira data de jogo → hoje (emissão)
  assert.deepEqual(sharePeriod({ general: true, firstDay: '2026-09-07', dayDate: '2026-10-14', today: '2026-10-20' }), { from: '2026-09-07', to: '2026-10-20', label: '07/09 - 20/10' });
  // a pelada ainda não começou: só o dia da emissão
  assert.equal(sharePeriod({ general: true, firstDay: '2030-01-05', today: '2026-10-20' }).label, '20/10/2026');
  assert.equal(sharePeriod({ general: true, firstDay: null, today: '2026-10-20' }).label, '20/10/2026');
  // artilharia do dia: a data do jogo
  assert.equal(sharePeriod({ general: false, firstDay: '2026-09-07', dayDate: '2026-10-14', today: '2026-10-20' }).label, '14/10/2026');
  // emitido no mesmo dia do primeiro jogo
  assert.equal(sharePeriod({ general: true, firstDay: '2026-10-20', today: '2026-10-20' }).label, '20/10/2026');
});
