import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, signup, teamInput } from './helpers.js';
import { setClock } from '../../lib/clock.js';

let S;
before(async () => { S = await startServer(); });
after(async () => { setClock(null); await S.close(); });

async function setup(n, { sport = 'futsal', origins = [], draw = true } = {}) {
  const org = await signup(S.base);
  const t = (await org.post('/tournaments', { name: 'Copa do Chaveamento', sport, finalDate: '2026-12-12' })).data.tournament;
  await org.patch(`/tournaments/${t.id}`, { maxTeams: n <= 4 ? 4 : n <= 8 ? 8 : n <= 16 ? 16 : 32 });
  for (let i = 0; i < n; i++) {
    const r = await org.post(`/tournaments/${t.id}/teams`, teamInput(`Equipe ${String.fromCharCode(65 + i)}${i}`, sport, { origin: origins[i] ?? '', offset: i }));
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  let view = (await org.get(`/tournaments/${t.id}`)).data.tournament;
  if (draw) { const d = await org.post(`/tournaments/${t.id}/draw`); assert.equal(d.status, 200, JSON.stringify(d.data)); view = d.data.tournament; }
  return { org, t, view, id: t.id };
}
const act = (org, id, key, body) => org.post(`/tournaments/${id}/matches/${key}`, body);
const get = async (org, id) => (await org.get(`/tournaments/${id}`)).data.tournament;
const nm = (v, tid) => v.teams.find(x => x.id === tid)?.name;

test('sorteio de 8 times: 3 fases, cada time aparece uma vez, sem byes', async () => {
  const { view } = await setup(8);
  assert.deepEqual(view.bracket.rounds.map(r => r.matches.length), [4, 2, 1]);
  assert.deepEqual(view.bracket.rounds.map(r => r.name), ['Quartas de final', 'Semifinais', 'Final']);
  const ids = view.bracket.rounds[0].matches.flatMap(m => [m.a, m.b]);
  assert.equal(new Set(ids).size, 8);
  assert.ok(ids.every(Boolean));
  assert.equal(view.status, 'chaveamento');
  assert.equal(view.registration.open, false);
  assert.ok(view.bracket.info.balance >= 0 && view.bracket.info.balance <= 100);
  assert.equal(view.bracket.info.conflicts, 0);
});

test('sorteio com número ímpar usa byes e avança os times automaticamente', async () => {
  const { view } = await setup(5);
  const r0 = view.bracket.rounds[0].matches;
  assert.equal(r0.length, 4);
  const byes = r0.filter(m => m.bye);
  assert.equal(byes.length, 3);
  assert.ok(byes.every(m => m.win && (m.a ? !m.b : m.b)));
  // 5 times: 1 jogo real na 1ª fase + 3 byes → 2ª fase tem os 3 byes e o vencedor pendente
  const placed = view.bracket.rounds[1].matches.flatMap(m => [m.a, m.b]).filter(Boolean);
  assert.equal(placed.length, 3);
  // partidas bye não contam como jogos
  assert.equal(view.stats.matchesTotal, view.bracket.rounds.flat().flatMap(r => r.matches).filter(m => !m.bye).length);
});

test('sorteio com 2 times cria apenas a final; menos de 2 é recusado', async () => {
  const two = await setup(2);
  assert.deepEqual(two.view.bracket.rounds.map(r => r.matches.length), [1]);
  assert.equal(two.view.bracket.rounds[0].name, 'Final');
  const one = await setup(1, { draw: false });
  const r = await one.org.post(`/tournaments/${one.id}/draw`);
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, 'NOT_ENOUGH_TEAMS');
});

test('sorteio de 16 e 32 times', async () => {
  const s16 = await setup(16);
  assert.deepEqual(s16.view.bracket.rounds.map(r => r.matches.length), [8, 4, 2, 1]);
  assert.deepEqual(s16.view.bracket.rounds.map(r => r.name), ['Oitavas de final', 'Quartas de final', 'Semifinais', 'Final']);
  const s20 = await setup(20);
  assert.equal(s20.view.bracket.size, 32);
  assert.equal(s20.view.bracket.info.byes, 12);
});

