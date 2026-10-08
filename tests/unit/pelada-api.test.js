// API do módulo Pelada: conta simplificada, criação, presença, sorteio, súmula, fila automática, histórico e artilharia.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client } from './helpers.js';
import { setClock } from '../../lib/clock.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let srv;
before(async () => { srv = await startServer(); });
after(async () => { setClock(null); await srv.close(); });

let n = 0;
async function newPlayer(name, birth = '15/05/1992', extra = {}) {
  const c = new Client(srv.base);
  const r = await c.post('/pelada/auth/signup', { name: name ?? `Jogador Teste ${++n}`, birth, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  c.player = r.data.player;
  return c;
}
const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

let setups = 0;
async function setup({ count = 10, min = 5, noTeams = false, matches = 0, autoDraw = false, generalDraw = false, generalEvery = 3 } = {}) {
  const tag = `S${++setups}`;
  const owner = await newPlayer(`Dono ${tag} da Pelada`);
  const r = await owner.post('/pelada/peladas', { name: 'Pelada de Teste', gender: 'masculino', minPerTeam: min, noTeams, autoDraw, generalDraw, generalEvery, matchMinutes: 10, days: [{ date: today(), matches }, { date: '2030-01-05' }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const id = r.data.pelada.id;
  const dayId = r.data.pelada.days.find(d => d.date === today()).id;
  const players = [owner];
  for (let i = 1; i < count; i++) players.push(await newPlayer(`Atleta ${tag}x${i} Souza`));
  for (const p of players) assert.equal((await p.post(`/pelada/peladas/${id}/days/${dayId}/presence`, { present: true })).status, 200);
  const base = `/pelada/peladas/${id}/days/${dayId}`;
  const view = async (c = owner) => (await c.get(`/pelada/peladas/${id}`)).data.pelada;
  return { owner, players, id, dayId, base, view };
}

test('conta simplificada: cadastro, login por nome + data, sessão persistente e erros', async () => {
  const c = new Client(srv.base);
  assert.equal((await c.post('/pelada/auth/signup', { name: 'A', birth: '15/05/1992' })).status, 400);
  assert.equal((await c.post('/pelada/auth/signup', { name: 'Maria Souza', birth: '31/02/1992' })).data.error.details.field, 'birth');
  assert.equal((await c.post('/pelada/auth/signup', { name: 'Maria Souza', birth: '15/05/2999' })).status, 400);
  assert.equal((await c.post('/pelada/auth/signup', { name: '<b>x</b>', birth: '15/05/1992' })).status, 400);

  const ok = await c.post('/pelada/auth/signup', { name: '  Valéria   da Silva ', birth: '25/03/1990', avatar: PNG });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.player.name, 'Valéria da Silva');
  assert.equal(ok.data.player.av, 1);
  assert.ok(c.cookie.startsWith('pl_session='));
  assert.equal((await c.get('/pelada/auth/me')).data.player.name, 'Valéria da Silva');

  // nome em uso (sem diferenciar acentos/maiúsculas)
  const dup = await new Client(srv.base).post('/pelada/auth/signup', { name: 'valeria DA silva', birth: '01/01/2000' });
  assert.equal(dup.status, 409); assert.equal(dup.data.error.code, 'NAME_TAKEN');

  // login com a data em outro formato; senha errada; nome inexistente
  const other = new Client(srv.base);
  assert.equal((await other.post('/pelada/auth/login', { name: 'VALERIA da silva', secret: '25031990' })).status, 200);
  assert.equal((await other.get('/pelada/auth/me')).data.player.id, ok.data.player.id);
  assert.equal((await new Client(srv.base).post('/pelada/auth/login', { name: 'Valéria da Silva', secret: '26/03/1990' })).status, 401);
  assert.equal((await new Client(srv.base).post('/pelada/auth/login', { name: 'Ninguém Aqui', secret: '25/03/1990' })).status, 401);

  // sem sessão
  assert.equal((await new Client(srv.base).get('/pelada/auth/me')).data.player, null);
  assert.equal((await new Client(srv.base).get('/pelada/mine')).status, 401);
  // o login de organizador de torneios não vale como conta de pelada (e vice-versa)
  const org = new Client(srv.base);
  await org.post('/auth/signup', { name: 'Org Torneio', email: 'orgpelada@teste.com', password: 'senha-segura-123' });
  assert.equal((await org.get('/pelada/auth/me')).data.player, null);

  // logout
  assert.equal((await other.post('/pelada/auth/logout')).status, 200);
  assert.equal((await other.get('/pelada/auth/me')).data.player, null);
});

test('cookie do jogador é de longa duração e HttpOnly', async () => {
  const res = await fetch(srv.base + '/api/pelada/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.9.9.9' }, body: JSON.stringify({ name: 'Cookie Teste', birth: '10/10/1990' }) });
  const sc = res.headers.get('set-cookie');
  assert.match(sc, /pl_session=/); assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/);
  assert.ok(Number(/Max-Age=(\d+)/.exec(sc)[1]) >= 300 * 24 * 3600);
});

test('limite de tentativas de login por nome e IP', async () => {
  await newPlayer('Alvo Do Limite', '02/02/1992');
  const c = new Client(srv.base);
  for (let i = 0; i < 8; i++) assert.equal((await c.post('/pelada/auth/login', { name: 'Alvo Do Limite', secret: '01/01/1991' })).status, 401);
  assert.equal((await c.post('/pelada/auth/login', { name: 'Alvo Do Limite', secret: '02/02/1992' })).status, 429);
});

test('perfil: trocar senha (data deixa de valer, outras sessões caem) e foto', async () => {
  const me = await newPlayer('Troca Senha Silva', '11/11/1991');
  const other = new Client(srv.base);
  await other.post('/pelada/auth/login', { name: 'Troca Senha Silva', secret: '11111991' });
  assert.equal((await me.post('/pelada/auth/password', { current: '01/01/2000', next: 'nova-senha' })).status, 401);
  assert.equal((await me.post('/pelada/auth/password', { current: '11/11/1991', next: 'abc' })).status, 400);
  assert.equal((await me.post('/pelada/auth/password', { current: '11/11/1991', next: 'nova-senha' })).status, 200);
  assert.equal((await me.get('/pelada/auth/me')).data.player.name, 'Troca Senha Silva'); // sessão atual segue valendo
  assert.equal((await other.get('/pelada/auth/me')).data.player, null); // outra sessão foi encerrada
  assert.equal((await new Client(srv.base).post('/pelada/auth/login', { name: 'Troca Senha Silva', secret: '11/11/1991' })).status, 401);
  assert.equal((await new Client(srv.base).post('/pelada/auth/login', { name: 'Troca Senha Silva', secret: 'nova-senha' })).status, 200);

  const up = await me.patch('/pelada/auth/me', { avatar: PNG });
  assert.equal(up.status, 200); assert.equal(up.data.player.av, 1);
  const img = await fetch(`${srv.base}/pelada-img/u/${me.player.id}?v=1`);
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
  assert.match(img.headers.get('cache-control'), /max-age=31536000/);
  assert.equal((await me.patch('/pelada/auth/me', { avatar: 'data:text/html;base64,PGI+' })).status, 400);
  assert.equal((await me.patch('/pelada/auth/me', { avatar: 'data:image/png;base64,QUJDREVGR0g=' })).status, 400); // assinatura de PNG inválida
  assert.equal((await me.patch('/pelada/auth/me', { avatar: null })).data.player.av, 0);
  assert.equal((await fetch(`${srv.base}/pelada-img/u/${me.player.id}`)).status, 404);
});

test('criar pelada: validações, ID, imagens e link de convite só para o criador', async () => {
  const owner = await newPlayer('Criadora Da Pelada');
  const bad = body => owner.post('/pelada/peladas', body);
  assert.equal((await bad({ name: 'ab', gender: 'masculino', minPerTeam: 5 })).status, 400);
  assert.equal((await bad({ name: 'Pelada Boa', gender: 'outro', minPerTeam: 5 })).status, 400);
  assert.equal((await bad({ name: 'Pelada Boa', gender: 'feminino', minPerTeam: 1 })).status, 400);
  assert.equal((await bad({ name: 'Pelada Boa', gender: 'feminino', minPerTeam: 5, days: [{ date: '2026-13-40' }] })).status, 400);
  assert.equal((await new Client(srv.base).post('/pelada/peladas', { name: 'Pelada Boa', gender: 'feminino', minPerTeam: 5 })).status, 401);

  const r = await bad({
    name: 'Pelada das Quintas', gender: 'feminino', minPerTeam: 6, noTeams: false, matchMinutes: 12, avatar: PNG, cover: PNG,
    days: [{ date: '2030-03-07', matches: 2 }, { date: '2030-03-14', org: { minPerTeam: 4, matchMinutes: 8 } }, { date: '2030-03-07' }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const p = r.data.pelada;
  assert.match(p.id, /^PL-[A-Z2-9]{6}$/);
  assert.equal(p.days.length, 2); // data repetida ignorada
  assert.deepEqual(p.days.map(d => d.date), ['2030-03-07', '2030-03-14']);
  assert.equal(p.days[0].matches.length, 2);
  assert.equal(p.days[0].custom, false); assert.equal(p.days[0].org.minPerTeam, 6);
  assert.equal(p.days[1].custom, true); assert.deepEqual(p.days[1].org, { minPerTeam: 4, noTeams: false, matchMinutes: 8, autoDraw: false, generalDraw: false, generalEvery: 3 });
  assert.equal(p.img.avatar, 1); assert.equal(p.img.cover, 1);
  assert.equal(p.invite.url, `${srv.base}/pelada/p/${p.id}`);

  // visitante sem conta enxerga tudo, menos o convite
  const guest = new Client(srv.base);
  const pub = (await guest.get(`/pelada/peladas/${p.id}`)).data.pelada;
  assert.equal(pub.name, 'Pelada das Quintas'); assert.equal(pub.invite, undefined); assert.equal(pub.viewer, null);
  // participante logado também não recebe o convite
  const joiner = await newPlayer('Quem Entra Depois');
  const jv = (await joiner.post(`/pelada/peladas/${p.id}/join`)).data.pelada;
  assert.equal(jv.invite, undefined); assert.equal(jv.viewer.isMember, true); assert.equal(jv.viewer.isOwner, false);
  // o ID aceita link, minúsculas e "#"
  assert.equal((await guest.get(`/pelada/peladas/${encodeURIComponent('#' + p.id.toLowerCase())}`)).status, 200);
  assert.equal((await guest.get('/pelada/peladas/PL-AAAAAA')).status, 404);
  assert.equal((await guest.get('/pelada/peladas/lixo')).status, 404);
  // imagens da pelada
  assert.equal((await fetch(`${srv.base}/pelada-img/p/${p.id}/cover?v=1`)).status, 200);
  assert.equal((await fetch(`${srv.base}/pelada-img/p/${p.id}/avatar`)).status, 200);
  assert.equal((await fetch(`${srv.base}/pelada-img/p/${p.id}/outro`)).status, 404);

  // painel: criadas × participando
  const mine = (await owner.get('/pelada/mine')).data;
  assert.equal(mine.created.length, 1); assert.equal(mine.created[0].id, p.id); assert.equal(mine.created[0].nextDate, '2030-03-07');
  const mj = (await joiner.get('/pelada/mine')).data;
  assert.equal(mj.created.length, 0); assert.equal(mj.joined[0].id, p.id); assert.equal(mj.joined[0].owner, 'Criadora Da Pelada');

  // só o criador edita
  assert.equal((await joiner.patch(`/pelada/peladas/${p.id}`, { name: 'Invadida' })).status, 403);
  const ed = await owner.patch(`/pelada/peladas/${p.id}`, { name: 'Quintas Renovada', minPerTeam: 7, cover: null });
  assert.equal(ed.status, 200); assert.equal(ed.data.pelada.name, 'Quintas Renovada'); assert.equal(ed.data.pelada.img.cover, 0);
  assert.equal((await fetch(`${srv.base}/pelada-img/p/${p.id}/cover`)).status, 404);
});

test('datas: o criador adiciona, personaliza (herdado × próprio) e exclui; data repetida é recusada', async () => {
  const s = await setup({ count: 2 });
  const add = await s.owner.post(`/pelada/peladas/${s.id}/days`, { date: '2030-02-02', org: { minPerTeam: 3 }, matches: 3 });
  assert.equal(add.status, 200);
  const day = add.data.pelada.days.find(d => d.id === add.data.dayId);
  assert.equal(day.custom, true); assert.equal(day.org.minPerTeam, 3); assert.equal(day.org.matchMinutes, 10); assert.equal(day.matches.length, 3);
  assert.equal((await s.owner.post(`/pelada/peladas/${s.id}/days`, { date: '2030-02-02' })).status, 409);
  assert.equal((await s.players[1].post(`/pelada/peladas/${s.id}/days`, { date: '2030-02-03' })).status, 403);
  // voltar ao padrão herdado
  const back = await s.owner.patch(`/pelada/peladas/${s.id}/days/${day.id}`, { org: null });
  assert.equal(back.data.pelada.days.find(d => d.id === day.id).custom, false);
  assert.equal(back.data.pelada.days.find(d => d.id === day.id).org.minPerTeam, 5);
  const moved = await s.owner.patch(`/pelada/peladas/${s.id}/days/${day.id}`, { date: '2029-12-31' });
  const dates = moved.data.pelada.days.map(d => d.date);
  assert.deepEqual(dates, [today(), '2029-12-31', '2030-01-05']); // lista sempre ordenada por data
  assert.equal((await s.owner.del(`/pelada/peladas/${s.id}/days/${day.id}`)).data.pelada.days.length, 2);
});

test('presença: marcar/retirar, aparece na lista, criador também marca, e vira participante', async () => {
  const s = await setup({ count: 3 });
  let v = await s.view();
  const day = () => v.days.find(d => d.id === s.dayId);
  assert.equal(day().attendance.length, 3);
  assert.equal(day().present, true); // dono marcou
  const spectator = new Client(srv.base);
  assert.equal((await spectator.post(`${s.base}/presence`, { present: true })).status, 401);
  const late = await newPlayer('Chegou Agora');
  const mark = await late.post(`${s.base}/presence`, { present: true });
  assert.equal(mark.data.pelada.days.find(d => d.id === s.dayId).attendance.length, 4);
  assert.equal(mark.data.pelada.viewer.isMember, true);
  assert.equal(mark.data.pelada.people[`u:${late.player.id}`].name, 'Chegou Agora');
  // idempotente
  assert.equal((await late.post(`${s.base}/presence`, { present: true })).data.pelada.days.find(d => d.id === s.dayId).attendance.length, 4);
  const out = await late.post(`${s.base}/presence`, { present: false });
  assert.equal(out.data.pelada.days.find(d => d.id === s.dayId).attendance.length, 3);
  assert.equal(out.data.pelada.days.find(d => d.id === s.dayId).present, false);
  // espectador vê a lista pública
  v = await s.view(spectator);
  assert.equal(day().attendance.length, 3);
});

test('ETag: leitura repetida devolve 304 e muda quando alguém marca presença', async () => {
  const s = await setup({ count: 2 });
  const first = await fetch(`${srv.base}/api/pelada/peladas/${s.id}`);
  const etag = first.headers.get('etag');
  assert.ok(etag);
  assert.equal((await fetch(`${srv.base}/api/pelada/peladas/${s.id}`, { headers: { 'If-None-Match': etag } })).status, 304);
  const late = await newPlayer('Mudou A Lista');
  await late.post(`${s.base}/presence`, { present: true });
  assert.equal((await fetch(`${srv.base}/api/pelada/peladas/${s.id}`, { headers: { 'If-None-Match': etag } })).status, 200);
});

test('sorteio: só o organizador sorteia; times completos, Cerca, convidados e retardatários', async () => {
  // 11 presentes, mínimo 5 → 2 times de 5 + 1 jogador na Cerca
  const s = await setup({ count: 11 });
  const outsider = await newPlayer('Nao Confirmado');
  assert.equal((await outsider.post(`${s.base}/draw`)).status, 403);
  assert.equal((await new Client(srv.base).post(`${s.base}/draw`)).status, 401);
  assert.equal((await s.players[3].post(`${s.base}/draw`)).status, 403); // nem quem confirmou presença sorteia
  assert.equal((await s.players[1].post(`${s.base}/draw`)).status, 403);
  const d1 = await s.owner.post(`${s.base}/draw`);
  assert.equal(d1.status, 200, JSON.stringify(d1.data));
  let day = d1.data.pelada.days.find(d => d.id === s.dayId);
  assert.equal(day.draw.teams.length, 2);
  assert.deepEqual(day.draw.teams.map(t => t.players.length), [5, 5]);
  assert.equal(day.fence.length, 1);
  assert.equal(day.draw.teams.flatMap(t => t.players).length + day.fence.length, 11);
  assert.ok(day.draw.notes.some(x => /Cerca/.test(x)));
  assert.match(day.draw.teams[0].label, /^Time 1 - \S+/);
  assert.equal(day.draw.teams[0].incomplete, undefined);
  assert.deepEqual(day.queue, ['t1', 't2']);
  // depois do primeiro sorteio é preciso escolher: Cerca + derrotado, ou geral (o criador pode a qualquer hora)
  assert.equal((await s.owner.post(`${s.base}/draw`)).status, 400);
  assert.equal((await s.players[1].post(`${s.base}/draw`, { mode: 'general' })).status, 403);
  const d2 = await s.owner.post(`${s.base}/draw`, { mode: 'general' });
  assert.equal(d2.status, 200, JSON.stringify(d2.data));
  assert.equal(d2.data.kind, 'general');
  assert.equal(d2.data.drawId, d1.data.drawId);
  assert.deepEqual(d2.data.pelada.days.find(d => d.id === s.dayId).draw.teams.map(t => t.id), ['t1', 't2']);

  // convidado depois do sorteio: Cerca ou direto em um time
  const g1 = await s.owner.post(`${s.base}/guests`, { name: 'Zé Convidado', teamId: 'free' });
  assert.equal(g1.status, 200);
  day = g1.data.pelada.days.find(d => d.id === s.dayId);
  assert.ok(day.fence.includes(g1.data.guestPid));
  assert.equal(day.fence.length, 2);
  assert.equal(g1.data.pelada.people[g1.data.guestPid].guest, true);
  assert.equal((await s.owner.post(`${s.base}/guests`, { name: 'zé convidado' })).status, 409); // nome repetido na lista
  assert.equal((await s.players[1].post(`${s.base}/guests`, { name: 'Intruso' })).status, 403);
  const small = day.draw.teams[0];
  const g2 = await s.owner.post(`${s.base}/guests`, { name: 'Chico Convidado', teamId: small.id });
  day = g2.data.pelada.days.find(d => d.id === s.dayId);
  assert.ok(day.draw.teams.find(t => t.id === small.id).players.includes(g2.data.guestPid));
  // encaixar quem está na Cerca em um time
  const as = await s.owner.post(`${s.base}/assign`, { pid: g1.data.guestPid, teamId: day.draw.teams[1].id });
  day = as.data.pelada.days.find(d => d.id === s.dayId);
  assert.ok(!day.fence.includes(g1.data.guestPid));
  assert.ok(day.draw.teams[1].players.includes(g1.data.guestPid));
  // quem retira a presença sai do time
  const leaver = s.players[5];
  const before = day.draw.teams.flatMap(t => t.players).length + day.fence.length;
  const lv = await leaver.post(`${s.base}/presence`, { present: false });
  day = lv.data.pelada.days.find(d => d.id === s.dayId);
  assert.equal(day.draw.teams.flatMap(t => t.players).length + day.fence.length, before - 1);
  assert.ok(![...day.draw.teams.flatMap(t => t.players), ...day.fence].includes(`u:${leaver.player.id}`));
  assert.ok(day.draw.teams.every(t => t.captain && t.players.includes(t.captain)));
  // quem chega depois do sorteio entra na Cerca
  const late = await newPlayer('Chegou Atrasado');
  const lt = await late.post(`${s.base}/presence`, { present: true });
  assert.ok(lt.data.pelada.days.find(d => d.id === s.dayId).fence.includes(`u:${late.player.id}`));
});

test('sorteio: falta de jogadores explica o motivo; "sem formação de times" bloqueia o sorteio', async () => {
  const few = await setup({ count: 6 });
  const r = await few.owner.post(`${few.base}/draw`);
  assert.equal(r.status, 400); assert.equal(r.data.error.code, 'DRAW_IMPOSSIBLE'); assert.match(r.data.error.message, /10 presentes/);

  const nt = await setup({ count: 10, noTeams: true });
  const r2 = await nt.owner.post(`${nt.base}/draw`);
  assert.equal(r2.status, 400); assert.equal(r2.data.error.code, 'NO_TEAMS');
  assert.equal((await nt.owner.post(`${nt.base}/matches`, {})).status, 400);
  // gols individuais para a artilharia
  const target = `u:${nt.players[4].player.id}`;
  for (let i = 0; i < 3; i++) assert.equal((await nt.owner.post(`${nt.base}/goals`, { pid: target, delta: 1 })).status, 200);
  const dec = await nt.owner.post(`${nt.base}/goals`, { pid: target, delta: -1 });
  assert.equal(dec.data.pelada.days.find(d => d.id === nt.dayId).looseGoals[target], 2);
  await nt.owner.post(`${nt.base}/goals`, { pid: `u:${nt.owner.player.id}`, delta: 1 });
  const v = await nt.view();
  assert.deepEqual(v.ranking.map(r => [r.pid, r.goals, r.medal]), [[target, 2, 'gold'], [`u:${nt.owner.player.id}`, 1, 'silver']]);
  assert.equal((await nt.players[1].post(`${nt.base}/goals`, { pid: target, delta: 1 })).status, 403);
  assert.equal((await nt.owner.post(`${nt.base}/goals`, { pid: 'u:naoexiste', delta: 1 })).status, 404);
  // goleiro não zera abaixo de 0
  for (let i = 0; i < 5; i++) await nt.owner.post(`${nt.base}/goals`, { pid: `u:${nt.owner.player.id}`, delta: -1 });
  assert.equal((await nt.view()).ranking.length, 1);

  // data personalizada "sem formação de times" dentro de uma pelada com times
  const mixed = await setup({ count: 10 });
  const add = await mixed.owner.post(`/pelada/peladas/${mixed.id}/days`, { date: '2030-05-05', org: { noTeams: true } });
  assert.equal(add.data.pelada.days.find(d => d.id === add.data.dayId).org.noTeams, true);
  assert.equal((await mixed.owner.post(`${mixed.base}/draw`)).status, 200);
});

test('partidas: criar vaga vazia, escolher times, súmula, cronômetro e próxima partida automática', async () => {
  const s = await setup({ count: 15, min: 5 }); // 3 times de 5
  assert.equal((await s.owner.post(`${s.base}/draw`)).status, 200);
  let v = await s.view();
  let day = () => v.days.find(d => d.id === s.dayId);
  const [t1, t2, t3] = day().draw.teams.map(t => t.id);

  // + cria jogo com os lugares vazios
  const c = await s.owner.post(`${s.base}/matches`, {});
  assert.equal(c.status, 200);
  const mid = c.data.matchId;
  assert.equal(c.data.pelada.days.find(d => d.id === s.dayId).matches[0].a, null);
  assert.equal((await s.players[1].post(`${s.base}/matches`, {})).status, 403);
  const mp = `${s.base}/matches/${mid}`;
  // escolher os dois times
  assert.equal((await s.owner.patch(mp, { a: t1, b: t1 })).status, 400);
  assert.equal((await s.owner.patch(mp, { a: 't9' })).status, 400);
  const set = await s.owner.patch(mp, { a: t1, b: t2 });
  assert.equal(set.status, 200);
  v = set.data.pelada;
  assert.deepEqual(day().queue, [t3]); // quem está em jogo sai da fila
  // um time não pode estar em duas partidas abertas
  const other = (await s.owner.post(`${s.base}/matches`, {})).data.matchId;
  assert.equal((await s.owner.patch(`${s.base}/matches/${other}`, { a: t1 })).status, 409);
  assert.equal((await s.owner.del(`${s.base}/matches/${other}`)).status, 200);

  // cronômetro: não inicia sem times; define o tempo; inicia; pausa
  assert.equal((await s.owner.post(`${mp}/timer`, { action: 'set', minutes: 0 })).status, 400);
  assert.equal((await s.owner.post(`${mp}/timer`, { action: 'set', minutes: 8 })).data.pelada.days[0].matches[0].timer.durationMs, 480_000);
  const st = await s.owner.post(`${mp}/timer`, { action: 'start' });
  assert.equal(st.data.pelada.days[0].matches[0].status, 'live');
  assert.ok(st.data.pelada.days[0].matches[0].timer.startedAt);
  assert.equal((await s.owner.post(`${mp}/timer`, { action: 'set', minutes: 5 })).status, 409); // rodando
  assert.equal((await s.owner.patch(mp, { a: t3 })).status, 409); // já começou
  assert.equal((await s.owner.post(`${mp}/finish`, { auto: true })).status, 409); // tempo ainda não acabou
  const pa = await s.owner.post(`${mp}/timer`, { action: 'pause' });
  assert.equal(pa.data.pelada.days[0].matches[0].timer.startedAt, null);

  // súmula: gols de quem é do time, emprestado ou sem autor
  const teamPlayers = id => day().draw.teams.find(t => t.id === id).players;
  const scorerA = teamPlayers(t1)[0], scorerB = teamPlayers(t2)[1], lender = teamPlayers(t3)[0];
  assert.equal((await s.owner.post(`${mp}/goals`, { teamId: t1, pid: scorerB })).status, 400);
  assert.equal((await s.owner.post(`${mp}/goals`, { teamId: t3, pid: lender })).status, 400);
  assert.equal((await s.players[2].post(`${mp}/goals`, { teamId: t1, pid: scorerA })).status, 403);
  const g1 = await s.owner.post(`${mp}/goals`, { teamId: t1, pid: scorerA });
  await s.owner.post(`${mp}/goals`, { teamId: t1, pid: scorerA });
  await s.owner.post(`${mp}/goals`, { teamId: t2, pid: scorerB });
  await s.owner.post(`${mp}/goals`, { teamId: t2, pid: null }); // gol sem autor
  // jogador de fora (empréstimo)
  assert.equal((await s.owner.post(`${mp}/loans`, { teamId: t1, pid: scorerA })).status, 400); // já é do time
  assert.equal((await s.owner.post(`${mp}/loans`, { teamId: t1, pid: lender })).status, 200);
  assert.equal((await s.owner.post(`${mp}/loans`, { teamId: t2, pid: lender })).status, 409); // já emprestado
  const lg = await s.owner.post(`${mp}/goals`, { teamId: t1, pid: lender });
  assert.equal(lg.status, 200);
  v = lg.data.pelada;
  assert.deepEqual(day().matches[0].score, { a: 3, b: 2 });
  assert.equal((await s.owner.post(`${mp}/loans`, { teamId: t1, pid: lender, remove: true })).status, 409); // já marcou
  // remover um gol
  const rm = await s.owner.del(`${mp}/goals/${g1.data.goalId}`);
  assert.deepEqual(rm.data.pelada.days[0].matches[0].score, { a: 2, b: 2 });
  await s.owner.post(`${mp}/goals`, { teamId: t1, pid: scorerA }); // 3 x 2 novamente

  // encerrar → quem ganha fica (t1), o desafiante é o time de fora (t3), t2 vai para o fim da fila
  const fin = await s.owner.post(`${mp}/finish`, {});
  assert.equal(fin.status, 200, JSON.stringify(fin.data));
  v = fin.data.pelada;
  const [m1, m2] = day().matches;
  assert.equal(m1.status, 'finished'); assert.deepEqual(m1.score, { a: 3, b: 2 });
  assert.equal(fin.data.next, m2.id);
  assert.deepEqual([m2.a, m2.b, m2.status, m2.auto], [t1, t3, 'scheduled', true]);
  assert.deepEqual(day().queue, [t2]);
  assert.deepEqual([day().streaks[t1], day().streaks[t2]], [1, 0]); // t2 saiu: sequência zerada
  assert.equal((await s.owner.post(`${mp}/finish`, {})).status, 409); // já encerrada
  assert.equal(fin.data.info.reason, 'venceu');

  // empate na 2ª partida: sai o time que está há mais tempo (t1, 2 jogos seguidos) e t2 volta
  const mp2 = `${s.base}/matches/${m2.id}`;
  await s.owner.post(`${mp2}/timer`, { action: 'start' });
  const f2 = await s.owner.post(`${mp2}/finish`, {});
  v = f2.data.pelada;
  assert.equal(f2.data.info.reason, 'empate');
  const m3 = day().matches[2];
  assert.deepEqual([m3.a, m3.b], [t3, t2]); // t3 fica (sequência menor), t2 é o desafiante
  assert.deepEqual(day().queue, [t1]);

  // apagar uma partida aberta devolve os times ao início da fila; encerrada pode ser excluída do histórico
  const dm = await s.owner.del(`${s.base}/matches/${m3.id}`);
  v = dm.data.pelada;
  assert.deepEqual(day().queue.slice(0, 2), [t3, t2]);
  assert.equal(day().matches.length, 2);
});

test('próxima partida preenche a vaga vazia já criada e respeita partida montada pelo organizador', async () => {
  const s = await setup({ count: 15, min: 5, matches: 2 }); // 2 vagas criadas no cadastro da data
  await s.owner.post(`${s.base}/draw`);
  let v = await s.view();
  const day = () => v.days.find(d => d.id === s.dayId);
  const [t1, t2, t3] = day().draw.teams.map(t => t.id);
  assert.equal(day().matches.length, 2);
  const m1 = day().matches[0].id;
  await s.owner.patch(`${s.base}/matches/${m1}`, { a: t1, b: t2 });
  await s.owner.post(`${s.base}/matches/${m1}/timer`, { action: 'start' });
  const fin = await s.owner.post(`${s.base}/matches/${m1}/finish`, {});
  v = fin.data.pelada;
  assert.equal(day().matches.length, 2); // não criou uma terceira: usou a vaga vazia
  assert.equal(fin.data.next, day().matches[1].id);
  // 0x0 com sequências iguais: sai o time A (t1); fica t2 e o desafiante é o primeiro da fila (t3)
  assert.deepEqual([day().matches[1].a, day().matches[1].b], [t2, t3]);
});

test('histórico público e artilharia (dia × geral) somam gols de todas as partidas', async () => {
  const s = await setup({ count: 10, min: 5 });
  await s.owner.post(`${s.base}/draw`);
  let v = await s.view();
  let day = () => v.days.find(d => d.id === s.dayId);
  const [t1, t2] = day().draw.teams.map(t => t.id);
  const roster = id => day().draw.teams.find(t => t.id === id).players;
  const star = roster(t1)[0], other = roster(t2)[0], third = roster(t1)[1], fourth = roster(t2)[1];
  const mid = (await s.owner.post(`${s.base}/matches`, { a: t1, b: t2 })).data.matchId;
  const mp = `${s.base}/matches/${mid}`;
  for (let i = 0; i < 4; i++) await s.owner.post(`${mp}/goals`, { teamId: t1, pid: star });
  for (let i = 0; i < 2; i++) await s.owner.post(`${mp}/goals`, { teamId: t2, pid: other });
  await s.owner.post(`${mp}/goals`, { teamId: t1, pid: third });
  await s.owner.post(`${mp}/goals`, { teamId: t2, pid: fourth });
  await s.owner.post(`${mp}/timer`, { action: 'start' });
  await s.owner.post(`${mp}/finish`, {});

  // outro dia: gols somam no geral, mas não no dia
  const d2 = (await s.owner.post(`/pelada/peladas/${s.id}/days`, { date: '2030-03-03', org: { noTeams: true } })).data;
  const day2 = d2.dayId;
  const scorers = [star, other, third, fourth];
  const extra = s.players.find(pl => !scorers.includes(`u:${pl.player.id}`));
  await extra.post(`/pelada/peladas/${s.id}/days/${day2}/presence`, { present: true });
  const p3 = `u:${extra.player.id}`;
  for (let i = 0; i < 3; i++) await s.owner.post(`/pelada/peladas/${s.id}/days/${day2}/goals`, { pid: p3, delta: 1 });

  // qualquer pessoa (inclusive sem conta) consulta o histórico e a artilharia
  const pub = (await new Client(srv.base).get(`/pelada/peladas/${s.id}`)).data.pelada;
  const pd = pub.days.find(d => d.id === s.dayId);
  assert.deepEqual(pd.matches[0].score, { a: 5, b: 3 });
  assert.equal(pd.matches[0].status, 'finished');
  assert.deepEqual(pd.ranking.slice(0, 2).map(r => [r.pid, r.goals, r.medal]), [[star, 4, 'gold'], [other, 2, 'silver']]);
  assert.deepEqual(pd.ranking.slice(2).map(r => [r.goals, r.rank, r.medal]), [[1, 3, 'bronze'], [1, 3, 'bronze']]); // empate divide o bronze
  assert.deepEqual(pd.ranking.slice(2).map(r => r.pid).sort(), [third, fourth].sort());
  // geral = soma de todas as datas; o dia 2 só tem os gols do dia 2
  assert.deepEqual(pub.ranking.slice(0, 3).map(r => [r.pid, r.goals, r.medal]), [[star, 4, 'gold'], [p3, 3, 'silver'], [other, 2, 'bronze']]);
  assert.deepEqual(pub.days.find(d => d.id === day2).ranking.map(r => [r.pid, r.goals]), [[p3, 3]]);
});

test('permissões e exclusão: só o criador exclui a pelada; peladas apagadas somem do painel', async () => {
  const s = await setup({ count: 3 });
  assert.equal((await s.players[1].del(`/pelada/peladas/${s.id}`)).status, 403);
  assert.equal((await s.players[1].get('/pelada/mine')).data.joined.length, 1);
  assert.equal((await s.owner.del(`/pelada/peladas/${s.id}`)).status, 200);
  assert.equal((await new Client(srv.base).get(`/pelada/peladas/${s.id}`)).status, 404);
  assert.equal((await s.players[1].get('/pelada/mine')).data.joined.length, 0);
});

test('tempo esgotado: o cronômetro acaba e o encerramento automático é aceito', async () => {
  const s = await setup({ count: 10, min: 5 });
  await s.owner.post(`${s.base}/draw`);
  const v = await s.view();
  const [t1, t2] = v.days.find(d => d.id === s.dayId).draw.teams.map(t => t.id);
  const mid = (await s.owner.post(`${s.base}/matches`, { a: t1, b: t2 })).data.matchId;
  const mp = `${s.base}/matches/${mid}`;
  await s.owner.post(`${mp}/timer`, { action: 'set', minutes: 1 });
  const t0 = Date.now();
  await s.owner.post(`${mp}/timer`, { action: 'start' });
  setClock(() => t0 + 61_000); // passa mais de 1 minuto
  try {
    assert.equal((await s.owner.post(`${mp}/timer`, { action: 'start' })).status, 200); // já rodando: nada muda
    const fin = await s.owner.post(`${mp}/finish`, { auto: true });
    assert.equal(fin.status, 200, JSON.stringify(fin.data));
    const m = fin.data.pelada.days.find(d => d.id === s.dayId).matches[0];
    assert.equal(m.status, 'finished'); assert.equal(m.timer.startedAt, null); assert.equal(m.timer.elapsedMs, 60_000); // limitado ao tempo regulamentar
  } finally { setClock(null); }
});

// ---------------------------------------------------------------- Cerca, sorteio automático e correções
const dayOf = (v, dayId) => v.days.find(d => d.id === dayId);

test('sorteios automáticos pela API: configuração, sorteio da Cerca ao encerrar e sorteios manuais com partida em andamento', async () => {
  const s = await setup({ count: 17, min: 5, autoDraw: true, generalDraw: true, generalEvery: 4 });
  let v = await s.view();
  assert.deepEqual([v.autoDraw, v.generalDraw, v.generalEvery], [true, true, 4]);
  assert.deepEqual([dayOf(v, s.dayId).org.autoDraw, dayOf(v, s.dayId).org.generalDraw, dayOf(v, s.dayId).org.generalEvery], [true, true, 4]);
  // a data pode ter a própria regra
  const other = await s.owner.post(`/pelada/peladas/${s.id}/days`, { date: '2030-02-02', org: { autoDraw: true, generalEvery: 5 } });
  assert.deepEqual([dayOf(other.data.pelada, other.data.dayId).org.autoDraw, dayOf(other.data.pelada, other.data.dayId).org.generalEvery], [true, 5]);
  assert.equal((await s.owner.post(`/pelada/peladas/${s.id}/days`, { date: '2030-02-09', org: { generalEvery: 11 } })).status, 400);
  assert.equal((await s.owner.patch(`/pelada/peladas/${s.id}`, { generalDraw: false })).data.pelada.generalDraw, false);
  assert.equal((await s.owner.patch(`/pelada/peladas/${s.id}`, { generalEvery: 2 })).data.pelada.generalEvery, 2);
  await s.owner.patch(`/pelada/peladas/${s.id}`, { generalDraw: false, generalEvery: 4 });

  await s.owner.post(`${s.base}/draw`);
  v = await s.view();
  let day = dayOf(v, s.dayId);
  const [t1, t2, t3] = day.draw.teams.map(t => t.id);
  const fence = [...day.fence];
  assert.equal(fence.length, 2);
  const mid = (await s.owner.post(`${s.base}/matches`, { a: t1, b: t2 })).data.matchId;
  const mp = `${s.base}/matches/${mid}`;
  await s.owner.post(`${mp}/timer`, { action: 'start' });

  // com a partida em andamento: a Cerca pequena não forma o próximo time; o geral fica combinado e nada muda agora
  const small = await s.owner.post(`${s.base}/draw`, { mode: 'fence' });
  assert.equal(small.status, 400);
  const later = await s.owner.post(`${s.base}/draw`, { mode: 'general' });
  assert.equal(later.status, 200, JSON.stringify(later.data));
  assert.equal(later.data.later, true);
  day = dayOf(later.data.pelada, s.dayId);
  assert.ok(day.pending && day.pending.teams.length === 3);
  assert.deepEqual(day.draw.teams.find(t => t.id === t1).players, dayOf(v, s.dayId).draw.teams.find(t => t.id === t1).players);
  assert.equal(day.matches[0].status, 'live');
  const pendingFirst = day.pending.teams.slice(0, 2).map(t => t.players);

  // ao encerrar, vale o geral combinado: o próximo confronto é o dos dois primeiros times do sorteio
  const winner = day.draw.teams.find(t => t.id === t1).players[0];
  await s.owner.post(`${mp}/goals`, { teamId: t1, pid: winner });
  const fin = await s.owner.post(`${mp}/finish`, {});
  assert.equal(fin.status, 200, JSON.stringify(fin.data));
  assert.equal(fin.data.info.rotation.kind, 'general');
  day = dayOf(fin.data.pelada, s.dayId);
  assert.equal(day.pending, null);
  const next = day.matches[1];
  assert.deepEqual([next.a, next.b].map(id => day.draw.teams.find(t => t.id === id).players), pendingFirst);
  // a partida encerrada mostra os times como eram quando ela terminou
  assert.deepEqual(day.matches[0].teams.b.players, dayOf(v, s.dayId).draw.teams.find(t => t.id === t2).players);
  assert.match(day.matches[0].teams.a.label, /^Time 1 - /);
  assert.equal(day.games[winner], 1);
  assert.ok(day.draw.log.length >= 1);

  // com o sorteio da Cerca ligado, o fim da partida troca a Cerca pelo time derrotado
  await s.owner.patch(s.base, { org: { autoDraw: true } });
  const nextMp = `${s.base}/matches/${next.id}`;
  await s.owner.post(`${nextMp}/timer`, { action: 'start' });
  const fin2 = await s.owner.post(`${nextMp}/finish`, {});
  assert.equal(fin2.status, 200, JSON.stringify(fin2.data));
  assert.equal(fin2.data.info.rotation?.kind ?? 'fence', 'fence');
});

test('só o organizador corrige partida encerrada: placar, gols e artilharia se ajustam', async () => {
  const s = await setup({ count: 10, min: 5 });
  await s.owner.post(`${s.base}/draw`);
  const day0 = dayOf(await s.view(), s.dayId);
  const [t1, t2] = day0.draw.teams;
  const mid = (await s.owner.post(`${s.base}/matches`, { a: t1.id, b: t2.id })).data.matchId;
  const mp = `${s.base}/matches/${mid}`;
  await s.owner.post(`${mp}/goals`, { teamId: t1.id, pid: t1.players[0] });
  await s.owner.post(`${mp}/timer`, { action: 'start' });
  await s.owner.post(`${mp}/finish`, {});
  const fixer = t2.players[0];
  assert.equal((await s.players[1].post(`${mp}/goals`, { teamId: t2.id, pid: fixer })).status, 403);
  const a = await s.owner.post(`${mp}/goals`, { teamId: t2.id, pid: fixer });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  let day = dayOf(a.data.pelada, s.dayId);
  assert.deepEqual(day.matches[0].score, { a: 1, b: 1 });
  assert.equal(day.matches[0].status, 'finished');
  assert.deepEqual(day.ranking.map(r => r.goals), [1, 1]);
  const noAuthor = await s.owner.post(`${mp}/goals`, { teamId: t2.id, pid: null });
  assert.deepEqual(dayOf(noAuthor.data.pelada, s.dayId).matches[0].score, { a: 1, b: 2 });
  const goalId = dayOf(noAuthor.data.pelada, s.dayId).matches[0].goals.find(g => g.pid === t1.players[0]).id;
  assert.equal((await s.players[1].del(`${mp}/goals/${goalId}`)).status, 403);
  const rm = await s.owner.del(`${mp}/goals/${goalId}`);
  day = dayOf(rm.data.pelada, s.dayId);
  assert.deepEqual(day.matches[0].score, { a: 0, b: 2 });
  assert.deepEqual(day.ranking.map(r => [r.pid, r.goals]), [[fixer, 1]]);
  assert.equal((await s.owner.post(`${mp}/goals`, { teamId: t1.id, pid: t2.players[1] })).status, 400); // jogador de outro time
});

test('sair da pelada: some do painel e das listas de hoje; gols continuam na artilharia; o organizador não sai; dá para voltar', async () => {
  const s = await setup({ count: 10, min: 5 });
  await s.owner.post(`${s.base}/draw`);
  const day0 = dayOf(await s.view(), s.dayId);
  const [t1, t2] = day0.draw.teams;
  const scorer = s.players.find(pl => `u:${pl.player.id}` !== `u:${s.owner.player.id}` && t1.players.includes(`u:${pl.player.id}`));
  const spid = `u:${scorer.player.id}`;
  const mid = (await s.owner.post(`${s.base}/matches`, { a: t1.id, b: t2.id })).data.matchId;
  for (let i = 0; i < 3; i++) await s.owner.post(`${s.base}/matches/${mid}/goals`, { teamId: t1.id, pid: spid });
  assert.equal((await scorer.get('/pelada/mine')).data.joined.length, 1);
  assert.equal((await new Client(srv.base).post(`/pelada/peladas/${s.id}/leave`)).status, 401);
  assert.equal((await s.owner.post(`/pelada/peladas/${s.id}/leave`)).status, 409); // o organizador não sai

  const out = await scorer.post(`/pelada/peladas/${s.id}/leave`);
  assert.equal(out.status, 200, JSON.stringify(out.data));
  assert.equal(out.data.pelada.viewer.isMember, false);
  assert.ok(!out.data.pelada.members.includes(spid));
  assert.equal((await scorer.get('/pelada/mine')).data.joined.length, 0); // "ela não aparece mais"
  let day = dayOf(out.data.pelada, s.dayId);
  assert.ok(!day.attendance.some(x => x.pid === spid));
  assert.ok(!day.draw.teams.some(t => t.players.includes(spid)) && !day.fence.includes(spid));
  // a artilharia do dia e a geral continuam com os 3 gols
  assert.deepEqual(day.ranking.map(r => [r.pid, r.goals]), [[spid, 3]]);
  assert.deepEqual(out.data.pelada.ranking.map(r => [r.pid, r.goals]), [[spid, 3]]);
  assert.equal(out.data.pelada.people[spid].name, scorer.player.name);
  // entrando de novo pelo link, volta a participar
  assert.equal((await scorer.post(`/pelada/peladas/${s.id}/join`)).data.pelada.viewer.isMember, true);
  assert.equal((await scorer.get('/pelada/mine')).data.joined.length, 1);
});

test('o organizador exclui jogadores: só ele, nunca a si mesmo, e os gols do excluído continuam na artilharia', async () => {
  const s = await setup({ count: 10, min: 5 });
  await s.owner.post(`${s.base}/draw`);
  const day0 = dayOf(await s.view(), s.dayId);
  const [t1, t2] = day0.draw.teams;
  const victim = s.players.find(pl => `u:${pl.player.id}` !== `u:${s.owner.player.id}` && t1.players.includes(`u:${pl.player.id}`));
  const vpid = `u:${victim.player.id}`;
  const mid = (await s.owner.post(`${s.base}/matches`, { a: t1.id, b: t2.id })).data.matchId;
  await s.owner.post(`${s.base}/matches/${mid}/goals`, { teamId: t1.id, pid: vpid });
  const del = pid => `/pelada/peladas/${s.id}/members/${encodeURIComponent(pid)}`;
  assert.equal((await s.players[1].del(del(vpid))).status, 403);
  assert.equal((await new Client(srv.base).del(del(vpid))).status, 401);
  assert.equal((await s.owner.del(del(`u:${s.owner.player.id}`))).status, 409);
  assert.equal((await s.owner.del(del('u:naoexiste'))).status, 404);
  assert.equal((await s.owner.del(del('g:xyz'))).status, 404);
  const r = await s.owner.del(del(vpid));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(!r.data.pelada.members.includes(vpid));
  assert.equal((await victim.get('/pelada/mine')).data.joined.length, 0);
  const day = dayOf(r.data.pelada, s.dayId);
  assert.ok(!day.attendance.some(a => a.pid === vpid));
  assert.deepEqual(r.data.pelada.ranking.map(x => [x.pid, x.goals]), [[vpid, 1]]);
});

test('login salvo no aparelho: a chave refaz a sessão sem pedir nome e data; senha nova invalida as chaves antigas', async () => {
  const c = new Client(srv.base);
  const su = await c.post('/pelada/auth/signup', { name: 'Fica Logado Silva', birth: '03/03/1993' });
  assert.ok(su.data.token && su.data.token.includes('.'));
  const me = await c.get('/pelada/auth/me');
  assert.equal(me.data.player.id, su.data.player.id);
  assert.ok(me.data.token);
  assert.match(me.headers.get('set-cookie'), /pl_session=.*Max-Age=\d{8}/); // a sessão é renovada por mais um ano a cada abertura
  // sem cookie (limpeza do navegador): a chave guardada restaura a sessão
  const fresh = new Client(srv.base);
  assert.equal((await fresh.get('/pelada/auth/me')).data.player, null);
  const back = await fresh.post('/pelada/auth/resume', { token: su.data.token });
  assert.equal(back.status, 200);
  assert.equal(back.data.player.name, 'Fica Logado Silva');
  assert.equal((await fresh.get('/pelada/auth/me')).data.player.id, su.data.player.id);
  assert.equal((await new Client(srv.base).post('/pelada/auth/resume', { token: 'lixo.lixo' })).status, 401);
  assert.equal((await new Client(srv.base).post('/pelada/auth/resume', {})).status, 401);
  // login por senha também entrega a chave; trocar a senha invalida as chaves antigas e entrega uma nova
  const login = await new Client(srv.base).post('/pelada/auth/login', { name: 'Fica Logado Silva', secret: '03/03/1993' });
  assert.ok(login.data.token);
  const pw = await c.post('/pelada/auth/password', { current: '03/03/1993', next: 'senha-nova-9' });
  assert.equal(pw.status, 200); assert.ok(pw.data.token);
  assert.equal((await new Client(srv.base).post('/pelada/auth/resume', { token: su.data.token })).status, 401);
  assert.equal((await new Client(srv.base).post('/pelada/auth/resume', { token: pw.data.token })).status, 200);
  // logout não deixa sessão aberta no servidor (a chave do aparelho é apagada pelo app)
  assert.equal((await c.post('/pelada/auth/logout')).status, 200);
});

test('link de convite: o app abre com a pré-visualização da pelada (capa, foto e dados) nas metatags', async () => {
  const owner = await newPlayer('Organizadora Do Link');
  const mk = body => owner.post('/pelada/peladas', { gender: 'feminino', minPerTeam: 6, days: [{ date: '2099-05-01' }], ...body });
  const full = (await mk({ name: 'Pelada "das" <Quintas> & Cia', avatar: PNG, cover: PNG, preview: PNG })).data.pelada;
  const get = async path => { const r = await fetch(srv.base + path); return { status: r.status, type: r.headers.get('content-type'), text: await r.text() }; };
  let page = await get(`/pelada/p/${full.id}`);
  assert.equal(page.status, 200); assert.match(page.type, /text\/html/);
  assert.match(page.text, /<script type="module" src="\/assets\/js\/pelada\/main\.js">/); // o app de sempre
  assert.match(page.text, /<meta property="og:title" content="Pelada &quot;das&quot; &lt;Quintas&gt; &amp; Cia · Pelada">/); // nome escapado
  assert.match(page.text, /og:description" content="👩 Pelada feminina · organizada por Organizadora Do Link · 1 participante · mín\. 6 por time · próximo jogo 01\/05\/2099\./);
  assert.match(page.text, new RegExp(`og:image" content="${srv.base}/pelada-img/p/${full.id}/preview\\?v=1"`));
  assert.match(page.text, new RegExp(`og:url" content="${srv.base}/pelada/p/${full.id}"`));
  assert.match(page.text, /twitter:card" content="summary_large_image"/);
  assert.equal((page.text.match(/<title>/g) || []).length, 1);
  assert.equal((page.text.match(/og:image"/g) || []).length, 1);
  assert.equal((await fetch(`${srv.base}/pelada-img/p/${full.id}/preview?v=1`)).status, 200);
  // sem a prévia montada: capa; sem capa: foto de perfil; sem nada: ícone do app
  const coverOnly = (await mk({ name: 'So Capa FC', cover: PNG })).data.pelada;
  assert.match((await get(`/pelada/p/${coverOnly.id}`)).text, /og:image" content="[^"]+\/cover\?v=1"/);
  const avatarOnly = (await mk({ name: 'So Foto FC', avatar: PNG })).data.pelada;
  const av = await get(`/pelada/p/${avatarOnly.id}`);
  assert.match(av.text, /og:image" content="[^"]+\/avatar\?v=1"/); assert.match(av.text, /twitter:card" content="summary"/);
  const none = (await mk({ name: 'Sem Imagem FC' })).data.pelada;
  assert.match((await get(`/pelada/p/${none.id}`)).text, /og:image" content="[^"]+\/pelada\/icons\/icon-512\.png"/);
  // o dono atualiza a prévia depois (editar pelada); ID inexistente devolve o app com 404
  assert.equal((await owner.patch(`/pelada/peladas/${none.id}`, { preview: PNG })).data.pelada.img.preview, 1);
  assert.match((await get(`/pelada/p/${none.id}`)).text, /\/preview\?v=1"/);
  assert.equal((await owner.patch(`/pelada/peladas/${none.id}`, { preview: 'data:text/html;base64,PGI+' })).status, 400);
  page = await get('/pelada/p/PL-AAAAAA');
  assert.equal(page.status, 404); assert.match(page.text, /main\.js/);
  assert.equal((await get('/pelada/p/lixo')).status, 404);
});
