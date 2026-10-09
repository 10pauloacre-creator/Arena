// App Pelada (PWA): rotas, sessão do jogador e service worker.
import { addRoute, start } from '../router.js';
import { loadPlayer } from './session.js';
import { initPwa } from './pwa.js';
import { startNotifications } from './notify.js';
import { initNotifUi } from './ui/notifications.js';

addRoute('/pelada', () => import('./pages/home.js'));
addRoute('/pelada/organizar', () => import('./pages/organizar.js'));
addRoute('/pelada/entrar', () => import('./pages/auth.js'));
addRoute('/pelada/painel', () => import('./pages/dashboard.js'));
addRoute('/pelada/notificacoes', () => import('./pages/notifications.js'));
addRoute('/pelada/configuracoes', () => import('./pages/settings.js'));
addRoute('/pelada/nova', () => import('./pages/form.js'));
addRoute('/pelada/p/:id/editar', () => import('./pages/form.js'));
addRoute('/pelada/p/:id/d/:day', () => import('./pages/day.js'));
addRoute('/pelada/p/:id/:tab?', () => import('./pages/pelada.js'));
// link curto do dia: /pelada/PL-XXXXXX/12-10-2026
addRoute('/pelada/:id/:date', () => import('./pages/day.js'));
addRoute('*', () => import('./pages/notfound.js'));

initPwa();
(async () => {
  await loadPlayer();
  initNotifUi();
  startNotifications(); // sem conta, não faz nada até alguém entrar
  await start(document.getElementById('app'));
})();

window.addEventListener('unhandledrejection', e => { console.error('Erro não tratado:', e.reason); });
