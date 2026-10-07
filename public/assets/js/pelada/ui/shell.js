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
import { parseDay } from '../../shared/format.js';

export const brand = () => html`<a class="pl-brand" href="/pelada/" aria-label="Pelada — início"><img src="/pelada/icons/icon.svg" alt="" width="36" height="36"><span><b>Pelada</b><small>organize · sorteie · marque</small></span></a>`;

function userMenu() {
  const u = S.player;
  if (!u) return html`<button class="btn btn-sm btn-primary" type="button" data-login>Entrar</button>`;
  return html`<div class="menu" data-menu><button type="button" class="user-chip" data-menu-btn aria-haspopup="true" aria-expanded="false" aria-label="Menu da conta de ${u.name}">${playerAvatar(u, 36)}<span class="name">${firstName(u.name)}</span>${ic('chevron-down', { size: 16 })}</button>
    <div class="menu-pop" hidden role="menu"><div class="who"><b>${u.name}</b><span class="muted small">Conta Pelada</span></div><div class="sep"></div>
      <a href="/pelada/painel" role="menuitem">${ic('layout-grid', { size: 18 })} Minhas peladas</a>
      <a href="/pelada/nova" role="menuitem">${ic('plus', { size: 18 })} Criar pelada</a>
      <button type="button" data-profile role="menuitem">${ic('user-round', { size: 18 })} Meu perfil</button>
      <a href="/" data-external role="menuitem">${ic('trophy', { size: 18 })} Torneios (ArenaMaster)</a></div></div>`;
}

/** Aviso quando o servidor não tem banco persistente (ex.: Vercel sem banco conectado). */
const storageBanner = () => S.config?.storage?.persistent === false
  ? html`<div class="storage-warn" role="status">⚠ Ambiente de demonstração sem banco de dados: contas e peladas podem ser apagadas a qualquer momento. ${S.config.storage.note || 'O dono do site precisa conectar um banco (veja o README).'}</div>` : '';

export const topbar = () => html`${storageBanner()}<header class="pl-top">${brand()}<span class="spacer"></span>
  <form class="id-form id-form-top" data-idform role="search"><input name="id" placeholder="ID da pelada" aria-label="ID da pelada" autocomplete="off" maxlength="80"><button class="btn btn-sm" type="submit">Entrar</button></form>
  <button type="button" class="btn btn-sm install-btn" data-install hidden aria-label="Instalar app">${ic('smartphone', { size: 16 })} <span>Instalar app</span></button>
  ${userMenu()}</header>`;

export const footer = () => html`<footer class="pl-foot"><span>⚽ Pelada · parte da plataforma <a href="/" data-external>ArenaMaster AI</a></span></footer>`;

/** Página padrão: topo + conteúdo + rodapé. */
export const page = (content, { cls = '' } = {}) => html`${topbar()}<main class="pl-main ${cls}" id="main">${content}</main>${footer()}`;

export function goToPelada(raw) {
  const id = normalizePeladaId(raw);
  if (!PELADA_ID_RE.test(id)) { toast('Digite o ID completo da pelada, por exemplo PL-7K3M9Q (ou cole o link de convite).', { type: 'warn' }); return false; }
  navigate('/pelada/p/' + id);
  return true;
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

/** Liga os comportamentos do topo dentro de `root`. `signal` é do roteador (limpa listeners ao sair da tela). */
export function wireShell(root, signal) {
  const closeMenus = () => root.querySelectorAll('[data-menu] .menu-pop').forEach(p => { p.hidden = true; p.parentElement.querySelector('[data-menu-btn]')?.setAttribute('aria-expanded', 'false'); });
  root.addEventListener('click', async e => {
    const btn = e.target.closest('[data-menu-btn]');
    if (btn) { const pop = btn.parentElement.querySelector('.menu-pop'), open = pop.hidden; closeMenus(); pop.hidden = !open; btn.setAttribute('aria-expanded', String(open)); e.stopPropagation(); return; }
    if (e.target.closest('[data-profile]')) { closeMenus(); openProfile(); return; }
    if (e.target.closest('[data-login]')) { const p = await openAuthDialog({ mode: 'login', title: 'Entrar na sua conta' }); if (p) location.reload(); return; }
    if (e.target.closest('[data-install]')) { if (canInstall()) await promptInstall(); else installDialog(); return; }
    if (!e.target.closest('.menu-pop')) closeMenus();
  });
  document.addEventListener('click', e => { if (!e.target.closest('[data-menu]')) closeMenus(); }, { signal });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); }, { signal });
  root.addEventListener('submit', e => { const f = e.target.closest('[data-idform]'); if (f) { e.preventDefault(); goToPelada(f.id.value); } });

  const sync = () => { const b = $('[data-install]', root); if (b) b.hidden = isStandalone(); };
  sync();
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
