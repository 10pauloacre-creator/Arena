import { route } from '../router.js';
import { withTournament } from '../repo.js';
import { applyStatus, paymentById } from '../domain/payments.js';

export function registerWebhookRoutes() {
  // Notificação do Mercado Pago. Não confiamos no corpo: consultamos o pagamento na API com nosso token.
  route('POST', '/webhooks/mercadopago', async ctx => {
    if (!ctx.provider.fetchById) return { ok: true, ignored: true };
    const q = ctx.query;
    const id = ctx.body?.data?.id || q['data.id'] || q.id;
    const type = ctx.body?.type || q.type || q.topic;
    if (!id || (type && type !== 'payment')) return { ok: true, ignored: true };

    const info = await ctx.provider.fetchById(String(id)); // erro => 500 => o Mercado Pago tenta de novo
    const [tournamentId, paymentId] = String(info.externalReference).split(':');
    if (!tournamentId || !paymentId) return { ok: true, ignored: true };
    try {
      await withTournament(ctx.store, tournamentId, async (t, now) => {
        const p = paymentById(t, paymentId);
        if (!p) return;
        if (!p.providerRef) p.providerRef = info.providerRef;
        applyStatus(t, p, info.status, now);
      });
    } catch (err) {
      if (err.status === 404) return { ok: true, ignored: true };
      throw err;
    }
    return { ok: true };
  }, { external: true });
}
