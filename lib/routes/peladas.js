// API do módulo Pelada: conta simplificada (nome + data de nascimento), peladas, presença, sorteio, súmula e artilharia.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { route, reply, raw } from '../router.js';
import { badRequest, forbidden, notFound, unauthorized, conflict } from '../errors.js';
import { hashPassword, verifyPassword, randomId, getSecret, signToken, verifyToken, PLAYER_TTL_MS } from '../auth.js';
import { clientIp } from '../http.js';
import { rateLimit, rateLimitPeek, rateLimitReset } from '../repo.js';
import {
  PK, getPlayer, getPlayerByName, createPlayer, loadPelada, withPelada, addToMine, removeFromMine, loadPlayers,
} from '../peladaRepo.js';
import {
  newPelada, peladaId, parseImage, AVATAR_MAX, COVER_MAX, PREVIEW_MAX, sanitizeSettings, sanitizeOrg, orgOf, addDay, getDay, getMatch,
  validDate, setPresence, addGuest, removeAttendance, performDraw, assignPlayer, createMatch, setMatchTeams, deleteMatch,
  timerAction, addGoal, removeGoal, setLoan, finishMatch, adjustLooseGoal, addMember, removeMember, userPid, guestPid, freePids,
} from '../domain/pelada.js';
import { peladaView, peladaSummary, referencedUserIds, todayBR } from '../domain/pelada-views.js';
import { newDemoPelada, demoAvatar, isDemoPlayerId } from '../domain/pelada-demo.js';
import { shareMeta, injectMeta } from '../domain/pelada-share.js';
import { appendFeed, deleteFeed, readInbox, markRead, getPrefs, updatePrefs, event, dayRef, userIds } from '../notifications.js';
import { cleanName, nameKey, parseBirth, normalizeSecret, normalizePeladaId, PELADA_ID_RE, teamLabel, firstName } from '../../public/assets/js/shared/pelada.js';

const INDEX_HTML = new URL('../../public/pelada/index.html', import.meta.url);
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .'’-]*$/u;
// hash falso para igualar o tempo de resposta quando o nome não existe
const DUMMY = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86);

export const playerView = u => u ? { id: u.id, name: u.name, av: u.av || 0 } : null;

/** index.html do app: lido do pacote da função; se o arquivo não vier no pacote, busca o estático publicado no mesmo domínio. */
async function indexHtml(ctx) {
  try { return await readFile(INDEX_HTML, 'utf8'); } catch { /* cai para o arquivo publicado */ }
  const res = await fetch(new URL('/pelada/index.html', ctx.base));
  if (!res.ok) throw new Error(`index.html do app indisponível (${res.status})`);
  return res.text();
}

function pelId(ctx) {
  const id = normalizePeladaId(ctx.params.id);
  if (!PELADA_ID_RE.test(id)) throw notFound('Pelada não encontrada. Confira o ID.');
  return id;
}

async function viewOf(ctx, p, viewer) {
  const users = await loadPlayers(ctx.store, referencedUserIds(p));
  return peladaView(p, { users, viewer, now: ctx.now, base: ctx.base });
}

/** Grava o feed de notificações; uma falha aqui não desfaz a ação (que já foi salva). */
async function saveFeed(ctx, p, events, now) {
  try { await appendFeed(ctx.store, p, events, now); } catch (err) { console.error('[notificações] não foi possível gravar o feed:', err.message); }
}

/**
 * Executa uma ação sobre a pelada dentro do lock e devolve a visão atualizada.
 * `owner: true` exige o criador. `fn(p, now, player, tx)` pode devolver dados extras (mesclados na resposta)
 * e registrar avisos em `tx.events` (ou pedir `tx.sync` para atualizar nome/datas do feed de notificações).
 */
async function act(ctx, { owner = false } = {}, fn) {
  const player = await ctx.requirePlayer();
  const id = pelId(ctx);
  const tx = { events: [], sync: false };
  const extra = await withPelada(ctx.store, id, async (p, now) => {
    if (owner && p.ownerId !== player.id) throw forbidden('Só quem criou a pelada pode fazer isso.');
    return fn(p, now, player, tx);
  }, { after: (p, now) => (tx.events.length || tx.sync ? saveFeed(ctx, p, tx.events, now) : null) });
  const p = await loadPelada(ctx.store, id);
  return { pelada: await viewOf(ctx, p, player), now: ctx.now, ...(extra && typeof extra === 'object' ? extra : {}) };
}

