// API do módulo Pelada: conta simplificada (nome + data de nascimento), peladas, presença, sorteio, súmula e artilharia.

import { createHash } from 'node:crypto';
import { route, reply, raw } from '../router.js';
import { badRequest, forbidden, notFound, unauthorized, conflict } from '../errors.js';
import { hashPassword, verifyPassword, randomId } from '../auth.js';
import { clientIp } from '../http.js';
import { rateLimit, rateLimitPeek, rateLimitReset } from '../repo.js';
import {
  PK, getPlayer, getPlayerByName, createPlayer, loadPelada, withPelada, addToMine, removeFromMine, loadPlayers,
} from '../peladaRepo.js';
import {
  newPelada, peladaId, parseImage, AVATAR_MAX, COVER_MAX, sanitizeSettings, sanitizeOrg, orgOf, addDay, getDay, getMatch,
  validDate, setPresence, addGuest, removeAttendance, performDraw, assignPlayer, createMatch, setMatchTeams, deleteMatch,
  timerAction, addGoal, removeGoal, setLoan, finishMatch, adjustLooseGoal, addMember, userPid, guestPid,
} from '../domain/pelada.js';
import { peladaView, peladaSummary, referencedUserIds } from '../domain/pelada-views.js';
import { cleanName, nameKey, parseBirth, normalizeSecret, normalizePeladaId, PELADA_ID_RE } from '../../public/assets/js/shared/pelada.js';

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .'’-]*$/u;
// hash falso para igualar o tempo de resposta quando o nome não existe
const DUMMY = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86);

export const playerView = u => u ? { id: u.id, name: u.name, av: u.av || 0 } : null;

function pelId(ctx) {
  const id = normalizePeladaId(ctx.params.id);
  if (!PELADA_ID_RE.test(id)) throw notFound('Pelada não encontrada. Confira o ID.');
  return id;
}

async function viewOf(ctx, p, viewer) {
  const users = await loadPlayers(ctx.store, referencedUserIds(p));
  return peladaView(p, { users, viewer, now: ctx.now, base: ctx.base });
}

/**
 * Executa uma ação sobre a pelada dentro do lock e devolve a visão atualizada.
 * `owner: true` exige o criador. `fn(p, now, player)` pode devolver dados extras (mesclados na resposta).
 */
async function act(ctx, { owner = false } = {}, fn) {
  const player = await ctx.requirePlayer();
  const id = pelId(ctx);
  const extra = await withPelada(ctx.store, id, async (p, now) => {
    if (owner && p.ownerId !== player.id) throw forbidden('Só quem criou a pelada pode fazer isso.');
    return fn(p, now, player);
  });
  const p = await loadPelada(ctx.store, id);
  return { pelada: await viewOf(ctx, p, player), now: ctx.now, ...(extra && typeof extra === 'object' ? extra : {}) };
}

