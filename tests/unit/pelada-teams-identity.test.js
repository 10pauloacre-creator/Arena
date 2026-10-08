// Identidade dos times: nome do catálogo (masculino/feminino) + emblema; o time mantém a identidade ao trocar de jogadores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEAM_NAMES, GLYPH_KEYS, PALETTES, newIdentity, fallbackIdentity, identityOf, teamLabel, emblemSvg } from '../../public/assets/js/shared/team-catalog.js';
import { mulberry32 } from '../../public/assets/js/shared/pelada.js';
import { newPelada, setPresence, performDraw, createMatch, timerAction, addGoal, finishMatch, ensureIdentities } from '../../lib/domain/pelada.js';

const NOW = Date.parse('2026-10-07T15:00:00Z');

test('catálogo: 48 nomes por gênero, sem repetir, com símbolo válido e listas diferentes', () => {
  for (const g of ['masculino', 'feminino']) {
    const list = TEAM_NAMES[g];
    assert.equal(list.length, 48);
    assert.equal(new Set(list.map(x => x[0])).size, 48);
    assert.ok(list.every(([, glyph]) => GLYPH_KEYS.includes(glyph)));
  }
  const fem = new Set(TEAM_NAMES.feminino.map(x => x[0]));
  assert.ok(TEAM_NAMES.masculino.filter(x => fem.has(x[0])).length <= 2, 'listas praticamente disjuntas');
  assert.ok(TEAM_NAMES.feminino.some(x => x[0] === 'Panteras') && !TEAM_NAMES.masculino.some(x => x[0] === 'Panteras'));
});

test('identidade nova não repete nome nem paleta enquanto houver livres; rótulo é "Time N - Nome"', () => {
  const used = [];
  const rnd = mulberry32(5);
  for (let i = 0; i < PALETTES.length; i++) used.push({ ...newIdentity(used, 'feminino', rnd) });
  assert.equal(new Set(used.map(u => u.name)).size, used.length);
  assert.equal(new Set(used.map(u => u.emb.p)).size, PALETTES.length);
  assert.ok(used.every(u => TEAM_NAMES.feminino.some(x => x[0] === u.name)));
  assert.equal(teamLabel({ number: 3, ...used[0] }), `Time 3 - ${used[0].name}`);
  // catálogo esgotado: ainda devolve um nome (com número), sem travar
  const all = TEAM_NAMES.masculino.map(([name]) => ({ name }));
  assert.match(newIdentity(all, 'masculino', () => 0).name, / \d+$/);
});

test('times antigos (sem identidade) recebem uma estável e sem repetir', () => {
  const a = fallbackIdentity('d1:t1', 'masculino'), b = fallbackIdentity('d1:t1', 'masculino');
  assert.deepEqual(a, b);
  assert.deepEqual(identityOf({ id: 't1' }, 'd1', 'masculino'), a);
  assert.deepEqual(identityOf({ id: 't1', name: 'X', emb: { g: 'star', p: 1, s: 1 } }, 'd1', 'masculino').name, 'X');
  const p = newPelada({ id: 'PL-IDENT1', owner: { id: 'o' }, input: { name: 'Antigo FC', gender: 'masculino', minPerTeam: 2, days: [{ date: '2026-10-07' }] } }, NOW);
  const day = p.days[0];
  day.draw = { id: 's', teams: [{ id: 't1', number: 1, players: [] }, { id: 't2', number: 2, players: [] }, { id: 't3', number: 3, players: [] }] };
  ensureIdentities(p, day);
  assert.equal(new Set(day.draw.teams.map(t => t.name)).size, 3);
  assert.ok(day.draw.teams.every(t => t.emb && t.name));
});

test('emblema: SVG válido, com forma, símbolo e cores; sem script', () => {
  for (const emb of [{ g: 'paw', p: 0, s: 0 }, { g: 'sun', p: 5, s: 1 }, { g: 'shield', p: 11, s: 3 }, undefined]) {
    const svg = emblemSvg(emb, 40);
    assert.match(svg, /^<svg class="emblem" width="40" height="40" viewBox="0 0 24 24"/);
    assert.ok(svg.includes('linearGradient') && svg.endsWith('</svg>') && !/<script|onload|javascript:/i.test(svg));
  }
});

const nameOf = pid => pid;
function day(count, { gender = 'masculino', auto = true } = {}) {
  const p = newPelada({ id: 'PL-IDENT2', owner: { id: 'o' }, input: { name: 'Time FC', gender, minPerTeam: 5, autoDraw: auto, days: [{ date: '2026-10-07' }] } }, NOW);
  const d = p.days[0];
  for (let i = 1; i <= count; i++) setPresence(p, d, `u${i}`, true, NOW);
  performDraw(p, d, d.attendance.map(a => ({ pid: a.pid, name: a.pid })), { by: 'o', now: NOW, rnd: mulberry32(8) });
  return { p, d };
}

test('sorteio dá nome/emblema únicos do gênero da pelada e o time mantém a identidade ao trocar de jogadores', () => {
  for (const gender of ['masculino', 'feminino']) {
    const { p, d } = day(17, { gender });
    const teams = d.draw.teams;
    assert.equal(new Set(teams.map(t => t.name)).size, 3);
    assert.ok(teams.every(t => TEAM_NAMES[gender].some(x => x[0] === t.name) && t.emb));
    const before = teams.map(t => ({ id: t.id, name: t.name, emb: t.emb }));
    const m = createMatch(p, d, { a: teams[0].id, b: teams[1].id }, NOW);
    timerAction(m, { action: 'start' }, NOW);
    addGoal(d, m, { teamId: teams[0].id, pid: teams[0].players[0] }, NOW);
    const r = finishMatch(p, d, m, { now: NOW + 1000, rnd: mulberry32(2), nameOf });
    assert.ok(r.info.rotation);
    for (const b of before) { const t = d.draw.teams.find(x => x.id === b.id); assert.deepEqual({ id: t.id, name: t.name, emb: t.emb }, b); }
    // a partida encerrada guarda o nome/emblema de quem jogou
    assert.equal(m.rosters[teams[0].id].name, before[0].name);
  }
});
