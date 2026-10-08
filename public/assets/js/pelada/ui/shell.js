// Estrutura comum das telas do app Pelada: topo (marca, ID, instalar, conta), conteúdo e rodapé.
import { html, ic, $ } from '../../ui/dom.js';
import { openDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { S } from '../session.js';
import { navigate } from '../../router.js';
import { canInstall, promptInstall, onInstallChange, isStandalone, isIOS } from '../pwa.js';
import { normalizePeladaId, PELADA_ID_RE, firstName } from '../../shared/pelada.js';
import { playerAvatar } from './img.js';
import { openAuthDialog } from './auth.js';
import { openProfile } from './profile.js';
import { bellButton } from './notifications.js';
import { N, refreshNotifications, resetNotifications } from '../notify.js';
import { parseDay } from '../../shared/format.js';

export const brand = () => html`<a class="pl-brand" href="/pelada/" aria-label="Pelada — início"><img src="/pelada/icons/icon.svg" alt="" width="36" height="36"><span><b>Pelada</b><small>organize · sorteie · marque</small></span></a>`;

function userMenu() {
  const u = S.player;
  if (!u) return html`<button class="btn btn-sm btn-primary" type="button" data-login>Entrar</button>`;
  return html`<div class="menu" data-menu><button type="button" class="user-chip" data-menu-btn aria-haspopup="true" aria-expanded="false" aria-label="Menu da conta de ${u.name}">${playerAvatar(u, 36)}<span class="name">${firstName(u.name)}</span>${ic('chevron-down', { size: 16 })}</button>
    <div class="menu-pop" hidden role="menu"><div class="who"><b>${u.name}</b><span class="muted small">Conta Pelada</span></div><div class="sep"></div>
      <a href="/pelada/painel" role="menuitem">${ic('layout-grid', { size: 18 })} Minhas peladas</a>
      <a href="/pelada/nova" role="menuitem">${ic('plus', { size: 18 })} Criar pelada</a>
      <a href="/pelada/notificacoes" role="menuitem">${ic('bell', { size: 18 })} Notificações</a>
      <a href="/pelada/configuracoes" role="menuitem">${ic('settings', { size: 18 })} Configurações</a>
      <button type="button" data-profile role="menuitem">${ic('user-round', { size: 18 })} Meu perfil</button>
      <a href="/" data-external role="menuitem">${ic('trophy', { size: 18 })} Torneios (ArenaMaster)</a></div></div>`;
}

/** Aviso quando o servidor não tem banco persistente (ex.: Vercel sem banco conectado). */
const storageBanner = () => S.config?.storage?.persistent === false
  ? html`<div class="storage-warn" role="status">⚠ Ambiente de demonstração sem banco de dados: contas e peladas podem ser apagadas a qualquer momento. ${S.config.storage.note || 'O dono do site precisa conectar um banco (veja o README).'}</div>` : '';

const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';
const themeGlyph = () => (isDark() ? '☀️' : '🌙');
const themeLabel = () => (isDark() ? 'Mudar para o modo claro' : 'Mudar para o modo escuro');

export const topbar = () => html`${storageBanner()}<header class="pl-top">${brand()}<span class="spacer"></span>
  <form class="id-form id-form-top" data-idform role="search"><input name="id" placeholder="ID da pelada" aria-label="ID da pelada" autocomplete="off" maxlength="80"><button class="btn btn-sm" type="submit">Entrar</button></form>
  <button type="button" class="icon-btn theme-btn" data-theme-btn aria-label="${themeLabel()}" title="${themeLabel()}">${themeGlyph()}</button>
  <button type="button" class="btn btn-sm install-btn" data-install hidden aria-label="Instalar app">${ic('smartphone', { size: 16 })} <span>Instalar app</span></button>
  ${S.player ? bellButton() : ''}${userMenu()}</header>`;

export const footer = () => html`<footer class="pl-foot"><span>⚽ Pelada · parte da plataforma <a href="/" data-external>ArenaMaster AI</a></span>
  <span class="pl-credit">Esta plataforma é uma criação de <b>Paulo Roberto R. Magalhães</b>, na missão de modernizar o esporte.</span></footer>`;

/** Barra de navegação inferior (só no celular, só com conta): o polegar alcança tudo sem subir até o topo. */
function bottomNav() {
  if (!S.player) return '';
  const path = location.pathname.replace(/\/+$/, '');
  const item = (href, icon, label, on) => html`<a href="${href}" aria-current="${on ? 'page' : 'false'}">${ic(icon, { size: 22 })}<span>${label}</span></a>`;
  return html`<nav class="pl-bnav" aria-label="Navegação principal">
    ${item('/pelada/painel', 'layout-grid', 'Peladas', path === '/pelada/painel' || path.startsWith('/pelada/p/'))}
    ${item('/pelada/nova', 'plus', 'Criar', path === '/pelada/nova')}
    <button type="button" data-bn-id>${ic('ticket', { size: 22 })}<span>Entrar com ID</span></button>
    <button type="button" data-bn-profile>${ic('user-round', { size: 22 })}<span>Perfil</span></button></nav>`;
}

/** Página padrão: topo + conteúdo + rodapé (+ barra inferior no celular). `nav: false` esconde a barra (ex.: formulários longos). */
export const page = (content, { cls = '', nav = true } = {}) => {
  const bn = nav ? bottomNav() : '';
  return html`${topbar()}<main class="pl-main ${cls} ${bn ? 'has-bnav' : ''}" id="main">${content}</main>${footer()}${bn}`;
};

export function goToPelada(raw) {
  const id = normalizePeladaId(raw);
  if (!PELADA_ID_RE.test(id)) { toast('Digite o ID completo da pelada, por exemplo PL-7K3M9Q (ou cole o link de convite).', { type: 'warn' }); return false; }
  navigate('/pelada/p/' + id);
  return true;
}

function idDialog() {
  const d = openDialog({
    title: 'Entrar numa pelada',
    body: html`<form class="stack" data-id-dialog novalidate><p class="muted small" style="margin:0">Cole o ID que o organizador compartilhou (ex.: PL-7K3M9Q) ou o link de convite.</p>
      <div class="field"><label for="bn-id" class="sr-only">ID da pelada</label><input id="bn-id" name="id" placeholder="PL-7K3M9Q" autocomplete="off" autocapitalize="characters" maxlength="80" style="text-transform:uppercase;font-weight:700;letter-spacing:.04em"></div>
      <button class="btn btn-primary btn-block btn-lg" type="submit">Acessar pelada ${ic('arrow-right', { size: 18 })}</button></form>`,
    onOpen: dlg => $('#bn-id', dlg)?.focus(),
  });
  d.el.addEventListener('submit', e => { e.preventDefault(); if (goToPelada(e.target.id.value)) d.close(); });
}

export function installDialog() {
  const ios = isIOS();
  openDialog({
    title: 'Instalar o app Pelada',
    body: html`<div class="stack"><p style="margin:0">Salve o Pelada na tela inicial para abrir em tela cheia, como um app, direto na sua pelada.</p>
      ${ios ? html`<ol class="install-steps"><li>Toque em <b>Compartilhar</b> ${ic('share', { size: 16 })} na barra do Safari.</li><li>Escolha <b>Adicionar à Tela de Início</b>.</li><li>Confirme em <b>Adicionar</b>.</li></ol>`
        : html`<ol class="install-steps"><li>Abra o menu do navegador (<b>⋮</b> ou <b>⋯</b>).</li><li>Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</li><li>Pronto! O ícone da Pelada aparece junto dos seus apps.</li></ol>`}
      <p class="muted small" style="margin:0">Dica: também dá para <b>favoritar</b> esta página (Ctrl/⌘ + D) para voltar rápido.</p></div>`,
    foot: html`<button class="btn btn-primary" data-close>Entendi</button>`,
  });
}

// Containers já ligados. As telas redesenham o CONTEÚDO várias vezes (e chamam wireShell de novo), mas o container é o mesmo:
// ligar os eventos a cada chamada empilhava vários ouvintes, e o clique no menu da conta abria e fechava na mesma hora
// (o botão de perfil parecia travado).
const wired = new WeakSet();

/** Liga os comportamentos do topo dentro de `root`. `signal` é do roteador (limpa listeners ao sair da tela). Pode ser chamada de novo após redesenhar. */
export function wireShell(root, signal) {
  const sync = () => { const b = $('[data-install]', root); if (b) b.hidden = isStandalone(); };
  sync();
  // acabou de entrar (ou sair) da conta: o sininho acompanha na hora (vale a cada redesenho, não só na primeira ligação)
  if (S.player && !N.loaded) refreshNotifications();
  else if (!S.player && N.loaded) resetNotifications();
  if (wired.has(root)) return;
  wired.add(root);
  const closeMenus = () => root.querySelectorAll('[data-menu] .menu-pop').forEach(p => { p.hidden = true; p.parentElement.querySelector('[data-menu-btn]')?.setAttribute('aria-expanded', 'false'); });
  root.addEventListener('click', async e => {
    const btn = e.target.closest('[data-menu-btn]');
    if (btn) { const pop = btn.parentElement.querySelector('.menu-pop'), open = pop.hidden; closeMenus(); pop.hidden = !open; btn.setAttribute('aria-expanded', String(open)); e.stopPropagation(); return; }
    if (e.target.closest('[data-profile], [data-bn-profile]')) { closeMenus(); openProfile(); return; }
    if (e.target.closest('[data-bn-id]')) { idDialog(); return; }
    const tb = e.target.closest('[data-theme-btn]');
    if (tb) { document.getElementById('theme-toggle')?.click(); tb.textContent = themeGlyph(); tb.setAttribute('aria-label', themeLabel()); tb.title = themeLabel(); return; }
    if (e.target.closest('[data-login]')) { const p = await openAuthDialog({ mode: 'login', title: 'Entrar na sua conta' }); if (p) location.reload(); return; }
    if (e.target.closest('[data-install]')) { if (canInstall()) await promptInstall(); else installDialog(); return; }
    if (!e.target.closest('.menu-pop')) closeMenus();
  });
  document.addEventListener('click', e => { if (!e.target.closest('[data-menu]')) closeMenus(); }, { signal });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); }, { signal });
  root.addEventListener('submit', e => { const f = e.target.closest('[data-idform]'); if (f) { e.preventDefault(); goToPelada(f.id.value); } });

  const off = onInstallChange(sync);
  signal?.addEventListener('abort', off);
}

/** Garante uma conta: devolve o jogador logado ou abre o modal de criação rápida. */
export async function ensurePlayer(opts = {}) {
  if (S.player) return S.player;
  return openAuthDialog(opts);
}

// ---------------------------------------------------------------- datas
const dmy = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const long = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
const wk = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });
const full = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
export const dayShort = iso => { const d = parseDay(iso); return d ? `${cap(wk.format(d).replace('.', ''))} · ${dmy.format(d)}` : '—'; };
export const dayLong = iso => { const d = parseDay(iso); return d ? cap(long.format(d)) : '—'; };
export const dayFull = iso => { const d = parseDay(iso); return d ? full.format(d) : '—'; };
