import { route } from '../router.js';
import { badRequest, conflict, forbidden, notFound } from '../../public/assets/js/shared/errors.js';
import { randomCode } from '../auth.js';
import {
  K, addToUserIndex, removeFromUserIndex, getUser, loadTournament, withTournament,
} from '../repo.js';
import {
  newTournament, makeTournamentId, defaultFinalDate, cleanText, pushActivity,
} from '../../public/assets/js/shared/domain/tournament.js';
import { simulatePhase } from '../../public/assets/js/shared/domain/bracket.js';
import { TOURNAMENT_ACTIONS, runTournamentAction, parseStream } from '../../public/assets/js/shared/domain/tournament-actions.js';
import { adminView, summaryView } from '../../public/assets/js/shared/domain/views.js';
import { SPORT_KEYS } from '../../public/assets/js/shared/sports.js';
import { parseDay } from '../../public/assets/js/shared/format.js';
import { demoTeams } from '../demo.js';

const MAX_TOURNAMENTS_PER_USER = 40;
const INVITE_TTL_MS = 7 * 86400_000;

async function usersOf(store, t) {
  const out = {};
  for (const a of t.admins) out[a.userId] = await getUser(store, a.userId);
  for (const i of t.invites) if (!out[i.createdBy]) out[i.createdBy] = await getUser(store, i.createdBy);
  return out;
}
const view = async (ctx, t, user) => adminView(t, ctx.now, { users: await usersOf(ctx.store, t), me: user });

/** Cópia do documento para o navegador do organizador aplicar ações sem internet (se pediu e a versão mudou). */
async function replicaOf(ctx, t) {
  const have = ctx.replicaHave;
  if (have === null || have === t.version) return undefined;
  const users = await usersOf(ctx.store, t);
  return { doc: t, users: Object.fromEntries(Object.entries(users).filter(([, u]) => u).map(([id, u]) => [id, { name: u.name, email: u.email }])) };
}

/**
 * Wrapper: bloqueia, valida que o usuário é admin e devolve a visão atualizada.
 * Com `X-Op-Id` a mesma operação enviada de novo não é repetida; `X-Op-At` é o instante em que foi feita no aparelho.
 */
async function mutate(ctx, id, fn, { ownerOnly = false } = {}) {
  const user = await ctx.requireUser();
  let extra;
  const op = ctx.op, meta = {};
  const done = await withTournament(ctx.store, id, async (t, now) => {
    const admin = t.admins.find(a => a.userId === user.id);
    if (!admin) throw forbidden('Você não administra este torneio.');
    if (ownerOnly && admin.role !== 'owner') throw forbidden('Apenas o criador do torneio pode fazer isso.');
    extra = await fn(t, now, user);
    return t;
  }, { opId: op?.id, at: op?.at, meta });
  const t = done || await loadTournament(ctx.store, id);
  const v = await view(ctx, t, user);
  const replica = await replicaOf(ctx, t);
  const out = { tournament: v, ...(replica ? { replica } : {}), ...(meta.replayed ? { replayed: true } : {}) };
  return extra ? { ...out, ...extra } : out;
}

