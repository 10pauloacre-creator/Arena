import { addRoute, start, navigate } from './router.js';
import { loadSession } from './session.js';
import { registerOfflinePlugin } from './offline/index.js';
import { offlineEngine } from './api.js';
import { mountSyncStatus } from './offline/ui.js';
import { registerServiceWorker } from './offline/sw-register.js';

// Modo offline: o painel do organizador (placar ao vivo, times, sorteio…) e a inscrição gratuita funcionam sem internet.
registerOfflinePlugin({ id: 'tournament', test: (m, p) => p.startsWith('/tournaments/'), load: () => import('./offline/plugins/tournament.js') });
registerOfflinePlugin({ id: 'public', test: (m, p) => p.startsWith('/public/'), load: () => import('./offline/plugins/public.js') });

addRoute('/', () => import('./pages/home.js'));
addRoute('/entrar', () => import('./pages/auth.js'));
addRoute('/cadastro', () => import('./pages/auth.js'));
addRoute('/convite/:code', () => import('./pages/invite.js'));
addRoute('/admin/:id/:section?', () => import('./pages/admin/index.js'));
addRoute('/t/:id/:tab?', () => import('./pages/visitor/index.js'));
addRoute('*', () => import('./pages/notfound.js'));

registerServiceWorker('/sw.js', '/');
mountSyncStatus(offlineEngine(), { onLogin: () => navigate('/entrar?next=' + encodeURIComponent(location.pathname)) });
(async () => {
  await loadSession();
  await start(document.getElementById('app'));
})();

window.addEventListener('unhandledrejection', e => { console.error('Erro não tratado:', e.reason); });
