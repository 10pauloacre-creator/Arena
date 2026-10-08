// Avisos na barra de notificações do aparelho (Web Push): ativar, desativar e testar. O envio é feito pelo servidor.
import { api } from '../api.js';

const swReady = () => navigator.serviceWorker.ready;

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
}

export async function disablePush() {
  try {
    const sub = await (await swReady()).pushManager.getSubscription();
    if (sub) { await api.post('/pelada/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
  } catch { /* já estava desligado */ }
}

export const testPush = () => api.post('/pelada/push/test');