test('sorteio evita confrontos entre times do mesmo clube/bairro quando possível', async () => {
  const origins = ['Vila', 'Vila', 'Centro', 'Centro', 'Norte', 'Norte', 'Sul', 'Sul'];
  for (let k = 0; k < 5; k++) {
    const { view } = await setup(8, { origins });
    for (const m of view.bracket.rounds[0].matches) {
      const a = view.teams.find(x => x.id === m.a), b = view.teams.find(x => x.id === m.b);
      assert.notEqual(a.origin, b.origin);
    }
  }
});

test('refazer o sorteio é permitido antes de qualquer resultado', async () => {
  const { org, id } = await setup(8);
  assert.equal((await org.post(`/tournaments/${id}/draw`)).status, 200);
});

test('futsal ao vivo: relógio, gols, cartões, pausa, undo e encerramento avança o vencedor', async () => {
  const { org, id, view } = await setup(4);
  const m = view.bracket.rounds[0].matches[0];
  assert.equal(m.phase, 'scheduled');

  assert.equal((await act(org, id, m.key, { action: 'start' })).status, 200);
  let v = await get(org, id);
  let mm = v.bracket.rounds[0].matches[0];
  assert.equal(mm.phase, 'live');
  assert.equal(mm.clock.status, 'running');
  assert.ok(mm.clock.startedAt);
  assert.equal((await act(org, id, m.key, { action: 'start' })).status, 409);

  await act(org, id, m.key, { action: 'event', type: 'goal', team: 'a', num: 9 });
  await act(org, id, m.key, { action: 'event', type: 'goal', team: 'a', num: 7 });
  await act(org, id, m.key, { action: 'event', type: 'goal', team: 'b' });
  await act(org, id, m.key, { action: 'event', type: 'yellow', team: 'b', num: 5 });
  assert.equal((await act(org, id, m.key, { action: 'event', type: 'tech', team: 'b' })).status, 400); // não existe no futsal
  assert.equal((await act(org, id, m.key, { action: 'event', type: 'goal', team: 'x' })).status, 400);
  v = await get(org, id); mm = v.bracket.rounds[0].matches[0];
  assert.deepEqual([mm.score.a, mm.score.b], [2, 1]);
  assert.equal(mm.events.filter(e => e.type === 'goal').length, 3);

  await act(org, id, m.key, { action: 'score-minus', team: 'a' });
  v = await get(org, id); assert.deepEqual([v.bracket.rounds[0].matches[0].score.a, v.bracket.rounds[0].matches[0].score.b], [1, 1]);
  await act(org, id, m.key, { action: 'undo' }); // desfaz o cartão
  assert.equal((await get(org, id)).bracket.rounds[0].matches[0].events.some(e => e.type === 'yellow'), false);

  await act(org, id, m.key, { action: 'pause' });
  assert.equal((await get(org, id)).bracket.rounds[0].matches[0].clock.status, 'paused');
  assert.equal((await act(org, id, m.key, { action: 'pause' })).status, 409);
  assert.equal((await act(org, id, m.key, { action: 'adjust', minutes: 5 })).status, 200);
  assert.ok((await get(org, id)).bracket.rounds[0].matches[0].clock.elapsedMs >= 5 * 60000);
  assert.equal((await act(org, id, m.key, { action: 'adjust', minutes: 999 })).status, 400);

  // empate (1 × 1) → exige pênaltis
  const tie = await act(org, id, m.key, { action: 'finalize' });
  assert.equal(tie.status, 409);
  assert.equal(tie.data.error.code, 'TIE');
  assert.equal(tie.data.error.details.tiebreak, 'pênaltis');
  assert.equal((await act(org, id, m.key, { action: 'finalize', pa: 3, pb: 3 })).status, 400);
  const fin = await act(org, id, m.key, { action: 'finalize', pa: 2, pb: 4 });
  assert.equal(fin.status, 200, JSON.stringify(fin.data));
  v = fin.data.tournament;
  mm = v.bracket.rounds[0].matches[0];
  assert.equal(mm.win, 'b');
  assert.equal(mm.phase, 'finished');
  assert.equal(mm.pa, 2); assert.equal(mm.pb, 4);
  assert.match(mm.note, /pênaltis: 2 × 4/);
  assert.equal(v.bracket.rounds[1].matches[0].a, mm.b); // vencedor avançou para a final
  assert.equal(v.stats.matchesDone, 1);
  assert.equal(v.status, 'andamento');
  // partida encerrada não aceita mais lances
  assert.equal((await act(org, id, m.key, { action: 'event', type: 'goal', team: 'a' })).status, 409);
});

