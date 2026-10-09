import { addRoute, start } from './router.js';
import { loadSession } from './session.js';

addRoute('/', () => import('./pages/home.js'));
addRoute('/entrar', () => import('./pages/auth.js'));
addRoute('/cadastro', () => import('./pages/auth.js'));
addRoute('/convite/:code', () => import('./pages/invite.js'));
addRoute('/admin/:id/:section?', () => import('./pages/admin/index.js'));
addRoute('/t/:id/:tab?', () => import('./pages/visitor/index.js'));
// link curto de uma partida: /AM-2026-9843/flamengo-x-vasco (a página confere se o 1º trecho é mesmo um ID de torneio)
addRoute('/:tid/:slug?', () => import('./pages/visitor/match.js'));
addRoute('*', () => import('./pages/notfound.js'));

(async () => {
  await loadSession();
  await start(document.getElementById('app'));
})();

window.addEventListener('unhandledrejection', e => { console.error('Erro não tratado:', e.reason); });
