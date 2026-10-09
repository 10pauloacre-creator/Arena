import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { route, reply, raw } from '../router.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { K, loadTournament, withTournament, rateLimit, rateLimitPeek } from '../repo.js';
import { registerTeam } from '../domain/teams.js';
import { canRepesc, teamById } from '../domain/bracket.js';
import { openPayment, applyProviderResult, applyStatus, paymentById, paymentView } from '../domain/payments.js';
import { publicView, captainTeamView } from '../domain/views.js';
import { normalizeTournamentId, TOURNAMENT_ID_RE } from '../../public/assets/js/shared/format.js';
import { clientIp } from '../http.js';
import { findMatchBySlug, matchPath, matchTitle } from '../../public/assets/js/shared/matchlink.js';
import { injectMeta } from '../domain/pelada-share.js';
import { flyerAvailable, flyerData, flyerVersion, renderFlyerPng } from '../domain/match-flyer.js';
import { storageNote } from '../store/index.js';

const safeEq = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
};

const codeOf = ctx => String(ctx.req.headers['x-team-code'] ?? ctx.query.code ?? '');

function tid(ctx) {
  const id = normalizeTournamentId(ctx.params.id);
  if (!TOURNAMENT_ID_RE.test(id)) throw notFound('Torneio não encontrado. Confira o ID.');
  return id;
}

const INDEX_HTML = fileURLToPath(new URL('../../public/index.html', import.meta.url));
async function indexHtml(ctx) {
  try { return await readFile(INDEX_HTML, 'utf8'); } catch { /* cai para o arquivo publicado */ }
  const res = await fetch(new URL('/index.html', ctx.base));
  if (!res.ok) throw new Error(`index.html do app indisponível (${res.status})`);
  return res.text();
}

const PHASE_TEXT = { live: 'Ao vivo', paused: 'Em andamento', finished: 'Encerrada', scheduled: 'Agendada' };

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

/** Igual a teamWithCode, mas limita tentativas erradas (por IP e por time) contra adivinhação do código. */
async function teamAuth(ctx, t, teamId, code) {
  const ipKey = `tc:${t.id}:${teamId}:${clientIp(ctx.req)}`, teamKey = `tcg:${t.id}:${teamId}`;
  await rateLimitPeek(ctx.store, ipKey, { max: 10 });
  await rateLimitPeek(ctx.store, teamKey, { max: 60 });
  try { return teamWithCode(t, teamId, code); }
  catch (err) {
    await rateLimit(ctx.store, ipKey, { max: 10, windowMs: 10 * 60_000 });
    await rateLimit(ctx.store, teamKey, { max: 60, windowMs: 3600_000 });
    throw err;
  }
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
    storage: { kind: ctx.store.describe().kind, persistent: ctx.store.describe().persistent, ...(ctx.store.describe().persistent ? {} : { note: storageNote() }) },
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

  // Página do link de uma partida (/AM-2026-9843/flamengo-x-vasco): o app de sempre, com a pré-visualização do jogo nas metatags.
  route('GET', '/match-page/:id/:slug', async ctx => {
    const html = await indexHtml(ctx);
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
    const id = normalizeTournamentId(ctx.params.id);
    const t0 = TOURNAMENT_ID_RE.test(id) ? await loadTournament(ctx.store, id) : null;
    if (!t0) return raw(404, html, headers);
    const t = publicView(t0, ctx.now);
    const m = findMatchBySlug(t, ctx.params.slug);
    if (!m) return raw(200, html, headers);
    const title = matchTitle(t, m);
    const score = m.score && m.a && m.b ? `${m.score.a} × ${m.score.b}` : null;
    const state = PHASE_TEXT[m.phase] || null;
    const description = [state, score, m.roundName, t.name].filter(Boolean).join(' · ') + '. Acompanhe esta partida no ArenaMaster AI.';
    // imagem do cartão: o flyer do confronto (PNG montado pelo servidor); sem ele, o emblema ou o ícone do app
    let image = `${ctx.base}/pelada/icons/icon-512.png`, large = false;
    if (m.a && m.b && await flyerAvailable()) {
      const v = flyerVersion(await flyerData(ctx.store, t, m));
      image = `${ctx.base}/api/public/${t.id}/match-flyer/${encodeURIComponent(ctx.params.slug)}?f=og&v=${v}`; large = true;
    }
    return raw(200, injectMeta(html, {
      title: `${title} · ${t.name}`, description, siteName: 'ArenaMaster AI', large, image,
      url: ctx.base + matchPath(t, m.key),
    }), headers);
  });

  // Flyer do confronto em PNG: ?f=og|feed|story, &dl=1 para baixar. Com ?v= (versão do conteúdo) a imagem pode ficar em cache.
  route('GET', '/public/:id/match-flyer/:slug', async ctx => {
    const t0 = await loadPublic(ctx);
    const t = publicView(t0, ctx.now);
    const m = findMatchBySlug(t, ctx.params.slug);
    if (!m || !m.a || !m.b) throw notFound('Partida não encontrada.');
    const format = ['og', 'feed', 'story'].includes(ctx.query.f) ? ctx.query.f : 'og';
    const png = await renderFlyerPng(await flyerData(ctx.store, t, m), format);
    if (!png) throw conflict('A imagem do confronto não está disponível agora.', 'UNAVAILABLE');
    const headers = { 'Content-Type': 'image/png', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': ctx.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=60' };
    if (ctx.query.dl) headers['Content-Disposition'] = `attachment; filename="${ctx.params.slug.replace(/[^a-z0-9-]/gi, '')}-${format}.png"`;
    return raw(200, png, headers);
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

  const tournamentMini = t => ({ id: t.id, name: t.name, fee: t.fee, minDonation: t.minDonation, causes: t.causes, donationEnabled: t.donationEnabled });

  route('GET', '/public/:id/teams/:teamId', async ctx => {
    const t = await loadPublic(ctx);
    const team = await teamAuth(ctx, t, ctx.params.teamId, codeOf(ctx));
    return { team: captainTeamView(t, team, ctx.now), tournament: tournamentMini(t) };
  });

  // Acesso em outro aparelho: o capitão informa só o código do time.
  route('POST', '/public/:id/my-team', async ctx => {
    const id = tid(ctx);
    await rateLimit(ctx.store, `myteam:${id}:${clientIp(ctx.req)}`, { max: 15, windowMs: 10 * 60_000 });
    const t = await loadPublic(ctx);
    const code = String(ctx.body.code || '').trim().toUpperCase().replace(/\s+/g, '');
    const team = code.length >= 6 ? t.teams.find(x => safeEq(x.accessCode, code)) : null;
    if (!team) throw forbidden('Código não encontrado neste torneio. Confira as letras e números.');
    return { team: captainTeamView(t, team, ctx.now), tournament: tournamentMini(t) };
  });

  route('POST', '/public/:id/teams/:teamId/pay', async ctx => {
    const id = tid(ctx);
    await rateLimit(ctx.store, `pay:${id}:${ctx.params.teamId}`, { max: 30, windowMs: 3600_000 });
    return withTournament(ctx.store, id, async (t, now) => {
      const team = await teamAuth(ctx, t, ctx.params.teamId, ctx.body.code);
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
    await teamAuth(ctx, t0, p0.teamId, codeOf(ctx));
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
      const team = await teamAuth(ctx, t, p.teamId, ctx.body.code);
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
      const team = await teamAuth(ctx, t, ctx.params.teamId, ctx.body.code);
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