test('final encerrada define o campeão e finaliza o torneio', async () => {
  const { org, id, view } = await setup(4);
  for (const m of view.bracket.rounds[0].matches) assert.equal((await act(org, id, m.key, { action: 'result', sa: 3, sb: 1 })).status, 200);
  let v = await get(org, id);
  const final = v.bracket.rounds[1].matches[0];
  assert.ok(final.a && final.b);
  const done = await act(org, id, final.key, { action: 'result', sa: 0, sb: 2 });
  assert.equal(done.status, 200);
  v = done.data.tournament;
  assert.equal(v.status, 'finalizado');
  assert.equal(v.champion, final.b);
  assert.equal(v.stats.matchesDone, 3);
  const pub = (await new Client(S.base).get(`/public/${id}`)).data.tournament;
  assert.equal(pub.champion, final.b);
});

test('resultado manual valida números e exige desempate', async () => {
  const { org, id, view } = await setup(4);
  const key = view.bracket.rounds[0].matches[0].key;
  assert.equal((await act(org, id, key, { action: 'result', sa: -1, sb: 2 })).status, 400);
  assert.equal((await act(org, id, key, { action: 'result', sa: 'x', sb: 2 })).status, 400);
  assert.equal((await act(org, id, key, { action: 'result', sa: 2, sb: 2 })).status, 409);
  assert.equal((await act(org, id, key, { action: 'result', sa: 2, sb: 2, pa: 5, pb: 4 })).status, 200);
});

test('partida da fase seguinte só começa com os dois times definidos', async () => {
  const { org, id } = await setup(4);
  const r = await act(org, id, '1-0', { action: 'start' });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'NOT_READY');
  assert.equal((await act(org, id, '9-9', { action: 'start' })).status, 404);
  assert.equal((await act(org, id, 'abc', { action: 'start' })).status, 404);
});

test('reabrir partida: desfaz o avanço se a próxima fase ainda não começou', async () => {
  const { org, id, view } = await setup(4);
  const [m0, m1] = view.bracket.rounds[0].matches;
  await act(org, id, m0.key, { action: 'result', sa: 2, sb: 0 });
  let v = await get(org, id);
  assert.equal(v.bracket.rounds[1].matches[0].a, m0.a);
  const re = await act(org, id, m0.key, { action: 'reopen' });
  assert.equal(re.status, 200);
  v = re.data.tournament;
  assert.equal(v.bracket.rounds[1].matches[0].a, null);
  assert.equal(v.bracket.rounds[0].matches[0].win, null);
  // refaz e depois joga a fase seguinte → bloqueia reabertura
  await act(org, id, m0.key, { action: 'result', sa: 1, sb: 0 });
  await act(org, id, m1.key, { action: 'result', sa: 1, sb: 0 });
  await act(org, id, '1-0', { action: 'result', sa: 1, sb: 0 });
  assert.equal((await act(org, id, m0.key, { action: 'reopen' })).status, 409);
});

