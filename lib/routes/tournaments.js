import { route } from '../router.js';
import { badRequest, conflict, forbidden, notFound } from '../../public/assets/js/shared/errors.js';
import { randomCode } from '../auth.js';
import {
  K, addToUserIndex, removeFromUserIndex, getUser, loadTournament, withTournament,
} from '../repo.js';
import {
  newTournament, sanitizeSettings, makeTournamentId, defaultFinalDate, cleanText, pushActivity,
} from '../../public/assets/js/shared/domain/tournament.js';
import { registerTeam, confirmTeam, updateTeam, removeTeam } from '../../public/assets/js/shared/domain/teams.js';
import { drawTournament, resetBracket, simulatePhase, teamById, canRepesc } from '../../public/assets/js/shared/domain/bracket.js';
import { applyAction } from '../../public/assets/js/shared/domain/live.js';
import { registerDonation } from '../../public/assets/js/shared/domain/payments.js';
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

/** Wrapper: bloqueia, valida que o usuário é admin e devolve a visão atualizada. */
async function mutate(ctx, id, fn, { ownerOnly = false } = {}) {
  const user = await ctx.requireUser();
  let extra;
  const t = await withTournament(ctx.store, id, async (t, now) => {
    const admin = t.admins.find(a => a.userId === user.id);
    if (!admin) throw forbidden('Você não administra este torneio.');
    if (ownerOnly && admin.role !== 'owner') throw forbidden('Apenas o criador do torneio pode fazer isso.');
    extra = await fn(t, now, user);
    return t;
  });
  const v = await view(ctx, t, user);
  return extra ? { tournament: v, ...extra } : { tournament: v };
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
    return { tournament: await view(ctx, t, user) };
  });

  route('PATCH', '/tournaments/:id', ctx => mutate(ctx, ctx.params.id, (t, now) => {
    Object.assign(t, sanitizeSettings(ctx.body, t, now));
  }));

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

  // ------------------------------------------------------------ times
  route('POST', '/tournaments/:id/teams', ctx => mutate(ctx, ctx.params.id, async (t, now) => {
    const { team, emblem } = registerTeam(t, ctx.body, now, { admin: true, paid: ctx.body.paid !== false });
    if (emblem) await ctx.store.set(K.emblem(t.id, team.id), emblem);
  }));

  route('PATCH', '/tournaments/:id/teams/:teamId', ctx => mutate(ctx, ctx.params.id, (t, now) => {
    const team = teamById(t, ctx.params.teamId);
    if (!team) throw notFound('Time não encontrado.');
    updateTeam(t, team, ctx.body, now);
  }));

  route('POST', '/tournaments/:id/teams/:teamId/confirm', ctx => mutate(ctx, ctx.params.id, (t, now) => {
    const team = teamById(t, ctx.params.teamId);
    if (!team) throw notFound('Time não encontrado.');
    if (team.status === 'confirmed') return;
    if (team.status === 'cancelled') throw conflict('Este time foi cancelado.', 'STATE');
    const r = confirmTeam(t, team, 'manual', now);
    if (r === 'no_slot') throw conflict('Não há vaga disponível para confirmar este time.', 'FULL');
  }));

  route('DELETE', '/tournaments/:id/teams/:teamId', ctx => mutate(ctx, ctx.params.id, async (t, now) => {
    const team = teamById(t, ctx.params.teamId);
    if (!team) throw notFound('Time não encontrado.');
    removeTeam(t, team, now);
    if (team.hasEmblem && !t.teams.some(x => x.id === team.id)) await ctx.store.del(K.emblem(t.id, team.id));
  }));

  route('POST', '/tournaments/:id/payments/:pid/refunded', ctx => mutate(ctx, ctx.params.id, (t, now) => {
    const p = t.payments.find(x => x.id === ctx.params.pid);
    if (!p) throw notFound('Pagamento não encontrado.');
    if (!p.needsRefund) throw conflict('Este pagamento não tem reembolso pendente.', 'STATE');
    p.needsRefund = false; p.status = 'refunded'; p.updatedAt = now;
    pushActivity(t, 'refund', 'Reembolso marcado como concluído.', now);
  }));

  // ------------------------------------------------------------ chaveamento e partidas
  route('POST', '/tournaments/:id/draw', ctx => mutate(ctx, ctx.params.id, async (t, now) => {
    const res = drawTournament(t, now);
    return { draw: { balance: res.balance, tried: res.tried, valid: res.valid, conflicts: res.conflicts, seed: res.seed, byes: res.byes } };
  }));

  route('POST', '/tournaments/:id/reset-bracket', ctx => mutate(ctx, ctx.params.id, (t, now) => {
    if (!ctx.body.confirm) throw badRequest('Confirmação necessária.', 'CONFIRM');
    if (!t.bracket) return;
    resetBracket(t, now);
    t.registrationOpen = false;
  }));

  route('POST', '/tournaments/:id/matches/:key', ctx => mutate(ctx, ctx.params.id, (t, now) => {
    if (!t.bracket) throw conflict('O chaveamento ainda não foi sorteado.', 'NO_BRACKET');
    const key = ctx.params.key;
    const match = key.startsWith('p:') ? t.playins.find(p => p.id === key.slice(2)) : (/^(\d+)-(\d+)$/.test(key) ? t.bracket.rounds[+key.split('-')[0]]?.[+key.split('-')[1]] : null);
    if (!match) throw notFound('Partida não encontrada.');
    applyAction(t, match, ctx.body, now);
  }));

  route('POST', '/tournaments/:id/donations', ctx => mutate(ctx, ctx.params.id, (t, now) => {
    const team = teamById(t, ctx.body.teamId);
    if (!team) throw notFound('Time não encontrado.');
    const amount = Number(ctx.body.amount);
    if (!Number.isInteger(amount) || amount < t.minDonation || amount > 1_000_000) throw badRequest('Valor da doação inválido.', 'VALIDATION', { field: 'amount' });
    const check = canRepesc(t, team);
    if (!check.ok) throw conflict(check.reason, 'NOT_ELIGIBLE');
    const cause = t.causes.includes(ctx.body.cause) ? ctx.body.cause : t.causes[0];
    t.payments.push({ id: 'pay_m' + now.toString(36), kind: 'donation', teamId: team.id, amount, method: 'manual', provider: 'manual', status: 'approved', createdAt: now, updatedAt: now, paidAt: now, expiresAt: now, meta: { cause } });
    registerDonation(t, team, { amount, cause, method: 'manual' }, now);
  }));

  route('PUT', '/tournaments/:id/stream', ctx => mutate(ctx, ctx.params.id, t => {
    const s = parseStream(ctx.body.url);
    if (s.error) throw badRequest(s.error, 'VALIDATION', { field: 'url' });
    t.stream = s.stream;
  }));
  route('DELETE', '/tournaments/:id/stream', ctx => mutate(ctx, ctx.params.id, t => { t.stream = null; }));

  route('POST', '/tournaments/:id/demo/simulate', ctx => mutate(ctx, ctx.params.id, (t, now) => {
    if (!t.demo) throw forbidden('A simulação só está disponível em torneios de demonstração.');
    simulatePhase(t, now);
  }));
}

