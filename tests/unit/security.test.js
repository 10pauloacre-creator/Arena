import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, signup, teamInput } from './helpers.js';
import { setClock } from '../../lib/clock.js';

let S;
before(async () => { S = await startServer(); });
after(async () => { setClock(null); await S.close(); });

async function paidTournament() {
  const org = await signup(S.base);
  const t = (await org.post('/tournaments', { name: 'Copa Segurança', sport: 'futsal' })).data.tournament;
  await org.patch(`/tournaments/${t.id}`, { fee: 5000 });
  return { org, t };
}

test('código do capitão: tentativas erradas são limitadas por IP e por time', async () => {
  const { t } = await paidTournament();
  const v = new Client(S.base);
  const team = (await v.post(`/public/${t.id}/teams`, teamInput('Alvo FC', 'futsal'))).data.team;
  const attacker = new Client(S.base);
  let last;
  for (let i = 0; i < 12; i++) last = await attacker.get(`/public/${t.id}/teams/${team.id}?code=AAAA${String(i).padStart(4, '0')}`);
  assert.equal(last.status, 429);
  // o capitão legítimo (outro IP) continua acessando
  const ok = await v.get(`/public/${t.id}/teams/${team.id}?code=${team.accessCode}`);
  assert.equal(ok.status, 200);
  // o atacante bloqueado não consegue nem com o código certo até a janela passar
  assert.equal((await attacker.get(`/public/${t.id}/teams/${team.id}?code=${team.accessCode}`)).status, 429);
});

test('reserva é estendida ao iniciar o pagamento, mas nunca passa de 60 min desde a inscrição', async () => {
  const { org, t } = await paidTournament();
  const v = new Client(S.base);
  const team = (await v.post(`/public/${t.id}/teams`, teamInput('Reserva FC', 'futsal'))).data.team;
  const t0 = Date.now();
  setClock(() => t0 + 29 * 60_000); // a 1 min de vencer
  const pay = await v.post(`/public/${t.id}/teams/${team.id}/pay`, { code: team.accessCode, method: 'pix' });
  assert.equal(pay.status, 200);
  const adm = (await org.get(`/tournaments/${t.id}`)).data.tournament;
  const left = adm.teams[0].reservedUntil - (t0 + 29 * 60_000);
  assert.ok(left >= 14 * 60_000, 'ganhou ao menos ~15 min');
  assert.ok(adm.teams[0].reservedUntil <= adm.teams[0].createdAt + 60 * 60_000, 'teto de 60 min');
  // pagar depois do prazo original ainda confirma
  setClock(() => t0 + 35 * 60_000);
  const sim = await v.post(`/public/${t.id}/payments/${pay.data.payment.id}/simulate`, { code: team.accessCode });
  assert.equal(sim.data.team.status, 'confirmed');
  setClock(null);
});

test('inscrições são limitadas por IP', async () => {
  const org = await signup(S.base);
  const t = (await org.post('/tournaments', { name: 'Copa Limite', sport: 'futsal' })).data.tournament;
  await org.patch(`/tournaments/${t.id}`, { maxTeams: 32 });
  const v = new Client(S.base);
  let last;
  for (let i = 0; i < 13; i++) last = await v.post(`/public/${t.id}/teams`, teamInput('Spam ' + i + 'abc', 'futsal', { offset: i }));
  assert.equal(last.status, 429);
});

test('rotas de administração exigem login e não vazam existência de torneios', async () => {
  const { t } = await paidTournament();
  const anon = new Client(S.base);
  for (const [m, p] of [['get', `/tournaments/${t.id}`], ['patch', `/tournaments/${t.id}`], ['post', `/tournaments/${t.id}/draw`], ['post', `/tournaments/${t.id}/invites`], ['del', `/tournaments/${t.id}`]]) {
    const r = await anon[m](p, m === 'get' ? undefined : {});
    assert.equal(r.status, 401, `${m} ${p}`);
  }
  const other = await signup(S.base);
  assert.equal((await other.post(`/tournaments/${t.id}/teams`, teamInput('Invasor FC', 'futsal'))).status, 403);
  assert.equal((await other.post(`/tournaments/${t.id}/matches/0-0`, { action: 'start' })).status, 403);
});

test('cabeçalhos: respostas da API não são cacheadas e JSON de erro tem formato estável', async () => {
  const r = await new Client(S.base).get('/tournaments');
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.data.error.code, 'UNAUTHENTICATED');
  assert.equal(typeof r.data.error.message, 'string');
});

test('corpo malformado e grande demais', async () => {
  const res = await fetch(S.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nao-e-json' });
  assert.equal(res.status, 400);
  const big = await fetch(S.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.com', password: 'x'.repeat(1_200_000) }) });
  assert.equal(big.status, 413);
});
