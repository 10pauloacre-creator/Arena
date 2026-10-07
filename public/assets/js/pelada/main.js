// App Pelada (PWA): rotas, sessão do jogador e service worker.
import { addRoute, start } from '../router.js';
import { loadPlayer } from './session.js';
import { initPwa } from './pwa.js';
import { registerOfflinePlugin } from '../offline/index.js';
import { offlineEngine } from '../api.js';
import { mountSyncStatus } from '../offline/ui.js';
import { openAuthDialog } from './ui/auth.js';

// Modo offline: a pelada (presença, sorteio, partidas, gols…) funciona sem internet e sincroniza quando ela volta.
registerOfflinePlugin({ id: 'pelada', test: (m, p) => p.startsWith('/pelada/peladas/'), load: () => import('../offline/plugins/pelada.js') });

addRoute('/pelada', () => import('./pages/home.js'));
addRoute('/pelada/organizar', () => import('./pages/organizar.js'));
addRoute('/pelada/entrar', () => import('./pages/auth.js'));
addRoute('/pelada/painel', () => import('./pages/dashboard.js'));
addRoute('/pelada/nova', () => import('./pages/form.js'));
addRoute('/pelada/p/:id/editar', () => import('./pages/form.js'));
addRoute('/pelada/p/:id/d/:day', () => import('./pages/day.js'));
addRoute('/pelada/p/:id/:tab?', () => import('./pages/pelada.js'));
addRoute('*', () => import('./pages/notfound.js'));

initPwa();
mountSyncStatus(offlineEngine(), { onLogin: () => openAuthDialog({ mode: 'login', title: 'Entrar na sua conta' }).then(p => { if (p) location.reload(); }) });
(async () => {
  await loadPlayer();
  await start(document.getElementById('app'));
})();

window.addEventListener('unhandledrejection', e => { console.error('Erro não tratado:', e.reason); });
