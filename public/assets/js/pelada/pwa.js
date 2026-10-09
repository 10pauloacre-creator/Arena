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
    // Atualização: o app confere se há versão nova ao abrir e sempre que volta para a frente (app instalado fica "pausado" em segundo plano).
    // Quando a versão nova assume o controle (e já havia uma antes), recarrega uma vez para mostrar a novidade na hora.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      const busy = () => document.querySelector('dialog[open]') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
      if (!busy()) { location.reload(); return; }
      document.addEventListener('visibilitychange', () => { if (document.hidden) location.reload(); }, { once: true }); // ocupado: recarrega ao sair da tela
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/pelada/sw.js', { scope: '/pelada/', updateViaCache: 'none' }).then(reg => {
        const check = () => reg.update().catch(() => { /* sem rede */ });
        document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
        setInterval(check, 30 * 60_000);
      }).catch(() => { /* app funciona sem service worker */ });
    });
  }
}
