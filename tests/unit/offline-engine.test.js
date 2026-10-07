// Motor offline ponta a ponta (em Node): um "aparelho" com armazenamento em memória fala com o servidor real
// (em memória); a internet é ligada/desligada à vontade. O teste central é a PARIDADE: o que o aparelho previu
// sem internet tem que ser idêntico ao que o servidor tem depois de sincronizar.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, signup, teamInput } from './helpers.js';
import { setClock } from '../../lib/clock.js';
import { OfflineEngine, NetworkError } from '../../public/assets/js/offline/engine.js';
import { memoryDriver } from '../../public/assets/js/offline/storage.js';
import peladaPlugin from '../../public/assets/js/offline/plugins/pelada.js';
import tournamentPlugin from '../../public/assets/js/offline/plugins/tournament.js';
import publicPlugin from '../../public/assets/js/offline/plugins/public.js';

let S;
before(async () => { S = await startServer(); });
after(async () => { setClock(null); await S.close(); });

/** Um aparelho: motor + "rede" que pode cair. `client` fornece os cookies da sessão. */
function device(client, { synced = [] } = {}) {
  const net = { up: true, loseResponses: 0, calls: [] };
  const transport = async (method, path, body, opts = {}) => {
    if (!net.up) throw new NetworkError();
    net.calls.push({ method, path, headers: opts.headers || {} });
    const res = await fetch(S.base + '/api' + path, {
      method,
      headers: { 'X-Forwarded-For': client.ip, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(client.cookie ? { Cookie: client.cookie } : {}), ...(opts.headers || {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (net.loseResponses > 0) { net.loseResponses--; throw new NetworkError(); } // o servidor aplicou, mas a resposta se perdeu
    return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers };
  };
  const engine = new OfflineEngine({ storage: memoryDriver(), transport, env: { origin: S.base } });
  engine.register({ id: 'pelada', test: (m, p) => p.startsWith('/pelada/peladas/'), load: () => peladaPlugin });
  engine.register({ id: 'tournament', test: (m, p) => p.startsWith('/tournaments/'), load: () => tournamentPlugin });
  engine.register({ id: 'public', test: (m, p) => p.startsWith('/public/'), load: () => ({ ...publicPlugin, onSynced: async (op, res) => { synced.push(res.data.team); } }) });
  const call = (m, p, b, o) => engine.request(m, p, b, o);
  return { engine, net, call, get: (p, o) => call('GET', p, undefined, o), post: (p, b = {}, o) => call('POST', p, b, o), patch: (p, b = {}) => call('PATCH', p, b), del: p => call('DELETE', p) };
}

const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
let n = 0;
async function player(name) {
  const c = new Client(S.base);
  const r = await c.post('/pelada/auth/signup', { name: name ?? `Jogador Motor ${++n} Silva`, birth: '15/05/1992' });
  c.player = r.data.player;
  return c;
}
async function setupPelada(count = 7) {
  const owner = await player(`Dono Motor ${++n} Souza`);
  const r = await owner.post('/pelada/peladas', { name: 'Pelada do Motor', gender: 'masculino', minPerTeam: 3, matchMinutes: 10, days: [{ date: today(), matches: 0 }] });
  const id = r.data.pelada.id, dayId = r.data.pelada.days[0].id;
  const others = [];
  for (let i = 1; i < count; i++) others.push(await player(`Atleta Motor ${++n} Lima`));
  for (const p of [owner, ...others]) await p.post(`/pelada/peladas/${id}/days/${dayId}/presence`, { present: true });
  const dev = device(owner);
  dev.engine.setUser({ id: owner.player.id, name: owner.player.name, av: 0 });
  return { owner, others, id, dayId, dev, base: `/pelada/peladas/${id}/days/${dayId}`, path: `/pelada/peladas/${id}` };
}
const stripVolatile = v => { const c = structuredClone(v); delete c.invite; return c; };
const serverView = async (owner, path) => (await owner.get(path)).data.pelada;

test('online: o motor não atrapalha (resposta do servidor intacta) e guarda a cópia para uso offline', async () => {
  const s = await setupPelada(4);
  const r = await s.dev.get(s.path);
  assert.equal(r.status, 200);
  assert.equal(r.data.pelada.days[0].attendance.length, 4);
  assert.ok(r.headers.get('etag'));

  s.dev.net.up = false;
  const off = await s.dev.get(s.path);
  assert.equal(off.status, 200);
  assert.deepEqual(stripVolatile(off.data.pelada), stripVolatile(r.data.pelada));
  // sem etag igual → 200; com a etag que o aparelho já tem → 304
  const same = await s.dev.get(s.path, { headers: { 'If-None-Match': off.headers.get('etag') } });
  assert.equal(same.status, 304);
});

test('sem cópia local e sem internet, a leitura falha com erro de rede (a tela mostra o aviso)', async () => {
  const s = await setupPelada(3);
  s.dev.net.up = false;
  await assert.rejects(s.dev.get(s.path), e => e instanceof NetworkError);
  await assert.rejects(s.dev.post(`${s.base}/presence`, { present: false }), e => e instanceof NetworkError);
});

test('PARIDADE: tudo o que o dono faz sem internet (sorteio, partidas, cronômetro, gols, encerrar) bate com o servidor depois de sincronizar', async () => {
  const s = await setupPelada(7);
  await s.dev.get(s.path);          // abre a pelada com internet
  s.dev.net.up = false;             // ...e a internet cai

  const d = await s.dev.post(`${s.base}/draw`);
  assert.equal(d.status, 200); assert.equal(d.data.queued, true);
  const teams = d.data.pelada.days[0].draw.teams;
  assert.equal(teams.length, 2);

  const m1 = (await s.dev.post(`${s.base}/matches`, { a: teams[0].id, b: teams[1].id })).data.matchId;
  assert.match(m1, /^m_/);
  await s.dev.post(`${s.base}/matches/${m1}/timer`, { action: 'start' });
  const g1 = await s.dev.post(`${s.base}/matches/${m1}/goals`, { teamId: teams[0].id, pid: teams[0].players[0] });
  const g2 = await s.dev.post(`${s.base}/matches/${m1}/goals`, { teamId: teams[1].id, pid: teams[1].players[0] });
  await s.dev.post(`${s.base}/matches/${m1}/goals`, { teamId: teams[0].id, pid: teams[0].players[1] });
  await s.dev.del(`${s.base}/matches/${m1}/goals/${g2.data.goalId}`);
  assert.ok(g1.data.goalId);
  await s.dev.post(`${s.base}/matches/${m1}/timer`, { action: 'pause' });
  const fin = await s.dev.post(`${s.base}/matches/${m1}/finish`);
  assert.equal(fin.status, 200);
  assert.ok(fin.data.next, 'a próxima partida é criada sozinha');
  // gol na partida que só existe no aparelho (id determinístico)
  const g3 = await s.dev.post(`${s.base}/matches/${fin.data.next}/goals`, { teamId: teams[0].id, pid: null });
  assert.equal(g3.status, 200, JSON.stringify(g3.data));
  const guest = await s.dev.post(`${s.base}/guests`, { name: 'Convidado Offline', teamId: 'free' });
  assert.match(guest.data.guestPid, /^g:/);

  const predicted = (await s.dev.get(s.path)).data.pelada;   // visão local (ainda offline)
  assert.equal((await s.dev.engine.listPending()).length, 11);
  assert.equal(predicted.days[0].matches.length, 2);

  s.dev.net.up = true;
  await s.dev.engine.flush({ manual: true });
  assert.equal((await s.dev.engine.listPending()).length, 0);
  assert.equal((await s.dev.engine.listFailed()).length, 0);

  const truth = await serverView(s.owner, s.path);
  assert.deepEqual(stripVolatile(truth), stripVolatile(predicted), 'o aparelho previu exatamente o que o servidor guardou');
});

test('resposta perdida na queda: a operação já foi aplicada pelo servidor e o reenvio não duplica o gol', async () => {
  const s = await setupPelada(6);
  await s.dev.get(s.path);
  await s.dev.post(`${s.base}/draw`);
  const v = (await s.dev.get(s.path)).data.pelada;
  const [t1, t2] = v.days[0].draw.teams;
  const mid = (await s.dev.post(`${s.base}/matches`, { a: t1.id, b: t2.id })).data.matchId;
  await s.dev.post(`${s.base}/matches/${mid}/timer`, { action: 'start' });
  assert.equal((await s.dev.engine.listPending()).length, 0, 'online: nada fica na fila');

  s.dev.net.loseResponses = 1;                                        // o servidor aplica o gol, mas a resposta não chega
  const goal = await s.dev.post(`${s.base}/matches/${mid}/goals`, { teamId: t1.id, pid: t1.players[0] });
  assert.equal(goal.data.queued, true);
  assert.equal((await s.dev.engine.listPending()).length, 1);

  await s.dev.engine.flush({ manual: true });
  assert.equal((await s.dev.engine.listPending()).length, 0);
  const truth = await serverView(s.owner, s.path);
  assert.equal(truth.days[0].matches[0].goals.length, 1, 'um gol só');
  assert.equal(truth.days[0].matches[0].score.a, 1);
});

test('conflito: a operação que o servidor recusa vai para a lista de problemas e as outras seguem', async () => {
  const s = await setupPelada(6);
  await s.dev.get(s.path);
  await s.dev.post(`${s.base}/draw`);
  const v = (await s.dev.get(s.path)).data.pelada;
  const [t1, t2] = v.days[0].draw.teams;
  const mid = (await s.dev.post(`${s.base}/matches`, { a: t1.id, b: t2.id })).data.matchId;

  s.dev.net.up = false;
  const r = await s.dev.post(`${s.base}/matches/${mid}/timer`, { action: 'start' });
  assert.equal(r.status, 200);
  await s.dev.post(`${s.base}/matches/${mid}/goals`, { teamId: t1.id, pid: t1.players[0] });
  const gone = await s.dev.post(`${s.base}/matches/${mid}/finish`);
  assert.equal(gone.status, 200);

  // enquanto isso, em outro aparelho, a partida é excluída (a revanche dos fatos: a operação do aparelho ficou inválida)
  assert.equal((await s.owner.del(`${s.base}/matches/${mid}`)).status, 200);

  s.dev.net.up = true;
  await s.dev.engine.flush({ manual: true });
  const failed = await s.dev.engine.listFailed();
  assert.ok(failed.length >= 1, 'as operações sobre a partida excluída foram recusadas');
  assert.equal(failed[0].error.status, 404);
  assert.ok(failed[0].label);
  assert.equal((await s.dev.engine.listPending()).length, 0);

  await s.dev.engine.discardAll();
  assert.equal((await s.dev.engine.listFailed()).length, 0);
});

test('regra recusada na hora (igual ao servidor): nada entra na fila', async () => {
  const s = await setupPelada(6);
  await s.dev.get(s.path);
  s.dev.net.up = false;
  // não dá para iniciar o cronômetro de partida sem times, nem criar partida antes do sorteio com times inexistentes
  const bad = await s.dev.post(`${s.base}/matches`, { a: 't9', b: 't8' });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error.code, 'NO_DRAW');
  assert.equal((await s.dev.engine.listPending()).length, 0);
});

test('mudanças de outras pessoas enquanto o aparelho estava sem internet se juntam às dele (rebase)', async () => {
  const s = await setupPelada(4);
  const late = await player('Retardatário Motor da Silva');
  await s.dev.get(s.path);
  s.dev.net.up = false;
  await s.dev.post(`${s.base}/guests`, { name: 'Convidado do Dono' });
  assert.equal((await s.dev.get(s.path)).data.pelada.days[0].attendance.length, 5);

  assert.equal((await late.post(`${s.base}/presence`, { present: true })).status, 200); // outro aparelho, com internet
  s.dev.net.up = true;
  const merged = (await s.dev.get(s.path)).data.pelada;   // a leitura já traz o servidor + a operação ainda pendente
  assert.equal(merged.days[0].attendance.length, 6);
  assert.equal((await s.dev.engine.listPending()).length, 1, 'a operação do aparelho continua pendente até ser enviada');

  await s.dev.engine.flush({ manual: true });
  assert.equal((await serverView(s.owner, s.path)).days[0].attendance.length, 6);
  assert.equal((await s.dev.engine.listPending()).length, 0);
});

test('sessão expirada: a fila espera o login e segue depois', async () => {
  const s = await setupPelada(4);
  await s.dev.get(s.path);
  s.dev.net.up = false;
  await s.dev.post(`${s.base}/guests`, { name: 'Convidado 401' });
  s.dev.net.up = true;
  const cookie = s.owner.cookie;
  s.owner.cookie = '';                                 // o cookie sumiu / expirou
  let asked = 0;
  s.dev.engine.onNeedLogin = () => { asked++; };
  await s.dev.engine.flush({ manual: true });
  assert.equal(s.dev.engine.status().needsLogin, true);
  assert.equal(asked, 1);
  assert.equal((await s.dev.engine.listPending()).length, 1, 'a operação continua guardada');

  s.owner.cookie = cookie;                             // entrou de novo
  s.dev.engine.setUser({ id: s.owner.player.id, name: s.owner.player.name });
  await new Promise(r => setTimeout(r, 50));
  await s.dev.engine.flush({ manual: true });
  assert.equal((await s.dev.engine.listPending()).length, 0);
  assert.equal(s.dev.engine.status().needsLogin, false);
});

test('a fila é por usuário: operações de outra conta no mesmo aparelho não são enviadas', async () => {
  const s = await setupPelada(4);
  await s.dev.get(s.path);
  s.dev.net.up = false;
  await s.dev.post(`${s.base}/guests`, { name: 'Convidado do Dono 2' });
  assert.equal(s.dev.engine.status().pending, 1);
  s.dev.engine.setUser({ id: 'pl_outro', name: 'Outra Pessoa' });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(s.dev.engine.status().pending, 0);
  s.dev.net.up = true;
  await s.dev.engine.flush({ manual: true });
  assert.equal((await serverView(s.owner, s.path)).days[0].attendance.length, 4, 'nada foi enviado pela outra conta');
  s.dev.net.up = false;
  s.dev.engine.setUser({ id: s.owner.player.id, name: s.owner.player.name });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(s.dev.engine.status().pending, 1, 'a fila do dono volta quando ele entra');
  s.dev.net.up = true;
  await s.dev.engine.flush({ manual: true });
  assert.equal((await serverView(s.owner, s.path)).days[0].attendance.length, 5);
  s.dev.engine.stop();
});

test('torneio: o organizador marca o placar ao vivo sem internet e tudo bate depois de sincronizar', async () => {
  const org = await signup(S.base);
  const t = (await org.post('/tournaments', { name: 'Copa do Motor Offline', sport: 'futsal', finalDate: '2026-12-12' })).data.tournament;
  await org.patch(`/tournaments/${t.id}`, { maxTeams: 4 });
  for (let i = 0; i < 4; i++) await org.post(`/tournaments/${t.id}/teams`, teamInput(`Time Motor ${i}`, 'futsal', { offset: i }));
  const dev = device(org);
  dev.engine.setUser({ id: org.user.id, name: org.user.name });
  const path = `/tournaments/${t.id}`;
  const first = await dev.get(path);
  assert.equal(first.status, 200);
  const sorteio = await dev.post(`${path}/draw`);                   // online
  assert.equal(sorteio.status, 200);
  const key = sorteio.data.tournament.bracket.rounds[0].matches[0].key;

  dev.net.up = false;
  await dev.post(`${path}/matches/${key}`, { action: 'start' });
  await dev.post(`${path}/matches/${key}`, { action: 'event', type: 'goal', team: 'a' });
  await dev.post(`${path}/matches/${key}`, { action: 'event', type: 'goal', team: 'a' });
  await dev.post(`${path}/matches/${key}`, { action: 'event', type: 'goal', team: 'b' });
  await dev.post(`${path}/matches/${key}`, { action: 'event', type: 'yellow', team: 'b', num: 7 });
  const mid = await dev.post(`${path}/matches/${key}`, { action: 'undo' });
  assert.equal(mid.data.tournament.bracket.rounds[0].matches[0].score.a, 2);
  const fin = await dev.post(`${path}/matches/${key}`, { action: 'finalize' });
  assert.equal(fin.status, 200, JSON.stringify(fin.data));
  const predicted = (await dev.get(path)).data.tournament;
  assert.equal(predicted.bracket.rounds[0].matches[0].win, 'a');
  assert.equal(dev.engine.status().pending, 7);

  dev.net.up = true;
  await dev.engine.flush({ manual: true });
  assert.equal(dev.engine.status().pending, 0);
  assert.equal(dev.engine.status().failed, 0);
  const truth = (await org.get(path)).data.tournament;
  const norm = v => { const c = structuredClone(v); delete c.serverNow; delete c.version; return c; };
  assert.deepEqual(norm(truth.bracket), norm(predicted.bracket));
  assert.deepEqual(truth.activity.map(a => a.text), predicted.activity.map(a => a.text));
  assert.equal(truth.stats.matchesDone, predicted.stats.matchesDone);
});

test('visitante: o torneio público abre sem internet e a inscrição gratuita feita offline é enviada sozinha (sem duplicar)', async () => {
  const org = await signup(S.base);
  const t = (await org.post('/tournaments', { name: 'Copa Livre Offline', sport: 'futsal', finalDate: '2026-12-12' })).data.tournament;
  await org.patch(`/tournaments/${t.id}`, { maxTeams: 8 });
  const visitor = new Client(S.base);
  const synced = [];
  const dev = device(visitor, { synced });
  const pub = await dev.get(`/public/${t.id}`);
  assert.equal(pub.data.tournament.fee, 0);
  assert.equal(pub.data.tournament.registration.open, true);

  dev.net.up = false;
  const offlinePub = await dev.get(`/public/${t.id}`);
  assert.equal(offlinePub.data.tournament.id, t.id);

  const body = teamInput('Time Sem Sinal', 'futsal');
  const q = await dev.post(`/public/${t.id}/teams`, body);
  assert.equal(q.status, 200);
  assert.equal(q.data.queued, true);
  assert.equal(dev.engine.status().pending, 1);

  dev.net.up = true; dev.net.loseResponses = 1;               // 1º envio: o servidor cria o time, mas a resposta se perde
  await dev.engine.flush({ manual: true });
  assert.equal(dev.engine.status().pending, 1);
  dev.net.loseResponses = 0;
  await dev.engine.flush({ manual: true });                   // 2º envio: mesma operação → o servidor devolve o time já criado
  assert.equal(dev.engine.status().pending, 0);
  assert.equal(synced.length, 1);
  assert.ok(synced[0].accessCode);

  const teams = (await org.get(`/tournaments/${t.id}`)).data.tournament.teams.filter(x => x.name === 'Time Sem Sinal');
  assert.equal(teams.length, 1, 'o time foi criado uma única vez');
  assert.equal(teams[0].status, 'confirmed');
});

test('visitante: torneio com taxa NÃO é enfileirado (pagamento exige internet)', async () => {
  const org = await signup(S.base);
  const t = (await org.post('/tournaments', { name: 'Copa Paga Offline', sport: 'futsal', finalDate: '2026-12-12' })).data.tournament;
  await org.patch(`/tournaments/${t.id}`, { fee: 5000 });
  const dev = device(new Client(S.base));
  await dev.get(`/public/${t.id}`);
  dev.net.up = false;
  await assert.rejects(dev.post(`/public/${t.id}/teams`, teamInput('Time Pago', 'futsal')), e => e instanceof NetworkError);
  assert.equal(dev.engine.status().pending, 0);
});

test('pagamentos e login nunca são guardados em cache nem enfileirados', async () => {
  const dev = device(new Client(S.base));
  dev.net.up = false;
  await assert.rejects(dev.post('/auth/login', { email: 'a@b.com', password: 'x' }), e => e instanceof NetworkError);
  assert.equal(dev.engine.status().pending, 0);
});

test('pré-carregar guarda a cópia (e não repete a busca se a cópia é recente); sair da conta apaga cópias e fila', async () => {
  const s = await setupPelada(4);
  await s.dev.engine.prefetch([s.path]);
  const calls = s.dev.net.calls.length;
  await s.dev.engine.prefetch([s.path]);
  assert.equal(s.dev.net.calls.length, calls, 'cópia recente: sem nova busca');
  s.dev.net.up = false;
  assert.equal((await s.dev.get(s.path)).status, 200, 'abre offline graças ao pré-carregamento');
  await s.dev.post(`${s.base}/guests`, { name: 'Convidado Sairá' });
  assert.equal(s.dev.engine.status().pending, 1);
  await s.dev.engine.purgeUser();
  assert.equal(s.dev.engine.status().pending, 0);
  await assert.rejects(s.dev.get(s.path), e => e instanceof NetworkError);
});

test('"tentar de novo" devolve as operações com problema para a fila', async () => {
  const s = await setupPelada(5);
  await s.dev.get(s.path);
  s.dev.net.up = false;
  await s.dev.post(`${s.base}/guests`, { name: 'Convidado Repete' });
  // outro aparelho remove a data de jogo: a operação vai falhar com 404 quando for enviada
  s.dev.net.up = true;
  assert.equal((await s.owner.del(`/pelada/peladas/${s.id}/days/${s.dayId}`)).status, 200);
  await s.dev.engine.flush({ manual: true });
  assert.equal(s.dev.engine.status().failed, 1);
  await s.dev.engine.retryFailed();
  assert.equal(s.dev.engine.status().failed, 1, 'continua sendo recusada (a data não existe mais) e volta para a lista de problemas');
  assert.equal(s.dev.engine.status().pending, 0);
  s.dev.engine.stop();
});

test('operação que entra durante um envio em andamento também é enviada (sem ficar esquecida)', async () => {
  const s = await setupPelada(4);
  await s.dev.get(s.path);
  s.dev.net.up = false;
  await s.dev.post(`${s.base}/guests`, { name: 'Convidado Um' });
  s.dev.net.up = true;
  const first = s.dev.engine.flush({ manual: true });
  s.dev.net.up = false;                                  // cai de novo bem no meio
  await s.dev.post(`${s.base}/guests`, { name: 'Convidado Dois' });
  s.dev.net.up = true;
  await first;
  await s.dev.engine.flush({ manual: true });
  assert.equal(s.dev.engine.status().pending, 0);
  assert.equal((await serverView(s.owner, s.path)).days[0].attendance.length, 6);
  s.dev.engine.stop();
});
