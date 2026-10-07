import { createHash, timingSafeEqual } from 'node:crypto';
import { route, reply, raw } from '../router.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { K, loadTournament, withTournament, rateLimit } from '../repo.js';
import { registerTeam, parseEmblem } from '../domain/teams.js';
import { canRepesc, teamById } from '../domain/bracket.js';
import { openPayment, applyProviderResult, applyStatus, paymentById, paymentView } from '../domain/payments.js';
import { publicView, captainTeamView } from '../domain/views.js';
import { normalizeTournamentId, TOURNAMENT_ID_RE } from '../../public/assets/js/shared/format.js';
import { clientIp } from '../http.js';

const safeEq = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
};

function tid(ctx) {
  const id = normalizeTournamentId(ctx.params.id);
  if (!TOURNAMENT_ID_RE.test(id)) throw notFound('Torneio não encontrado. Confira o ID.');
  return id;
}

async function loadPublic(ctx) {
  const t = await loadTournament(ctx.store, tid(ctx));
  if (!t) throw notFound('Torneio não encontrado. Confira o ID.');
  return t;
}

function teamWithCode(t, teamId, code) {
  const team = teamById(t, teamId);
  if (!team || !safeEq(team.accessCode, code)) throw forbidden('Código de acesso do time inválido.');
  return team;
}

const payer = team => ({ email: team.captain.email, name: team.captain.name });

/** Cria a cobrança no provedor (PIX ou cartão) e aplica o resultado. Deve rodar dentro do lock do torneio. */
async function charge(ctx, t, team, { kind, method, amount, meta, card, now }) {
  const { payment, reused } = openPayment(t, { kind, team, method, amount, meta, provider: ctx.provider }, now);
  if (reused) return payment;
  try {
    if (method === 'pix') {
      const res = await ctx.provider.createPix({ payment, tournament: t, team, payer: payer(team), req: ctx.req });
      applyProviderResult(t, payment, { providerRef: res.providerRef, pix: res.pix }, now);
    } else {
      const res = await ctx.provider.chargeCard({ payment, tournament: t, team, payer: payer(team), card, req: ctx.req });
      applyProviderResult(t, payment, res, now);
    }
  } catch (err) {
    payment.status = 'declined';
    payment.failReason = 'Não foi possível processar o pagamento agora. Tente novamente.';
    console.error('[pagamento] falha no provedor:', err.message);
  }
  return payment;
}

