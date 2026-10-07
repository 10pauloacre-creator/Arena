// Acesso a dados: usuários, torneios, índices e locks.

import { notFound, conflict, tooMany } from '../public/assets/js/shared/errors.js';
import { now as clockNow } from './clock.js';
import { expireReservations } from '../public/assets/js/shared/domain/teams.js';
import { expirePayments } from '../public/assets/js/shared/domain/payments.js';

export const K = {
  user: id => `u:${id}`,
  email: e => `e:${e}`,
  tour: id => `t:${id}`,
  userTours: uid => `ut:${uid}`,
  emblem: (tid, teamId) => `emb:${tid}:${teamId}`,
  invite: code => `inv:${code}`,
};

export const getUser = (store, id) => store.get(K.user(id));
export async function getUserByEmail(store, email) {
  const id = await store.get(K.email(email));
  return id ? getUser(store, id) : null;
}

export async function createUser(store, user) {
  const claimed = await store.setNX(K.email(user.email), user.id);
  if (!claimed) throw conflict('Este e-mail já está cadastrado. Faça login.', 'EMAIL_TAKEN', { field: 'email' });
  await store.set(K.user(user.id), user);
  return user;
}

export const loadTournament = (store, id) => store.get(K.tour(id));

/**
 * Executa `fn(t)` com o torneio bloqueado (escrita serializada), salva e devolve o resultado.
 * Se `fn` lançar um erro com `persist = true`, as alterações feitas ainda são salvas.
 */
export async function withTournament(store, id, fn) {
  const release = await store.lock(K.tour(id));
  try {
    const t = await store.get(K.tour(id));
    if (!t) throw notFound('Torneio não encontrado.');
    const now = clockNow();
    expireReservations(t, now);
    expirePayments(t, now);
    let result;
    try { result = await fn(t, now); }
    catch (err) {
      if (err && err.persist) { t.version++; t.updatedAt = now; await store.set(K.tour(id), t); }
      throw err;
    }
    t.version++; t.updatedAt = now;
    await store.set(K.tour(id), t);
    return result;
  } finally { await release(); }
}

export async function addToUserIndex(store, userId, tid) {
  const release = await store.lock(K.userTours(userId));
  try {
    const list = (await store.get(K.userTours(userId))) || [];
    if (!list.includes(tid)) { list.push(tid); await store.set(K.userTours(userId), list); }
  } finally { await release(); }
}
export async function removeFromUserIndex(store, userId, tid) {
  const release = await store.lock(K.userTours(userId));
  try {
    const list = ((await store.get(K.userTours(userId))) || []).filter(x => x !== tid);
    await store.set(K.userTours(userId), list);
  } finally { await release(); }
}

/** Limite de tentativas por chave (janela fixa). */
export async function rateLimit(store, key, { max, windowMs }) {
  const k = `rl:${key}`;
  const now = clockNow();
  let rec = await store.get(k);
  if (!rec || rec.resetAt <= now) rec = { count: 0, resetAt: now + windowMs };
  rec.count++;
  await store.set(k, rec, { ttlMs: windowMs });
  if (rec.count > max) throw tooMany();
}
export async function rateLimitPeek(store, key, { max }) {
  const rec = await store.get(`rl:${key}`);
  if (rec && rec.resetAt > clockNow() && rec.count >= max) throw tooMany();
}
export const rateLimitReset = (store, key) => store.del(`rl:${key}`);
