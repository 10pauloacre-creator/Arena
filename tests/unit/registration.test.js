import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, signup, teamInput, roster, genCpf } from './helpers.js';
import { setClock } from '../../lib/clock.js';

let S;
before(async () => { S = await startServer(); });
after(async () => { setClock(null); await S.close(); });

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function mk(c, patch = {}, sport = 'futsal') {
  const t = (await c.post('/tournaments', { name: 'Copa de Teste', sport })).data.tournament;
  if (Object.keys(patch).length) {
    const r = await c.patch(`/tournaments/${t.id}`, patch);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data.tournament;
  }
  return t;
}
const visitor = () => new Client(S.base);
const reg = (v, id, name, extra) => v.post(`/public/${id}/teams`, teamInput(name, extra?.sport || 'futsal', extra));

test('inscrição gratuita confirma o time na hora e ele aparece na lista pública', async () => {
  const org = await signup(S.base);
  const t = await mk(org);
  const r = await reg(visitor(), t.id, 'Tigres do Bairro');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.team.status, 'confirmed');
  assert.ok(r.data.team.accessCode);
  const pub = (await visitor().get(`/public/${t.id}`)).data.tournament;
  assert.equal(pub.teams.length, 1);
  assert.equal(pub.teams[0].name, 'Tigres do Bairro');
  assert.equal(pub.teamsConfirmed, 1);
});

