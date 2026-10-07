// Provedor de pagamentos em MODO DE TESTE: nenhum valor é cobrado e nenhum dado de cartão é guardado.

import { luhn, cardBrand } from '../../public/assets/js/shared/validators.js';
import { buildPixCode } from './pixcode.js';
import { randomId } from '../auth.js';

export const mockProvider = {
  name: 'mock',
  mock: true,
  canSimulate: true,
  publicConfig() { return { name: 'mock', mock: true, publicKey: null, methods: ['pix', 'card'] }; },

  async createPix({ payment }) {
    const code = buildPixCode({ key: 'pagamento-teste@arenamaster.invalid', name: 'ARENAMASTER MODO TESTE', amountCents: payment.amount, txid: payment.id.replace(/[^A-Za-z0-9]/g, '') });
    return { providerRef: randomId('mock_'), pix: { code } };
  },

  /** Cartões de teste: 4242 4242 4242 4242 aprova · 4000 0000 0000 0002 recusa · 4000 0000 0000 9995 sem saldo. */
  async chargeCard({ card }) {
    const digits = String(card?.number || '').replace(/\D/g, '');
    const brand = cardBrand(digits), last4 = digits.slice(-4);
    if (!luhn(digits)) return { status: 'declined', failReason: 'Número de cartão inválido.', card: { brand, last4 } };
    const m = /^(\d{1,2})\s*\/\s*(\d{2,4})$/.exec(String(card?.expiry || ''));
    if (!m) return { status: 'declined', failReason: 'Validade inválida (use MM/AA).', card: { brand, last4 } };
    const month = +m[1], year = m[2].length === 2 ? 2000 + +m[2] : +m[2];
    const now = new Date();
    if (month < 1 || month > 12 || year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) return { status: 'declined', failReason: 'Cartão vencido.', card: { brand, last4 } };
    if (!/^\d{3,4}$/.test(String(card?.cvv || ''))) return { status: 'declined', failReason: 'Código de segurança inválido.', card: { brand, last4 } };
    if (String(card?.name || '').trim().length < 3) return { status: 'declined', failReason: 'Informe o nome impresso no cartão.', card: { brand, last4 } };
    if (digits === '4000000000000002') return { status: 'declined', failReason: 'Cartão recusado pelo emissor.', card: { brand, last4 } };
    if (digits === '4000000000009995') return { status: 'declined', failReason: 'Saldo insuficiente.', card: { brand, last4 } };
    return { status: 'approved', providerRef: randomId('mock_'), card: { brand, last4 } };
  },

  async fetchStatus() { return 'pending'; },
};
