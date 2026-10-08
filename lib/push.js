// Notificações push (Web Push) para a barra de notificações do aparelho, sem dependências: VAPID (RFC 8292) + criptografia aes128gcm (RFC 8291).
// As chaves VAPID são geradas na primeira vez e ficam no banco. Cada jogador pode ter alguns aparelhos inscritos.

import { createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, createCipheriv, randomBytes, sign } from 'node:crypto';
import { badRequest } from './errors.js';

const KEY_VAPID = 'pp:vapid';
const KEY_USERS = 'pp:users';
const subKey = uid => `pps:${uid}`;
export const MAX_SUBS = 5;
const SUBJECT = process.env.PUSH_SUBJECT || 'mailto:contato@arenamaster.ai';
/** Serviços de push dos navegadores: o servidor só envia para eles (evita usar a inscrição para acessar endereços internos). */
const ALLOWED_HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)mozilla\.(com|org)$/, /(^|\.)windows\.com$/, /(^|\.)apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/];

const b64u = buf => Buffer.from(buf).toString('base64url');
const unb64u = s => Buffer.from(String(s), 'base64url');

/** Chaves VAPID: { pub (base64url, 65 bytes), jwk privada }. Criadas uma única vez. */
export async function getVapid(store) {
  const cur = await store.get(KEY_VAPID);
  if (cur) return cur;
  const release = await store.lock(KEY_VAPID);
  try {
    const again = await store.get(KEY_VAPID);
    if (again) return again;
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pj = publicKey.export({ format: 'jwk' });
    const v = { pub: b64u(Buffer.concat([Buffer.from([4]), unb64u(pj.x), unb64u(pj.y)])), jwk: privateKey.export({ format: 'jwk' }) };
    await store.set(KEY_VAPID, v);
    return v;
  } finally { await release(); }
}

function vapidHeader(vapid, endpoint) {
  const aud = new URL(endpoint).origin;
  const enc = o => b64u(JSON.stringify(o));
  const data = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })}`;
  const sig = sign('sha256', Buffer.from(data), { key: createPrivateKey({ key: vapid.jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64u(sig)}, k=${vapid.pub}`;
}

/** Criptografa o conteúdo para a inscrição (RFC 8291, aes128gcm). */
export function encryptPayload(sub, payload) {
  const uaPublic = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPublic);
  const salt = randomBytes(16);
  const prk = Buffer.from(hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/** Envia um aviso. Retorna { ok, gone } (gone = inscrição inválida, deve ser apagada). */
export async function sendPush(vapid, sub, message, { timeoutMs = 4000, ttl = 3600 } = {}) {
  const body = encryptPayload(sub, JSON.stringify(message));
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST', body, signal: ctl.signal,
      headers: { Authorization: vapidHeader(vapid, sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: 'normal' },
    });
    return { ok: res.ok, gone: res.status === 404 || res.status === 410, status: res.status };
  } catch { return { ok: false, gone: false, status: 0 }; } finally { clearTimeout(t); }
}

// ---------------------------------------------------------------- inscrições
export function checkSubscription(s) {
  let url;
  try { url = new URL(s?.endpoint); } catch { throw badRequest('Inscrição de notificações inválida.', 'VALIDATION'); }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.some(re => re.test(url.hostname))) throw badRequest('Este navegador usa um serviço de notificações não suportado.', 'VALIDATION');
  const p = s.keys?.p256dh, a = s.keys?.auth;
  if (typeof p !== 'string' || typeof a !== 'string' || unb64u(p).length !== 65 || unb64u(a).length < 8 || unb64u(a).length > 32) throw badRequest('Inscrição de notificações inválida.', 'VALIDATION');
  return { endpoint: url.toString(), keys: { p256dh: p, auth: a } };
}

export const listSubs = async (store, uid) => (await store.get(subKey(uid))) || [];

export async function addSub(store, uid, raw, now) {
  const sub = { ...checkSubscription(raw), at: now };
  const release = await store.lock(KEY_USERS);
  try {
    const list = (await listSubs(store, uid)).filter(x => x.endpoint !== sub.endpoint);
    list.push(sub);
    await store.set(subKey(uid), list.slice(-MAX_SUBS));
    const users = (await store.get(KEY_USERS)) || [];
    if (!users.includes(uid)) await store.set(KEY_USERS, [...users, uid]);
  } finally { await release(); }
}

export async function removeSub(store, uid, endpoint) {
  const release = await store.lock(KEY_USERS);
  try {
    const list = (await listSubs(store, uid)).filter(x => endpoint ? x.endpoint !== endpoint : false);
    if (list.length) await store.set(subKey(uid), list); else {
      await store.del(subKey(uid));
      const users = ((await store.get(KEY_USERS)) || []).filter(x => x !== uid);
      await store.set(KEY_USERS, users);
    }
  } finally { await release(); }
}

/** Quem tem aparelhos inscritos (para filtrar os participantes de uma pelada sem consultar um por um). */
export async function subscribedUsers(store) { return new Set((await store.get(KEY_USERS)) || []); }

/** Envia a mensagem a todos os aparelhos de `uid`; apaga as inscrições que o serviço recusou como inexistentes. */
export async function pushToUser(store, vapid, uid, message) {
  const subs = await listSubs(store, uid);
  if (!subs.length) return 0;
  const results = await Promise.all(subs.map(s => sendPush(vapid, s, message)));
  const dead = subs.filter((_, i) => results[i].gone);
  if (dead.length) {
    const keep = subs.filter(s => !dead.includes(s));
    const release = await store.lock(KEY_USERS);
    try {
      if (keep.length) await store.set(subKey(uid), keep); else {
        await store.del(subKey(uid));
        await store.set(KEY_USERS, ((await store.get(KEY_USERS)) || []).filter(x => x !== uid));
      }
    } finally { await release(); }
  }
  return results.filter(r => r.ok).length;
}