export function registerTournamentRoutes() {
  route('GET', '/tournaments', async ctx => {
    const user = await ctx.requireUser();
    const ids = (await ctx.store.get(K.userTours(user.id))) || [];
    const list = [];
    for (const id of ids) {
      const t = await loadTournament(ctx.store, id);
      if (t && t.admins.some(a => a.userId === user.id)) list.push(summaryView(t, user.id, ctx.now));
    }
    list.sort((a, b) => b.createdAt - a.createdAt);
    return { tournaments: list };
  });

  route('POST', '/tournaments', async ctx => {
    const user = await ctx.requireUser();
    const ids = (await ctx.store.get(K.userTours(user.id))) || [];
    if (ids.length >= MAX_TOURNAMENTS_PER_USER) throw conflict(`Limite de ${MAX_TOURNAMENTS_PER_USER} torneios por conta atingido.`, 'LIMIT');
    const name = cleanText(ctx.body.name, 60, { min: 3, field: 'Nome do torneio' });
    const sport = ctx.body.sport;
    if (!SPORT_KEYS.includes(sport)) throw badRequest('Escolha a modalidade do torneio.', 'VALIDATION', { field: 'sport' });
    const finalDate = ctx.body.finalDate ? ctx.body.finalDate : defaultFinalDate(ctx.now);
    if (!parseDay(finalDate)) throw badRequest('Data da final inválida.', 'VALIDATION', { field: 'finalDate' });

    let t, id;
    for (let attempt = 0; attempt < 60; attempt++) {
      id = makeTournamentId(ctx.now, Math.random, attempt < 40 ? 4 : 5);
      t = newTournament({ id, user, name, sport, finalDate, demo: !!ctx.body.demo }, ctx.now);
      if (t.demo) { t.teams = demoTeams(t, ctx.now); t.type = 'amador'; }
      if (await ctx.store.setNX(K.tour(id), t)) break;
      t = null;
    }
    if (!t) throw conflict('Não foi possível gerar um ID único. Tente novamente.', 'ID_COLLISION');
    await addToUserIndex(ctx.store, user.id, id);
    return { tournament: await view(ctx, t, user) };
  });

  route('GET', '/tournaments/:id', async ctx => {
    const { user, t } = await ctx.requireAdmin(ctx.params.id);
    const replica = await replicaOf(ctx, t);
    return { tournament: await view(ctx, t, user), ...(replica ? { replica } : {}) };
  });

  route('DELETE', '/tournaments/:id', async ctx => {
    const user = await ctx.requireUser();
    const id = ctx.params.id;
    await withTournament(ctx.store, id, async t => {
      const me = t.admins.find(a => a.userId === user.id);
      if (!me) throw forbidden('Você não administra este torneio.');
      if (me.role !== 'owner') throw forbidden('Apenas o criador do torneio pode excluí-lo.');
      if (String(ctx.body.confirm || '').trim() !== t.name) throw badRequest('Digite o nome do torneio para confirmar a exclusão.', 'CONFIRM');
      for (const team of t.teams) if (team.hasEmblem) await ctx.store.del(K.emblem(id, team.id));
      for (const i of t.invites) await ctx.store.del(K.invite(i.code));
      for (const a of t.admins) await removeFromUserIndex(ctx.store, a.userId, id);
    });
    await ctx.store.del(K.tour(id));
    return { ok: true };
  });

  // ------------------------------------------------------------ convites e administradores
  route('POST', '/tournaments/:id/invites', ctx => mutate(ctx, ctx.params.id, async (t, now, user) => {
    t.invites = t.invites.filter(i => !i.revoked && !i.usedBy && i.expiresAt > now);
    if (t.invites.length >= 10) throw conflict('Há convites pendentes demais. Revogue algum antes de criar outro.', 'LIMIT');
    const code = randomCode(18);
    t.invites.push({ code, createdBy: user.id, createdAt: now, expiresAt: now + INVITE_TTL_MS, usedBy: null, revoked: false });
    await ctx.store.set(K.invite(code), { tid: t.id }, { ttlMs: INVITE_TTL_MS + 3600_000 });
    return { invite: { code, url: `${ctx.base}/convite/${code}`, expiresAt: now + INVITE_TTL_MS } };
  }));

  route('DELETE', '/tournaments/:id/invites/:code', ctx => mutate(ctx, ctx.params.id, async t => {
    const inv = t.invites.find(i => i.code === ctx.params.code);
    if (!inv) throw notFound('Convite não encontrado.');
    inv.revoked = true;
    await ctx.store.del(K.invite(inv.code));
  }));

  route('DELETE', '/tournaments/:id/admins/:userId', async ctx => {
    const user = await ctx.requireUser();
    const target = ctx.params.userId;
    const t = await withTournament(ctx.store, ctx.params.id, async t => {
      const me = t.admins.find(a => a.userId === user.id);
      if (!me) throw forbidden('Você não administra este torneio.');
      const tgt = t.admins.find(a => a.userId === target);
      if (!tgt) throw notFound('Administrador não encontrado.');
      if (tgt.role === 'owner') throw forbidden('O criador do torneio não pode ser removido.');
      if (target !== user.id && me.role !== 'owner') throw forbidden('Apenas o criador pode remover outros administradores.');
      t.admins = t.admins.filter(a => a.userId !== target);
      pushActivity(t, 'admin', target === user.id ? 'Um administrador saiu do torneio.' : 'Um administrador foi removido.', ctx.now);
      return t;
    });
    await removeFromUserIndex(ctx.store, target, t.id);
    if (target === user.id) return { left: true };
    return { tournament: await view(ctx, t, user) };
  });

  route('GET', '/invites/:code', async ctx => {
    const rec = await ctx.store.get(K.invite(ctx.params.code));
    const invalid = { valid: false, reason: 'Este convite não existe ou foi revogado.' };
    if (!rec) return invalid;
    const t = await loadTournament(ctx.store, rec.tid);
    const inv = t?.invites.find(i => i.code === ctx.params.code);
    if (!t || !inv || inv.revoked) return invalid;
    if (inv.usedBy) return { valid: false, reason: 'Este convite já foi utilizado.' };
    if (inv.expiresAt <= ctx.now) return { valid: false, reason: 'Este convite expirou. Peça um novo ao organizador.' };
    const inviter = await getUser(ctx.store, inv.createdBy);
    return { valid: true, tournament: { id: t.id, name: t.name }, inviter: inviter?.name || 'O organizador', expiresAt: inv.expiresAt };
  });

  route('POST', '/invites/:code/accept', async ctx => {
    const user = await ctx.requireUser();
    const rec = await ctx.store.get(K.invite(ctx.params.code));
    if (!rec) throw notFound('Este convite não existe ou foi revogado.');
    const tid = rec.tid;
    const consumed = await withTournament(ctx.store, tid, async (t, now) => {
      const inv = t.invites.find(i => i.code === ctx.params.code);
      if (!inv || inv.revoked) throw notFound('Este convite não existe ou foi revogado.');
      if (t.admins.some(a => a.userId === user.id)) return false; // já é admin: não consome o convite
      if (inv.usedBy) throw conflict('Este convite já foi utilizado.', 'USED');
      if (inv.expiresAt <= now) throw conflict('Este convite expirou. Peça um novo ao organizador.', 'EXPIRED');
      inv.usedBy = user.id; inv.usedAt = now;
      t.admins.push({ userId: user.id, role: 'admin', addedAt: now });
      pushActivity(t, 'admin', `${user.name} agora administra o torneio.`, now);
      return true;
    });
    await addToUserIndex(ctx.store, user.id, tid);
    if (consumed) await ctx.store.del(K.invite(ctx.params.code));
    return { tournamentId: tid };
  });

  // ------------------------------------------------------------ ações do organizador (shared/domain/tournament-actions.js)
  // O navegador repete as mesmas ações sem internet; aqui entram só os efeitos que dependem do servidor (emblema).
  for (const action of TOURNAMENT_ACTIONS) {
    route(action.method, action.path, ctx => mutate(ctx, ctx.params.id, async (t, now, user) => {
      const effects = [];
      const extra = runTournamentAction(t, action, { params: ctx.params, body: ctx.body, now, me: user, effects }, ctx.op?.id);
      for (const e of effects) {
        if (e.type === 'emblem:set') await ctx.store.set(K.emblem(t.id, e.teamId), e.emblem);
        else if (e.type === 'emblem:del') await ctx.store.del(K.emblem(t.id, e.teamId));
      }
      return extra;
    }));
  }

  route('POST', '/tournaments/:id/demo/simulate', ctx => mutate(ctx, ctx.params.id, (t, now) => {
    if (!t.demo) throw forbidden('A simulação só está disponível em torneios de demonstração.');
    simulatePhase(t, now);
  }));
}

export { parseStream };
