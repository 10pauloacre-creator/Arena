// Registra o service worker do app (só em https ou localhost). O app funciona sem ele; com ele, abre sem internet.
export function registerServiceWorker(url, scope) {
  if (!('serviceWorker' in navigator)) return;
  if (!(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return;
  const go = () => navigator.serviceWorker.register(url, { scope, updateViaCache: 'none' }).catch(() => { /* o app funciona sem service worker */ });
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
}