test('vôlei: sets a 25, vantagem de 2, 5º set a 15, desfazer ponto e encerramento só com 3 sets', async () => {
  const { org, id, view } = await setup(4, { sport: 'volei' });
  const key = view.bracket.rounds[0].matches[0].key;
  const pt = (team, n = 1) => Promise.all(Array.from({ length: n }, () => null)).then(async () => { for (let i = 0; i < n; i++) assert.equal((await act(org, id, key, { action: 'event', type: 'goal', team })).status, 200); });
  assert.equal((await act(org, id, key, { action: 'adjust', minutes: 1 })).status, 400); // sem relógio
  await pt('a', 24); await pt('b', 24);
  let m = (await get(org, id)).bracket.rounds[0].matches[0];
  assert.deepEqual([m.score.cur.a, m.score.cur.b, m.score.set], [24, 24, 1]);
  await pt('a'); // 25-24: ainda não fecha (vantagem de 2)
  m = (await get(org, id)).bracket.rounds[0].matches[0];
  assert.deepEqual([m.score.a, m.score.b, m.score.set], [0, 0, 1]);
  await pt('a'); // 26-24 fecha o set 1
  m = (await get(org, id)).bracket.rounds[0].matches[0];
  assert.deepEqual([m.score.a, m.score.b, m.score.set], [1, 0, 2]);
  assert.deepEqual(m.score.setScores.map(s => [s.a, s.b]), [[26, 24]]);
  // desfazer o ponto decisivo reabre o set 1
  assert.equal((await act(org, id, key, { action: 'undo' })).status, 200);
  m = (await get(org, id)).bracket.rounds[0].matches[0];
  assert.deepEqual([m.score.a, m.score.b, m.score.set, m.score.cur.a], [0, 0, 1, 25]);
  await pt('a');
  // set 2 e 3 para A → decide a partida (3x0)
  await pt('a', 25); await pt('a', 25);
  m = (await get(org, id)).bracket.rounds[0].matches[0];
  assert.deepEqual([m.score.a, m.score.b], [3, 0]);
  assert.equal(m.decided, 'a');
  assert.equal((await act(org, id, key, { action: 'event', type: 'goal', team: 'b' })).status, 409); // já decidido
  const fin = await act(org, id, key, { action: 'finalize' });
  assert.equal(fin.status, 200);
  const mm = fin.data.tournament.bracket.rounds[0].matches[0];
  assert.equal(mm.win, 'a');
  assert.deepEqual([mm.score.a, mm.score.b], [3, 0]);
  assert.equal(mm.score.setScores.length, 3);
});

test('vôlei: não encerra antes de 3 sets; resultado manual valida sets', async () => {
  const { org, id, view } = await setup(4, { sport: 'volei' });
  const [m0, m1] = view.bracket.rounds[0].matches;
  assert.equal((await act(org, id, m0.key, { action: 'finalize' })).status, 409);
  assert.equal((await act(org, id, m0.key, { action: 'result', sa: 2, sb: 1 })).status, 400);
  assert.equal((await act(org, id, m0.key, { action: 'result', sa: 3, sb: 3 })).status, 400);
  assert.equal((await act(org, id, m0.key, { action: 'result', sa: 3, sb: 1 })).status, 200);
  void m1;
});

test('basquete: cestas de 1/2/3 pontos e empate exige prorrogação', async () => {
  const { org, id, view } = await setup(4, { sport: 'basquete' });
  const key = view.bracket.rounds[0].matches[0].key;
  await act(org, id, key, { action: 'event', type: 'goal', team: 'a', pts: 3 });
  await act(org, id, key, { action: 'event', type: 'goal', team: 'b', pts: 2 });
  await act(org, id, key, { action: 'event', type: 'goal', team: 'b', pts: 1 });
  assert.equal((await act(org, id, key, { action: 'event', type: 'goal', team: 'b', pts: 4 })).status, 400);
  let m = (await get(org, id)).bracket.rounds[0].matches[0];
  assert.deepEqual([m.score.a, m.score.b], [3, 3]);
  const tie = await act(org, id, key, { action: 'finalize' });
  assert.equal(tie.status, 409);
  assert.equal(tie.data.error.details.tiebreak, 'prorrogação');
  assert.equal((await act(org, id, key, { action: 'finalize', pa: 5, pb: 3 })).status, 409); // sem pênaltis no basquete
  await act(org, id, key, { action: 'event', type: 'goal', team: 'a', pts: 2 });
  assert.equal((await act(org, id, key, { action: 'finalize' })).status, 200);
});

