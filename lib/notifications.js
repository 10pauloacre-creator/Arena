// Notificações do app Pelada.
// Cada pelada tem um "feed" com os últimos eventos (entrou, presença, sorteio, resultado, agenda…), gravado dentro do lock
// da pelada. A caixa de cada jogador é montada na leitura: eventos das peladas dele (desde que entrou), sem as próprias
// ações, filtrados pelas preferências. Assim cada ação custa uma escrita, por maior que seja a pelada.

import { randomBytes } from 'node:crypto';
import { PK } from './peladaRepo.js';
import { normalizePrefs, mergePrefs, describe, notifUrl, isoBR, startOfDayBR } from '../public/assets/js/shared/notifications.js';
import { badRequest } from './errors.js';
import { getVapid, subscribedUsers, pushToUser } from './push.js';

export const FEED_MAX = 120;          // eventos guardados por pelada
export const INBOX_MAX = 60;          // notificações devolvidas por leitura
export const READ_IDS_MAX = 300;      // lidas individualmente (além do "lido até")
const FLAP_MS = 5 * 60_000;           // marcar e desmarcar presença em seguida não gera aviso
const REDRAW_MS = 10 * 60_000;        // sorteio refeito logo em seguida substitui o anterior

const evId = () => 'e' + randomBytes(5).toString('base64url');

/** Dados da pelada guardados junto do feed: nome e datas (com quem confirmou, para o lembrete do dia). */
function snapshot(p, now) {
  const today = isoBR(now);
  return {
    name: p.name, g: p.gender,
    days: p.days.map(d => ({ id: d.id, date: d.date, ...(d.date >= today ? { in: d.attendance.filter(a => a.pid.startsWith('u:')).map(a => a.pid.slice(2)) } : {}) })),
  };
}

const selfPresence = e => (e.t === 'presence' || e.t === 'absence') && !e.d?.guest && !e.d?.removed;

/** Junta um evento ao feed, evitando avisos repetidos ou que se anulam. */
function merge(events, e, now) {  // devolve o evento novo (ou null quando só atualiza/anula um aviso)
  if (e.t === 'result') {
    // correção de gols depois de encerrar: atualiza o resultado já avisado (sem avisar de novo)
    const old = events.find(x => x.t === 'result' && x.day?.id === e.day?.id && x.d?.mid === e.d?.mid);
    if (old) { old.d = e.d; return null; }
  }
  if (e.t === 'draw') {
    const i = events.findLastIndex(x => x.t === 'draw' && x.day?.id === e.day?.id);
    if (e.d?.fix) {
      // times ajustados depois do sorteio: corrige "você está no Time X" do aviso já enviado
      if (i >= 0) events[i].d = { ...events[i].d, teams: e.d.teams, slot: e.d.slot };
      return null;
    }
    if (i >= 0 && now - events[i].at < REDRAW_MS) events.splice(i, 1);
  }
  if (selfPresence(e)) {
    const i = events.findLastIndex(x => selfPresence(x) && x.by === e.by && x.day?.id === e.day?.id);
    if (i >= 0 && events[i].t !== e.t && now - events[i].at < FLAP_MS) { events.splice(i, 1); return null; }
  }
  const added = { id: evId(), at: now, ...e };
  events.push(added);
  return added;
}

/** Grava os eventos (chamar com a pelada bloqueada, depois de salvá-la). Sem eventos, só atualiza nome/datas. */
export async function appendFeed(store, p, events, now) {
  const feed = (await store.get(PK.feed(p.id))) || { events: [] };
  const added = [];
  for (const e of events) { const x = merge(feed.events, e, now); if (x) added.push(x); }
  if (feed.events.length > FEED_MAX) feed.events.splice(0, feed.events.length - FEED_MAX);
  await store.set(PK.feed(p.id), { ...snapshot(p, now), events: feed.events });
  return added;
}

/**
 * Avisos no celular (barra de notificações) para quem tem aparelho inscrito: os mesmos textos e filtros da caixa do app
 * (preferências, peladas silenciadas e as próprias ações não notificam). Falhas nunca desfazem a ação.
 */
export async function pushEvents(store, p, added, now) {
  try {
    if (!added.length) return;
    const subscribed = await subscribedUsers(store);
    const targets = [p.ownerId, ...p.members.map(m => m.userId)].filter((u, i, a) => subscribed.has(u) && a.indexOf(u) === i);
    if (!targets.length) return;
    const vapid = await getVapid(store);
    const today = isoBR(now);
    await Promise.all(targets.map(async uid => {
      const { prefs } = await loadState(store, uid);
      if (!prefs.enabled || prefs.muted.includes(p.id)) return;
      for (const e of added) {
        if (e.by === uid || !prefs.types[e.t]) continue;
        const { title, text } = describe(e, { viewerId: uid, today, gender: p.gender });
        await pushToUser(store, vapid, uid, { title, text, url: notifUrl(e, p.id), tag: `${p.id}:${e.id}` });
      }
    }));
  } catch (err) { console.error('[push] falha ao enviar avisos:', err.message); }
}

