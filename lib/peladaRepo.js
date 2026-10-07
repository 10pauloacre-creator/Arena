// Acesso a dados do módulo Pelada: jogadores (conta simplificada), peladas, imagens e índices.

import { notFound, conflict } from './errors.js';
import { now as clockNow } from './clock.js';

export const PK = {
  player: id => `pu:${id}`,
  name: key => `pun:${key}`,
  avatar: id => `pua:${id}`,
  pelada: id => `pl:${id}`,
  img: (id, kind) => `pli:${id}:${kind}`,
  mine: uid => `pum:${uid}`,
};

export const getPlayer = (store, id) => store.get(PK.player(id));
export async function getPlayerByName(store, key) {
  const id = await store.get(PK.name(key));
  return id ? getPlayer(store, id) : null;
}
export async function createPlayer(store, player, key) {
  const claimed = await store.setNX(PK.name(key), player.id);
  if (!claimed) throw conflict('Já existe alguém com este nome. Se é você, entre; se não, acrescente um sobrenome ou apelido.', 'NAME_TAKEN', { field: 'name' });
  await store.set(PK.player(player.id), player);
  return player;
}

export const loadPelada = (store, id) => store.get(PK.pelada(id));

/** Executa `fn(p, now)` com a pelada bloqueada (escrita serializada), salva e devolve o resultado. */
export async function withPelada(store, id, fn) {
  const release = await store.lock(PK.pelada(id));
  try {
    const p = await store.get(PK.pelada(id));
    if (!p) throw notFound('Pelada não encontrada. Confira o ID.');
    const now = clockNow();
    const result = await fn(p, now);
    p.version++; p.updatedAt = now;
    await store.set(PK.pelada(id), p);
    return result;
  } finally { await release(); }
}

/** Índice "minhas peladas" do jogador: [{ id, role: 'owner'|'member', at }]. */
export async function addToMine(store, uid, peladaId, role, now = clockNow()) {
  const release = await store.lock(PK.mine(uid));
  try {
    const list = (await store.get(PK.mine(uid))) || [];
    const cur = list.find(x => x.id === peladaId);
    if (!cur) list.push({ id: peladaId, role, at: now });
    else if (role === 'owner' && cur.role !== 'owner') cur.role = 'owner';
    else return list;
    await store.set(PK.mine(uid), list);
    return list;
  } finally { await release(); }
}
export async function removeFromMine(store, uid, peladaId) {
  const release = await store.lock(PK.mine(uid));
  try {
    const list = ((await store.get(PK.mine(uid))) || []).filter(x => x.id !== peladaId);
    await store.set(PK.mine(uid), list);
  } finally { await release(); }
}

/** Carrega vários jogadores em paralelo → Map id → jogador. */
export async function loadPlayers(store, ids) {
  const uniq = [...new Set(ids)];
  const rows = await Promise.all(uniq.map(id => getPlayer(store, id)));
  const map = new Map();
  rows.forEach((r, i) => { if (r) map.set(uniq[i], r); });
  return map;
}
