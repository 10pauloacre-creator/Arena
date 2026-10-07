// Regras puras do módulo Pelada: data de nascimento como senha, ID, sorteio (regras de sobra A e B), fila de partidas e artilharia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBirth, parseDateParts, normalizeSecret, maskDate, nameKey, normalizePeladaId, PELADA_ID_RE, planTeams, drawTeams, minPlayersForDraw,
  nextPairing, rankGoals, matchScore, timerRemaining, fmtClock, mulberry32, teamLabel, rangeLabel, sharePeriod,
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

test('sorteio — planejamento: exemplos com mínimo de 5', () => {
  const sizes = n => planTeams(n, 5);
  assert.deepEqual(sizes(25).sizes, [5, 5, 5, 5, 5]);
  assert.equal(sizes(25).incomplete, null);
  // Regra A: sobra de 3 ou 4 → o time incompleto se mantém
  const a4 = sizes(24); assert.deepEqual(a4.sizes, [5, 5, 5, 5, 4]); assert.deepEqual(a4.incomplete, { index: 4, size: 4, missing: 1 });
  const a3 = sizes(23); assert.deepEqual(a3.sizes, [5, 5, 5, 5, 3]); assert.equal(a3.incomplete.missing, 2);
  // Regra B: sobra de 1 ou 2 → dissolve e distribui
  const b1 = sizes(26); assert.deepEqual(b1.sizes, [5, 5, 5, 5, 5]); assert.equal(b1.extras, 1); assert.equal(b1.incomplete, null);
  const b2 = sizes(27); assert.equal(b2.extras, 2);
  assert.deepEqual(sizes(10).sizes, [5, 5]);
  // mínimo de 2 times
  assert.equal(sizes(7).ok, false);
  assert.match(sizes(7).error, /8/);
  assert.equal(sizes(8).ok, true); assert.deepEqual(sizes(8).sizes, [5, 3]);
  assert.equal(sizes(6).ok, false);
  assert.equal(sizes(5).ok, false);
  assert.equal(sizes(0).ok, false);
  assert.equal(minPlayersForDraw(5), 8);
  assert.equal(minPlayersForDraw(3), 6);
  assert.equal(minPlayersForDraw(2), 4);
  // mínimos pequenos: nunca existe "time incompleto" válido (< 3), só a regra B
  assert.equal(planTeams(7, 3).extras, 1);
  assert.equal(planTeams(5, 2).extras, 1);
  // mínimo grande
  assert.deepEqual(planTeams(14, 11).sizes, [11, 3]);
  assert.equal(planTeams(13, 11).ok, false);
});

test('sorteio — todos os jogadores entram uma única vez e os tamanhos seguem as regras', () => {
  for (let n = 8; n <= 41; n++) {
    for (const min of [4, 5, 7]) {
      const plan = planTeams(n, min);
      const res = drawTeams(people(n), min, mulberry32(n * 31 + min));
      assert.equal(res.ok, plan.ok, `n=${n} min=${min}`);
      if (!res.ok) continue;
      const all = res.teams.flatMap(t => t.players);
      assert.equal(all.length, n);
      assert.equal(new Set(all).size, n, `duplicados n=${n} min=${min}`);
      const k = Math.floor(n / min), r = n % min;
      if (r === 0) assert.ok(res.teams.every(t => t.players.length === min));
      else if (r >= 3) { assert.equal(res.teams.length, k + 1); assert.equal(res.teams.at(-1).players.length, r); assert.ok(res.teams.at(-1).incomplete); assert.equal(res.teams.at(-1).missing, min - r); }
      else {
        assert.equal(res.teams.length, k); // time incompleto dissolvido
        const big = res.teams.filter(t => t.players.length === min + 1).length;
        assert.equal(big, r, `n=${n} min=${min}: ${r} times com ${min + 1}`);
        assert.ok(res.teams.every(t => t.players.length === min || t.players.length === min + 1));
      }
      res.teams.forEach((t, i) => { assert.equal(t.number, i + 1); assert.ok(t.players.includes(t.captain)); });
    }
  }
});

test('sorteio — capitão evita convidados quando há jogadores com conta e a semente reproduz o resultado', () => {
  const list = people(10).map((p, i) => ({ ...p, guest: i >= 1 }));
  const a = drawTeams(list, 5, mulberry32(7)), b = drawTeams(list, 5, mulberry32(7));
  assert.deepEqual(a.teams, b.teams);
  const c = drawTeams(list, 5, mulberry32(8));
  assert.notDeepEqual(a.teams.map(t => t.players), c.teams.map(t => t.players));
  const guests = new Set(list.filter(p => p.guest).map(p => p.pid));
  for (const t of a.teams) { const hasReal = t.players.some(pid => !guests.has(pid)); if (hasReal) assert.ok(!guests.has(t.captain)); }
  assert.equal(teamLabel({ number: 2, captain: 'u:9' }, () => 'Valéria Souza'), 'Time 2 - Valéria');
  assert.match(teamLabel(a.teams[0], pid => list.find(p => p.pid === pid).name), /^Time 1 - Jogadora$/);
});

test('sorteio — notas explicam as decisões (regras A e B)', () => {
  const b = drawTeams(people(27), 5, mulberry32(1));
  assert.ok(b.notes.some(n => /desfeito/.test(n) && /distribuíd/.test(n)));
  const a = drawTeams(people(24), 5, mulberry32(1));
  assert.ok(a.notes.some(n => /faltam 1/.test(n) && /de fora/.test(n)));
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
