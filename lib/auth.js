import { scrypt, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

const b64u = buf => Buffer.from(buf).toString('base64url');
const fromB64u = s => Buffer.from(s, 'base64url');

function scryptAsync(password, salt, keylen = 64) {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keylen, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => err ? reject(err) : resolve(key));
  });
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${b64u(salt)}$${b64u(key)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [alg, saltB64, keyB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = fromB64u(keyB64);
    const actual = await scryptAsync(password, fromB64u(saltB64), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}

/** Segredo de assinatura: variável AUTH_SECRET ou um valor aleatório persistido no banco. */
export async function getSecret(store) {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  let s = await store.get('meta:secret');
  if (!s) {
    const fresh = randomBytes(32).toString('hex');
    await store.setNX('meta:secret', fresh);
    s = (await store.get('meta:secret')) || fresh;
  }
  return s;
}

export function signToken(payload, secret) {
  const body = b64u(JSON.stringify(payload));
  const sig = b64u(createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  let given;
  try { given = fromB64u(sig); } catch { return null; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(fromB64u(body).toString('utf8'));
    if (!payload.exp || payload.exp < now) return null;
    return payload;
  } catch { return null; }
}

export const SESSION_COOKIE = 'am_session';
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

export function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    if (k) { try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignora */ } }
  });
  return out;
}

// Conta simplificada do módulo Pelada (nome + data de nascimento): sessão longa, para não deslogar o jogador.
export const PLAYER_COOKIE = 'pl_session';
export const PLAYER_TTL_MS = 365 * 24 * 3600 * 1000;

export function sessionCookie(token, { secure, clear = false, name = SESSION_COOKIE, ttlMs = SESSION_TTL_MS } = {}) {
  const parts = [`${name}=${clear ? '' : encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  parts.push(clear ? 'Max-Age=0' : `Max-Age=${Math.floor(ttlMs / 1000)}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// Geradores de ids/códigos: vivem em shared/rand.js (o navegador também precisa deles para aplicar ações offline).
export { randomCode, randomId, shortCode } from '../public/assets/js/shared/rand.js';
