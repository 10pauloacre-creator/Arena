// Flyer do confronto: agendamento (data/local), modelo SVG, imagem PNG da prévia do link e og:image da partida.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, signup, teamInput } from './helpers.js';
import { setClock } from '../../lib/clock.js';
import { whenText, matchInfo, matchFlyerSvg, FLYER_FORMATS } from '../../public/assets/js/shared/matchflyer.js';
import { matchPath, matchSlugs, matchFlyerPath, flyerImage } from '../../public/assets/js/shared/matchlink.js';
import { flyerAvailable } from '../../lib/domain/match-flyer.js';

let S;
before(async () => { S = await startServer(); });
after(async () => { setClock(null); await S.close(); });

const act = (org, id, key, body) => org.post(`/tournaments/${id}/matches/${key}`, body);
const PNG = [0x89, 0x50, 0x4e, 0x47];

async function setup() {
  const org = await signup(S.base);
  const t = (await org.post('/tournaments', { name: 'Copa do Flyer', sport: 'futsal', finalDate: '2026-12-12' })).data.tournament;
  await org.patch(`/tournaments/${t.id}`, { maxTeams: 4 });
  for (let i = 0; i < 4; i++) assert.equal((await org.post(`/tournaments/${t.id}/teams`, teamInput(`Equipe ${String.fromCharCode(65 + i)}${i}`, 'futsal', { offset: i }))).status, 200);
  assert.equal((await org.post(`/tournaments/${t.id}/draw`)).status, 200);
  const view = (await org.get(`/tournaments/${t.id}`)).data.tournament;
  return { org, id: t.id, view, m: view.bracket.rounds[0].matches[0] };
}
const fetchBin = async path => { const r = await fetch(S.base + path); return { r, bytes: new Uint8Array(await r.arrayBuffer()) }; };

test('whenText: data por extenso, com ou sem horário, e vazio para valor inválido', () => {
  assert.equal(whenText('2026-11-14T16:30'), 'Sábado, 14 de novembro · 16h30');
  assert.equal(whenText('2026-11-14T16:00'), 'Sábado, 14 de novembro · 16h');
  assert.equal(whenText('2026-11-14'), 'Sábado, 14 de novembro');
  assert.equal(whenText('2026-02-31'), '');
  assert.equal(whenText('lixo'), '');
  assert.equal(whenText(null), '');
});

test('matchInfo: agendamento da partida, com local do torneio e data da final como reserva', () => {
  const t = { finalDate: '2026-12-12', venue: 'Arena Central', bracket: { rounds: [{ matches: [] }, { matches: [] }] } };
  assert.deepEqual(matchInfo(t, { r: 0, when: '2026-11-01T10:00', venue: 'Quadra 2' }), { when: '2026-11-01T10:00', venue: 'Quadra 2' });
  assert.deepEqual(matchInfo(t, { r: 0 }), { when: '', venue: 'Arena Central' });
  assert.deepEqual(matchInfo(t, { r: 1 }), { when: '2026-12-12', venue: 'Arena Central' }); // a final usa a data da final
});

test('modelo do flyer: três formatos, placar opcional e nomes escapados', () => {
  const data = { tournament: 'Copa <b>X</b>', sport: 'futsal', round: 'Final', a: { name: 'A&B "C"', hue: 200 }, b: { name: '<script>alert(1)</script>', hue: 10 }, when: '2026-11-14T16:30', venue: 'Ginásio' };
  for (const f of Object.keys(FLYER_FORMATS)) {
    const svg = matchFlyerSvg(data, f);
    assert.match(svg, new RegExp(`width="${FLYER_FORMATS[f].w}" height="${FLYER_FORMATS[f].h}"`));
    assert.doesNotMatch(svg, /<script|<b>/);
    assert.match(svg, /A&amp;B &quot;C&quot;/);
    assert.match(svg, /16h30/);
  }
  assert.match(matchFlyerSvg({ ...data, score: { a: 3, b: 2 }, state: 'done' }, 'og'), /3 × 2/);
  assert.ok(matchFlyerSvg(data, 'formato-invalido').startsWith('<svg')); // formato desconhecido cai no padrão
});

test('endereços do flyer no front: só existem com os dois times definidos', () => {
  const t = { id: 'AM-2026-1234', teams: [{ id: 'a', name: 'Flamengo' }, { id: 'b', name: 'Vasco' }], bracket: { rounds: [{ matches: [{ key: '0-0', a: 'a', b: 'b' }, { key: '0-1', a: 'a', b: null }] }], playins: [] } };
  assert.equal(matchFlyerPath(t, t.bracket.rounds[0].matches[0]), '/api/public/AM-2026-1234/match-flyer/flamengo-x-vasco?f=og');
  assert.equal(matchFlyerPath(t, t.bracket.rounds[0].matches[0], { f: 'feed', dl: true }), '/api/public/AM-2026-1234/match-flyer/flamengo-x-vasco?f=feed&dl=1');
  assert.equal(matchFlyerPath(t, t.bracket.rounds[0].matches[1]), null);
  assert.equal(flyerImage(t, t.bracket.rounds[0].matches[1]), null);
  const img = flyerImage(t, t.bracket.rounds[0].matches[0]);
  assert.equal(img.name, matchSlugs(t).get('0-0'));
  assert.match(img.feed, /f=feed&dl=1$/);
});

