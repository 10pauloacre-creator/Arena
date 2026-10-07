import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, signup, teamInput } from './helpers.js';
import { setProvider } from '../../lib/payments/index.js';
import { createMercadoPagoProvider } from '../../lib/payments/mercadopago.js';

let S;
before(async () => { S = await startServer(); });
after(async () => { await S.close(); });

test('fluxo completo com provedor "real" simulado: PIX → webhook → time confirmado (idempotente)', async () => {
  const state = { payments: new Map(), nextId: 5000 };
  const fakeFetch = async (url, init) => {
    const method = init.method;
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      const id = state.nextId++;
      state.payments.set(String(id), { id, status: 'pending', external_reference: body.external_reference });
      return { ok: true, status: 201, json: async () => ({ id, status: 'pending', point_of_interaction: { transaction_data: { qr_code: '00020126FAKE', qr_code_base64: 'QUJD' } } }) };
    }
    const id = url.split('/').pop();
    const p = state.payments.get(id);
    return p ? { ok: true, status: 200, json: async () => p } : { ok: false, status: 404, json: async () => ({ message: 'not found' }) };
  };
  setProvider(createMercadoPagoProvider({ accessToken: 'TEST-x', publicKey: null, fetchImpl: fakeFetch, publicBase: 'https://site.example' }));
  try {
    const org = await signup(S.base);
    const t = (await org.post('/tournaments', { name: 'Copa Webhook', sport: 'futsal' })).data.tournament;
    await org.patch(`/tournaments/${t.id}`, { fee: 7000 });
    const v = new Client(S.base);
    const cfg = (await v.get('/config')).data;
    assert.equal(cfg.payments.mock, false);
    assert.deepEqual(cfg.payments.methods, ['pix']); // sem chave pública, só PIX

    const reg = (await v.post(`/public/${t.id}/teams`, teamInput('Webhook FC', 'futsal'))).data.team;
    // cartão indisponível sem chave pública
    assert.equal((await v.post(`/public/${t.id}/teams/${reg.id}/pay`, { code: reg.accessCode, method: 'card', card: {} })).status, 400);
    const pay = (await v.post(`/public/${t.id}/teams/${reg.id}/pay`, { code: reg.accessCode, method: 'pix' })).data.payment;
    assert.equal(pay.mock, false);
    assert.equal(pay.pix.code, '00020126FAKE');
    assert.equal(pay.pix.qrBase64, 'QUJD');
    // simulação é proibida fora do modo de teste
    assert.equal((await v.post(`/public/${t.id}/payments/${pay.id}/simulate`, { code: reg.accessCode })).status, 403);

    // webhook antes do pagamento: nada muda
    await v.post('/webhooks/mercadopago', { type: 'payment', data: { id: '5000' } });
    assert.equal((await org.get(`/tournaments/${t.id}`)).data.tournament.teams[0].status, 'pending_payment');

    // o cliente paga; o MP notifica
    state.payments.get('5000').status = 'approved';
    const hook = await v.post('/webhooks/mercadopago?type=payment&data.id=5000', {});
    assert.equal(hook.status, 200);
    const adm = (await org.get(`/tournaments/${t.id}`)).data.tournament;
    assert.equal(adm.teams[0].status, 'confirmed');
    assert.equal(adm.teams[0].paidVia, 'pix');
    assert.equal(adm.stats.revenue, 7000);
    // notificações repetidas não duplicam
    await v.post('/webhooks/mercadopago', { type: 'payment', data: { id: '5000' } });
    assert.equal((await org.get(`/tournaments/${t.id}`)).data.tournament.stats.revenue, 7000);
    // id desconhecido: ignorado
    assert.equal((await v.post('/webhooks/mercadopago', { type: 'payment', data: { id: '999999' } })).status, 500);

    // consulta de status pelo capitão também sincroniza (webhook perdido)
    const reg2 = (await v.post(`/public/${t.id}/teams`, teamInput('Sincroniza FC', 'futsal', { offset: 3 }))).data.team;
    const pay2 = (await v.post(`/public/${t.id}/teams/${reg2.id}/pay`, { code: reg2.accessCode, method: 'pix' })).data.payment;
    state.payments.get('5001').status = 'approved';
    const poll = await v.get(`/public/${t.id}/payments/${pay2.id}?code=${reg2.accessCode}`);
    assert.equal(poll.data.payment.status, 'approved');
    assert.equal(poll.data.team.status, 'confirmed');
  } finally { setProvider(null); }
});