/** nome por pid (convidados na pelada; contas via banco) — usado em regras que comparam nomes. */
async function nameResolver(ctx, p) {
  const users = await loadPlayers(ctx.store, referencedUserIds(p));
  return pid => pid.startsWith('g:') ? (p.guests.find(g => `g:${g.id}` === pid)?.name || '') : (users.get(pid.slice(2))?.name || '');
}

/** Grava uma pelada nova com um ID livre: `build(id)` monta o documento (tenta de novo se o ID já existir). */
async function insertNew(ctx, build) {
  for (let i = 0; i < 6; i++) {
    const draft = build(peladaId());
    if (await ctx.store.setNX(PK.pelada(draft.id), draft)) return draft;
  }
  throw conflict('Não foi possível gerar o ID da pelada. Tente de novo.', 'ID_COLLISION');
}

/** Chave de acesso guardada neste aparelho: refaz a sessão se o cookie for apagado (o app não pede login de novo). */
async function deviceToken(ctx, player) {
  return signToken({ k: 'dev', plid: player.id, pv: player.pv || 0, exp: ctx.now + PLAYER_TTL_MS }, await getSecret(ctx.store));
}

/** Nome por pid carregando só as contas citadas em `pids`. */
async function namesOf(ctx, p, pids) {
  const users = await loadPlayers(ctx.store, userIds(pids));
  return pid => !pid ? '' : pid.startsWith('g:') ? (p.guests.find(g => guestPid(g.id) === pid)?.name || '') : (users.get(pid.slice(2))?.name || '');
}

const labelOf = nameOf => t => (t.captain ? teamLabel(t, nameOf) : `Time ${t.number}`);

/** Times da partida para os avisos: rótulos, número de exibição e quem jogou por cada lado. */
async function matchInfo(ctx, p, day, m) {
  // partida encerrada: os times como eram quando ela terminou (o sorteio automático já pode ter mudado os elencos)
  const team = id => (m.status === 'finished' && m.rosters?.[id]) || day.draw?.teams.find(t => t.id === id);
  const ta = team(m.a), tb = team(m.b);
  const nameOf = await namesOf(ctx, p, [ta?.captain, tb?.captain, ...m.goals.map(g => g.pid)].filter(Boolean));
  const label = labelOf(nameOf);
  const side = t => (t ? userIds([...t.players, ...(m.loans?.[t.id] || [])]) : []);
  return { mid: m.id, n: day.matches.indexOf(m) + 1, a: ta ? label(ta) : 'Time A', b: tb ? label(tb) : 'Time B', pa: side(ta), pb: side(tb), nameOf };
}