export const deleteFeed = (store, peladaId) => store.del(PK.feed(peladaId));

// ---------------------------------------------------------------- caixa do jogador
async function loadState(store, uid) {
  const s = (await store.get(PK.notif(uid))) || {};
  return { prefs: normalizePrefs(s.prefs), readAt: s.readAt || 0, read: Array.isArray(s.read) ? s.read : [] };
}

/** Notificações do jogador: { items, unread, prefs }. */
export async function readInbox(store, me, now) {
  const [mine, state] = await Promise.all([store.get(PK.mine(me.id)), loadState(store, me.id)]);
  const { prefs } = state;
  if (!prefs.enabled) return { items: [], unread: 0, prefs };
  const list = (mine || []).filter(x => !prefs.muted.includes(x.id));
  const feeds = await Promise.all(list.map(x => store.get(PK.feed(x.id))));
  const today = isoBR(now);
  const items = [];
  const push = (e, x, feed) => {
    const { title, text } = describe(e, { viewerId: me.id, today, gender: feed.g });
    items.push({ id: `${x.id}:${e.id}`, type: e.t, at: e.at, title, text, url: notifUrl(e, x.id), pelada: { id: x.id, name: feed.name } });
  };
  list.forEach((x, i) => {
    const feed = feeds[i];
    if (!feed) return;
    const since = x.at || 0;
    const days = new Map((feed.days || []).map(d => [d.id, d]));
    for (const e of feed.events) {
      if (e.by === me.id || e.at < since || !prefs.types[e.t]) continue;
      if (e.day && !(e.t === 'schedule' && e.d?.kind === 'cancel')) {
        const cur = days.get(e.day.id);
        if (!cur) continue; // a data foi excluída: o aviso de cancelamento já diz isso
        push({ ...e, day: { id: cur.id, date: cur.date } }, x, feed); // data atual (o jogo pode ter sido remarcado)
      } else push(e, x, feed);
    }
    // lembrete do dia: aparece no dia do jogo (sem gravar nada)
    const d = prefs.types.reminder && feed.days?.find(y => y.date === today);
    if (d) push({ id: `r-${d.id}`, t: 'reminder', at: Math.max(startOfDayBR(today), since), day: { id: d.id, date: d.date }, d: { present: (d.in || []).includes(me.id) } }, x, feed);
  });
  items.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  const out = items.slice(0, INBOX_MAX);
  const readIds = new Set(state.read);
  let unread = 0;
  for (const it of out) { it.unread = it.at > state.readAt && !readIds.has(it.id); if (it.unread) unread++; }
  return { items: out, unread, prefs };
}

/** Marca como lidas: `all` (até `upTo`, o relógio da última leitura do aparelho) ou uma lista de `ids`. */
export async function markRead(store, uid, { all = false, ids = [], upTo } = {}, now) {
  if (!all && !(Array.isArray(ids) && ids.length)) throw badRequest('Informe quais notificações marcar como lidas.', 'VALIDATION');
  const release = await store.lock(PK.notif(uid));
  try {
    const s = (await store.get(PK.notif(uid))) || {};
    s.readAt = s.readAt || 0;
    s.read = Array.isArray(s.read) ? s.read : [];
    if (all) {
      const limit = Number.isFinite(Number(upTo)) && Number(upTo) > 0 ? Math.min(Number(upTo), now) : now;
      s.readAt = Math.max(s.readAt, limit);
      s.read = [];
    } else {
      const add = ids.filter(x => typeof x === 'string' && x.length <= 80).slice(0, 100);
      s.read = [...new Set([...s.read, ...add])].slice(-READ_IDS_MAX);
    }
    await store.set(PK.notif(uid), s);
  } finally { await release(); }
}

export async function getPrefs(store, uid) { return (await loadState(store, uid)).prefs; }

export async function updatePrefs(store, uid, patch) {
  const release = await store.lock(PK.notif(uid));
  try {
    const s = (await store.get(PK.notif(uid))) || {};
    try { s.prefs = mergePrefs(s.prefs, patch); } catch (err) { throw badRequest(err.message, 'VALIDATION', err.field ? { field: err.field } : undefined); }
    await store.set(PK.notif(uid), s);
    return s.prefs;
  } finally { await release(); }
}

// ---------------------------------------------------------------- montagem dos eventos (rotas)
/** Evento feito por `me`. */
export const event = (me, t, extra = {}) => ({ t, by: me.id, who: me.name, ...extra });
export const dayRef = d => ({ id: d.id, date: d.date });
/** IDs de contas (sem convidados) entre os pids. */
export const userIds = pids => pids.filter(x => typeof x === 'string' && x.startsWith('u:')).map(x => x.slice(2));
