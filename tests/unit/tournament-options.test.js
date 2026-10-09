// Inscrição gratuita, regras do torneio (checklist), detalhes e premiação.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, signup, teamInput } from './helpers.js';
import { setClock } from '../../lib/clock.js';

let S;
before(async () => { S = await startServer(); });
after(async () => { setClock(null); await S.close(); });

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const visitor = () => new Client(S.base);
const players = (n, { numbered = true } = {}) => Array.from({ length: n }, (_, i) => ({ name: `Atleta Numero ${i + 1}`, ...(numbered ? { number: i + 1 } : {}) }));
const create = async (org, body = {}) => {
  const r = await org.post('/tournaments', { name: 'Copa de Teste', sport: 'futsal', ...body });
  return r;
};
const register = (id, name, input = {}) => visitor().post(`/public/${id}/teams`, { ...teamInput(name, 'futsal'), ...input });

// ---------------------------------------------------------------- inscrição gratuita
test('criação com "Inscrição gratuita": valor zerado e time entra confirmado, sem pagamento', async () => {
  const org = await signup(S.base);
  const r = await create(org, { freeRegistration: true, fee: 5000 }); // gratuita vence o valor
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const t = r.data.tournament;
  assert.equal(t.fee, 0);
  assert.equal(t.freeRegistration, true);
  const reg = await register(t.id, 'Tigres do Bairro');
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  assert.equal(reg.data.team.status, 'confirmed');
  assert.equal(reg.data.team.paidVia, 'free');
  assert.equal((await visitor().get(`/public/${t.id}`)).data.tournament.teamsConfirmed, 1);
});

