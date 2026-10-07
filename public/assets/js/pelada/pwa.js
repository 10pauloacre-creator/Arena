// PWA: registra o service worker e controla o botão "Instalar app".
let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach(fn => { try { fn(); } catch { /* ignora */ } });

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const canInstall = () => !!deferred;
export const onInstallChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

export async function promptInstall() {
  if (!deferred) return 'unavailable';
  const ev = deferred;
  deferred = null; notify();
  ev.prompt();
  const choice = await ev.userChoice.catch(() => ({ outcome: 'dismissed' }));
  return choice.outcome;
}

export function initPwa() {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; notify(); });
  window.addEventListener('appinstalled', () => { deferred = null; notify(); });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/pelada/sw.js', { scope: '/pelada/' }).catch(() => { /* app funciona sem service worker */ }); });
  }
}