test('visitante vê lances e placar ao vivo (sem login) e o ETag muda a cada lance', async () => {
  const { org, id, view } = await setup(4);
  const key = view.bracket.rounds[0].matches[0].key;
  const v = new Client(S.base);
  const e1 = (await v.get(`/public/${id}`)).headers.get('etag');
  await act(org, id, key, { action: 'start' });
  await act(org, id, key, { action: 'event', type: 'goal', team: 'a', num: 10 });
  const r = await v.get(`/public/${id}`);
  assert.notEqual(r.headers.get('etag'), e1);
  const m = r.data.tournament.bracket.rounds[0].matches[0];
  assert.equal(m.phase, 'live');
  assert.equal(m.score.a, 1);
  assert.ok(m.events.some(e => e.type === 'goal' && e.num === 10));
  assert.equal(r.data.tournament.status, 'andamento');
  // visitante não controla partidas
  assert.equal((await v.post(`/tournaments/${id}/matches/${key}`, { action: 'event', type: 'goal', team: 'a' })).status, 401);
});

test('reiniciar chaveamento exige confirmação e limpa resultados', async () => {
  const { org, id, view } = await setup(4);
  await act(org, id, view.bracket.rounds[0].matches[0].key, { action: 'result', sa: 1, sb: 0 });
  assert.equal((await org.post(`/tournaments/${id}/reset-bracket`, {})).status, 400);
  const r = await org.post(`/tournaments/${id}/reset-bracket`, { confirm: true });
  assert.equal(r.status, 200);
  assert.equal(r.data.tournament.bracket, null);
  assert.equal(r.data.tournament.teams.every(t => !t.elim), true);
  assert.equal((await org.post(`/tournaments/${id}/draw`)).status, 200);
});

// ------------------------------------------------------------------ repescagem beneficente

test('repescagem: doação libera revanche, bloqueia a partida seguinte e o desafiante pode voltar à tabela', async () => {
  const { org, id, view } = await setup(4);
  const [m0, m1] = view.bracket.rounds[0].matches;
  await act(org, id, m0.key, { action: 'result', sa: 3, sb: 0 });
  let v = await get(org, id);
  const loser = v.teams.find(x => x.id === m0.b);
  assert.equal(loser.repesc.ok, true);

  // abaixo do mínimo e time ainda em disputa
  assert.equal((await org.post(`/tournaments/${id}/donations`, { teamId: loser.id, amount: 100 })).status, 400);
  assert.equal((await org.post(`/tournaments/${id}/donations`, { teamId: m1.a, amount: 5000 })).status, 409);

  const d = await org.post(`/tournaments/${id}/donations`, { teamId: loser.id, amount: 5000, cause: 'Banco de Alimentos local' });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  v = d.data.tournament;
  assert.equal(v.donations.total, 5000);
  assert.equal(v.donations.count, 1);
  assert.equal(v.bracket.playins.length, 1);
  const pin = v.bracket.playins[0];
  assert.equal(pin.a, loser.id);
  assert.equal(pin.b, m0.a);
  assert.equal(v.bracket.rounds[1].matches[0].blocked, true);
  assert.equal(v.teams.find(x => x.id === loser.id).repescada, true);
  assert.equal(v.teams.find(x => x.id === loser.id).repesc.ok, false); // uma por equipe

  // a final-semifinal não pode começar enquanto a revanche estiver pendente
  await act(org, id, m1.key, { action: 'result', sa: 1, sb: 0 });
  assert.equal((await act(org, id, '1-0', { action: 'start' })).status, 409);
  assert.equal((await act(org, id, '1-0', { action: 'result', sa: 1, sb: 0 })).status, 409);

  // revanche: desafiante vence → volta à tabela
  const res = await act(org, id, pin.key, { action: 'result', sa: 2, sb: 1 });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  v = res.data.tournament;
  assert.equal(v.bracket.rounds[1].matches[0].a, loser.id);
  assert.equal(v.bracket.rounds[1].matches[0].blocked, false);
  assert.equal(v.bracket.playins[0].phase, 'finished');
  const defender = v.teams.find(x => x.id === m0.a);
  assert.equal(defender.eliminated, true);
  assert.equal(defender.repesc.ok, false); // eliminado na revanche não pode repescar
  assert.equal(v.status, 'andamento');
  assert.equal(v.activity.some(a => a.type === 'donation'), true);
});

