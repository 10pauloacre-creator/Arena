import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPixCode, crc16 } from '../../lib/payments/pixcode.js';
import { mockProvider } from '../../lib/payments/mock.js';
import { createMercadoPagoProvider, mapStatus } from '../../lib/payments/mercadopago.js';
import { luhn, validCPF, cardBrand } from '../../public/assets/js/shared/validators.js';

test('CRC16/CCITT-FALSE confere com o vetor de referência', () => {
  assert.equal(crc16('123456789'), '29B1');
});

test('BR Code: estrutura EMV, valor, país e CRC válido', () => {
  const code = buildPixCode({ key: 'chave@teste.invalid', name: 'Arena Master Ç', amountCents: 15050, txid: 'pay_ab-12' });
  assert.match(code, /^000201010212/);
  assert.ok(code.includes('BR.GOV.BCB.PIX'));
  assert.ok(code.includes('5406150.50'));
  assert.ok(code.includes('5802BR'));
  assert.ok(code.includes('ARENA MASTER C'), 'acentos removidos');
  const body = code.slice(0, -4);
  assert.equal(code.slice(-4), crc16(body));
  assert.ok(body.endsWith('6304'));
});

test('cartões de teste: aprova, recusa e valida Luhn/validade/CVV', async () => {
  const c = o => ({ number: '4242424242424242', name: 'FULANO', expiry: '12/39', cvv: '123', ...o });
  assert.equal((await mockProvider.chargeCard({ card: c() })).status, 'approved');
  assert.equal((await mockProvider.chargeCard({ card: c({ number: '4000000000000002' }) })).status, 'declined');
  assert.match((await mockProvider.chargeCard({ card: c({ number: '4000000000009995' }) })).failReason, /Saldo/);
  assert.match((await mockProvider.chargeCard({ card: c({ number: '4242424242424241' }) })).failReason, /inválido/);
  assert.match((await mockProvider.chargeCard({ card: c({ expiry: '1/2020' }) })).failReason, /vencido/);
  assert.match((await mockProvider.chargeCard({ card: c({ expiry: '13/30' }) })).failReason, /vencido|inválida/);
  assert.match((await mockProvider.chargeCard({ card: c({ cvv: '12' }) })).failReason, /segurança/);
  assert.match((await mockProvider.chargeCard({ card: c({ name: '' }) })).failReason, /nome/);
  const r = await mockProvider.chargeCard({ card: c() });
  assert.deepEqual(Object.keys(r.card).sort(), ['brand', 'last4']);
});

test('validadores: Luhn, CPF e bandeira', () => {
  assert.ok(luhn('4242 4242 4242 4242') && !luhn('4242 4242 4242 4241') && !luhn('123'));
  assert.ok(validCPF('529.982.247-25') && !validCPF('111.111.111-11') && !validCPF('529.982.247-24') && !validCPF(''));
  assert.equal(cardBrand('5555555555554444'), 'Mastercard');
  assert.equal(cardBrand('378282246310005'), 'Amex');
});

test('Mercado Pago: mapeia status e monta a requisição de PIX conforme a API', async () => {
  assert.equal(mapStatus('approved'), 'approved');
  assert.equal(mapStatus('in_process'), 'pending');
  assert.equal(mapStatus('rejected'), 'declined');
  assert.equal(mapStatus('xyz'), 'pending');

  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    if (init.method === 'POST') return { ok: true, status: 201, json: async () => ({ id: 987, status: 'pending', point_of_interaction: { transaction_data: { qr_code: 'COPIAECOLA', qr_code_base64: 'QkFTRTY0' } } }) };
    return { ok: true, status: 200, json: async () => ({ id: 987, status: 'approved', external_reference: 'AM-2026-1234:pay_1' }) };
  };
  const mp = createMercadoPagoProvider({ accessToken: 'TEST-token', publicKey: 'TEST-pub', fetchImpl: fakeFetch, publicBase: 'https://site.example' });
  assert.deepEqual(mp.publicConfig().methods, ['pix', 'card']);
  const payment = { id: 'pay_1', kind: 'registration', amount: 15050, expiresAt: Date.now() + 1800_000 };
  const out = await mp.createPix({ payment, tournament: { id: 'AM-2026-1234', name: 'Copa X' }, payer: { email: 'a@b.com', name: 'Fulano Silva' } });
  assert.equal(out.providerRef, '987');
  assert.equal(out.pix.code, 'COPIAECOLA');
  const call = calls[0];
  assert.equal(call.url, 'https://api.mercadopago.com/v1/payments');
  assert.equal(call.init.headers.Authorization, 'Bearer TEST-token');
  assert.equal(call.init.headers['X-Idempotency-Key'], 'pay_1');
  assert.equal(call.body.transaction_amount, 150.5);
  assert.equal(call.body.payment_method_id, 'pix');
  assert.equal(call.body.external_reference, 'AM-2026-1234:pay_1');
  assert.equal(call.body.notification_url, 'https://site.example/api/webhooks/mercadopago');
  assert.equal(call.body.payer.email, 'a@b.com');

  assert.equal(await mp.fetchStatus({ providerRef: '987' }), 'approved');
  const info = await mp.fetchById('987');
  assert.deepEqual(info, { status: 'approved', externalReference: 'AM-2026-1234:pay_1', providerRef: '987' });
  const card = await mp.chargeCard({ payment, tournament: { id: 'AM-2026-1234', name: 'Copa X' }, payer: { email: 'a@b.com' }, card: { token: 'tok', paymentMethodId: 'visa', installments: 1 } });
  assert.equal(card.providerRef, '987');
  assert.equal((await mp.chargeCard({ payment, tournament: { id: 'x', name: 'y' }, payer: { email: 'a@b.com' }, card: {} })).status, 'declined');
});

test('Mercado Pago: erro da API vira exceção legível', async () => {
  const fakeFetch = async () => ({ ok: false, status: 400, json: async () => ({ message: 'invalid payer' }) });
  const mp = createMercadoPagoProvider({ accessToken: 't', fetchImpl: fakeFetch, publicBase: 'https://x' });
  await assert.rejects(() => mp.createPix({ payment: { id: 'p', kind: 'registration', amount: 1000, expiresAt: Date.now() + 1000 }, tournament: { id: 'a', name: 'b' }, payer: { email: 'x' } }), /invalid payer/);
});