/** nome por pid (convidados na pelada; contas via banco) — usado em regras que comparam nomes. */
async function nameResolver(ctx, p) {
  const users = await loadPlayers(ctx.store, referencedUserIds(p));
  return pid => pid.startsWith('g:') ? (p.guests.find(g => `g:${g.id}` === pid)?.name || '') : (users.get(pid.slice(2))?.name || '');
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
    return { player: playerView(player) };
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
    return { player: playerView(player) };
  });

  route('POST', '/pelada/auth/logout', async ctx => { ctx.endPlayerSession(); return { ok: true }; });
  route('GET', '/pelada/auth/me', async ctx => ({ player: playerView(await ctx.player()) }));

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
    return { ok: true };
  });

  // ------------------------------------------------------------ imagens (cache longo; a URL leva ?v=versão)
  const imgReply = rec => {
    if (!rec) throw notFound('Imagem não encontrada.');
    return raw(200, Buffer.from(rec.b64, 'base64'), { 'Content-Type': rec.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  };
  route('GET', '/pelada/img/u/:id', async ctx => imgReply(await ctx.store.get(PK.avatar(ctx.params.id))));
  route('GET', '/pelada/img/p/:id/:kind', async ctx => {
    if (!['avatar', 'cover'].includes(ctx.params.kind)) throw notFound('Imagem não encontrada.');
    return imgReply(await ctx.store.get(PK.img(normalizePeladaId(ctx.params.id), ctx.params.kind)));
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
    let p = null;
    for (let i = 0; i < 6 && !p; i++) {
      const id = peladaId();
      const draft = newPelada({ id, owner: me, input: ctx.body }, ctx.now);
      if (avatar) draft.img.avatar = 1;
      if (cover) draft.img.cover = 1;
      if (await ctx.store.setNX(PK.pelada(id), draft)) p = draft;
    }
    if (!p) throw conflict('Não foi possível gerar o ID da pelada. Tente de novo.', 'ID_COLLISION');
    if (avatar) await ctx.store.set(PK.img(p.id, 'avatar'), avatar);
    if (cover) await ctx.store.set(PK.img(p.id, 'cover'), cover);
    await addToMine(ctx.store, me.id, p.id, 'owner', ctx.now);
    return { pelada: await viewOf(ctx, p, me), now: ctx.now };
  });

  route('GET', '/pelada/peladas/:id', async ctx => {
    const p = await loadPelada(ctx.store, pelId(ctx));
    if (!p) throw notFound('Pelada não encontrada. Confira o ID.');
    const view = await viewOf(ctx, p, await ctx.player());
    const etag = 'W/"' + createHash('sha1').update(JSON.stringify(view)).digest('base64url').slice(0, 20) + '"';
    if (ctx.req.headers['if-none-match'] === etag) return raw(304, '', { ETag: etag, 'Cache-Control': 'no-cache' });
    return reply(200, { pelada: view, now: ctx.now }, { ETag: etag, 'Cache-Control': 'no-cache' });
  });

  route('PATCH', '/pelada/peladas/:id', async ctx => act(ctx, { owner: true }, async p => {
    Object.assign(p, sanitizeSettings(ctx.body, p));
    for (const [key, max, label] of [['avatar', AVATAR_MAX, 'Foto da pelada'], ['cover', COVER_MAX, 'Imagem de capa']]) {
      if (!(key in ctx.body)) continue;
      const img = parseImage(ctx.body[key], { maxBytes: max, field: key, label });
      if (img) { await ctx.store.set(PK.img(p.id, key), img); p.img[key] = (p.img[key] || 0) + 1; }
      else { await ctx.store.del(PK.img(p.id, key)); p.img[key] = 0; }
    }
  }));

  route('POST', '/pelada/peladas/:id/join', async ctx => act(ctx, {}, async (p, now, me) => {
    addMember(p, me.id, now);
    await addToMine(ctx.store, me.id, p.id, p.ownerId === me.id ? 'owner' : 'member', now);
  }));

  // ------------------------------------------------------------ dias de jogo
  route('POST', '/pelada/peladas/:id/days', async ctx => act(ctx, { owner: true }, async (p, now) => {
    const day = addDay(p, { date: ctx.body.date, org: ctx.body.org || null, matches: ctx.body.matches || 0 }, now);
    return { dayId: day.id };
  }));

  route('PATCH', '/pelada/peladas/:id/days/:dayId', async ctx => act(ctx, { owner: true }, async p => {
    const day = getDay(p, ctx.params.dayId);
    if ('date' in ctx.body) {
      if (!validDate(ctx.body.date)) throw badRequest('Data do jogo inválida.', 'VALIDATION', { field: 'date' });
      if (p.days.some(d => d.id !== day.id && d.date === ctx.body.date)) throw conflict('Já existe um jogo nesta data.', 'DUPLICATE_DAY', { field: 'date' });
      day.date = ctx.body.date;
      p.days.sort((a, b) => a.date.localeCompare(b.date));
    }
    if ('org' in ctx.body) day.org = ctx.body.org ? sanitizeOrg(ctx.body.org, orgOf(p, day)) : null;
  }));

  route('DELETE', '/pelada/peladas/:id/days/:dayId', async ctx => act(ctx, { owner: true }, async p => {
    const day = getDay(p, ctx.params.dayId);
    p.days.splice(p.days.indexOf(day), 1);
  }));

  // ------------------------------------------------------------ presença e convidados
  route('POST', '/pelada/peladas/:id/days/:dayId/presence', async ctx => act(ctx, {}, async (p, now, me) => {
    setPresence(p, getDay(p, ctx.params.dayId), me.id, ctx.body.present !== false, now);
    await addToMine(ctx.store, me.id, p.id, p.ownerId === me.id ? 'owner' : 'member', now);
  }));

  route('POST', '/pelada/peladas/:id/days/:dayId/guests', async ctx => act(ctx, { owner: true }, async (p, now) => {
    const day = getDay(p, ctx.params.dayId);
    const g = addGuest(p, day, ctx.body.name, ctx.body.teamId, now, await nameResolver(ctx, p));
    return { guestPid: guestPid(g.id) };
  }));

  route('DELETE', '/pelada/peladas/:id/days/:dayId/attendance/:pid', async ctx => act(ctx, { owner: true }, async p => {
    removeAttendance(getDay(p, ctx.params.dayId), ctx.params.pid);
  }));

  route('POST', '/pelada/peladas/:id/days/:dayId/assign', async ctx => act(ctx, { owner: true }, async p => {
    assignPlayer(getDay(p, ctx.params.dayId), String(ctx.body.pid || ''), ctx.body.teamId || null);
  }));

  // ------------------------------------------------------------ sorteio
  route('POST', '/pelada/peladas/:id/days/:dayId/draw', async ctx => act(ctx, {}, async (p, now, me) => {
    const day = getDay(p, ctx.params.dayId);
    const isOwner = p.ownerId === me.id;
    // o criador sorteia (e refaz) quando quiser; um confirmado só pode fazer o primeiro sorteio do dia
    if (!isOwner) {
      if (!day.attendance.some(a => a.pid === userPid(me.id))) throw forbidden('Marque presença para poder sortear os times.');
      if (day.draw) throw forbidden('Os times já foram sorteados. Só o criador da pelada pode refazer o sorteio.');
    }
    const nameOf = await nameResolver(ctx, p);
    const players = day.attendance.map(a => ({ pid: a.pid, name: nameOf(a.pid), guest: a.pid.startsWith('g:') }));
    const draw = performDraw(p, day, players, { by: me.id, now });
    return { drawId: draw.id };
  }));

  // ------------------------------------------------------------ partidas e súmula
  const matchAct = (ctx, fn) => act(ctx, { owner: true }, async (p, now) => {
    const day = getDay(p, ctx.params.dayId);
    return fn(p, day, getMatch(day, ctx.params.mid), now);
  });

  route('POST', '/pelada/peladas/:id/days/:dayId/matches', async ctx => act(ctx, { owner: true }, async (p, now) => {
    const m = createMatch(p, getDay(p, ctx.params.dayId), { a: ctx.body.a, b: ctx.body.b }, now);
    return { matchId: m.id };
  }));
  route('PATCH', '/pelada/peladas/:id/days/:dayId/matches/:mid', async ctx => matchAct(ctx, (p, day, m) => {
    setMatchTeams(day, m, { a: 'a' in ctx.body ? (ctx.body.a || null) : undefined, b: 'b' in ctx.body ? (ctx.body.b || null) : undefined });
  }));
  route('DELETE', '/pelada/peladas/:id/days/:dayId/matches/:mid', async ctx => matchAct(ctx, (p, day, m) => { deleteMatch(day, m); }));
  route('POST', '/pelada/peladas/:id/days/:dayId/matches/:mid/timer', async ctx => matchAct(ctx, (p, day, m, now) => {
    timerAction(m, { action: ctx.body.action, minutes: ctx.body.minutes }, now);
  }));
  route('POST', '/pelada/peladas/:id/days/:dayId/matches/:mid/goals', async ctx => matchAct(ctx, (p, day, m, now) => {
    const g = addGoal(day, m, { teamId: ctx.body.teamId, pid: ctx.body.pid || null }, now);
    return { goalId: g.id };
  }));
  route('DELETE', '/pelada/peladas/:id/days/:dayId/matches/:mid/goals/:gid', async ctx => matchAct(ctx, (p, day, m) => { removeGoal(m, ctx.params.gid); }));
  route('POST', '/pelada/peladas/:id/days/:dayId/matches/:mid/loans', async ctx => matchAct(ctx, (p, day, m) => {
    setLoan(day, m, { teamId: ctx.body.teamId, pid: String(ctx.body.pid || ''), remove: !!ctx.body.remove });
  }));
  route('POST', '/pelada/peladas/:id/days/:dayId/matches/:mid/finish', async ctx => matchAct(ctx, (p, day, m, now) => {
    const { next, info } = finishMatch(p, day, m, { auto: !!ctx.body.auto, now });
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
    await Promise.all(p.members.map(m => removeFromMine(ctx.store, m.userId, id)));
    await Promise.all([ctx.store.del(PK.pelada(id)), ctx.store.del(PK.img(id, 'avatar')), ctx.store.del(PK.img(id, 'cover'))]);
    return { ok: true };
  });
}
