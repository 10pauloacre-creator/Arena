// Links simples de compartilhamento: uma partida (/AM-2026-9843/time-a-x-time-b) e um dia de pelada (/pelada/PL-XXXXXX/12-10-2026).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, signup } from './helpers.js';
import { setClock } from '../../lib/clock.js';
import { slugify, matchSlugs, findMatchBySlug, matchPath, matchTitle, fixedSlug } from '../../public/assets/js/shared/matchlink.js';
import { dayToSlug, slugToDay, dayPath } from '../../public/assets/js/shared/peladalink.js';
import { injectMeta } from '../../lib/domain/pelada-share.js';

let S;
before(async () => { S = await startServer(); });
after(async () => { setClock(null); await S.close(); });

const get = async path => { const r = await fetch(S.base + path); return { status: r.status, type: r.headers.get('content-type'), text: await r.text() }; };

test('slugify: sem acento, minúsculo, hifens e limite de tamanho', () => {
  assert.equal(slugify('Atlético Mineiro FC!'), 'atletico-mineiro-fc');
  assert.equal(slugify('  Bar & Grill  '), 'bar-e-grill');
  assert.equal(slugify('???'), '');
  assert.ok(slugify('a'.repeat(100)).length <= 40);
});

test('slug da partida: times definidos, repetições, partida sem times e busca pelo endereço fixo', () => {
  const t = {
    id: 'AM-2026-1234',
    teams: [{ id: 'a', name: 'Flamengo' }, { id: 'b', name: 'Vasco' }],
    bracket: {
      rounds: [{ matches: [{ key: '0-0', a: 'a', b: 'b' }, { key: '0-1', a: 'a', b: 'b' }, { key: '0-2', bye: true, a: 'a' }] }, { matches: [{ key: '1-0', a: null, b: null }] }],
      playins: [],
    },
  };
  const s = matchSlugs(t);
  assert.equal(s.get('0-0'), 'flamengo-x-vasco');
  assert.equal(s.get('0-1'), 'flamengo-x-vasco-2');
  assert.equal(s.has('0-2'), false); // bye não é compartilhável
  assert.equal(s.get('1-0'), 'jogo-1-0');
  assert.equal(matchPath(t, '0-0'), '/AM-2026-1234/flamengo-x-vasco');
  assert.equal(findMatchBySlug(t, 'flamengo-x-vasco-2').key, '0-1');
  assert.equal(findMatchBySlug(t, 'FLAMENGO-X-VASCO').key, '0-0');
  assert.equal(findMatchBySlug(t, fixedSlug({ key: '0-0' })).key, '0-0'); // o apelido fixo sempre funciona
  assert.equal(findMatchBySlug(t, 'nada'), null);
  assert.equal(matchTitle(t, t.bracket.rounds[0].matches[0]), 'Flamengo × Vasco');
});

test('dia da pelada: dd-mm-aaaa ↔ ISO, só datas reais', () => {
  assert.equal(dayToSlug('2026-10-12'), '12-10-2026');
  assert.equal(slugToDay('12-10-2026'), '2026-10-12');
  assert.equal(slugToDay('31-02-2026'), null);
  assert.equal(slugToDay('2026-10-12'), null);
  assert.equal(slugToDay('lixo'), null);
  assert.equal(dayPath('PL-ABC234', '2026-10-12'), '/pelada/PL-ABC234/12-10-2026');
});

test('injectMeta usa o nome do site informado', () => {
  const html = '<html><head><title>x</title></head><body></body></html>';
  const meta = { title: 'T', description: 'D', image: 'http://i/x.png', url: 'http://u/' };
  assert.match(injectMeta(html, meta), /og:site_name" content="Pelada"/);
  assert.match(injectMeta(html, { ...meta, siteName: 'ArenaMaster AI' }), /og:site_name" content="ArenaMaster AI"/);
});

test('link de uma partida: o app abre com a pré-visualização do jogo nas metatags', async () => {
  const c = await signup(S.base, 'Dono Do Torneio');
  const t = (await c.post('/tournaments', { name: 'Copa do Link', sport: 'futebol', finalDate: '2026-11-14', demo: true })).data.tournament;
  const drawn = (await c.post(`/tournaments/${t.id}/draw`)).data.tournament;
  const first = drawn.bracket.rounds[0].matches[0];
  const view = (await c.get(`/public/${t.id}`)).data.tournament;
  const path = matchPath(view, first.key ?? `${first.r}-${first.m}`);
  assert.ok(path, 'a primeira partida tem endereço');

  const page = await get(path);
  assert.equal(page.status, 200); assert.match(page.type, /text\/html/);
  assert.match(page.text, /<script type="module" src="\/assets\/js\/main\.js">/);
  assert.match(page.text, /og:site_name" content="ArenaMaster AI"/);
  assert.match(page.text, new RegExp(`og:url" content="${S.base}${path}"`));
  assert.match(page.text, /Copa do Link/);
  assert.equal((page.text.match(/<title>/g) || []).length, 1);

  // o endereço fixo também abre; partida inexistente devolve o app (a tela mostra "não encontrada"); torneio inexistente = 404
  const fixed = await get(`/${t.id}/${fixedSlug({ key: first.key ?? `${first.r}-${first.m}` })}`);
  assert.equal(fixed.status, 200); assert.match(fixed.text, /Copa do Link/);
  const nothing = await get(`/${t.id}/nao-existe`);
  assert.equal(nothing.status, 200); assert.doesNotMatch(nothing.text, /Copa do Link/);
  assert.equal((await get('/AM-2026-999999/qualquer')).status, 404);
});

test('link de um dia da pelada: o app abre com a pré-visualização daquele dia', async () => {
  const { Client } = await import('./helpers.js');
  const owner = new Client(S.base);
  assert.equal((await owner.post('/pelada/auth/signup', { name: 'Organizador Do Dia', birth: '15/05/1992' })).status, 200);
  const p = (await owner.post('/pelada/peladas', { name: 'Pelada do Dia', gender: 'masculino', minPerTeam: 5, days: [{ date: '2099-10-12' }] })).data.pelada;

  const day = await get(`/pelada/${p.id}/12-10-2099`);
  assert.equal(day.status, 200); assert.match(day.type, /text\/html/);
  assert.match(day.text, /<script type="module" src="\/assets\/js\/pelada\/main\.js">/);
  assert.match(day.text, /og:title" content="Pelada do Dia · 12\/10\/2099"/);
  assert.match(day.text, new RegExp(`og:url" content="${S.base}/pelada/${p.id}/12-10-2099"`));
  assert.match(day.text, /Jogo de 12\/10\/2099/);

  // data que não existe na pelada: cai na prévia geral da pelada; pelada inexistente: 404
  const other = await get(`/pelada/${p.id}/13-10-2099`);
  assert.equal(other.status, 200); assert.match(other.text, new RegExp(`og:url" content="${S.base}/pelada/p/${p.id}"`));
  assert.equal((await get('/pelada/PL-AAAAAA/12-10-2099')).status, 404);
});
