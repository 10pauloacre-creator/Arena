// Avisos na barra de notificações do aparelho (Web Push): ativar, desativar, testar e manter a inscrição em dia.
// O envio é feito pelo servidor (lib/push.js).
import { api } from '../api.js';

/** O service worker pronto; sem ele (ex.: página fora do https) não há como receber avisos. */
const swReady = () => Promise.race([
  navigator.serviceWorker.ready,
  new Promise((_, rej) => setTimeout(() => rej(new Error('O app ainda não terminou de carregar para receber avisos. Feche e abra o app e tente de novo.')), 8000)),
]);

const OFF_KEY = 'pelada.pushOff'; // a pessoa desligou os avisos neste aparelho de propósito: não religa sozinho
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
  del: k => { try { localStorage.removeItem(k); } catch { /* sem armazenamento */ } },
};

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** 'unsupported' | 'denied' | 'on' | 'off' */
export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try { return (await (await swReady()).pushManager.getSubscription()) ? 'on' : 'off'; } catch { return 'off'; }
}

const toKey = b64 => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '=')), c => c.charCodeAt(0));

/** Pede permissão, inscreve este aparelho e registra no servidor. Lança Error com mensagem amigável se não der. */
export async function enablePush() {
  if (!pushSupported()) throw new Error('Este navegador não permite notificações. No iPhone, instale o app (Compartilhar › Adicionar à Tela de Início) e abra por lá.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permissão negada. Libere as notificações deste site nas configurações do navegador.');
  const reg = await swReady();
  const { key } = await api.get('/pelada/push/key');
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(key) });
  await api.post('/pelada/push/subscribe', { subscription: sub.toJSON() });
  store.del(OFF_KEY);
}

/**
 * Mantém este aparelho recebendo os avisos da conta logada. Silencioso (nunca pede permissão):
 *  - com permissão e inscrição: registra a inscrição na conta atual (troca de conta, inscrição renovada);
 *  - com permissão mas sem inscrição (ex.: o navegador a descartou): inscreve de novo, a menos que a pessoa tenha desligado.
 */
export async function syncPush() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const sub = await (await swReady()).pushManager.getSubscription();
    if (sub) await api.post('/pelada/push/subscribe', { subscription: sub.toJSON() });
    else if (!store.get(OFF_KEY)) await enablePush();
  } catch { /* tenta de novo na próxima abertura */ }
}

/** Desliga os avisos neste aparelho. `byUser`: escolha da pessoa (não religa sozinho); ao sair da conta, não. */
export async function disablePush({ byUser = false } = {}) {
  try {
    const sub = await (await swReady()).pushManager.getSubscription();
    if (sub) { await api.post('/pelada/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
  } catch { /* já estava desligado */ }
  if (byUser) store.set(OFF_KEY, '1');
}

export const testPush = () => api.post('/pelada/push/test');