/** "Ana (2), Bia e Carla" (primeiro nome; nome completo quando dois artilheiros têm o mesmo primeiro nome). */
function goalsText(m, nameOf) {
  const by = new Map();
  for (const g of m.goals) if (g.pid) by.set(g.pid, (by.get(g.pid) || 0) + 1);
  const names = [...by.keys()].map(nameOf);
  const firsts = names.map(firstName);
  const parts = [...by.values()].map((n, i) => `${firsts.filter(f => f === firsts[i]).length > 1 ? names[i] : firsts[i]}${n > 1 ? ` (${n})` : ''}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}` : parts[0] || '';
}

/** Em qual time cada conta ficou: { idDaConta: "Time 2 - Valéria" } ("Cerca" para quem aguarda a próxima partida). */
function drawSlots(day, nameOf) {
  const slot = {}, label = labelOf(nameOf);
  for (const t of day.draw.teams) for (const id of userIds(t.players)) slot[id] = label(t);
  for (const id of userIds(freePids(day))) slot[id] = 'Cerca';
  return slot;
}

/** Alguém saiu da pelada (ou foi excluído): atualiza as datas do feed e corrige o aviso do sorteio dos jogos de hoje em diante. */
async function memberGone(ctx, me, p, now, tx) {
  tx.sync = true;
  const today = todayBR(now);
  for (const day of p.days) if (day.draw && day.date >= today) tx.events.push(await drawFix(ctx, me, p, day));
}

/** Times mudaram depois do sorteio (encaixe manual, alguém saiu da lista): corrige o aviso do sorteio já enviado. */
async function drawFix(ctx, me, p, day) {
  const nameOf = await namesOf(ctx, p, day.draw.teams.map(t => t.captain).filter(Boolean));
  return event(me, 'draw', { day: dayRef(day), d: { fix: true, teams: day.draw.teams.length, slot: drawSlots(day, nameOf) } });
}

async function resultEvent(ctx, me, p, day, m) {
  const { nameOf, ...info } = await matchInfo(ctx, p, day, m);
  return event(me, 'result', { day: dayRef(day), d: { ...info, sa: m.result.a, sb: m.result.b, goals: goalsText(m, nameOf) } });
}

function checkName(raw) {
  const name = cleanName(raw);
  if (name.length < 2 || name.length > 40 || !NAME_RE.test(name)) throw badRequest('Informe seu nome (2 a 40 letras, sem símbolos).', 'VALIDATION', { field: 'name' });
  return name;
}

export function registerPeladaRoutes() {
  // ------------------------------------------------------------ conta simplificada
  route('POST', '/pelada/auth/signup', async ctx => {
    const { body } = ctx;
    await rateLimit(ctx.store, `plsignup:${clientIp(ctx.req)}`, { max: 25, windowMs: 3600_000 });
    const name = checkName(body.name);
    const birth = parseBirth(body.birth, ctx.now);
    if (!birth) throw badRequest('Informe uma data de nascimento válida (dia/mês/ano).', 'VALIDATION', { field: 'birth' });
    const avatar = parseImage(body.avatar, { maxBytes: AVATAR_MAX, field: 'avatar', label: 'Foto' });
    const id = randomId('pl_');
    const player = { id, name, passHash: await hashPassword(normalizeSecret(birth.iso)), pv: 0, av: avatar ? 1 : 0, createdAt: ctx.now };
    await createPlayer(ctx.store, player, nameKey(name));
    if (avatar) await ctx.store.set(PK.avatar(id), avatar);
    await ctx.startPlayerSession(player);
    return { player: playerView(player), token: await deviceToken(ctx, player) };
  });

  route('POST', '/pelada/auth/login', async ctx => {
    const name = cleanName(ctx.body.name);
    const secret = normalizeSecret(ctx.body.secret);
    if (!name || !secret) throw badRequest('Informe o nome e a data de nascimento (ou a senha que você criou).', 'VALIDATION');
    const key = nameKey(name);
    const ipKey = `pllogin:${key}:${clientIp(ctx.req)}`, nameKeyRl = `plloging:${key}`;
    await rateLimitPeek(ctx.store, ipKey, { max: 8 });
    await rateLimitPeek(ctx.store, nameKeyRl, { max: 40 });
    const player = await getPlayerByName(ctx.store, key);
    const ok = await verifyPassword(secret, player ? player.passHash : DUMMY);
    if (!player || !ok) {
      await rateLimit(ctx.store, ipKey, { max: 8, windowMs: 10 * 60_000 });
      await rateLimit(ctx.store, nameKeyRl, { max: 40, windowMs: 3600_000 });
      throw unauthorized('Nome ou data de nascimento incorretos.');
    }
    await rateLimitReset(ctx.store, ipKey);
    await ctx.startPlayerSession(player);
    return { player: playerView(player), token: await deviceToken(ctx, player) };
  });

  route('POST', '/pelada/auth/logout', async ctx => { ctx.endPlayerSession(); return { ok: true }; });
  // quem tem sessão válida a renova por mais um ano (fica logado enquanto usar o app) e recebe a chave do aparelho
  route('GET', '/pelada/auth/me', async ctx => {
    const player = await ctx.player();
    if (!player) return { player: null };
    await ctx.startPlayerSession(player);
    return { player: playerView(player), token: await deviceToken(ctx, player) };
  });
  // o aparelho devolve a chave guardada quando o cookie sumiu (limpeza do navegador, app instalado, etc.)
  route('POST', '/pelada/auth/resume', async ctx => {
    await rateLimit(ctx.store, `plresume:${clientIp(ctx.req)}`, { max: 60, windowMs: 3600_000 });
    const payload = verifyToken(String(ctx.body.token || ''), await getSecret(ctx.store), ctx.now);
    const player = payload?.k === 'dev' && payload.plid ? await getPlayer(ctx.store, payload.plid) : null;
    if (!player || (player.pv || 0) !== (payload.pv || 0)) throw unauthorized('Sua sessão neste aparelho expirou. Entre de novo.');
    await ctx.startPlayerSession(player);
    return { player: playerView(player), token: await deviceToken(ctx, player) };
  });

  route('PATCH', '/pelada/auth/me', async ctx => {
    const me = await ctx.requirePlayer();
    if (!('avatar' in ctx.body)) throw badRequest('Nada para atualizar.');
    const avatar = parseImage(ctx.body.avatar, { maxBytes: AVATAR_MAX, field: 'avatar', label: 'Foto' });
    const fresh = await getPlayer(ctx.store, me.id);
    if (avatar) { await ctx.store.set(PK.avatar(me.id), avatar); fresh.av = (fresh.av || 0) + 1; }
    else { await ctx.store.del(PK.avatar(me.id)); fresh.av = 0; }
    await ctx.store.set(PK.player(me.id), fresh);
    return { player: playerView(fresh) };
  });

  route('POST', '/pelada/auth/password', async ctx => {
    const me = await ctx.requirePlayer();
    await rateLimit(ctx.store, `plpass:${me.id}`, { max: 10, windowMs: 3600_000 });
    const current = normalizeSecret(ctx.body.current), next = normalizeSecret(ctx.body.next);
    if (!(await verifyPassword(current, me.passHash))) throw unauthorized('A senha atual está incorreta.');
    if (next.length < 4) throw badRequest('A nova senha precisa ter ao menos 4 caracteres.', 'VALIDATION', { field: 'next' });
    if (next.length > 100) throw badRequest('Senha muito longa.', 'VALIDATION', { field: 'next' });
    const fresh = await getPlayer(ctx.store, me.id);
    fresh.passHash = await hashPassword(next);
    fresh.pv = (fresh.pv || 0) + 1; // invalida as outras sessões
    await ctx.store.set(PK.player(me.id), fresh);
    await ctx.startPlayerSession(fresh);
    return { ok: true, token: await deviceToken(ctx, fresh) };
  });

  // ------------------------------------------------------------ imagens (cache longo; a URL leva ?v=versão)
  const imgReply = rec => {
    if (!rec) throw notFound('Imagem não encontrada.');
    return raw(200, Buffer.from(rec.b64, 'base64'), { 'Content-Type': rec.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  };
  route('GET', '/pelada/img/u/:id', async ctx => imgReply(demoAvatar(ctx.params.id) || await ctx.store.get(PK.avatar(ctx.params.id))));
  route('GET', '/pelada/img/p/:id/:kind', async ctx => {
    if (!['avatar', 'cover', 'preview'].includes(ctx.params.kind)) throw notFound('Imagem não encontrada.');
    return imgReply(await ctx.store.get(PK.img(normalizePeladaId(ctx.params.id), ctx.params.kind)));
  });

  // Página do link de convite (/pelada/p/ID): o app de sempre, com a pré-visualização desta pelada (capa, foto e dados) nas metatags.
  route('GET', '/pelada/page/:id', async ctx => {
    const html = await indexHtml(ctx);
    const id = normalizePeladaId(ctx.params.id);
    const p = PELADA_ID_RE.test(id) ? await loadPelada(ctx.store, id) : null;
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
    if (!p) return raw(404, html, headers);
    const owner = (await loadPlayers(ctx.store, [p.ownerId])).get(p.ownerId);
    return raw(200, injectMeta(html, shareMeta(p, { base: ctx.base, ownerName: owner?.name, now: ctx.now })), headers);
  });

  // ------------------------------------------------------------ painel
  route('GET', '/pelada/mine', async ctx => {
    const me = await ctx.requirePlayer();
    const list = (await ctx.store.get(PK.mine(me.id))) || [];
    const rows = await Promise.all(list.map(async x => ({ x, p: await loadPelada(ctx.store, x.id) })));
    const alive = rows.filter(r => r.p);
    const owners = await loadPlayers(ctx.store, alive.map(r => r.p.ownerId));
    const items = alive.map(({ p }) => peladaSummary(p, p.ownerId === me.id ? 'owner' : 'member', ctx.now, owners.get(p.ownerId)));
    return { created: items.filter(i => i.role === 'owner'), joined: items.filter(i => i.role !== 'owner') };
  });

  route('POST', '/pelada/peladas', async ctx => {
    const me = await ctx.requirePlayer();
    await rateLimit(ctx.store, `plcreate:${me.id}`, { max: 20, windowMs: 3600_000 });
    const avatar = parseImage(ctx.body.avatar, { maxBytes: AVATAR_MAX, field: 'avatar', label: 'Foto da pelada' });
    const cover = parseImage(ctx.body.cover, { maxBytes: COVER_MAX, field: 'cover', label: 'Imagem de capa' });
    const preview = parseImage(ctx.body.preview, { maxBytes: PREVIEW_MAX, field: 'preview', label: 'Prévia do link' });
    const p = await insertNew(ctx, id => {
      const draft = newPelada({ id, owner: me, input: ctx.body }, ctx.now);
      if (avatar) draft.img.avatar = 1;
      if (cover) draft.img.cover = 1;
      if (preview) draft.img.preview = 1;
      return draft;
    });
    if (avatar) await ctx.store.set(PK.img(p.id, 'avatar'), avatar);
    if (cover) await ctx.store.set(PK.img(p.id, 'cover'), cover);
    if (preview) await ctx.store.set(PK.img(p.id, 'preview'), preview);
    await addToMine(ctx.store, me.id, p.id, 'owner', ctx.now);
    await saveFeed(ctx, p, [], ctx.now);
    return { pelada: await viewOf(ctx, p, me), now: ctx.now };
  });

  // Pelada de demonstração: o jogo de hoje com 17 jogadores (nome + foto) já confirmados, para testar o sorteio e as partidas.
  route('POST', '/pelada/peladas/demo', async ctx => {
    const me = await ctx.requirePlayer();
    await rateLimit(ctx.store, `pldemo:${me.id}`, { max: 10, windowMs: 3600_000 });
    const p = await insertNew(ctx, id => newDemoPelada({ id, owner: me, date: todayBR(ctx.now) }, ctx.now));
    await addToMine(ctx.store, me.id, p.id, 'owner', ctx.now);
    await saveFeed(ctx, p, [], ctx.now);
    return { pelada: await viewOf(ctx, p, me), dayId: p.days[0].id, now: ctx.now };
  });

  route('GET', '/pelada/peladas/:id', async ctx => {
    const p = await loadPelada(ctx.store, pelId(ctx));
    if (!p) throw notFound('Pelada não encontrada. Confira o ID.');
    const view = await viewOf(ctx, p, await ctx.player());
    const etag = 'W/"' + createHash('sha1').update(JSON.stringify(view)).digest('base64url').slice(0, 20) + '"';
    if (ctx.req.headers['if-none-match'] === etag) return raw(304, '', { ETag: etag, 'Cache-Control': 'no-cache' });
    return reply(200, { pelada: view, now: ctx.now }, { ETag: etag, 'Cache-Control': 'no-cache' });
  });

  route('PATCH', '/pelada/peladas/:id', async ctx => act(ctx, { owner: true }, async (p, now, me, tx) => {
    Object.assign(p, sanitizeSettings(ctx.body, p));
    tx.sync = true; // o nome aparece nas notificações
    for (const [key, max, label] of [['avatar', AVATAR_MAX, 'Foto da pelada'], ['cover', COVER_MAX, 'Imagem de capa'], ['preview', PREVIEW_MAX, 'Prévia do link']]) {
      if (!(key in ctx.body)) continue;
      const img = parseImage(ctx.body[key], { maxBytes: max, field: key, label });
      if (img) { await ctx.store.set(PK.img(p.id, key), img); p.img[key] = (p.img[key] || 0) + 1; }
      else { await ctx.store.del(PK.img(p.id, key)); p.img[key] = 0; }
    }
  }));

  route('POST', '/pelada/peladas/:id/join', async ctx => act(ctx, {}, async (p, now, me, tx) => {
    if (addMember(p, me.id, now)) tx.events.push(event(me, 'join'));
    await addToMine(ctx.store, me.id, p.id, p.ownerId === me.id ? 'owner' : 'member', now);
  }));

  // sair da pelada: some do painel e das listas de hoje em diante; os gols que a pessoa marcou continuam na artilharia
  route('POST', '/pelada/peladas/:id/leave', async ctx => act(ctx, {}, async (p, now, me, tx) => {
    removeMember(p, me.id, todayBR(now));
    await removeFromMine(ctx.store, me.id, p.id);
    await memberGone(ctx, me, p, now, tx);
  }));
  // o organizador exclui um jogador da pelada
  route('DELETE', '/pelada/peladas/:id/members/:pid', async ctx => act(ctx, { owner: true }, async (p, now, me, tx) => {
    const pid = String(ctx.params.pid);
    if (!pid.startsWith('u:')) throw notFound('Esta pessoa não participa da pelada.');
    const uid = pid.slice(2);
    removeMember(p, uid, todayBR(now));
    if (!isDemoPlayerId(uid)) await removeFromMine(ctx.store, uid, p.id);
    await memberGone(ctx, me, p, now, tx);
  }));

  // ------------------------------------------------------------ dias de jogo
  route('POST', '/pelada/peladas/:id/days', async ctx => act(ctx, { owner: true }, async (p, now, me, tx) => {
    const day = addDay(p, { date: ctx.body.date, org: ctx.body.org || null, matches: ctx.body.matches || 0 }, now);
    if (day.date >= todayBR(now)) tx.events.push(event(me, 'schedule', { day: dayRef(day), d: { kind: 'new' } }));
    else tx.sync = true;
    return { dayId: day.id };
  }));

  route('PATCH', '/pelada/peladas/:id/days/:dayId', async ctx => act(ctx, { owner: true }, async (p, now, me, tx) => {
    const day = getDay(p, ctx.params.dayId);
    if ('date' in ctx.body) {
      if (!validDate(ctx.body.date)) throw badRequest('Data do jogo inválida.', 'VALIDATION', { field: 'date' });
      if (p.days.some(d => d.id !== day.id && d.date === ctx.body.date)) throw conflict('Já existe um jogo nesta data.', 'DUPLICATE_DAY', { field: 'date' });
      const from = day.date;
      day.date = ctx.body.date;
      p.days.sort((a, b) => a.date.localeCompare(b.date));
      if (from !== day.date) {
        if (day.date >= todayBR(now)) tx.events.push(event(me, 'schedule', { day: dayRef(day), d: { kind: 'moved', from } }));
        else tx.sync = true;
      }
    }
    if ('org' in ctx.body) day.org = ctx.body.org ? sanitizeOrg(ctx.body.org, orgOf(p, day)) : null;
  }));

  route('DELETE', '/pelada/peladas/:id/days/:dayId', async ctx => act(ctx, { owner: true }, async (p, now, me, tx) => {
    const day = getDay(p, ctx.params.dayId);
    p.days.splice(p.days.indexOf(day), 1);
    if (day.date >= todayBR(now)) tx.events.push(event(me, 'schedule', { day: dayRef(day), d: { kind: 'cancel' } }));
    else tx.sync = true;
  }));

  // ------------------------------------------------------------ presença e convidados
  route('POST', '/pelada/peladas/:id/days/:dayId/presence', async ctx => act(ctx, {}, async (p, now, me, tx) => {
    const day = getDay(p, ctx.params.dayId), pid = userPid(me.id);
    const newMember = !p.members.some(m => m.userId === me.id);
    const was = day.attendance.some(a => a.pid === pid);
    setPresence(p, day, me.id, ctx.body.present !== false, now);
    const is = day.attendance.some(a => a.pid === pid);
    if (newMember) tx.events.push(event(me, 'join'));
    if (was !== is) tx.events.push(event(me, is ? 'presence' : 'absence', { day: dayRef(day), d: { n: day.attendance.length } }));
    if (was && !is && day.draw) tx.events.push(await drawFix(ctx, me, p, day)); // saiu de um time: o capitão (e o nome do time) pode mudar
    await addToMine(ctx.store, me.id, p.id, p.ownerId === me.id ? 'owner' : 'member', now);
  }));

  route('POST', '/pelada/peladas/:id/days/:dayId/guests', async ctx => act(ctx, { owner: true }, async (p, now, me, tx) => {
    const day = getDay(p, ctx.params.dayId);
    const g = addGuest(p, day, ctx.body.name, ctx.body.teamId, now, await nameResolver(ctx, p));
    tx.events.push(event(me, 'presence', { day: dayRef(day), d: { guest: g.name, n: day.attendance.length } }));
    return { guestPid: guestPid(g.id) };
  }));

  route('DELETE', '/pelada/peladas/:id/days/:dayId/attendance/:pid', async ctx => act(ctx, { owner: true }, async (p, now, me, tx) => {
    const day = getDay(p, ctx.params.dayId), pid = ctx.params.pid;
    const name = (await namesOf(ctx, p, [pid]))(pid);
    removeAttendance(day, pid);
    const n = day.attendance.length;
    if (pid === userPid(me.id)) tx.events.push(event(me, 'absence', { day: dayRef(day), d: { n } }));
    else tx.events.push(event(me, 'absence', { day: dayRef(day), d: { removed: name || 'um jogador', uid: userIds([pid])[0] || null, n } }));
    if (day.draw) tx.events.push(await drawFix(ctx, me, p, day));
  }));

  route('POST', '/pelada/peladas/:id/days/:dayId/assign', async ctx => act(ctx, { owner: true }, async (p, now, me, tx) => {
    const day = getDay(p, ctx.params.dayId);
    assignPlayer(day, String(ctx.body.pid || ''), ctx.body.teamId || null);
    tx.events.push(await drawFix(ctx, me, p, day)); // o aviso do sorteio passa a dizer o time certo
  }));

  // ------------------------------------------------------------ sorteio
  // só o organizador sorteia — e pode sortear a qualquer hora, inclusive com partida em andamento (define a próxima composição)
  route('POST', '/pelada/peladas/:id/days/:dayId/draw', async ctx => act(ctx, { owner: true }, async (p, now, me, tx) => {
    const day = getDay(p, ctx.params.dayId);
    const nameOf = await nameResolver(ctx, p);
    const players = day.attendance.map(a => ({ pid: a.pid, name: nameOf(a.pid), guest: a.pid.startsWith('g:') }));
    const redo = !!day.draw;
    const draw = performDraw(p, day, players, { by: me.id, now });
    tx.events.push(event(me, 'draw', { day: dayRef(day), d: { teams: draw.teams.length, redo, slot: drawSlots(day, nameOf) } }));
    return { drawId: draw.id };
  }));

  // ------------------------------------------------------------ partidas e súmula
  const matchAct = (ctx, fn) => act(ctx, { owner: true }, async (p, now, me, tx) => {
    const day = getDay(p, ctx.params.dayId);
    return fn(p, day, getMatch(day, ctx.params.mid), now, me, tx);
  });

  route('POST', '/pelada/peladas/:id/days/:dayId/matches', async ctx => act(ctx, { owner: true }, async (p, now) => {
    const m = createMatch(p, getDay(p, ctx.params.dayId), { a: ctx.body.a, b: ctx.body.b }, now);
    return { matchId: m.id };
  }));
  route('PATCH', '/pelada/peladas/:id/days/:dayId/matches/:mid', async ctx => matchAct(ctx, (p, day, m) => {
    setMatchTeams(day, m, { a: 'a' in ctx.body ? (ctx.body.a || null) : undefined, b: 'b' in ctx.body ? (ctx.body.b || null) : undefined });
  }));
  route('DELETE', '/pelada/peladas/:id/days/:dayId/matches/:mid', async ctx => matchAct(ctx, (p, day, m) => { deleteMatch(day, m); }));
  route('POST', '/pelada/peladas/:id/days/:dayId/matches/:mid/timer', async ctx => matchAct(ctx, async (p, day, m, now, me, tx) => {
    const before = m.status;
    timerAction(m, { action: ctx.body.action, minutes: ctx.body.minutes }, now);
    if (before === 'scheduled' && m.status === 'live') {
      const { nameOf, ...info } = await matchInfo(ctx, p, day, m);
      tx.events.push(event(me, 'match', { day: dayRef(day), d: info }));
    }
  }));
  route('POST', '/pelada/peladas/:id/days/:dayId/matches/:mid/goals', async ctx => matchAct(ctx, async (p, day, m, now, me, tx) => {
    const g = addGoal(day, m, { teamId: ctx.body.teamId, pid: ctx.body.pid || null }, now);
    if (m.status === 'finished') tx.events.push(await resultEvent(ctx, me, p, day, m)); // correção: atualiza o resultado avisado
    return { goalId: g.id };
  }));
  route('DELETE', '/pelada/peladas/:id/days/:dayId/matches/:mid/goals/:gid', async ctx => matchAct(ctx, async (p, day, m, now, me, tx) => {
    removeGoal(m, ctx.params.gid);
    if (m.status === 'finished') tx.events.push(await resultEvent(ctx, me, p, day, m));
  }));
  route('POST', '/pelada/peladas/:id/days/:dayId/matches/:mid/loans', async ctx => matchAct(ctx, (p, day, m) => {
    setLoan(day, m, { teamId: ctx.body.teamId, pid: String(ctx.body.pid || ''), remove: !!ctx.body.remove });
  }));
  route('POST', '/pelada/peladas/:id/days/:dayId/matches/:mid/finish', async ctx => matchAct(ctx, async (p, day, m, now, me, tx) => {
    const { next, info } = finishMatch(p, day, m, { auto: !!ctx.body.auto, now, nameOf: await nameResolver(ctx, p) });
    tx.events.push(await resultEvent(ctx, me, p, day, m));
    if (info.rotation) tx.events.push(await drawFix(ctx, me, p, day)); // o sorteio automático mudou os times: "você está no Time X" acompanha
    return { next: next ? next.id : null, info };
  }));

  // gols do dia quando a data é "sem formação de times"
  route('POST', '/pelada/peladas/:id/days/:dayId/goals', async ctx => act(ctx, { owner: true }, async p => {
    adjustLooseGoal(p, getDay(p, ctx.params.dayId), String(ctx.body.pid || ''), ctx.body.delta);
  }));

  // ------------------------------------------------------------ excluir pelada
  route('DELETE', '/pelada/peladas/:id', async ctx => {
    const me = await ctx.requirePlayer();
    const id = pelId(ctx);
    const p = await loadPelada(ctx.store, id);
    if (!p) throw notFound('Pelada não encontrada.');
    if (p.ownerId !== me.id) throw forbidden('Só quem criou a pelada pode excluí-la.');
    await Promise.all(p.members.filter(m => !isDemoPlayerId(m.userId)).map(m => removeFromMine(ctx.store, m.userId, id)));
    await Promise.all([ctx.store.del(PK.pelada(id)), ctx.store.del(PK.img(id, 'avatar')), ctx.store.del(PK.img(id, 'cover')), ctx.store.del(PK.img(id, 'preview')), deleteFeed(ctx.store, id)]);
    return { ok: true };
  });

  // ------------------------------------------------------------ notificações no app
  route('GET', '/pelada/notifications', async ctx => {
    const me = await ctx.requirePlayer();
    const inbox = await readInbox(ctx.store, me, ctx.now);
    const etag = 'W/"' + createHash('sha1').update(JSON.stringify(inbox)).digest('base64url').slice(0, 20) + '"';
    if (ctx.req.headers['if-none-match'] === etag) return raw(304, '', { ETag: etag, 'Cache-Control': 'no-cache' });
    return reply(200, { ...inbox, now: ctx.now }, { ETag: etag, 'Cache-Control': 'no-cache' });
  });

  route('POST', '/pelada/notifications/read', async ctx => {
    const me = await ctx.requirePlayer();
    await markRead(ctx.store, me.id, { all: ctx.body.all === true, ids: ctx.body.ids, upTo: ctx.body.upTo }, ctx.now);
    return { ...(await readInbox(ctx.store, me, ctx.now)), now: ctx.now };
  });

  route('GET', '/pelada/notifications/prefs', async ctx => {
    const me = await ctx.requirePlayer();
    return { prefs: await getPrefs(ctx.store, me.id) };
  });

  route('PATCH', '/pelada/notifications/prefs', async ctx => {
    const me = await ctx.requirePlayer();
    await rateLimit(ctx.store, `plprefs:${me.id}`, { max: 120, windowMs: 600_000 });
    return { prefs: await updatePrefs(ctx.store, me.id, ctx.body) };
  });
}
