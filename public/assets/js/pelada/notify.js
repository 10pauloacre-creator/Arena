// Notificações no app: lê a caixa do jogador de tempos em tempos (com ETag), mantém o contador do sininho,
// marca como lidas e salva as preferências. A tela (sininho, painel, avisos) fica em ui/notifications.js.
import { api } from '../api.js';
import { S } from './session.js';
import { syncPush } from './push.js';

const POLL_MS = 20_000;
/** Estado compartilhado: `offset` = relógio do servidor − relógio local (ms). */
export const N = { items: [], unread: 0, prefs: null, now: 0, offset: 0, etag: null, loaded: false };
const listeners = new Set(), arrivals = new Set();
const known = new Set();
let timer = 0, inflight = null, started = false;

/** Avisa a cada mudança de estado. Devolve a função que cancela. */
export const onNotif = fn => { listeners.add(fn); return () => listeners.delete(fn); };
/** Avisa quando chegam notificações novas (não lidas e nunca vistas neste aparelho), exceto na primeira leitura. */
export const onArrive = fn => { arrivals.add(fn); return () => arrivals.delete(fn); };
const call = (set, arg) => set.forEach(fn => { try { fn(arg); } catch (err) { console.error(err); } });

function appBadge(n) {
  try { if (n) navigator.setAppBadge?.(n)?.catch?.(() => {}); else navigator.clearAppBadge?.()?.catch?.(() => {}); } catch { /* sem suporte */ }
}

function setData(d) {
  const first = !N.loaded;
  if (first) syncPush(); // este aparelho passa a receber os avisos desta conta
  const fresh = d.items.filter(i => i.unread && !known.has(i.id));
  Object.assign(N, { items: d.items, unread: d.unread, prefs: d.prefs, loaded: true });
  if (d.now) { N.now = d.now; N.offset = d.now - Date.now(); }
  d.items.forEach(i => known.add(i.id));
  appBadge(N.unread);
  call(listeners, N);
  if (!first && fresh.length) call(arrivals, fresh);
}

export function resetNotifications() {
  Object.assign(N, { items: [], unread: 0, prefs: null, now: 0, etag: null, loaded: false });
  known.clear();
  appBadge(0);
  call(listeners, N);
}

/** Busca a caixa agora (uma leitura por vez). `force` ignora o ETag. */
export function refreshNotifications({ force = false } = {}) {
  if (!S.player) { if (N.loaded) resetNotifications(); return Promise.resolve(); }
  if (inflight) return force ? inflight.then(() => refreshNotifications({ force })) : inflight;
  inflight = (async () => {
    try {
      const r = await api.request('GET', '/pelada/notifications', undefined, { headers: N.etag && !force ? { 'If-None-Match': N.etag } : {}, withResponse: true });
      if (r.notModified) return;
      N.etag = r.res.headers.get('etag');
      setData(r.data);
    } catch (err) {
      if (err.status === 401) resetNotifications();
    } finally { inflight = null; }
  })();
  return inflight;
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(async () => { if (!document.hidden) await refreshNotifications(); schedule(); }, POLL_MS);
}

/** Começa a acompanhar a caixa (uma vez por carregamento do app). */
export function startNotifications() {
  if (started) return;
  started = true;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshNotifications(); schedule(); } });
  refreshNotifications();
  schedule();
}

/** Marca todas como lidas até o momento da última leitura (o que chegou depois continua como novo). */
export async function markAllRead() {
  if (!N.unread) return;
  try { N.etag = null; setData(await api.post('/pelada/notifications/read', { all: true, upTo: N.now || undefined })); } catch { /* tenta na próxima */ }
}

export async function markRead(ids) {
  const list = ids.filter(id => N.items.some(i => i.id === id && i.unread));
  if (!list.length) return;
  try { N.etag = null; setData(await api.post('/pelada/notifications/read', { ids: list })); } catch { /* ignora */ }
}

export async function loadPrefs() {
  const r = await api.get('/pelada/notifications/prefs');
  N.prefs = r.prefs;
  return r.prefs;
}

/** Salva uma alteração parcial das preferências e relê a caixa (o filtro vale na hora). */
export async function savePrefs(patch) {
  const r = await api.patch('/pelada/notifications/prefs', patch);
  N.prefs = r.prefs;
  call(listeners, N);
  N.etag = null;
  refreshNotifications({ force: true });
  return r.prefs;
}

/** Relógio do servidor estimado. */
export const serverNow = () => Date.now() + N.offset;