export function registerPublicRoutes() {
  route('GET', '/config', async ctx => ({
    payments: ctx.provider.publicConfig(),
    storage: { kind: ctx.store.describe().kind, persistent: ctx.store.describe().persistent },
  }));

  route('GET', '/health', async ctx => ({ ok: true, storage: ctx.store.describe().kind, time: ctx.now }));

  route('GET', '/public/:id', async ctx => {
    const t = await loadPublic(ctx);
    const view = publicView(t, ctx.now);
    const { serverNow, ...rest } = view;
    const etag = 'W/"' + createHash('sha1').update(JSON.stringify(rest)).digest('base64url').slice(0, 20) + '"';
    if (ctx.req.headers['if-none-match'] === etag) return raw(304, '', { ETag: etag, 'Cache-Control': 'no-cache' });
    return reply(200, { tournament: view }, { ETag: etag, 'Cache-Control': 'no-cache' });
  });

  route('GET', '/public/:id/emblem/:teamId', async ctx => {
    const id = tid(ctx);
    const rec = await ctx.store.get(K.emblem(id, ctx.params.teamId));
    if (!rec) throw notFound('Emblema não encontrado.');
    return raw(200, Buffer.from(rec.b64, 'base64'), { 'Content-Type': rec.mime, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  });

  // ------------------------------------------------------------ inscrição
  route('POST', '/public/:id/teams', async ctx => {
    const id = tid(ctx);
    await rateLimit(ctx.store, `reg:${id}:${clientIp(ctx.req)}`, { max: 12, windowMs: 3600_000 });
    let created;
    await withTournament(ctx.store, id, async (t, now) => {
      const { team, emblem } = registerTeam(t, ctx.body, now);
      if (emblem) await ctx.store.set(K.emblem(t.id, team.id), emblem);
      created = { team, t, now };
    });
    return { team: { ...captainTeamView(created.t, created.team, created.now), accessCode: created.team.accessCode } };
  });

  route('GET', '/public/:id/teams/:teamId', async ctx => {
    const t = await loadPublic(ctx);
    const team = teamWithCode(t, ctx.params.teamId, ctx.query.code);
    return { team: captainTeamView(t, team, ctx.now), tournament: { id: t.id, name: t.name, fee: t.fee, minDonation: t.minDonation, causes: t.causes, donationEnabled: t.donationEnabled } };
  });

  route('POST', '/public/:id/teams/:teamId/pay', async ctx => {
    const id = tid(ctx);
    await rateLimit(ctx.store, `pay:${id}:${ctx.params.teamId}`, { max: 30, windowMs: 3600_000 });
    return withTournament(ctx.store, id, async (t, now) => {
      const team = teamWithCode(t, ctx.params.teamId, ctx.body.code);
      if (team.status === 'confirmed') throw conflict('A inscrição deste time já está confirmada.', 'ALREADY_PAID');
      if (team.status !== 'pending_payment') throw conflict('A reserva da vaga expirou. Faça a inscrição novamente.', 'EXPIRED');
      const payment = await charge(ctx, t, team, { kind: 'registration', method: ctx.body.method, amount: t.fee, meta: {}, card: ctx.body.card, now });
      return { payment: paymentView(payment), team: captainTeamView(t, team, now) };
    });
  });

  route('GET', '/public/:id/payments/:pid', async ctx => {
    const id = tid(ctx);
    const t0 = await loadPublic(ctx);
    const p0 = paymentById(t0, ctx.params.pid);
    if (!p0) throw notFound('Pagamento não encontrado.');
    teamWithCode(t0, p0.teamId, ctx.query.code);
    // provedores reais: consulta o status quando ainda pendente (o webhook costuma chegar antes)
    if (p0.status === 'pending' && !ctx.provider.mock && p0.provider === ctx.provider.name && ctx.provider.fetchStatus) {
      let st = 'pending';
      try { st = await ctx.provider.fetchStatus(p0); } catch (err) { console.error('[pagamento] consulta falhou:', err.message); }
      if (st !== 'pending') {
        return withTournament(ctx.store, id, async (t, now) => {
          const p = paymentById(t, p0.id);
          applyStatus(t, p, st, now);
          const team = teamById(t, p.teamId);
          return { payment: paymentView(p), team: captainTeamView(t, team, now) };
        });
      }
    }
    const team = teamById(t0, p0.teamId);
    return { payment: paymentView(p0), team: captainTeamView(t0, team, ctx.now) };
  });

  // Somente no modo de teste: simula a confirmação/recusa do PIX.
  route('POST', '/public/:id/payments/:pid/simulate', async ctx => {
    if (!ctx.provider.canSimulate) throw forbidden('A simulação de pagamento só existe no modo de teste.');
    const id = tid(ctx);
    return withTournament(ctx.store, id, async (t, now) => {
      const p = paymentById(t, ctx.params.pid);
      if (!p) throw notFound('Pagamento não encontrado.');
      const team = teamWithCode(t, p.teamId, ctx.body.code);
      if (p.method !== 'pix') throw badRequest('Apenas pagamentos PIX podem ser simulados.', 'VALIDATION');
      if (p.status !== 'pending') throw conflict('Este pagamento não está mais pendente.', 'STATE');
      applyStatus(t, p, ctx.body.outcome === 'decline' ? 'declined' : 'approved', now);
      return { payment: paymentView(p), team: captainTeamView(t, team, now) };
    });
  });

  // ------------------------------------------------------------ repescagem beneficente
  route('POST', '/public/:id/teams/:teamId/repescagem', async ctx => {
    const id = tid(ctx);
    await rateLimit(ctx.store, `rep:${id}:${ctx.params.teamId}`, { max: 20, windowMs: 3600_000 });
    return withTournament(ctx.store, id, async (t, now) => {
      const team = teamWithCode(t, ctx.params.teamId, ctx.body.code);
      const check = canRepesc(t, team);
      if (!check.ok) throw conflict(check.reason, 'NOT_ELIGIBLE');
      const amount = Number(ctx.body.amount);
      if (!Number.isInteger(amount) || amount < t.minDonation || amount > 1_000_000) throw badRequest('Valor da doação inválido.', 'VALIDATION', { field: 'amount' });
      if (!ctx.body.agree) throw badRequest('Confirme que entende as regras da repescagem.', 'VALIDATION', { field: 'agree' });
      const cause = t.causes.includes(ctx.body.cause) ? ctx.body.cause : t.causes[0];
      const payment = await charge(ctx, t, team, { kind: 'donation', method: ctx.body.method, amount, meta: { cause }, card: ctx.body.card, now });
      return { payment: paymentView(payment), team: captainTeamView(t, team, now) };
    });
  });
}
