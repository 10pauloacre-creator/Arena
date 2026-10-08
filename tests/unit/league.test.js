// Campeonato de pontos corridos: tabela de jogos (todos contra todos), máximo de partidas, classificação, campeão e API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildLeague, leagueTable, recordLeagueResult, leagueFinished, singleRounds } from '../../lib/domain/league.js';
import { startServer, Client, signup } from './helpers.js';
import { setClock } from '../../lib/clock.js';

const teams = n => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, name: `Time ${i + 1}`, rating: 1500 }));
const pairsOf = lg => lg.rounds.flat().map(m => [m.a, m.b].sort().join('|'));

test('turno único: todos contra todos exatamente uma vez, ninguém joga duas vezes na rodada (pares e ímpares)', () => {
  for (const n of [3, 4, 5, 6, 8, 9, 16]) {
    const lg = buildLeague(teams(n), { seed: n });
    assert.equal(lg.rounds.length, singleRounds(n), `rodadas com ${n} times`);
    const pairs = pairsOf(lg);
    assert.equal(new Set(pairs).size, pairs.length, 'sem confronto repetido');
    assert.equal(pairs.length, n * (n - 1) / 2);
    for (const rd of lg.rounds) { const ids = rd.flatMap(m => [m.a, m.b]); assert.equal(new Set(ids).size, ids.length, 'time repetido na rodada'); }
    const played = {};
    for (const m of lg.rounds.flat()) { played[m.a] = (played[m.a] || 0) + 1; played[m.b] = (played[m.b] || 0) + 1; }
    assert.ok(Object.values(played).every(v => v === n - 1), 'cada time enfrenta todos os outros');
  }
  assert.throws(() => buildLeague(teams(2)), /ao menos 3/);
});

test('máximo de partidas por time limita as rodadas; acima do turno único entra o returno com mando invertido', () => {
  const lg = buildLeague(teams(8), { maxMatches: 3, seed: 1 });
  assert.equal(lg.rounds.length, 3);
  const played = {};
  for (const m of lg.rounds.flat()) { played[m.a] = (played[m.a] || 0) + 1; played[m.b] = (played[m.b] || 0) + 1; }
  assert.ok(Object.values(played).every(v => v === 3));
  const dbl = buildLeague(teams(4), { maxMatches: 6, seed: 2 });
  assert.equal(dbl.rounds.length, 6);
  const key = m => `${m.a}>${m.b}`;
  const keys = dbl.rounds.flat().map(key);
  assert.equal(new Set(keys).size, 12, 'ida e volta: 12 jogos, cada confronto nos dois mandos');
  assert.equal(buildLeague(teams(4), { maxMatches: 99, seed: 2 }).rounds.length, 6, 'limite acima do possível vira o máximo');
  assert.equal(buildLeague(teams(4), { seed: 2 }).rounds.length, 3, 'sem limite: turno único');
  assert.deepEqual(buildLeague(teams(6), { seed: 5 }), buildLeague(teams(6), { seed: 5 }), 'mesma semente, mesma tabela');
});

test('classificação: 3 pontos por vitória, 1 por empate; desempate por vitórias, saldo e gols; campeão só no fim', () => {
  const t = { teams: teams(3), champion: null, activity: [] };
  t.league = buildLeague(teams(3), { seed: 3 });
  t.league.teamIds = ['t1', 't2', 't3'];
  const m = t.league.rounds.flat();
  const set = (i, sa, sb) => recordLeagueResult(t, m[i].key, { sa, sb }, 1);
  set(0, 2, 0); set(1, 1, 1);
  assert.equal(leagueFinished(t), false); assert.equal(t.champion, null);
  const mid = leagueTable(t, id => id);
  assert.equal(mid[0].pts, 3);
  assert.equal(mid.reduce((s, r) => s + r.pts, 0), 3 + 1 + 1, 'vitória (3) + empate (1+1)');
  set(2, 0, 3);
  assert.equal(leagueFinished(t), true);
  const tab = leagueTable(t, id => id);
  assert.equal(t.champion, tab[0].id);
  assert.ok(tab[0].pts >= tab[1].pts && tab[1].pts >= tab[2].pts);
  assert.equal(tab.reduce((s, r) => s + r.w, 0), tab.reduce((s, r) => s + r.l, 0));
  // corrigir um resultado muda a tabela e o campeão; limpar tira o campeão
  recordLeagueResult(t, m[2].key, { clear: true }, 2);
  assert.equal(t.champion, null);
  assert.throws(() => recordLeagueResult(t, m[2].key, { sa: -1, sb: 0 }, 3), /Placar inválido/);
  assert.throws(() => recordLeagueResult(t, 'x', { sa: 1, sb: 0 }, 3), /não encontrada/);
});

