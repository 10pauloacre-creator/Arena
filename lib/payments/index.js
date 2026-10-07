import { mockProvider } from './mock.js';
import { createMercadoPagoProvider } from './mercadopago.js';

let override = null;
export function setProvider(p) { override = p; }

export function getProvider() {
  if (override) return override;
  if ((process.env.PAYMENT_PROVIDER || 'mock') === 'mercadopago') {
    if (!process.env.MP_ACCESS_TOKEN) {
      console.error('[pagamentos] PAYMENT_PROVIDER=mercadopago sem MP_ACCESS_TOKEN — usando modo de teste.');
      return mockProvider;
    }
    return createMercadoPagoProvider({ accessToken: process.env.MP_ACCESS_TOKEN, publicKey: process.env.MP_PUBLIC_KEY, publicBase: process.env.PUBLIC_BASE_URL });
  }
  return mockProvider;
}