test('repescagem: desafiante perde a revanche e fica fora; doação é contabilizada mesmo assim', async () => {
  const { org, id, view } = await setup(4);
  const [m0] = view.bracket.rounds[0].matches;
  await act(org, id, m0.key, { action: 'result', sa: 0, sb: 1 });
  const loser = m0.a;
  const d = await org.post(`/tournaments/${id}/donations`, { teamId: loser, amount: 2000 });
  const pin = d.data.tournament.bracket.playins[0];
  const res = await act(org, id, pin.key, { action: 'result', sa: 0, sb: 4 });
  const v = res.data.tournament;
  assert.equal(v.bracket.rounds[1].matches[0].b ?? v.bracket.rounds[1].matches[0].a, m0.b);
  assert.equal(v.donations.total, 2000);
  assert.equal(v.teams.find(x => x.id === loser).eliminated, true);
});

test('repescagem: revanche também usa relógio/placar ao vivo e empate pede pênaltis', async () => {
  const { org, id, view } = await setup(4);
  const [m0] = view.bracket.rounds[0].matches;
  await act(org, id, m0.key, { action: 'result', sa: 5, sb: 2 });
  const d = await org.post(`/tournaments/${id}/donations`, { teamId: m0.b, amount: 3000 });
  const key = d.data.tournament.bracket.playins[0].key;
  await act(org, id, key, { action: 'start' });
  await act(org, id, key, { action: 'event', type: 'goal', team: 'a' });
  await act(org, id, key, { action: 'event', type: 'goal', team: 'b' });
  assert.equal((await act(org, id, key, { action: 'finalize' })).data.error.code, 'TIE');
  const fin = await act(org, id, key, { action: 'finalize', pa: 5, pb: 4 });
  assert.equal(fin.status, 200);
  assert.equal(fin.data.tournament.bracket.rounds[1].matches[0].a ?? fin.data.tournament.bracket.rounds[1].matches[0].b, m0.b);
});

test('repescagem: eliminado na final ou com a fase seguinte já iniciada não é elegível', async () => {
  const { org, id, view } = await setup(4);
  const [m0, m1] = view.bracket.rounds[0].matches;
  await act(org, id, m0.key, { action: 'result', sa: 2, sb: 0 });
  await act(org, id, m1.key, { action: 'result', sa: 2, sb: 0 });
  await act(org, id, '1-0', { action: 'start' }); // final em andamento
  const r = await org.post(`/tournaments/${id}/donations`, { teamId: m0.b, amount: 5000 });
  assert.equal(r.status, 409);
  assert.match(r.data.error.message, /Janela encerrada/);
  await act(org, id, '1-0', { action: 'result', sa: 1, sb: 0 });
  const v = await get(org, id);
  const finalLoser = v.teams.find(x => x.id === v.bracket.rounds[1].matches[0].b);
  assert.equal(finalLoser.repesc.ok, false);
  assert.match(finalLoser.repesc.reason, /final/);
});