/** Aceita links do YouTube e da Twitch; devolve dados para o player embutido. */
export function parseStream(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return { error: 'Link inválido. Cole o endereço completo, começando com https://' }; }
  if (u.protocol !== 'https:') return { error: 'Use um link https do YouTube ou da Twitch.' };
  const h = u.hostname.replace(/^www\.|^m\./, '');
  if (h === 'youtube.com' || h === 'youtu.be') {
    let id = h === 'youtu.be' ? u.pathname.slice(1) : (u.searchParams.get('v') || (u.pathname.match(/^\/(?:live|embed|shorts)\/([^/?]+)/) || [])[1]);
    if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return { error: 'Não encontramos o ID do vídeo neste link do YouTube.' };
    return { stream: { platform: 'youtube', id, url: u.href, label: 'YouTube' } };
  }
  if (h === 'twitch.tv') {
    const ch = u.pathname.split('/').filter(Boolean)[0];
    if (!ch || !/^[A-Za-z0-9_]{3,25}$/.test(ch)) return { error: 'Inclua o nome do canal da Twitch no link.' };
    return { stream: { platform: 'twitch', id: ch, url: u.href, label: 'Twitch' } };
  }
  return { error: 'Aceitamos apenas links do YouTube (youtube.com, youtu.be) ou da Twitch (twitch.tv).' };
}
