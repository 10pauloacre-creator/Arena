import { html, ic } from './dom.js';
import { session, initials, logout } from '../session.js';
import { navigate } from '../router.js';
import { openDialog } from './dialog.js';
import { appearanceHTML, wireAppearance } from './appearance.js';

export const brandMark = (size = 40) => html`<svg class="brand-mark" width="${size}" height="${Math.round(size * 1.1)}" viewBox="0 0 40 44" fill="none" aria-hidden="true">
  <path d="M20 3 35 10v12c0 9-6 14.500-15 18C11 36.500 5 31 5 22V10z" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>
  <g transform="translate(10.500 10.500) scale(.8)" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14.660V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2"/><path d="M14 14.660V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2"/><path d="M17.916 10H19.500A2.500 2.500 0 0 0 22 7.500V5a1 1 0 0 0-1-1h-3"/><path d="M4 22h16"/><path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><path d="M6.084 10H4.500A2.500 2.500 0 0 1 2 7.500V5a1 1 0 0 1 1-1h3"/></g></svg>`;

export const brand = ({ href = '/' } = {}) => html`<a class="brand" href="${href}" aria-label="ArenaMaster AI — início">${brandMark()}<span><span class="brand-name">Arena<b>Master</b> AI</span><span class="brand-sub">TOURNAMENT OS</span></span></a>`;

/** Menu do usuário (avatar + nome) ou botões de entrar/cadastrar. */
export function userMenuHTML() {
  const u = session.user;
  if (!u) return html`<a class="btn btn-sm" href="/entrar">Entrar</a><a class="btn btn-sm btn-primary" href="/cadastro">Criar conta</a>`;
  return html`<div class="menu" data-menu><button type="button" class="user-chip" data-menu-btn aria-haspopup="true" aria-expanded="false"><span class="avatar">${initials(u.name)}</span><span class="name">${u.name.split(' ')[0]}</span>${ic('chevron-down', { size: 16 })}</button>
    <div class="menu-pop" hidden role="menu"><div class="who"><b>${u.name}</b><span class="muted small">${u.email}</span></div><div class="sep"></div>
      <a href="/" role="menuitem">${ic('layout-grid', { size: 18 })} Meus torneios</a>
      <button type="button" data-profile role="menuitem">${ic('user-round', { size: 18 })} Meu perfil</button>
      <button type="button" data-logout role="menuitem">${ic('log-out', { size: 18 })} Sair</button></div></div>`;
}

/** Perfil: dados da conta e aparência (automático, claro ou escuro). */
function openProfile() {
  const u = session.user;
  if (!u) return;
  const d = openDialog({
    title: 'Meu perfil',
    body: html`<div class="stack"><div class="row" style="gap:14px"><span class="avatar" style="width:56px;height:56px;font-size:20px">${initials(u.name)}</span><div class="grow"><strong style="font-size:18px">${u.name}</strong><div class="muted small">${u.email}</div></div></div>${appearanceHTML()}</div>`,
    foot: html`<button class="btn" data-close>Fechar</button>`,
  });
  wireAppearance(d.el);
}

/** Liga os comportamentos dos menus dentro de `root`. */
export function wireMenus(root, signal) {
  const close = () => root.querySelectorAll('[data-menu] .menu-pop').forEach(p => { p.hidden = true; p.parentElement.querySelector('[data-menu-btn]')?.setAttribute('aria-expanded', 'false'); });
  root.addEventListener('click', async e => {
    const btn = e.target.closest('[data-menu-btn]');
    if (btn) { const pop = btn.parentElement.querySelector('.menu-pop'); const open = pop.hidden; close(); pop.hidden = !open; btn.setAttribute('aria-expanded', String(open)); e.stopPropagation(); return; }
    if (e.target.closest('[data-profile]')) { close(); openProfile(); return; }
    if (e.target.closest('[data-logout]')) { await logout(); navigate('/'); return; }
    if (!e.target.closest('.menu-pop')) close();
  });
  document.addEventListener('click', e => { if (!e.target.closest('[data-menu]')) close(); }, { signal });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); }, { signal });
}

/** Aviso exibido quando o servidor não tem banco persistente (ex.: Vercel sem banco conectado). */
export const storageBanner = () => session.config?.storage?.persistent === false
  ? html`<div class="storage-warn">⚠ Ambiente de demonstração sem banco de dados: contas e torneios podem ser apagados a qualquer momento. ${session.config.storage.note || 'Conecte um banco na Vercel (veja o README) para guardar os dados de verdade.'}</div>` : '';