test('repescagem pelo capitão: PIX de doação, simulação aprova e abre a revanche', async () => {
  const { org, id, view } = await setup(4);
  const [m0] = view.bracket.rounds[0].matches;
  await act(org, id, m0.key, { action: 'result', sa: 2, sb: 0 });
  const adm = await get(org, id);
  const loser = adm.teams.find(x => x.id === m0.b);
  const v = new Client(S.base);
  const mine = await v.get(`/public/${id}/teams/${loser.id}?code=${loser.accessCode}`);
  assert.equal(mine.data.team.repesc.ok, true);

  assert.equal((await v.post(`/public/${id}/teams/${loser.id}/repescagem`, { code: 'ERRADO', amount: 5000, method: 'pix', agree: true })).status, 403);
  assert.equal((await v.post(`/public/${id}/teams/${loser.id}/repescagem`, { code: loser.accessCode, amount: 100, method: 'pix', agree: true })).status, 400);
  assert.equal((await v.post(`/public/${id}/teams/${loser.id}/repescagem`, { code: loser.accessCode, amount: 5000, method: 'pix' })).status, 400); // sem aceite

  const pay = await v.post(`/public/${id}/teams/${loser.id}/repescagem`, { code: loser.accessCode, amount: 5000, method: 'pix', agree: true, cause: 'Escolinha de esporte social' });
  assert.equal(pay.status, 200, JSON.stringify(pay.data));
  assert.equal(pay.data.payment.kind, 'donation');
  assert.equal(pay.data.payment.status, 'pending');
  // ainda sem revanche
  assert.equal((await get(org, id)).bracket.playins.length, 0);
  const sim = await v.post(`/public/${id}/payments/${pay.data.payment.id}/simulate`, { code: loser.accessCode });
  assert.equal(sim.data.payment.status, 'approved');
  const after = await get(org, id);
  assert.equal(after.bracket.playins.length, 1);
  assert.equal(after.donations.total, 5000);
  assert.equal(after.donationItems[0].cause, 'Escolinha de esporte social');

  // cartão recusado não libera nada
  const { org: org2, id: id2, view: view2 } = await setup(4);
  await act(org2, id2, view2.bracket.rounds[0].matches[0].key, { action: 'result', sa: 2, sb: 0 });
  const t2 = await get(org2, id2);
  const l2 = t2.teams.find(x => x.id === view2.bracket.rounds[0].matches[0].b);
  const bad = await v.post(`/public/${id2}/teams/${l2.id}/repescagem`, { code: l2.accessCode, amount: 5000, method: 'card', agree: true, card: { number: '4000000000000002', name: 'FULANO', expiry: '12/39', cvv: '123' } });
  assert.equal(bad.data.payment.status, 'declined');
  assert.equal((await get(org2, id2)).bracket.playins.length, 0);
  const good = await v.post(`/public/${id2}/teams/${l2.id}/repescagem`, { code: l2.accessCode, amount: 5000, method: 'card', agree: true, card: { number: '4242424242424242', name: 'FULANO', expiry: '12/39', cvv: '123' } });
  assert.equal(good.data.payment.status, 'approved');
  assert.equal((await get(org2, id2)).bracket.playins.length, 1);
});

test('repescagem desabilitada pelo organizador', async () => {
  const { org, id, view } = await setup(4);
  await org.patch(`/tournaments/${id}`, { donationEnabled: false });
  await act(org, id, view.bracket.rounds[0].matches[0].key, { action: 'result', sa: 2, sb: 0 });
  const r = await org.post(`/tournaments/${id}/donations`, { teamId: view.bracket.rounds[0].matches[0].b, amount: 5000 });
  assert.equal(r.status, 409);
});

test('atividade registra eventos relevantes (notificações do organizador)', async () => {
  const { org, id } = await setup(4);
  const v = await get(org, id);
  const types = new Set(v.activity.map(a => a.type));
  assert.ok(types.has('team') && types.has('draw'));
});

test('concorrência: inscrições simultâneas não estouram a capacidade', async () => {
  const org = await signup(S.base);
  const t = (await org.post('/tournaments', { name: 'Corrida pelas vagas', sport: 'futsal' })).data.tournament;
  await org.patch(`/tournaments/${t.id}`, { maxTeams: 4 });
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => new Client(S.base).post(`/public/${t.id}/teams`, teamInput('Corredor ' + i + 'xx', 'futsal', { offset: i }))));
  assert.equal(results.filter(r => r.status === 200).length, 4);
  assert.equal(results.filter(r => r.status === 409).length, 6);
  const adm = await get(org, t.id);
  assert.equal(adm.teams.filter(x => x.status === 'confirmed').length, 4);
});
