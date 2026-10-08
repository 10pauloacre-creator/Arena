// Service worker do app Pelada (escopo /pelada/): abre o app sem internet e acelera as telas.
// Dados (/api) nunca são guardados; as telas e os arquivos do app usam "rede primeiro, cache como reserva".
const VERSION = 'pelada-v8';
const SHELL = [
  '/pelada/',
  '/assets/css/base.css',
  '/assets/css/pelada.css',
  '/assets/css/dark.css',
  '/assets/js/theme.js',
  '/assets/fonts/pjs-latin.woff2',
  '/assets/fonts/pjs-latin-ext.woff2',
  '/assets/fonts/barlow-condensed-700.woff2',
  '/assets/fonts/barlow-condensed-800.woff2',
  '/assets/fonts/league-spartan-800.woff2',
  '/pelada/share/modelo-compartilhamento.webp',
  '/pelada/icons/icon.svg',
  '/pelada/icons/icon-192.png',
  '/pelada/sounds/apito.m4a',
  '/assets/js/router.js',
  '/assets/js/api.js',
  '/assets/js/icons.js',
  '/assets/js/ui/dom.js',
  '/assets/js/ui/dialog.js',
  '/assets/js/ui/toast.js',
  '/assets/js/ui/forms.js',
  '/assets/js/ui/flyer.js',
  '/assets/js/ui/qr.js',
  '/assets/js/vendor/qrcode.js',
  '/assets/js/shared/format.js',
  '/assets/js/shared/gender.js',
  '/assets/js/shared/team-catalog.js',
  '/assets/js/shared/dates.js',
  '/assets/js/shared/validators.js',
  '/assets/js/shared/pelada.js',
  '/assets/js/shared/notifications.js',
  '/assets/js/pelada/data.js',
  '/assets/js/pelada/main.js',
  '/assets/js/pelada/notify.js',
  '/assets/js/pelada/pages/auth.js',
  '/assets/js/pelada/pages/dashboard.js',
  '/assets/js/pelada/pages/day.js',
  '/assets/js/pelada/pages/form.js',
  '/assets/js/pelada/pages/home.js',
  '/assets/js/pelada/pages/notifications.js',
  '/assets/js/pelada/pages/notfound.js',
  '/assets/js/pelada/pages/organizar.js',
  '/assets/js/pelada/pages/pelada.js',
  '/assets/js/pelada/pages/settings.js',
  '/assets/js/pelada/push.js',
  '/assets/js/pelada/pwa.js',
  '/assets/js/pelada/session.js',
  '/assets/js/pelada/ui/auth.js',
  '/assets/js/pelada/ui/calendar.js',
  '/assets/js/pelada/ui/cropper.js',
  '/assets/js/pelada/ui/emblem.js',
  '/assets/js/pelada/ui/img.js',
  '/assets/js/pelada/ui/match.js',
  '/assets/js/pelada/ui/notifications.js',
  '/assets/js/pelada/ui/podium.js',
  '/assets/js/pelada/ui/poll.js',
  '/assets/js/pelada/ui/preview.js',
  '/assets/js/pelada/ui/profile.js',
  '/assets/js/pelada/ui/share.js',
  '/assets/js/pelada/ui/shell.js',
  '/assets/js/pelada/ui/sound.js',
  '/assets/js/pelada/ui/shuffle.js',
  '/assets/js/pelada/ui/teams.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => Promise.all(SHELL.map(url => cache.add(new Request(url, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('pelada-') && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Sempre confere com o servidor (ignora o cache HTTP do navegador): quem abre o app depois de uma atualização já recebe a versão nova.
const fresh = request => (request.mode === 'navigate' ? fetch(request) : fetch(request, { cache: 'no-cache' }));

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fresh(request);
    if (res && res.ok) cache.put(fallbackUrl || request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(fallbackUrl || request);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  const refresh = fetch(request, { cache: 'no-cache' }).then(res => { if (res && res.ok) cache.put(request, res.clone()); return res; }).catch(() => hit);
  return hit || refresh;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return; // pedidos parciais (áudio/vídeo) vão direto à rede
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // dados: sempre da rede

  if (request.mode === 'navigate') {
    // qualquer rota do app abre o mesmo index.html (SPA)
    event.respondWith(networkFirst(request, '/pelada/'));
    return;
  }
  if (url.pathname.startsWith('/pelada-img/')) { event.respondWith(staleWhileRevalidate(request)); return; }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/pelada/')) event.respondWith(networkFirst(request));
});

// ---------------------------------------------------------------- avisos na barra de notificações (Web Push)
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { text: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Pelada', {
    body: data.text || '', icon: '/pelada/icons/icon-192.png', badge: '/pelada/icons/icon-192.png', tag: data.tag || undefined,
    lang: 'pt-BR', data: { url: data.url || '/pelada/' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/pelada/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.location.origin + '/pelada'));
    if (open) { if ('navigate' in open) open.navigate(url).catch(() => {}); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});

// O navegador renovou (ou invalidou) a inscrição: refaz e avisa o servidor, para os avisos não pararem.
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    try {
      const old = event.oldSubscription;
      const sub = event.newSubscription || (old ? await self.registration.pushManager.subscribe(old.options) : null);
      if (!sub) return;
      await fetch('/api/pelada/push/subscribe', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
    } catch { /* o app registra de novo na próxima abertura (syncPush) */ }
  })());
});