test('agendar partida: valida data e local, aparece na visão pública e pode ser limpo', async () => {
  const { org, id, m } = await setup();
  assert.equal(m.when, null); assert.equal(m.venue, '');

  const ok = await act(org, id, m.key, { action: 'schedule', when: '2026-11-14T16:30', venue: '  Ginásio Municipal  ' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  let pub = (await org.get(`/public/${id}`)).data.tournament.bracket.rounds[0].matches[0];
  assert.equal(pub.when, '2026-11-14T16:30'); assert.equal(pub.venue, 'Ginásio Municipal');

  for (const when of ['14/11/2026', '2026-02-31T10:00', '2026-11-14T25:00', 'amanhã'])
    assert.equal((await act(org, id, m.key, { action: 'schedule', when, venue: 'x' })).status, 400, when);
  assert.equal((await act(org, id, m.key, { action: 'schedule', when: '2026-11-14', venue: 'x'.repeat(81) })).status, 400);
  assert.equal((await act(org, id, m.key, { action: 'schedule', when: '2026-11-15' })).status, 400); // data e horário andam juntos

  assert.equal((await act(org, id, m.key, { action: 'schedule', when: '', venue: '' })).status, 200);
  pub = (await org.get(`/public/${id}`)).data.tournament.bracket.rounds[0].matches[0];
  assert.equal(pub.when, null); assert.equal(pub.venue, '');
});

test('agendar partida: só o dono altera e partida encerrada não pode ser reagendada', async () => {
  const { org, id, m } = await setup();
  const visitor = await signup(S.base, 'Outra Pessoa');
  assert.ok([401, 403, 404].includes((await act(visitor, id, m.key, { action: 'schedule', when: '2026-11-14' })).status));

  await act(org, id, m.key, { action: 'start' });
  await act(org, id, m.key, { action: 'event', type: 'goal', team: 'a' });
  assert.equal((await act(org, id, m.key, { action: 'finalize' })).status, 200);
  const late = await act(org, id, m.key, { action: 'schedule', when: '2026-11-20' });
  assert.equal(late.status, 409);
  assert.equal(late.data.error.code, 'FINISHED');
});

test('prévia do link da partida: og:image é o flyer do confronto (ou o ícone, sem times)', async () => {
  const { org, id, view, m } = await setup();
  const path = matchPath(view, m.key);
  const page = await (await fetch(S.base + path)).text();
  const slug = path.split('/').pop();
  if (await flyerAvailable()) {
    assert.match(page, new RegExp(`og:image" content="${S.base}/api/public/${id}/match-flyer/${slug}\\?f=og&amp;v=[0-9a-f]{10}"|og:image" content="${S.base}/api/public/${id}/match-flyer/${slug}\\?f=og&v=[0-9a-f]{10}"`));
    assert.match(page, /twitter:card" content="summary_large_image"/);
  } else {
    assert.match(page, /og:image" content="[^"]*icon-512\.png"/);
  }
  await org.get(`/public/${id}`);
});

test('imagem do flyer: PNG nos três formatos, download, cache e 404 sem times', async () => {
  const { id, view, m } = await setup();
  const slug = matchPath(view, m.key).split('/').pop();
  const base = `/api/public/${id}/match-flyer/${slug}`;

  if (!(await flyerAvailable())) {
    assert.equal((await fetch(S.base + base)).status, 409);
    return;
  }
  const sizes = { og: [1200, 630], feed: [1080, 1350], story: [1080, 1920] };
  for (const [f, [w, h]] of Object.entries(sizes)) {
    const { r, bytes } = await fetchBin(`${base}?f=${f}`);
    assert.equal(r.status, 200, f);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.deepEqual([...bytes.slice(0, 4)], PNG);
    const dv = new DataView(bytes.buffer);
    assert.deepEqual([dv.getUint32(16), dv.getUint32(20)], [w, h], f); // largura × altura no cabeçalho IHDR
  }
  assert.equal((await fetch(S.base + base)).status, 200); // sem ?f= usa o formato da prévia
  assert.match((await fetch(`${S.base}${base}?f=feed&dl=1`)).headers.get('content-disposition') || '', /attachment; filename="[^"]+-feed\.png"/);
  assert.match((await fetch(`${S.base}${base}?f=og&v=abc`)).headers.get('cache-control') || '', /immutable/);

  assert.equal((await fetch(`${S.base}/api/public/${id}/match-flyer/nao-existe`)).status, 404);
  assert.equal((await fetch(`${S.base}/api/public/AM-2026-999999/match-flyer/x`)).status, 404);
});
