// Notificações push (Web Push): criptografia RFC 8291 + VAPID verificados por um "serviço de push" falso, inscrições e envio nos eventos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createDecipheriv, createPublicKey, verify, hkdfSync, randomBytes } from 'node:crypto';
import { startServer, Client } from './helpers.js';
import { setClock } from '../../lib/clock.js';
import { encryptPayload } from '../../lib/push.js';

let srv;
const realFetch = globalThis.fetch;
const sent = [];
before(async () => {
  srv = await startServer();
  // intercepta só os envios para o serviço de push falso; o resto segue para o servidor de teste
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://fcm.googleapis.com/')) { sent.push({ url: String(url), headers: init.headers, body: Buffer.from(init.body) }); return new Response(null, { status: String(url).endsWith('/gone') ? 410 : 201 }); }
    return realFetch(url, init);
  };
});
after(async () => { globalThis.fetch = realFetch; setClock(null); await srv.close(); });

/** Navegador falso: gera as chaves da inscrição e sabe decifrar o que o servidor envia (RFC 8291). */
function browser() {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const auth = randomBytes(16);
  const keys = { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
  const decrypt = body => {
    const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
    const secret = ecdh.computeSecret(asPublic);
    const prk = Buffer.from(hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]), 32));
    const cek = Buffer.from(hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
    const nonce = Buffer.from(hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const d = createDecipheriv('aes-128-gcm', cek, nonce);
    d.setAuthTag(ct.subarray(ct.length - 16));
    const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
    assert.equal(plain.at(-1), 2, 'delimitador de preenchimento');
    return JSON.parse(plain.subarray(0, -1).toString());
  };
  return { keys, decrypt };
}

let n = 0;
async function newPlayer(name) {
  const c = new Client(srv.base);
  const r = await c.post('/pelada/auth/signup', { name: name ?? `Push Jogador ${++n}`, birth: '15/05/1992' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  c.player = r.data.player;
  return c;
}
const todayIso = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

test('criptografia aes128gcm: o navegador decifra exatamente o que o servidor enviou', () => {
  const b = browser();
  const msg = { title: 'Resultado', text: 'Time 1 3 × 1 Time 2 🎉', url: '/pelada/p/PL-ABCDEF' };
  const body = encryptPayload({ endpoint: 'https://fcm.googleapis.com/x', keys: b.keys }, JSON.stringify(msg));
  assert.deepEqual(b.decrypt(body), msg);
  assert.notDeepEqual(encryptPayload({ endpoint: 'x', keys: b.keys }, '{}'), encryptPayload({ endpoint: 'x', keys: b.keys }, '{}'), 'sal e chave efêmera mudam a cada envio');
});

test('inscrições: só serviços de push dos navegadores, chaves válidas; aviso de teste vai cifrado com VAPID válido', async () => {
  const c = await newPlayer();
  assert.equal((await c.get('/pelada/push/key')).status, 200);
  const key = (await c.get('/pelada/push/key')).data.key;
  assert.equal(Buffer.from(key, 'base64url').length, 65);
  assert.equal((await new Client(srv.base).get('/pelada/push/key')).status, 401);
  const b = browser();
  const bad = [
    { endpoint: 'http://fcm.googleapis.com/x', keys: b.keys },
    { endpoint: 'https://127.0.0.1/x', keys: b.keys },
    { endpoint: 'https://evil.example.com/x', keys: b.keys },
    { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'AAAA', auth: b.keys.auth } },
    { endpoint: 'lixo', keys: b.keys }, null,
  ];
  for (const subscription of bad) assert.equal((await c.post('/pelada/push/subscribe', { subscription })).status, 400, JSON.stringify(subscription));
  assert.equal((await c.post('/pelada/push/test')).status, 400, 'sem aparelho inscrito');
  assert.equal((await c.post('/pelada/push/subscribe', { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: b.keys } })).status, 200);
  sent.length = 0;
  assert.equal((await c.post('/pelada/push/test')).status, 200);
  assert.equal(sent.length, 1);
  const s = sent[0];
  assert.equal(s.headers['Content-Encoding'], 'aes128gcm');
  assert.match(b.decrypt(s.body).title, /Notificações ativadas/);
  // VAPID: JWT ES256 assinado com a chave que o navegador recebeu em /push/key
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(s.headers.Authorization);
  assert.equal(k, key);
  const [h, p, sig] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(h, 'base64url')).alg, 'ES256');
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).aud, 'https://fcm.googleapis.com');
  const raw = Buffer.from(key, 'base64url');
  const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), 'assinatura VAPID');
  // sair: some o aparelho
  assert.equal((await c.post('/pelada/push/unsubscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' })).status, 200);
  assert.equal((await c.post('/pelada/push/test')).status, 400);
});

test('eventos da pelada viram aviso no aparelho de quem participa (menos de quem fez a ação, de quem silenciou e de quem desligou o tipo)', async () => {
  const owner = await newPlayer('Dona Push Silva');
  const r = await owner.post('/pelada/peladas', { name: 'Pelada Push', gender: 'feminino', minPerTeam: 2, matchMinutes: 10, days: [{ date: todayIso() }] });
  const id = r.data.pelada.id, dayId = r.data.pelada.days[0].id;
  const ana = await newPlayer('Ana Push Souza'), bia = await newPlayer('Bia Push Souza'), carla = await newPlayer('Carla Push Souza');
  for (const c of [ana, bia, carla]) assert.equal((await c.post(`/pelada/peladas/${id}/join`)).status, 200);
  const devices = new Map();
  for (const [c, name] of [[owner, 'owner'], [ana, 'ana'], [bia, 'bia'], [carla, 'carla']]) {
    const b = browser(); devices.set(name, b);
    assert.equal((await c.post('/pelada/push/subscribe', { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: b.keys } })).status, 200);
  }
  await bia.patch('/pelada/notifications/prefs', { muted: [id] });
  await carla.patch('/pelada/notifications/prefs', { types: { presence: false } });
  sent.length = 0;
  assert.equal((await ana.post(`/pelada/peladas/${id}/days/${dayId}/presence`, { present: true })).status, 200);
  const got = new Map(sent.map(s => [s.url.split('/').pop(), devices.get(s.url.split('/').pop()).decrypt(s.body)]));
  assert.deepEqual([...got.keys()], ['owner'], 'só a organizadora: Ana é quem agiu, Bia silenciou e Carla desligou presenças');
  assert.match(got.get('owner').text, /confirmou presença/);
  assert.match(got.get('owner').url, new RegExp(id));
  // inscrição que o serviço diz não existir mais é apagada
  const g = browser();
  await ana.post('/pelada/push/subscribe', { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/gone', keys: g.keys } });
  sent.length = 0;
  const guest = n => owner.post(`/pelada/peladas/${id}/days/${dayId}/guests`, { name: `Convidada ${n} Teste` });
  assert.equal((await guest('A')).status, 200);
  assert.equal(sent.filter(s => s.url.endsWith('/gone')).length, 1);
  sent.length = 0;
  assert.equal((await guest('B')).status, 200);
  assert.equal(sent.filter(s => s.url.endsWith('/gone')).length, 0, 'inscrição expirada foi removida');
  assert.ok(sent.some(s => s.url.endsWith('/ana')), 'o outro aparelho da Ana continua recebendo');
});
