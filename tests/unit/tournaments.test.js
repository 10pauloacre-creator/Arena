import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, signup, teamInput } from './helpers.js';
import { setClock } from '../../lib/clock.js';

let S;
before(async () => { S = await startServer(); });
after(async () => { setClock(null); await S.close(); });

async function create(c, extra = {}) {
  const r = await c.post('/tournaments', { name: 'COFAV - Copa de futsal Amigos da Vila 2026', sport: 'futsal', finalDate: '2026-11-14', ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.tournament;
}

test('criar torneio gera ID no formato AM-ANO-NNNN, aparece na grade e o criador é owner', async () => {
  const c = await signup(S.base, 'Dono');
  const t = await create(c);
  assert.match(t.id, /^AM-\d{4}-\d{4,5}$/);
  assert.equal(t.status, 'inscricoes');
  assert.equal(t.me.role, 'owner');
  assert.equal(t.maxTeams, 8);
  assert.ok(t.regDeadline);
  const list = await c.get('/tournaments');
  assert.equal(list.data.tournaments.length, 1);
  assert.equal(list.data.tournaments[0].id, t.id);
  assert.equal(list.data.tournaments[0].teamsConfirmed, 0);
});

test('a grade mostra apenas os torneios do usuário', async () => {
  const a = await signup(S.base), b = await signup(S.base);
  await create(a); await create(a, { name: 'Segundo torneio' });
  await create(b);
  assert.equal((await a.get('/tournaments')).data.tournaments.length, 2);
  assert.equal((await b.get('/tournaments')).data.tournaments.length, 1);
});

test('validações na criação', async () => {
  const c = await signup(S.base);
  assert.equal((await c.post('/tournaments', { name: 'ab', sport: 'futsal' })).status, 400);
  assert.equal((await c.post('/tournaments', { name: 'Nome ok', sport: 'tenis' })).status, 400);
  assert.equal((await c.post('/tournaments', { name: 'Nome ok', sport: 'futsal', finalDate: '31/12/2026' })).status, 400);
  assert.equal((await new Client(S.base).post('/tournaments', { name: 'Nome ok', sport: 'futsal' })).status, 401);
});

test('salvar alterações (PATCH) atualiza nome, data, modalidade, taxa e prazo', async () => {
  const c = await signup(S.base);
  const t = await create(c);
  const deadline = new Date(Date.now() + 5 * 86400_000).toISOString();
  const r = await c.patch(`/tournaments/${t.id}`, { name: 'Novo nome do torneio', finalDate: '2026-12-01', sport: 'volei', fee: 5000, regDeadline: deadline, maxTeams: 16, type: 'oficial', venue: 'Ginásio Central' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const u = r.data.tournament;
  assert.equal(u.name, 'Novo nome do torneio');
  assert.equal(u.sport, 'volei');
  assert.equal(u.fee, 5000);
  assert.equal(u.maxTeams, 16);
  assert.equal(u.type, 'oficial');
  assert.equal(u.regDeadline, deadline);
  const again = await c.get(`/tournaments/${t.id}`);
  assert.equal(again.data.tournament.name, 'Novo nome do torneio');
});

test('configurações inválidas são recusadas', async () => {
  const c = await signup(S.base);
  const t = await create(c);
  const bad = async body => (await c.patch(`/tournaments/${t.id}`, body)).status;
  assert.equal(await bad({ name: 'x' }), 400);
  assert.equal(await bad({ fee: -1 }), 400);
  assert.equal(await bad({ fee: 100 }), 400); // mínimo R$ 5
  assert.equal(await bad({ fee: 'abc' }), 400);
  assert.equal(await bad({ maxTeams: 7 }), 400);
  assert.equal(await bad({ regDeadline: 'ontem' }), 400);
  assert.equal(await bad({ finalDate: '2026-13-45' }), 400);
  assert.equal(await bad({ causes: [] }), 400);
  assert.equal(await bad({ minDonation: 10 }), 400);
  assert.equal(await bad({ type: 'profissional' }), 400);
});

test('modalidade e tipo ficam travados depois que há times inscritos', async () => {
  const c = await signup(S.base);
  const t = await create(c);
  const reg = await new Client(S.base).post(`/public/${t.id}/teams`, teamInput('Time Um', 'futsal'));
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  assert.equal((await c.patch(`/tournaments/${t.id}`, { sport: 'futebol' })).status, 400);
  assert.equal((await c.patch(`/tournaments/${t.id}`, { type: 'oficial' })).status, 400);
  assert.equal((await c.patch(`/tournaments/${t.id}`, { sport: 'futsal', name: 'Mesmo esporte ok' })).status, 200);
});

test('não é possível reduzir as vagas abaixo dos times confirmados', async () => {
  const c = await signup(S.base);
  const t = await create(c, { sport: 'futsal' });
  for (let i = 0; i < 5; i++) assert.equal((await new Client(S.base).post(`/public/${t.id}/teams`, teamInput('Time ' + i + 'abc', 'futsal'))).status, 200);
  const r = await c.patch(`/tournaments/${t.id}`, { maxTeams: 4 });
  assert.equal(r.status, 400);
});

test('outro usuário não administra o torneio', async () => {
  const a = await signup(S.base), b = await signup(S.base);
  const t = await create(a);
  assert.equal((await b.get(`/tournaments/${t.id}`)).status, 403);
  assert.equal((await b.patch(`/tournaments/${t.id}`, { name: 'Invasão do torneio' })).status, 403);
  assert.equal((await b.del(`/tournaments/${t.id}`, { confirm: t.name })).status, 403);
  assert.equal((await new Client(S.base).get(`/tournaments/${t.id}`)).status, 401);
  assert.equal((await a.get('/tournaments/AM-2026-0000')).status, 404);
});

test('excluir exige o nome do torneio e remove da grade', async () => {
  const c = await signup(S.base);
  const t = await create(c);
  assert.equal((await c.del(`/tournaments/${t.id}`, { confirm: 'outro nome' })).status, 400);
  assert.equal((await c.del(`/tournaments/${t.id}`, { confirm: t.name })).status, 200);
  assert.equal((await c.get('/tournaments')).data.tournaments.length, 0);
  assert.equal((await new Client(S.base).get(`/public/${t.id}`)).status, 404);
});

test('convite: criar, ver, aceitar, uso único e administrar em conjunto', async () => {
  const owner = await signup(S.base, 'Dona'), guest = await signup(S.base, 'Convidado');
  const t = await create(owner);
  const inv = await owner.post(`/tournaments/${t.id}/invites`);
  assert.equal(inv.status, 200);
  const code = inv.data.invite.code;
  assert.match(inv.data.invite.url, new RegExp(`/convite/${code}$`));

  const info = await new Client(S.base).get(`/invites/${code}`);
  assert.equal(info.data.valid, true);
  assert.equal(info.data.tournament.id, t.id);
  assert.equal(info.data.inviter, 'Dona');

  assert.equal((await new Client(S.base).post(`/invites/${code}/accept`)).status, 401);
  const acc = await guest.post(`/invites/${code}/accept`);
  assert.equal(acc.status, 200);
  assert.equal(acc.data.tournamentId, t.id);

  // agora o convidado administra e vê o torneio na grade
  assert.equal((await guest.get('/tournaments')).data.tournaments[0].role, 'admin');
  assert.equal((await guest.patch(`/tournaments/${t.id}`, { name: 'Renomeado pelo convidado' })).status, 200);
  const adm = (await owner.get(`/tournaments/${t.id}`)).data.tournament;
  assert.equal(adm.admins.length, 2);
  assert.equal(adm.invites.length, 0);

  // uso único
  const third = await signup(S.base);
  assert.equal((await third.post(`/invites/${code}/accept`)).status, 404);
  assert.equal((await new Client(S.base).get(`/invites/${code}`)).data.valid, false);
});

test('convite revogado e convite expirado não funcionam', async () => {
  const owner = await signup(S.base), guest = await signup(S.base);
  const t = await create(owner);
  const a = (await owner.post(`/tournaments/${t.id}/invites`)).data.invite.code;
  assert.equal((await owner.del(`/tournaments/${t.id}/invites/${a}`)).status, 200);
  assert.equal((await new Client(S.base).get(`/invites/${a}`)).data.valid, false);
  assert.equal((await guest.post(`/invites/${a}/accept`)).status, 404);

  const b = (await owner.post(`/tournaments/${t.id}/invites`)).data.invite.code;
  setClock(() => Date.now() + 8 * 86400_000);
  assert.equal((await new Client(S.base).get(`/invites/${b}`)).data.valid, false);
  setClock(null);
});

test('regras de remoção de administradores', async () => {
  const owner = await signup(S.base, 'Dono'), g1 = await signup(S.base, 'G1'), g2 = await signup(S.base, 'G2');
  const t = await create(owner);
  for (const g of [g1, g2]) {
    const code = (await owner.post(`/tournaments/${t.id}/invites`)).data.invite.code;
    assert.equal((await g.post(`/invites/${code}/accept`)).status, 200);
  }
  // admin comum não remove outro admin
  assert.equal((await g1.del(`/tournaments/${t.id}/admins/${g2.user.id}`)).status, 403);
  // ninguém remove o dono
  assert.equal((await g1.del(`/tournaments/${t.id}/admins/${owner.user.id}`)).status, 403);
  // dono remove g2
  assert.equal((await owner.del(`/tournaments/${t.id}/admins/${g2.user.id}`)).status, 200);
  assert.equal((await g2.get(`/tournaments/${t.id}`)).status, 403);
  assert.equal((await g2.get('/tournaments')).data.tournaments.length, 0);
  // admin comum pode sair
  const leave = await g1.del(`/tournaments/${t.id}/admins/${g1.user.id}`);
  assert.equal(leave.status, 200);
  assert.equal(leave.data.left, true);
  assert.equal((await g1.get(`/tournaments/${t.id}`)).status, 403);
  // admin não excluiu o torneio; só o dono exclui
  assert.equal((await owner.get(`/tournaments/${t.id}`)).data.tournament.admins.length, 1);
});

test('aceitar convite sendo já administrador não consome o convite', async () => {
  const owner = await signup(S.base);
  const t = await create(owner);
  const code = (await owner.post(`/tournaments/${t.id}/invites`)).data.invite.code;
  assert.equal((await owner.post(`/invites/${code}/accept`)).status, 200);
  assert.equal((await new Client(S.base).get(`/invites/${code}`)).data.valid, true);
});

test('torneio de demonstração já vem com 8 times e permite simular fases', async () => {
  const c = await signup(S.base);
  const t = await create(c, { sport: 'futebol', demo: true });
  assert.equal(t.teamsConfirmed, 8);
  assert.equal(t.demo, true);
  const d = await c.post(`/tournaments/${t.id}/draw`);
  assert.equal(d.status, 200);
  assert.equal(d.data.tournament.bracket.rounds.length, 3);
  for (let i = 0; i < 3; i++) assert.equal((await c.post(`/tournaments/${t.id}/demo/simulate`)).status, 200);
  const fin = (await c.get(`/tournaments/${t.id}`)).data.tournament;
  assert.equal(fin.status, 'finalizado');
  assert.ok(fin.champion);
  // torneio normal não simula
  const normal = await create(c);
  assert.equal((await c.post(`/tournaments/${normal.id}/demo/simulate`)).status, 403);
});

test('transmissão ao vivo: aceita YouTube/Twitch e rejeita outros links', async () => {
  const c = await signup(S.base);
  const t = await create(c);
  assert.equal((await c.put(`/tournaments/${t.id}/stream`, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).data.tournament.stream.platform, 'youtube');
  assert.equal((await c.put(`/tournaments/${t.id}/stream`, { url: 'https://youtu.be/dQw4w9WgXcQ' })).data.tournament.stream.id, 'dQw4w9WgXcQ');
  assert.equal((await c.put(`/tournaments/${t.id}/stream`, { url: 'https://www.twitch.tv/arenamaster' })).data.tournament.stream.platform, 'twitch');
  assert.equal((await c.put(`/tournaments/${t.id}/stream`, { url: 'https://vimeo.com/123' })).status, 400);
  assert.equal((await c.put(`/tournaments/${t.id}/stream`, { url: 'http://youtube.com/watch?v=abc' })).status, 400);
  assert.equal((await c.put(`/tournaments/${t.id}/stream`, { url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await c.del(`/tournaments/${t.id}/stream`)).data.tournament.stream, null);
});