test('desempate: mesmos pontos → mais vitórias, depois saldo de gols', () => {
  const t = { teams: teams(4), champion: null, activity: [], league: { teamIds: ['t1', 't2', 't3', 't4'], rounds: [[
    { key: '0-0', r: 0, i: 0, a: 't1', b: 't2', sa: 1, sb: 0, done: true },
    { key: '0-1', r: 0, i: 1, a: 't3', b: 't4', sa: 5, sb: 0, done: true },
    { key: '1-0', r: 1, i: 0, a: 't1', b: 't3', sa: 0, sb: 0, done: true },
    { key: '1-1', r: 1, i: 1, a: 't2', b: 't4', sa: 0, sb: 0, done: true },
  ]] } };
  const tab = leagueTable(t, id => id);
  assert.equal(tab[0].id, 't3', 't3: 4 pts e saldo +5 à frente de t1: 4 pts e saldo +1');
  assert.equal(tab[1].id, 't1');
  assert.deepEqual(tab.map(r => r.pos), [1, 2, 3, 4]);
});

let S;
before(async () => { S = await startServer(); });
after(async () => { setClock(null); await S.close(); });

test('API: criar campeonato de pontos corridos (demo), gerar a tabela, lançar resultados e coroar o campeão', async () => {
  const c = await signup(S.base, 'Org Liga');
  const created = await c.post('/tournaments', { name: 'Liga dos Amigos', sport: 'futebol', demo: true, format: 'league', leagueMax: 4 });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const t = created.data.tournament;
  assert.equal(t.format, 'league'); assert.equal(t.leagueMax, 4);
  assert.equal(t.league, null);
  const bad = await c.patch(`/tournaments/${t.id}`, { leagueMax: 0 });
  assert.equal(bad.status, 400);
  assert.equal((await c.patch(`/tournaments/${t.id}`, { format: 'xyz' })).status, 400);
  assert.equal((await c.post(`/tournaments/${t.id}/league/0-0`, { sa: 1, sb: 0 })).status, 409, 'sem tabela ainda');
  const d = await c.post(`/tournaments/${t.id}/draw`);
  assert.equal(d.status, 200, JSON.stringify(d.data));
  let v = d.data.tournament;
  assert.equal(v.bracket, null);
  assert.equal(v.league.rounds.length, 4, 'máximo de 4 partidas por time');
  assert.equal(v.league.rounds[0].matches.length, 4);
  assert.equal(v.status, 'chaveamento');
  assert.equal(v.registration.open, false);
  assert.equal((await c.patch(`/tournaments/${t.id}`, { format: 'knockout' })).status, 400, 'formato trava depois do sorteio');
  assert.equal((await c.patch(`/tournaments/${t.id}`, { leagueMax: 2 })).status, 400);
  // resultado manual
  const first = v.league.rounds[0].matches[0];
  const r1 = await c.post(`/tournaments/${t.id}/league/${first.key}`, { sa: 3, sb: 1 });
  assert.equal(r1.status, 200);
  v = r1.data.tournament;
  assert.equal(v.status, 'andamento');
  assert.equal(v.league.table.find(r => r.id === first.a).pts, 3);
  assert.equal(v.stats.matchesDone, 1); assert.equal(v.stats.matchesTotal, 16);
  assert.equal((await c.post(`/tournaments/${t.id}/league/${first.key}`, { sa: 'x', sb: 1 })).status, 400);
  assert.equal((await c.post(`/tournaments/${t.id}/draw`)).status, 409, 'não sorteia de novo com resultados');
  // simular as rodadas restantes: campeão = líder da tabela
  for (let i = 0; i < 4; i++) assert.equal((await c.post(`/tournaments/${t.id}/demo/simulate`)).status, 200);
  v = (await c.get(`/tournaments/${t.id}`)).data.tournament;
  assert.equal(v.status, 'finalizado');
  assert.equal(v.champion, v.league.table[0].id);
  assert.ok(v.league.table[0].pts >= v.league.table[1].pts);
  assert.equal(v.stats.matchesDone, 16);
  // público também vê a tabela
  const pub = (await new Client(S.base).get(`/public/${t.id}`)).data.tournament;
  assert.equal(pub.league.table.length, 8);
  assert.equal(pub.champion, v.champion);
  // reiniciar
  assert.equal((await c.post(`/tournaments/${t.id}/reset-bracket`, { confirm: true })).status, 200);
  v = (await c.get(`/tournaments/${t.id}`)).data.tournament;
  assert.equal(v.league, null); assert.equal(v.champion, null);
});

test('Jarvis do ArenaMaster: conselho pronto sem IA, só para organizadores', async () => {
  for (const k of ['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY']) delete process.env[k];
  const c = await signup(S.base, 'Org Jarvis');
  const t = (await c.post('/tournaments', { name: 'Liga do Jarvis', sport: 'futsal', format: 'league' })).data.tournament;
  const r = await c.post(`/tournaments/${t.id}/jarvis`);
  assert.equal(r.status, 200);
  assert.equal(r.data.ai, null);
  assert.match(r.data.text, /0 times confirmados|precisa de ao menos 3/);
  assert.equal((await new Client(S.base).post(`/tournaments/${t.id}/jarvis`)).status, 401);
  const other = await signup(S.base, 'Outro Org');
  assert.ok([403, 404].includes((await other.post(`/tournaments/${t.id}/jarvis`)).status));
});