test('visão pública não vaza dados pessoais (contato, CPF, código)', async () => {
  const org = await signup(S.base);
  const t = await mk(org, { type: 'oficial' });
  const r = await reg(visitor(), t.id, 'Time Oficial', { official: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const text = JSON.stringify((await visitor().get(`/public/${t.id}`)).data);
  for (const secret of ['capitao@teste.com', '98765', 'accessCode', r.data.team.accessCode, 'cpf', 'rg1234', 'passHash', 'ownerId']) assert.ok(!text.includes(secret), `vazou: ${secret}`);
  assert.ok(text.includes('Jogador Numero 1'));
  // o organizador vê tudo
  const adm = (await org.get(`/tournaments/${t.id}`)).data.tournament;
  assert.equal(adm.teams[0].captain.email, 'capitao@teste.com');
  assert.match(adm.teams[0].players[0].cpf, /^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
});

test('ID aceita variações (#, minúsculas, espaços) e rejeita inexistentes', async () => {
  const org = await signup(S.base);
  const t = await mk(org);
  const v = visitor();
  assert.equal((await v.get(`/public/${encodeURIComponent('#' + t.id.toLowerCase())}`)).status, 200);
  assert.equal((await v.get(`/public/${encodeURIComponent(' ' + t.id + ' ')}`)).status, 200);
  assert.equal((await v.get('/public/AM-2026-0001')).status, 404);
  assert.equal((await v.get('/public/lixo')).status, 404);
});

test('ETag: 304 quando nada mudou e 200 após mudança', async () => {
  const org = await signup(S.base);
  const t = await mk(org);
  const v = visitor();
  const a = await v.get(`/public/${t.id}`);
  const etag = a.headers.get('etag');
  assert.ok(etag);
  const b = await v.get(`/public/${t.id}`, { headers: { 'If-None-Match': etag } });
  assert.equal(b.status, 304);
  await reg(visitor(), t.id, 'Novo Time Aqui');
  const c = await v.get(`/public/${t.id}`, { headers: { 'If-None-Match': etag } });
  assert.equal(c.status, 200);
});

test('validações da inscrição: nome, elenco mínimo, camisas repetidas, contato', async () => {
  const org = await signup(S.base);
  const t = await mk(org);
  const v = visitor();
  const post = body => v.post(`/public/${t.id}/teams`, body);
  const ok = teamInput('Valido FC');
  assert.equal((await post({ ...ok, name: 'ab' })).status, 400);
  assert.equal((await post({ ...ok, players: ok.players.slice(0, 4) })).status, 400);
  assert.equal((await post({ ...ok, players: ok.players.map(p => ({ ...p, number: 7 })) })).status, 400);
  assert.equal((await post({ ...ok, players: ok.players.map((p, i) => i ? p : { ...p, number: 100 }) })).status, 400);
  assert.equal((await post({ ...ok, players: ok.players.map((p, i) => i ? p : { ...p, name: 'Jo' }) })).status, 400);
  assert.equal((await post({ ...ok, captain: { ...ok.captain, email: 'sem-arroba' } })).status, 400);
  assert.equal((await post({ ...ok, captain: { ...ok.captain, phone: '123' } })).status, 400);
  assert.equal((await post({ ...ok, players: [...ok.players, ...roster('futsal', { offset: 50 }).map((p, i) => ({ ...p, number: 20 + i }))] })).status, 400); // acima do máximo (12)
  assert.equal((await post(ok)).status, 200);
  assert.equal((await post({ ...ok, name: 'VALIDO fc' })).status, 409); // nome repetido (sem diferenciar maiúsculas)
});

test('nome do time e nomes de atletas são sanitizados contra HTML (armazenado como texto)', async () => {
  const org = await signup(S.base);
  const t = await mk(org);
  const input = teamInput('<img src=x onerror=alert(1)>');
  const r = await visitor().post(`/public/${t.id}/teams`, input);
  assert.equal(r.status, 200);
  assert.equal(r.data.team.name, '<img src=x onerror=alert(1)>'); // texto puro; o front escapa
});

test('torneio oficial exige CPF válido, RG e PDF; barra CPF duplicado entre times', async () => {
  const org = await signup(S.base);
  const t = await mk(org, { type: 'oficial' });
  const v = visitor();
  const base = teamInput('Oficial Um', 'futsal', { official: true });
  const noCpf = await v.post(`/public/${t.id}/teams`, { ...base, players: base.players.map((p, i) => i ? p : { ...p, cpf: '111.111.111-11' }) });
  assert.equal(noCpf.status, 400);
  const noDoc = await v.post(`/public/${t.id}/teams`, { ...base, players: base.players.map((p, i) => i ? p : { ...p, doc: null }) });
  assert.equal(noDoc.status, 400);
  const bigDoc = await v.post(`/public/${t.id}/teams`, { ...base, players: base.players.map((p, i) => i ? p : { ...p, doc: { name: 'a.pdf', size: 9 * 1024 * 1024 } }) });
  assert.equal(bigDoc.status, 400);
  const notPdf = await v.post(`/public/${t.id}/teams`, { ...base, players: base.players.map((p, i) => i ? p : { ...p, doc: { name: 'a.exe', size: 10 } }) });
  assert.equal(notPdf.status, 400);
  assert.equal((await v.post(`/public/${t.id}/teams`, base)).status, 200);

  // mesmo CPF em outro time: barrado e contabilizado
  const dup = teamInput('Oficial Dois', 'futsal', { official: true, offset: 1 });
  dup.players[0].cpf = base.players[0].cpf;
  const r = await v.post(`/public/${t.id}/teams`, dup);
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'DUPLICATE_ATHLETE');
  const adm = (await org.get(`/tournaments/${t.id}`)).data.tournament;
  assert.equal(adm.stats.blocked, 1);
  assert.equal(adm.teams.length, 1);
});

test('emblema: aceita imagem pequena, serve pelo endpoint e recusa formatos/tamanhos inválidos', async () => {
  const org = await signup(S.base);
  const t = await mk(org);
  const v = visitor();
  assert.equal((await v.post(`/public/${t.id}/teams`, { ...teamInput('Com Emblema'), emblem: 'data:image/svg+xml;base64,PHN2Zy8+' })).status, 400);
  assert.equal((await v.post(`/public/${t.id}/teams`, { ...teamInput('Com Emblema'), emblem: 'data:image/png;base64,' + 'A'.repeat(100000) })).status, 400);
  const r = await v.post(`/public/${t.id}/teams`, { ...teamInput('Com Emblema'), emblem: PNG });
  assert.equal(r.status, 200);
  const pub = (await v.get(`/public/${t.id}`)).data.tournament;
  const url = pub.teams[0].emblemUrl;
  assert.match(url, /\/api\/public\/.+\/emblem\//);
  const img = await fetch(S.base + url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await img.arrayBuffer()).byteLength > 20, true);
});

// ------------------------------------------------------------------ pagamento

test('inscrição paga: fica pendente, PIX gerado, simulação confirma e o time entra na lista', async () => {
  const org = await signup(S.base);
  const t = await mk(org, { fee: 15000 });
  const v = visitor();
  const r = await reg(v, t.id, 'Pagantes FC');
  assert.equal(r.data.team.status, 'pending_payment');
  assert.ok(r.data.team.reservationLeftMs > 25 * 60_000);
  const { id: teamId, accessCode } = r.data.team;
  // ainda não aparece publicamente
  assert.equal((await v.get(`/public/${t.id}`)).data.tournament.teams.length, 0);

  const pay = await v.post(`/public/${t.id}/teams/${teamId}/pay`, { code: accessCode, method: 'pix' });
  assert.equal(pay.status, 200, JSON.stringify(pay.data));
  assert.equal(pay.data.payment.status, 'pending');
  assert.equal(pay.data.payment.amount, 15000);
  assert.match(pay.data.payment.pix.code, /^000201.*6304[0-9A-F]{4}$/);
  assert.equal(pay.data.payment.mock, true);

  // recarregar a página reaproveita o mesmo PIX
  const again = await v.post(`/public/${t.id}/teams/${teamId}/pay`, { code: accessCode, method: 'pix' });
  assert.equal(again.data.payment.id, pay.data.payment.id);

  // código errado não consulta nem simula
  assert.equal((await v.get(`/public/${t.id}/payments/${pay.data.payment.id}?code=ERRADO`)).status, 403);
  assert.equal((await v.post(`/public/${t.id}/payments/${pay.data.payment.id}/simulate`, { code: 'ERRADO' })).status, 403);
  assert.equal((await v.get(`/public/${t.id}/payments/${pay.data.payment.id}?code=${accessCode}`)).data.payment.status, 'pending');

  const sim = await v.post(`/public/${t.id}/payments/${pay.data.payment.id}/simulate`, { code: accessCode });
  assert.equal(sim.status, 200);
  assert.equal(sim.data.payment.status, 'approved');
  assert.equal(sim.data.team.status, 'confirmed');
  const pub = (await v.get(`/public/${t.id}`)).data.tournament;
  assert.equal(pub.teams.length, 1);
  // idempotente
  assert.equal((await v.post(`/public/${t.id}/payments/${pay.data.payment.id}/simulate`, { code: accessCode })).status, 409);
  assert.equal((await v.post(`/public/${t.id}/teams/${teamId}/pay`, { code: accessCode, method: 'pix' })).status, 409);

  const adm = (await org.get(`/tournaments/${t.id}`)).data.tournament;
  assert.equal(adm.stats.revenue, 15000);
  assert.equal(adm.teams[0].paidVia, 'pix');
});

test('cartão: aprovado com 4242…, recusado com 4000…0002 e dados do cartão nunca são guardados', async () => {
  const org = await signup(S.base);
  const t = await mk(org, { fee: 8000 });
  const v = visitor();
  const r = await reg(v, t.id, 'Cartao FC');
  const { id: teamId, accessCode } = r.data.team;
  const card = n => ({ number: n, name: 'FULANO DE TAL', expiry: '12/39', cvv: '123' });

  const declined = await v.post(`/public/${t.id}/teams/${teamId}/pay`, { code: accessCode, method: 'card', card: card('4000 0000 0000 0002') });
  assert.equal(declined.data.payment.status, 'declined');
  assert.match(declined.data.payment.failReason, /recusado/i);
  assert.equal(declined.data.team.status, 'pending_payment');

  const invalid = await v.post(`/public/${t.id}/teams/${teamId}/pay`, { code: accessCode, method: 'card', card: card('1234 5678 9012 3456') });
  assert.equal(invalid.data.payment.status, 'declined');

  const expired = await v.post(`/public/${t.id}/teams/${teamId}/pay`, { code: accessCode, method: 'card', card: { ...card('4242424242424242'), expiry: '01/20' } });
  assert.equal(expired.data.payment.status, 'declined');

  const ok = await v.post(`/public/${t.id}/teams/${teamId}/pay`, { code: accessCode, method: 'card', card: card('4242 4242 4242 4242') });
  assert.equal(ok.data.payment.status, 'approved');
  assert.equal(ok.data.payment.card.last4, '4242');
  assert.equal(ok.data.payment.card.brand, 'Visa');
  assert.equal(ok.data.team.status, 'confirmed');

  const dump = JSON.stringify(await S.store.get(`t:${t.id}`));
  assert.ok(!dump.includes('4242424242424242') && !dump.includes('4242 4242') && !dump.includes('"cvv"') && !dump.includes('FULANO'));
});

test('forma de pagamento inválida e valor zero', async () => {
  const org = await signup(S.base);
  const t = await mk(org, { fee: 8000 });
  const v = visitor();
  const r = await reg(v, t.id, 'Metodos FC');
  assert.equal((await v.post(`/public/${t.id}/teams/${r.data.team.id}/pay`, { code: r.data.team.accessCode, method: 'boleto' })).status, 400);
});

test('capacidade: reservas ocupam vaga, expiram em 30 min e liberam a vaga', async () => {
  const org = await signup(S.base);
  const t = await mk(org, { fee: 5000, maxTeams: 4 });
  const v = visitor();
  const teams = [];
  for (let i = 0; i < 4; i++) teams.push((await reg(v, t.id, 'Reserva ' + i + 'zz')).data.team);
  const full = await reg(v, t.id, 'Quinto Time');
  assert.equal(full.status, 409);
  assert.equal(full.data.error.code, 'FULL');
  assert.equal((await v.get(`/public/${t.id}`)).data.tournament.registration.slotsLeft, 0);

  setClock(() => Date.now() + 31 * 60_000); // as reservas vencem
  assert.equal((await v.get(`/public/${t.id}`)).data.tournament.registration.slotsLeft, 4);
  const late = await v.post(`/public/${t.id}/teams/${teams[0].id}/pay`, { code: teams[0].accessCode, method: 'pix' });
  assert.equal(late.status, 409);
  assert.equal(late.data.error.code, 'EXPIRED');
  assert.equal((await reg(v, t.id, 'Quinto Time')).status, 200);
  setClock(null);
});

test('pagamento aprovado depois da reserva vencer: confirma se houver vaga, senão sinaliza reembolso', async () => {
  const org = await signup(S.base);
  const t = await mk(org, { fee: 5000, maxTeams: 4 });
  const v = visitor();
  const a = (await reg(v, t.id, 'Atrasado FC')).data.team;
  const pay = (await v.post(`/public/${t.id}/teams/${a.id}/pay`, { code: a.accessCode, method: 'pix' })).data.payment;

  setClock(() => Date.now() + 31 * 60_000); // reserva e PIX vencem
  // ocupa todas as vagas com times gratuitos manualmente (organizador)
  for (let i = 0; i < 4; i++) {
    const r = await org.post(`/tournaments/${t.id}/teams`, teamInput('Manual ' + i + 'x', 'futsal', { offset: i * 3 }));
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  setClock(null);
  // o dono do PIX paga "tarde" (webhook/simulação direta no store): sem vaga → reembolso
  const { applyStatus } = await import('../../lib/domain/payments.js');
  const { withTournament } = await import('../../lib/repo.js');
  await withTournament(S.store, t.id, (tt, now) => { applyStatus(tt, tt.payments.find(p => p.id === pay.id), 'approved', now); });
  const adm = (await org.get(`/tournaments/${t.id}`)).data.tournament;
  assert.equal(adm.stats.refundsPending, 1);
  assert.equal(adm.teams.find(x => x.name === 'Atrasado FC').status, 'expired');
  assert.equal(adm.teams.filter(x => x.status === 'confirmed').length, 4);
  // organizador marca reembolso concluído
  const done = await org.post(`/tournaments/${t.id}/payments/${pay.id}/refunded`);
  assert.equal(done.data.tournament.stats.refundsPending, 0);
});

test('prazo: inscrição bloqueada após o horário limite e quando o organizador encerra', async () => {
  const org = await signup(S.base);
  const deadline = new Date(Date.now() + 60_000).toISOString();
  const t = await mk(org, { regDeadline: deadline });
  const v = visitor();
  assert.equal((await reg(v, t.id, 'Antes do Prazo')).status, 200);
  setClock(() => Date.now() + 120_000);
  const late = await reg(v, t.id, 'Depois do Prazo');
  assert.equal(late.status, 409);
  assert.match(late.data.error.message, /prazo/i);
  assert.equal((await v.get(`/public/${t.id}`)).data.tournament.status, 'encerradas');
  setClock(null);
  // reabrir prazo
  const future = new Date(Date.now() + 86400_000).toISOString();
  await org.patch(`/tournaments/${t.id}`, { regDeadline: future });
  assert.equal((await reg(v, t.id, 'Depois do Prazo')).status, 200);
  // encerrar manualmente
  await org.patch(`/tournaments/${t.id}`, { registrationOpen: false });
  assert.equal((await reg(v, t.id, 'Terceiro Time')).status, 409);
  assert.equal((await v.get(`/public/${t.id}`)).data.tournament.registration.open, false);
});

test('organizador: adiciona time manualmente, confirma pagamento em dinheiro, edita e remove', async () => {
  const org = await signup(S.base);
  const t = await mk(org, { fee: 10000 });
  const v = visitor();
  const pend = (await reg(v, t.id, 'Pendente FC')).data.team;
  let adm = (await org.get(`/tournaments/${t.id}`)).data.tournament;
  assert.equal(adm.teams[0].status, 'pending_payment');
  const conf = await org.post(`/tournaments/${t.id}/teams/${pend.id}/confirm`);
  assert.equal(conf.data.tournament.teams[0].status, 'confirmed');
  assert.equal(conf.data.tournament.teams[0].paidVia, 'manual');

  const man = await org.post(`/tournaments/${t.id}/teams`, teamInput('Manual FC', 'futsal', { offset: 10 }));
  assert.equal(man.data.tournament.teams.length, 2);
  const mid = man.data.tournament.teams.find(x => x.name === 'Manual FC').id;
  const ed = await org.patch(`/tournaments/${t.id}/teams/${mid}`, { name: 'Manual Editado', rating: 1700 });
  assert.equal(ed.data.tournament.teams.find(x => x.id === mid).name, 'Manual Editado');
  assert.equal(ed.data.tournament.teams.find(x => x.id === mid).rating, 1700);
  assert.equal((await org.patch(`/tournaments/${t.id}/teams/${mid}`, { rating: 9 })).status, 400);
  assert.equal((await org.patch(`/tournaments/${t.id}/teams/${mid}`, { name: 'Pendente FC' })).status, 409);
  const rm = await org.del(`/tournaments/${t.id}/teams/${mid}`);
  assert.equal(rm.data.tournament.teams.length, 1);
  // visitante não pode usar rotas de admin
  assert.equal((await v.del(`/tournaments/${t.id}/teams/${pend.id}`)).status, 401);
});

test('após o sorteio não há mais inscrições nem remoções', async () => {
  const org = await signup(S.base);
  const t = await mk(org);
  const v = visitor();
  for (let i = 0; i < 4; i++) await reg(v, t.id, 'Time ' + i + 'ab', { offset: i * 2 });
  assert.equal((await org.post(`/tournaments/${t.id}/draw`)).status, 200);
  const r = await reg(v, t.id, 'Atrasado Total');
  assert.equal(r.status, 409);
  const adm = (await org.get(`/tournaments/${t.id}`)).data.tournament;
  assert.equal((await org.del(`/tournaments/${t.id}/teams/${adm.teams[0].id}`)).status, 409);
  assert.equal(adm.registration.open, false);
});

test('capitão consulta o próprio time só com o código correto', async () => {
  const org = await signup(S.base);
  const t = await mk(org);
  const v = visitor();
  const r = await reg(v, t.id, 'Consulta FC');
  const { id, accessCode } = r.data.team;
  assert.equal((await v.get(`/public/${t.id}/teams/${id}?code=${accessCode}`)).status, 200);
  assert.equal((await v.get(`/public/${t.id}/teams/${id}?code=XXXXXXXX`)).status, 403);
  assert.equal((await v.get(`/public/${t.id}/teams/${id}`)).status, 403);
});

test('webhook do Mercado Pago ignora requisições sem dados e provedor de teste', async () => {
  const v = visitor();
  const r = await v.post('/webhooks/mercadopago', { type: 'payment', data: { id: '123' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.ignored, true);
});

test('config pública informa modo de teste', async () => {
  const cfg = (await visitor().get('/config')).data;
  assert.equal(cfg.payments.mock, true);
  assert.deepEqual(cfg.payments.methods, ['pix', 'card']);
});