test('criação paga: exige valor cobrável e o time fica aguardando pagamento', async () => {
  const org = await signup(S.base);
  const r = await create(org, { freeRegistration: false, fee: 2500 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const t = r.data.tournament;
  assert.equal(t.fee, 2500);
  assert.equal(t.freeRegistration, false);
  const reg = await register(t.id, 'Time Pagante');
  assert.equal(reg.data.team.status, 'pending_payment');

  for (const bad of [{ freeRegistration: false }, { freeRegistration: false, fee: 0 }, { freeRegistration: false, fee: 100 }, { freeRegistration: false, fee: 'abc' }, { freeRegistration: false, fee: 99_999_999 }, { freeRegistration: 'sim' }]) {
    const x = await create(org, bad);
    assert.equal(x.status, 400, JSON.stringify(bad));
    assert.match(x.data.error.code, /VALIDATION/);
  }
});

test('criação sem informar nada continua gratuita (compatibilidade)', async () => {
  const org = await signup(S.base);
  const t = (await create(org)).data.tournament;
  assert.equal(t.fee, 0);
  assert.equal(t.freeRegistration, true);
  assert.equal((await register(t.id, 'Time Qualquer')).data.team.status, 'confirmed');
});

test('configurações: alternar gratuita/paga e confirmar reservas que nunca começaram a pagar', async () => {
  const org = await signup(S.base);
  const t = (await create(org, { freeRegistration: false, fee: 3000 })).data.tournament;
  const a = (await register(t.id, 'Reserva Sem Pagar')).data.team;
  const b = (await register(t.id, 'Reserva Pagando')).data.team;
  const pix = await visitor().post(`/public/${t.id}/teams/${b.id}/pay`, { code: b.accessCode, method: 'pix' });
  assert.equal(pix.status, 200, JSON.stringify(pix.data));

  assert.equal((await org.patch(`/tournaments/${t.id}`, { freeRegistration: false })).status, 200, 'mantém o valor atual');
  const free = await org.patch(`/tournaments/${t.id}`, { freeRegistration: true });
  assert.equal(free.status, 200, JSON.stringify(free.data));
  assert.equal(free.data.tournament.fee, 0);
  const st = Object.fromEntries(free.data.tournament.teams.map(x => [x.name, x.status]));
  assert.equal(st['Reserva Sem Pagar'], 'confirmed', 'quem não iniciou pagamento entra na lista');
  assert.equal(st['Reserva Pagando'], 'pending_payment', 'quem já abriu uma cobrança segue o fluxo dela');
  assert.equal(a.status, 'pending_payment');

  const paid = await org.patch(`/tournaments/${t.id}`, { freeRegistration: false });
  assert.equal(paid.status, 400, 'sem valor cobrável não dá para voltar a ser paga');
  assert.equal(paid.data.error.details.field, 'fee');
  const ok = await org.patch(`/tournaments/${t.id}`, { freeRegistration: false, fee: 4500 });
  assert.equal(ok.data.tournament.fee, 4500);
  assert.equal(ok.data.tournament.freeRegistration, false);
});

// ---------------------------------------------------------------- detalhes
test('detalhes: preserva quebras de linha, normaliza e aparece para o visitante', async () => {
  const org = await signup(S.base);
  const details = 'Aviso 1: portões abrem às 8h.\r\n\r\n\r\n\r\nAviso 2:   proibido  som alto.  \u0007';
  const t = (await create(org, { details })).data.tournament;
  assert.equal(t.details, 'Aviso 1: portões abrem às 8h.\n\nAviso 2:   proibido  som alto.');
  assert.equal((await visitor().get(`/public/${t.id}`)).data.tournament.details, t.details);

  const up = await org.patch(`/tournaments/${t.id}`, { details: '  Novo aviso\nSegunda linha  ' });
  assert.equal(up.data.tournament.details, 'Novo aviso\nSegunda linha');
  const clear = await org.patch(`/tournaments/${t.id}`, { details: '' });
  assert.equal(clear.data.tournament.details, '');

  assert.equal((await create(org, { details: 'x'.repeat(4001) })).status, 400);
  assert.equal((await org.patch(`/tournaments/${t.id}`, { details: 'x'.repeat(4001) })).status, 400);
  assert.equal((await create(org, { details: 'x'.repeat(4000) })).status, 200);
});

test('detalhes não executam HTML: a API devolve texto puro (o front escapa)', async () => {
  const org = await signup(S.base);
  const t = (await create(org, { details: '<img src=x onerror=alert(1)>' })).data.tournament;
  assert.equal(t.details, '<img src=x onerror=alert(1)>');
});

// ---------------------------------------------------------------- regras
test('regras: padrão mantém só o número da camisa e valida o que o organizador envia', async () => {
  const org = await signup(S.base);
  const t = (await create(org)).data.tournament;
  assert.deepEqual(t.rules, { custom: [], minPlayers: null, shirtNumbers: true, emblemRequired: false, uniform: false, idDocument: false, minAge: null, punctuality: false, captainPresent: false });
  assert.equal(t.rosterRules.min, 5);

  const rules = { minPlayers: 7, shirtNumbers: false, emblemRequired: true, uniform: true, minAge: 18, custom: ['Proibido chuteira de trava', '  Proibido   chuteira de trava ', 'Levar bola própria'] };
  const ok = await org.patch(`/tournaments/${t.id}`, { rules });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const r = ok.data.tournament.rules;
  assert.equal(r.minPlayers, 7); assert.equal(r.shirtNumbers, false); assert.equal(r.emblemRequired, true);
  assert.equal(r.uniform, true); assert.equal(r.minAge, 18);
  assert.deepEqual(r.custom, ['Proibido chuteira de trava', 'Levar bola própria'], 'regras repetidas são unidas');
  assert.equal(ok.data.tournament.rosterRules.min, 7);

  const partial = await org.patch(`/tournaments/${t.id}`, { rules: { punctuality: true } });
  assert.equal(partial.data.tournament.rules.punctuality, true);
  assert.equal(partial.data.tournament.rules.minPlayers, 7, 'chaves ausentes preservam o valor atual');

  const off = await org.patch(`/tournaments/${t.id}`, { rules: { minPlayers: null, minAge: false } });
  assert.equal(off.data.tournament.rules.minPlayers, null);
  assert.equal(off.data.tournament.rules.minAge, null);

  for (const bad of [{ minPlayers: 4 }, { minPlayers: 13 }, { minPlayers: 7.5 }, { minPlayers: 'muitos' }, { minAge: 3 }, { minAge: 120 }, { uniform: 'sim' }, { custom: 'texto' }, { custom: ['ab'] }, { custom: ['x'.repeat(121)] }, { custom: Array.from({ length: 9 }, (_, i) => `Regra número ${i}`) }]) {
    const x = await org.patch(`/tournaments/${t.id}`, { rules: bad });
    assert.equal(x.status, 400, JSON.stringify(bad));
    assert.match(x.data.error.details?.field || '', /^rules\./, `campo do erro: ${JSON.stringify(bad)}`);
  }
  assert.equal((await org.patch(`/tournaments/${t.id}`, { rules: 'tudo' })).status, 400);
  assert.equal((await create(org, { rules: { minPlayers: 99 } })).status, 400);
});

test('regra "mínimo de jogadores" é aplicada na inscrição e nunca fica abaixo do mínimo da modalidade', async () => {
  const org = await signup(S.base);
  const t = (await create(org, { rules: { minPlayers: 7 } })).data.tournament;
  const low = await register(t.id, 'Time Pequeno', { players: players(5) });
  assert.equal(low.status, 400);
  assert.match(low.data.error.message, /ao menos 7 atletas \(faltam 2\)/);
  assert.equal(low.data.error.details.field, 'players');
  assert.equal((await register(t.id, 'Time Grande', { players: players(7) })).status, 200);
  // sem a regra, vale o mínimo da modalidade
  const t2 = (await create(org)).data.tournament;
  assert.equal((await register(t2.id, 'Time Normal', { players: players(5) })).status, 200);
  assert.equal((await register(t2.id, 'Time Curto', { players: players(4) })).status, 400);
});

test('regra "número da camisa": ligada exige e não repete; desligada deixa opcional', async () => {
  const org = await signup(S.base);
  const on = (await create(org)).data.tournament;
  const blank = await register(on.id, 'Sem Numero', { players: players(5, { numbered: false }) });
  assert.equal(blank.status, 400);
  assert.match(blank.data.error.message, /número de camisa/);

  const off = (await create(org, { rules: { shirtNumbers: false } })).data.tournament;
  const noNum = await register(off.id, 'Sem Numero', { players: players(5, { numbered: false }) });
  assert.equal(noNum.status, 200, JSON.stringify(noNum.data));
  const pub = (await visitor().get(`/public/${off.id}`)).data.tournament;
  assert.ok(pub.teams[0].players.every(p => p.number === null), 'jogadores sem número seguem null para o front');
  // misturado: quem informa não pode repetir
  const mixed = players(5, { numbered: false }); mixed[0].number = 10; mixed[1].number = 10;
  const dup = await register(off.id, 'Numero Repetido', { players: mixed });
  assert.equal(dup.status, 400);
  assert.match(dup.data.error.message, /camisa 10 está repetida/);
  mixed[1].number = 11;
  assert.equal((await register(off.id, 'Numero Misto', { players: mixed })).status, 200);
  const bad = players(5); bad[0].number = 100;
  assert.equal((await register(off.id, 'Numero Alto', { players: bad })).status, 400);
});

test('regra "emblema obrigatório" e aceite das regras (uniforme, idade, regras livres)', async () => {
  const org = await signup(S.base);
  const t = (await create(org, { rules: { emblemRequired: true, uniform: true, custom: ['Levar bola própria'] } })).data.tournament;

  const noEmblem = await register(t.id, 'Sem Escudo', { rulesAccepted: true });
  assert.equal(noEmblem.status, 400);
  assert.equal(noEmblem.data.error.details.field, 'emblem');

  const noAccept = await register(t.id, 'Sem Aceite', { emblem: PNG });
  assert.equal(noAccept.status, 400);
  assert.equal(noAccept.data.error.code, 'RULES_NOT_ACCEPTED');
  const truthy = await register(t.id, 'Aceite Falso', { emblem: PNG, rulesAccepted: 'true' });
  assert.equal(truthy.status, 400, 'só o booleano true vale como aceite');

  const ok = await register(t.id, 'Time Em Dia', { emblem: PNG, rulesAccepted: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const adm = (await org.get(`/tournaments/${t.id}`)).data.tournament;
  assert.ok(adm.teams.find(x => x.name === 'Time Em Dia').rulesAcceptedAt > 0, 'o aceite fica registrado para o organizador');
  assert.ok(!JSON.stringify((await visitor().get(`/public/${t.id}`)).data).includes('rulesAcceptedAt'), 'o visitante não vê quando cada time aceitou');

  // só regras verificadas pelo sistema (sem declaração): não pede aceite
  const t2 = (await create(org, { rules: { minPlayers: 6 } })).data.tournament;
  assert.equal((await register(t2.id, 'Sem Aceite Necessario', { players: players(6) })).status, 200);
});

test('inscrição manual do organizador não exige aceite nem emblema', async () => {
  const org = await signup(S.base);
  const t = (await create(org, { rules: { emblemRequired: true, uniform: true, minPlayers: 6 } })).data.tournament;
  const short = await org.post(`/tournaments/${t.id}/teams`, { ...teamInput('Manual Curto', 'futsal'), players: players(5) });
  assert.equal(short.status, 400, 'o mínimo de jogadores vale também para o organizador');
  const ok = await org.post(`/tournaments/${t.id}/teams`, { ...teamInput('Manual Completo', 'futsal'), players: players(6) });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const team = ok.data.tournament.teams.find(x => x.name === 'Manual Completo');
  assert.equal(team.status, 'confirmed');
  assert.equal(team.rulesAcceptedAt, null);
});

test('trocar a modalidade ajusta um "mínimo de jogadores" que ficaria fora dos limites', async () => {
  const org = await signup(S.base);
  const t = (await create(org, { sport: 'futebol', rules: { minPlayers: 16 } })).data.tournament;
  assert.equal(t.rules.minPlayers, 16);
  const r = await org.patch(`/tournaments/${t.id}`, { sport: 'futsal' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.tournament.rules.minPlayers, null);
  assert.equal(r.data.tournament.rosterRules.min, 5);
  const keep = (await create(org, { sport: 'futebol', rules: { minPlayers: 12 } })).data.tournament;
  const r2 = await org.patch(`/tournaments/${keep.id}`, { sport: 'volei', rules: { minPlayers: 8 } });
  assert.equal(r2.data.tournament.rules.minPlayers, 8);
});

test('torneio criado antes das regras (sem o campo salvo) segue com o comportamento original', async () => {
  const org = await signup(S.base);
  const t = (await create(org)).data.tournament;
  const rec = await S.store.get(`t:${t.id}`);
  delete rec.rules; delete rec.prizes; delete rec.details;
  await S.store.set(`t:${t.id}`, rec);
  const pub = (await visitor().get(`/public/${t.id}`)).data.tournament;
  assert.equal(pub.rules.shirtNumbers, true);
  assert.deepEqual(pub.prizes, { geral: [], masculino: [], feminino: [] });
  assert.equal(pub.details, '');
  assert.equal((await register(t.id, 'Time Legado')).status, 200);
});

// ---------------------------------------------------------------- premiação
test('premiação: 1º, 2º, 3º… para geral, masculino e feminino no mesmo torneio', async () => {
  const org = await signup(S.base);
  const prizes = {
    masculino: [{ description: 'Troféu + medalhas', amount: 100000 }, { description: 'Medalhas', amount: 50000 }, { description: '', amount: 20000 }],
    feminino: [{ description: 'Troféu + medalhas', amount: 80000 }, { description: 'Kit de uniformes' }],
  };
  const r = await create(org, { prizes });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const t = r.data.tournament;
  assert.deepEqual(t.prizes.geral, []);
  assert.equal(t.prizes.masculino.length, 3);
  assert.deepEqual(t.prizes.masculino[0], { description: 'Troféu + medalhas', amount: 100000 });
  assert.deepEqual(t.prizes.feminino[1], { description: 'Kit de uniformes', amount: null });
  const pub = (await visitor().get(`/public/${t.id}`)).data.tournament;
  assert.deepEqual(pub.prizes, t.prizes, 'o visitante vê a mesma premiação');

  // editar uma categoria preserva as demais; lista vazia remove
  const up = await org.patch(`/tournaments/${t.id}`, { prizes: { geral: [{ description: 'Churrasco para o campeão' }], feminino: [] } });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal(up.data.tournament.prizes.geral[0].description, 'Churrasco para o campeão');
  assert.equal(up.data.tournament.prizes.masculino.length, 3);
  assert.equal(up.data.tournament.prizes.feminino.length, 0);
});

test('premiação: rejeita colocação vazia, valores fora do limite e listas grandes demais', async () => {
  const org = await signup(S.base);
  const t = (await create(org)).data.tournament;
  const bad = [
    { masculino: [{ description: '', amount: null }] },
    { masculino: [{ description: 'Troféu', amount: -5 }] },
    { masculino: [{ description: 'Troféu', amount: 50 }] },
    { masculino: [{ description: 'Troféu', amount: 10_000_001 }] },
    { masculino: [{ description: 'Troféu', amount: 10.5 }] },
    { masculino: [{ description: 'x'.repeat(81) }] },
    { masculino: Array.from({ length: 11 }, (_, i) => ({ description: `Prêmio ${i + 1}` })) },
    { masculino: 'troféu' },
    { masculino: ['troféu'] },
  ];
  for (const prizes of bad) {
    const x = await org.patch(`/tournaments/${t.id}`, { prizes });
    assert.equal(x.status, 400, JSON.stringify(prizes));
    assert.equal(x.data.error.details.field, 'prizes');
  }
  assert.equal((await org.patch(`/tournaments/${t.id}`, { prizes: 'nada' })).status, 400);
  assert.equal((await create(org, { prizes: bad[0] })).status, 400);
  const ten = await org.patch(`/tournaments/${t.id}`, { prizes: { geral: Array.from({ length: 10 }, (_, i) => ({ description: `Prêmio ${i + 1}` })) } });
  assert.equal(ten.status, 200);
  // categorias desconhecidas são ignoradas
  const odd = await org.patch(`/tournaments/${t.id}`, { prizes: { misto: [{ description: 'x' }] } });
  assert.equal(odd.status, 200);
  assert.equal(odd.data.tournament.prizes.misto, undefined);
});

test('só administradores alteram regras, detalhes e premiação', async () => {
  const org = await signup(S.base);
  const t = (await create(org)).data.tournament;
  const other = await signup(S.base, 'Outro');
  for (const patch of [{ rules: { uniform: true } }, { details: 'invasor' }, { prizes: { geral: [{ description: 'x' }] } }, { freeRegistration: false, fee: 9000 }]) {
    assert.equal((await other.patch(`/tournaments/${t.id}`, patch)).status, 403);
    assert.equal((await visitor().patch(`/tournaments/${t.id}`, patch)).status, 401);
  }
  assert.equal((await org.get(`/tournaments/${t.id}`)).data.tournament.rules.uniform, false);
});
