// Provedor Mercado Pago (PIX + cartão). Ativado com PAYMENT_PROVIDER=mercadopago e MP_ACCESS_TOKEN.
// Documentação: https://www.mercadopago.com.br/developers/pt/reference/payments/_payments/post
// ATENÇÃO: esta integração segue a documentação oficial, mas só pôde ser validada contra uma API simulada.
// Teste com as credenciais de TESTE do Mercado Pago antes de cobrar valores reais.

import { baseUrl } from '../http.js';

const API = 'https://api.mercadopago.com';

const STATUS_MAP = {
  approved: 'approved', authorized: 'pending', pending: 'pending', in_process: 'pending', in_mediation: 'pending',
  rejected: 'declined', cancelled: 'cancelled', refunded: 'refunded', charged_back: 'refunded', expired: 'expired',
};
export const mapStatus = s => STATUS_MAP[s] || 'pending';

export function createMercadoPagoProvider({ accessToken, publicKey, fetchImpl = globalThis.fetch, publicBase }) {
  async function call(method, path, body, idempotencyKey) {
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
    if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
    const res = await fetchImpl(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.message || data?.error || `HTTP ${res.status}`;
      const err = new Error(`Mercado Pago: ${msg}`);
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }

  const common = ({ payment, tournament, payer, req }) => ({
    transaction_amount: Number((payment.amount / 100).toFixed(2)),
    description: `${payment.kind === 'donation' ? 'Doação' : 'Inscrição'} · ${tournament.name}`.slice(0, 200),
    external_reference: `${tournament.id}:${payment.id}`,
    notification_url: `${publicBase || (req ? baseUrl(req) : '')}/api/webhooks/mercadopago`,
    payer: { email: payer.email, first_name: (payer.name || '').split(' ')[0] || undefined },
  });

  return {
    name: 'mercadopago',
    mock: false,
    canSimulate: false,
    publicConfig() { return { name: 'mercadopago', mock: false, publicKey: publicKey || null, methods: publicKey ? ['pix', 'card'] : ['pix'] }; },

    async createPix(args) {
      const { payment } = args;
      const data = await call('POST', '/v1/payments', {
        ...common(args), payment_method_id: 'pix',
        date_of_expiration: new Date(payment.expiresAt).toISOString().replace('Z', '-00:00'),
      }, payment.id);
      const td = data?.point_of_interaction?.transaction_data || {};
      return { providerRef: String(data.id), pix: { code: td.qr_code, qrBase64: td.qr_code_base64 } };
    },

    /** `card` = { token, paymentMethodId, issuerId, installments } — gerado no navegador pelo SDK do Mercado Pago. */
    async chargeCard(args) {
      const { payment, card } = args;
      if (!card?.token) return { status: 'declined', failReason: 'Cartão não tokenizado.', card: {} };
      const data = await call('POST', '/v1/payments', {
        ...common(args), token: card.token, installments: Number(card.installments) || 1,
        payment_method_id: card.paymentMethodId, issuer_id: card.issuerId || undefined,
      }, payment.id);
      const status = mapStatus(data.status);
      return {
        status, providerRef: String(data.id),
        failReason: status === 'declined' ? `Pagamento recusado (${data.status_detail || 'rejeitado'}).` : undefined,
        card: { brand: data.payment_method_id || 'Cartão', last4: data.card?.last_four_digits || '' },
      };
    },

    async fetchStatus(payment) {
      if (!payment.providerRef) return 'pending';
      const data = await call('GET', `/v1/payments/${encodeURIComponent(payment.providerRef)}`);
      return mapStatus(data.status);
    },

    /** Usado pelo webhook: busca o pagamento pelo ID do Mercado Pago e devolve { status, externalReference }. */
    async fetchById(id) {
      const data = await call('GET', `/v1/payments/${encodeURIComponent(id)}`);
      return { status: mapStatus(data.status), externalReference: data.external_reference || '', providerRef: String(data.id) };
    },
  };
}
