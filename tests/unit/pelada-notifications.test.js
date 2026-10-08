// Notificações no app Pelada: eventos (entrou, presença, sorteio, partidas, resultados, agenda, lembrete),
// preferências por tipo e por pelada, leitura e regras contra avisos repetidos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client } from './helpers.js';
import { setClock } from '../../lib/clock.js';
import { describe as describeEvent, dayName, timeAgo, normalizePrefs, mergePrefs, defaultPrefs, NOTIF_KEYS } from '../../public/assets/js/shared/notifications.js';

let srv;
before(async () => { srv = await startServer(); });
after(async () => { setClock(null); await srv.close(); });

let n = 0;
async function newPlayer(name) {
  const c = new Client(srv.base);
  const r = await c.post('/pelada/auth/signup', { name: name ?? `Notif Jogador ${++n}`, birth: '15/05/1992' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  c.player = r.data.player;
  return c;
}
const todayIso = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const inbox = async c => { const r = await c.get('/pelada/notifications'); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
const texts = async c => (await inbox(c)).items.map(i => i.text);

let tags = 0;
/** Pelada com dono + `count` participantes (entram pelo link). */
async function setup(count = 3, { min = 2 } = {}) {
  const tag = `N${++tags}`;
  const owner = await newPlayer(`Dona ${tag} Silva`);
  const r = await owner.post('/pelada/peladas', { name: `Pelada ${tag}`, gender: 'feminino', minPerTeam: min, matchMinutes: 10, days: [{ date: todayIso() }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const id = r.data.pelada.id, dayId = r.data.pelada.days[0].id;
  const players = [];
  for (let i = 0; i < count; i++) {
    const c = await newPlayer(`Atleta ${tag}${String.fromCharCode(97 + i)} Souza`);
    assert.equal((await c.post(`/pelada/peladas/${id}/join`)).status, 200);
    players.push(c);
  }
  return { owner, players, id, dayId, base: `/pelada/peladas/${id}/days/${dayId}` };
}

test('textos: datas relativas, personalização e tempo decorrido', () => {
  const today = '2026-10-07';
  assert.equal(dayName('2026-10-07', today), 'hoje');
  assert.equal(dayName('2026-10-08', today), 'amanhã');
  assert.equal(dayName('2026-10-06', today), 'ontem');
  assert.equal(dayName('2026-10-10', today), 'sáb, 10/10');
  const draw = { t: 'draw', who: 'Ana', day: { id: 'd1', date: today }, d: { teams: 3, slot: { u1: 'Time 2 - Bia' } } };
  assert.equal(describeEvent(draw, { viewerId: 'u1', today }).text, 'Ana sorteou os times do jogo de hoje: 3 times. Você está no Time 2 - Bia.');
  assert.equal(describeEvent(draw, { viewerId: 'u9', today }).text, 'Ana sorteou os times do jogo de hoje: 3 times.');
  const res = { t: 'result', d: { n: 2, a: 'Time 1 - Ana', b: 'Time 2 - Bia', sa: 3, sb: 1, goals: 'Ana (2) e Carla', pa: ['u1'], pb: ['u2'] } };
  assert.equal(describeEvent(res, { viewerId: 'u1' }).text, 'Time 1 - Ana 3 × 1 Time 2 - Bia. Gols: Ana (2) e Carla. Seu time venceu! 🎉');
  assert.match(describeEvent(res, { viewerId: 'u2' }).text, /Seu time perdeu\.$/);
  assert.equal(describeEvent({ t: 'absence', who: 'Ana', day: { id: 'd', date: today }, d: { removed: 'Bia', uid: 'u2', n: 4 } }, { viewerId: 'u2', today }).text, 'Ana tirou você da lista do jogo de hoje.');
  assert.equal(describeEvent({ t: 'schedule', who: 'Ana', day: { id: 'd', date: '2026-10-08' }, d: { kind: 'moved', from: '2026-10-07' } }, { today }).text, 'O jogo de hoje foi remarcado para amanhã.');
  const now = Date.parse('2026-10-07T18:00:00Z');
  assert.equal(timeAgo(now - 20_000, now), 'agora');
  assert.equal(timeAgo(now - 5 * 60_000, now), 'há 5 min');
  assert.equal(timeAgo(now - 2 * 3600_000, now), 'há 2 h');
  assert.equal(timeAgo(now - 24 * 3600_000, now), 'ontem');
  assert.equal(timeAgo(now - 3 * 86_400_000, now), 'há 3 dias');
  assert.equal(timeAgo(now - 20 * 86_400_000, now), '17/09');
});

test('preferências: padrões, mescla parcial e validação', () => {
  const d = defaultPrefs();
  assert.equal(d.enabled, true); assert.equal(d.types.match, false); assert.equal(d.types.result, true);
  assert.deepEqual(Object.keys(d.types), NOTIF_KEYS);
  assert.deepEqual(normalizePrefs({ types: { draw: false, xyz: true }, muted: ['PL-ABCDEF', 'lixo', 'PL-ABCDEF'] }).muted, ['PL-ABCDEF']);
  assert.equal(normalizePrefs({ types: { draw: false } }).types.draw, false);
  assert.equal(mergePrefs(d, { types: { match: true } }).types.match, true);
  assert.throws(() => mergePrefs(d, { types: { nada: true } }), /desconhecido/);
  assert.throws(() => mergePrefs(d, { enabled: 'sim' }), /inválido/);
  assert.throws(() => mergePrefs(d, { muted: ['PL-0'] }), /inválido/);
});

test('quem entra na pelada e quem confirma presença: todos são avisados, menos quem fez', async () => {
  const { owner, players: [ana, bia], base } = await setup(2);
  // entrada pelo link
  assert.ok((await texts(owner)).some(t => /Atleta N\d+a Souza entrou na pelada\./.test(t)));
  assert.ok((await texts(ana)).every(t => !/Atleta N\d+a Souza entrou/.test(t)), 'não avisa a própria entrada');
  assert.ok((await texts(ana)).some(t => /Atleta N\d+b Souza entrou na pelada\./.test(t)), 'avisa quem entrou depois');

  assert.equal((await ana.post(`${base}/presence`, { present: true })).status, 200);
  const o = await inbox(owner);
  const pres = o.items.find(i => i.type === 'presence');
  assert.match(pres.text, /confirmou presença no jogo de hoje \(1 confirmada\)\./);
  assert.equal(pres.title, 'Presença confirmada');
  assert.ok(pres.url.endsWith(base.replace('/pelada/peladas/', '/pelada/p/').replace('/days/', '/d/')));
  assert.ok(pres.unread);
  assert.ok((await texts(bia)).some(t => /confirmou presença/.test(t)));
  assert.ok(!(await texts(ana)).some(t => /confirmou presença/.test(t)), 'não avisa a própria presença');
  // repetir a mesma presença não gera outro aviso
  await ana.post(`${base}/presence`, { present: true });
  assert.equal((await inbox(owner)).items.filter(i => i.type === 'presence').length, 1);

  // quem marca presença sem ter entrado antes também "entrou na pelada"
  const nova = await newPlayer('Direto Na Lista Costa');
  assert.equal((await nova.post(`${base}/presence`, { present: true })).status, 200);
  const t = await texts(owner);
  assert.ok(t.includes('Direto Na Lista Costa entrou na pelada.'));
  assert.ok(t.includes('Direto Na Lista Costa confirmou presença no jogo de hoje (2 confirmadas).'));
});

test('marcar e desmarcar em seguida não avisa; desistência depois de um tempo avisa', async () => {
  const { owner, players: [ana], base } = await setup(1);
  const t0 = Date.now();
  setClock(() => t0);
  try {
    await ana.post(`${base}/presence`, { present: true });
    setClock(() => t0 + 60_000);
    await ana.post(`${base}/presence`, { present: false });
    let o = await inbox(owner);
    assert.equal(o.items.filter(i => i.type === 'presence' || i.type === 'absence').length, 0, 'clique errado não vira aviso');
    setClock(() => t0 + 2 * 60_000);
    await ana.post(`${base}/presence`, { present: true });
    setClock(() => t0 + 30 * 60_000);
    await ana.post(`${base}/presence`, { present: false });
    o = await inbox(owner);
    assert.equal(o.items.filter(i => i.type === 'presence').length, 1);
    assert.match(o.items.find(i => i.type === 'absence').text, /retirou a presença do jogo de hoje \(0 confirmadas\)\./);
  } finally { setClock(null); }
});

test('organizador: convidado, remoção da lista, sorteio com o time de cada um, partida e resultado', async () => {
  const { owner, players, base, id } = await setup(3, { min: 2 });
  const [ana, bia, carla] = players;
  for (const c of [owner, ana, bia, carla]) assert.equal((await c.post(`${base}/presence`, { present: true })).status, 200);
  assert.equal((await owner.post(`${base}/guests`, { name: 'Zeca Convidado' })).status, 200);
  assert.ok((await texts(ana)).some(t => /adicionou Zeca Convidado \(convidada\) ao jogo de hoje \(5 confirmadas\)/.test(t)));

  // remover alguém da lista
  assert.equal((await owner.del(`${base}/attendance/${encodeURIComponent(`u:${carla.player.id}`)}`)).status, 200);
  assert.ok((await texts(carla)).some(t => /tirou você da lista do jogo de hoje\./.test(t)));
  assert.ok((await texts(ana)).some(t => new RegExp(`tirou ${carla.player.name} da lista do jogo de hoje \\(4 confirmadas\\)`).test(t)));

  // sorteio: cada um sabe em qual time ficou
  assert.equal((await owner.post(`${base}/draw`)).status, 200);
  const pel = (await owner.get(`/pelada/peladas/${id}`)).data.pelada;
  const day = pel.days[0];
  const teamOfAna = day.draw.teams.find(t => t.players.includes(`u:${ana.player.id}`));
  const drawA = (await inbox(ana)).items.find(i => i.type === 'draw');
  assert.equal(drawA.title, 'Times sorteados');
  assert.ok(drawA.text.endsWith(`Você está no ${teamOfAna.label}.`), drawA.text);
  // refazer logo em seguida substitui o aviso (não acumula)
  assert.equal((await owner.post(`${base}/draw`)).status, 200);
  const draws = (await inbox(ana)).items.filter(i => i.type === 'draw');
  assert.equal(draws.length, 1); assert.equal(draws[0].title, 'Sorteio refeito');
  // encaixe manual muda o time: o aviso passa a dizer o time novo
  const d2 = (await owner.get(`/pelada/peladas/${id}`)).data.pelada.days[0];
  const other = d2.draw.teams.find(t => !t.players.includes(`u:${ana.player.id}`));
  assert.equal((await owner.post(`${base}/assign`, { pid: `u:${ana.player.id}`, teamId: other.id })).status, 200);
  const d3 = (await owner.get(`/pelada/peladas/${id}`)).data.pelada.days[0];
  const label = d3.draw.teams.find(t => t.id === other.id).label;
  assert.ok((await inbox(ana)).items.find(i => i.type === 'draw').text.endsWith(`Você está no ${label}.`));

  // partida: início (desligado por padrão) e resultado
  const [t1, t2] = d3.draw.teams;
  const mr = await owner.post(`${base}/matches`, { a: t1.id, b: t2.id });
  const mid = mr.data.matchId;
  await owner.post(`${base}/matches/${mid}/timer`, { action: 'start' });
  assert.equal((await inbox(ana)).items.filter(i => i.type === 'match').length, 0, '"início das partidas" vem desligado');
  assert.equal((await ana.patch('/pelada/notifications/prefs', { types: { match: true } })).status, 200);
  assert.match((await inbox(ana)).items.find(i => i.type === 'match').text, /^Partida 1 começou: Time 1 - .+ × Time 2 - .+\./);

  const scorer = t1.players[0]; // pode ser o convidado: o nome dele também aparece nos gols
  await owner.post(`${base}/matches/${mid}/goals`, { teamId: t1.id, pid: scorer });
  await owner.post(`${base}/matches/${mid}/goals`, { teamId: t1.id, pid: scorer });
  await owner.post(`${base}/matches/${mid}/goals`, { teamId: t2.id });
  assert.equal((await owner.post(`${base}/matches/${mid}/finish`)).status, 200);
  const resA = (await inbox(ana)).items.find(i => i.type === 'result');
  assert.equal(resA.title, 'Resultado da partida 1');
  assert.match(resA.text, /^Time 1 - .+ 2 × 1 Time 2 - .+\. Gols: .+ \(2\)\./);
  const anaSide = t1.players.includes(`u:${ana.player.id}`) ? 'venceu' : t2.players.includes(`u:${ana.player.id}`) ? 'perdeu' : null;
  if (anaSide) assert.ok(resA.text.endsWith(anaSide === 'venceu' ? 'Seu time venceu! 🎉' : 'Seu time perdeu.'), resA.text);

  // correção de gol depois de encerrar: atualiza o mesmo aviso, sem marcar como novo
  await ana.post('/pelada/notifications/read', { all: true });
  await owner.post(`${base}/matches/${mid}/goals`, { teamId: t2.id });
  const after = await inbox(ana);
  const fixed = after.items.filter(i => i.type === 'result');
  assert.equal(fixed.length, 1);
  assert.equal(fixed[0].id, resA.id);
  assert.match(fixed[0].text, / 2 × 2 /);
  assert.equal(fixed[0].unread, false);
});

test('agenda: nova data, remarcação, cancelamento e lembrete do dia', async () => {
  const { owner, players: [ana], id, dayId, base } = await setup(1);
  // lembrete do jogo de hoje (sem presença → pede para confirmar)
  let rem = (await inbox(ana)).items.find(i => i.type === 'reminder');
  assert.equal(rem.title, 'Hoje tem jogo! ⚽');
  assert.match(rem.text, /Confirme sua presença/);
  await ana.post(`${base}/presence`, { present: true });
  rem = (await inbox(ana)).items.find(i => i.type === 'reminder');
  assert.match(rem.text, /Sua presença está confirmada/);
  assert.ok(!(await inbox(owner)).items.some(i => i.type === 'reminder' && i.text.includes('confirmada')));

  const r = await owner.post(`/pelada/peladas/${id}/days`, { date: '2030-03-09' });
  const newDay = r.data.dayId;
  assert.ok((await texts(ana)).some(t => /marcou um jogo para sáb, 09\/03\./.test(t)));
  assert.equal((await owner.patch(`/pelada/peladas/${id}/days/${newDay}`, { date: '2030-03-10' })).status, 200);
  assert.ok((await texts(ana)).some(t => t === 'O jogo de sáb, 09/03 foi remarcado para dom, 10/03.'));
  assert.ok((await texts(ana)).some(t => /marcou um jogo para dom, 10\/03\./.test(t)), 'o aviso antigo mostra a data atual');
  assert.equal((await owner.del(`/pelada/peladas/${id}/days/${newDay}`)).status, 200);
  const after = await texts(ana);
  assert.ok(after.some(t => /cancelou o jogo de dom, 10\/03\./.test(t)));
  assert.ok(!after.some(t => /marcou um jogo|remarcado/.test(t)), 'avisos de uma data excluída somem');
  // data passada (registro de histórico) não vira aviso de agenda
  await owner.post(`/pelada/peladas/${id}/days`, { date: '2020-01-04' });
  assert.ok(!(await texts(ana)).some(t => /04\/01/.test(t)));
  assert.ok(dayId);
});

test('preferências por tipo, desligar tudo e silenciar uma pelada', async () => {
  const { owner, players: [ana, bia], base, id } = await setup(2);
  await bia.post(`${base}/presence`, { present: true });
  assert.ok((await inbox(ana)).items.some(i => i.type === 'presence'));

  const p1 = await ana.patch('/pelada/notifications/prefs', { types: { presence: false } });
  assert.equal(p1.status, 200); assert.equal(p1.data.prefs.types.presence, false); assert.equal(p1.data.prefs.types.join, true);
  assert.ok(!(await inbox(ana)).items.some(i => i.type === 'presence'));
  assert.equal((await ana.get('/pelada/notifications/prefs')).data.prefs.types.presence, false);

  assert.equal((await ana.patch('/pelada/notifications/prefs', { muted: [id] })).status, 200);
  assert.equal((await inbox(ana)).items.filter(i => i.pelada.id === id).length, 0);
  assert.equal((await ana.patch('/pelada/notifications/prefs', { muted: [] })).status, 200);
  assert.ok((await inbox(ana)).items.length > 0);

  assert.equal((await ana.patch('/pelada/notifications/prefs', { enabled: false })).status, 200);
  const off = await inbox(ana);
  assert.deepEqual([off.items.length, off.unread, off.prefs.enabled], [0, 0, false]);

  // validação e sessão
  assert.equal((await ana.patch('/pelada/notifications/prefs', { types: { nada: true } })).status, 400);
  assert.equal((await ana.patch('/pelada/notifications/prefs', { muted: 'PL-ABCDEF' })).data.error.details.field, 'muted');
  assert.equal((await new Client(srv.base).get('/pelada/notifications')).status, 401);
  assert.equal((await new Client(srv.base).patch('/pelada/notifications/prefs', { enabled: true })).status, 401);
  // as preferências de um não mudam as do outro
  assert.equal((await inbox(owner)).prefs.enabled, true);
});

test('lidas: marcar todas (até o momento visto), marcar uma, e quem entra depois não vê o passado', async () => {
  const { owner, players: [ana], base, id } = await setup(1);
  await owner.post(`${base}/presence`, { present: true });
  let a = await inbox(ana);
  assert.ok(a.unread >= 1);
  // marca só uma
  const first = a.items.find(i => i.unread);
  const one = await ana.post('/pelada/notifications/read', { ids: [first.id] });
  assert.equal(one.status, 200);
  assert.equal(one.data.items.find(i => i.id === first.id).unread, false);
  assert.equal(one.data.unread, a.unread - 1);
  // "todas" respeita o momento da leitura do aparelho: o que chegou depois continua novo
  const seenAt = a.now;
  await new Promise(r => setTimeout(r, 5));
  const late = await newPlayer('Chegou Depois Lima');
  await late.post(`/pelada/peladas/${id}/join`);
  const r = await ana.post('/pelada/notifications/read', { all: true, upTo: seenAt });
  assert.equal(r.data.unread, 1);
  assert.equal(r.data.items.find(i => i.unread).type, 'join');
  assert.equal((await ana.post('/pelada/notifications/read', { all: true })).data.unread, 0);
  assert.equal((await ana.post('/pelada/notifications/read', {})).status, 400);

  // quem entrou agora não recebe os avisos de antes de entrar
  const l = await inbox(late);
  assert.ok(!l.items.some(i => i.type === 'presence'), 'presença anterior à entrada não aparece');
  assert.ok(l.items.every(i => i.type === 'reminder'));
});

test('ETag na leitura (304 quando nada mudou) e exclusão da pelada apaga o feed', async () => {
  const { owner, players: [ana], id, base } = await setup(1);
  const r1 = await ana.get('/pelada/notifications');
  const etag = r1.headers.get('etag');
  assert.ok(etag);
  assert.equal((await ana.get('/pelada/notifications', { headers: { 'If-None-Match': etag } })).status, 304);
  await owner.post(`${base}/presence`, { present: true });
  assert.equal((await ana.get('/pelada/notifications', { headers: { 'If-None-Match': etag } })).status, 200);

  assert.ok(await srv.store.get(`plf:${id}`));
  assert.equal((await owner.del(`/pelada/peladas/${id}`)).status, 200);
  assert.equal(await srv.store.get(`plf:${id}`), null);
  assert.equal((await inbox(ana)).items.filter(i => i.pelada.id === id).length, 0);
});

test('o nome atualizado da pelada aparece nas notificações', async () => {
  const { owner, players: [ana], id } = await setup(1);
  await owner.patch(`/pelada/peladas/${id}`, { name: 'Pelada Renomeada' });
  const items = (await inbox(ana)).items.filter(i => i.pelada.id === id);
  assert.ok(items.length && items.every(i => i.pelada.name === 'Pelada Renomeada'));
});

test('Cerca e sorteio automático nos avisos: quem sobra é avisado, o resultado guarda os times da época e quem sai deixa de receber', async () => {
  const s = await setup(5, { min: 2 });
  const { owner, players, id, base } = s;
  const [ana, bia, carla, dani, eva] = players;
  const dayId = s.dayId;
  assert.equal((await owner.patch(`/pelada/peladas/${id}`, { autoDraw: true, autoEvery: 1 })).status, 200);
  for (const c of [ana, bia, carla, dani, eva]) assert.equal((await c.post(`${base}/presence`, { present: true })).status, 200);

  // 5 presentes (o organizador não joga), mínimo 2: dois times de 2 e 1 jogador na Cerca, que é avisado
  assert.equal((await owner.post(`${base}/draw`)).status, 200);
  let day = (await owner.get(`/pelada/peladas/${id}`)).data.pelada.days.find(d => d.id === dayId);
  assert.equal(day.fence.length, 1);
  const fenceUid = day.fence[0].slice(2);
  const fenceClient = [ana, bia, carla, dani, eva].find(c => c.player.id === fenceUid);
  const fenceMsg = (await inbox(fenceClient)).items.find(i => i.type === 'draw');
  assert.match(fenceMsg.text, /Você ficou na Cerca: aguarda a próxima partida e entra no time que perder\./);
  assert.ok(!/Você está no/.test(fenceMsg.text));

  // partida + resultado: o aviso usa os times que jogaram, mesmo que o sorteio automático os mude em seguida
  const [t1, t2] = day.draw.teams;
  const mid = (await owner.post(`${base}/matches`, { a: t1.id, b: t2.id })).data.matchId;
  await owner.post(`${base}/matches/${mid}/timer`, { action: 'start' });
  await owner.post(`${base}/matches/${mid}/goals`, { teamId: t1.id });
  const fin = await owner.post(`${base}/matches/${mid}/finish`);
  assert.equal(fin.status, 200);
  assert.ok(fin.data.info.rotation, 'sorteio automático a cada 1 partida');
  const res = (await inbox(ana)).items.find(i => i.type === 'result');
  assert.ok(res.text.startsWith(`${t1.label} 1 × 0 ${t2.label}.`), res.text);
  // a Cerca entrou no time que perdeu: o aviso do sorteio acompanha ("você está no Time X")
  day = (await owner.get(`/pelada/peladas/${id}`)).data.pelada.days.find(d => d.id === dayId);
  const nowIn = day.draw.teams.find(t => t.players.includes(`u:${fenceUid}`));
  assert.ok(nowIn);
  assert.ok((await inbox(fenceClient)).items.find(i => i.type === 'draw').text.endsWith(`Você está no ${nowIn.label}.`));

  // sair da pelada: sai da caixa (a pelada some dele) e os outros não são avisados da própria saída
  assert.equal((await dani.post(`/pelada/peladas/${id}/leave`)).status, 200);
  assert.equal((await inbox(dani)).items.filter(i => i.text.includes(`Pelada N`)).length, 0);
  assert.equal((await dani.get('/pelada/mine')).data.joined.length, 0);
});

test('pelada feminina: avisos e mensagens no feminino; masculina continua no masculino', async () => {
  const fem = await setup(2, { min: 2 }); // setup cria pelada feminina
  const [ana] = fem.players;
  assert.equal((await fem.owner.post(`${fem.base}/guests`, { name: 'Zeca Convidada' })).status, 200);
  const t = (await texts(ana)).join(' | ');
  assert.match(t, /\(convidada\)/); assert.ok(!/\(convidado\)|confirmados/.test(t), t);
  const j = (await inbox(ana)).items.find(i => i.type === 'presence');
  assert.match(j.title, /^Convidada na lista$/);
  // textos puros
  const ev = { t: 'join', who: 'Ana' };
  assert.equal(describeEvent(ev, { gender: 'feminino' }).title, 'Nova participante');
  assert.equal(describeEvent(ev, { gender: 'masculino' }).title, 'Novo participante');
  assert.equal(describeEvent({ t: 'presence', who: 'A', day: { id: 'd', date: '2026-10-07' }, d: { n: 3, guest: 'Bia' } }, { gender: 'masculino', today: '2026-10-07' }).text, 'A adicionou Bia (convidado) ao jogo de hoje (3 confirmados).');
  // erros do servidor também no feminino
  const dup = await fem.owner.post(`${fem.base}/guests`, { name: 'zeca convidada' });
  assert.equal(dup.status, 409);
});
