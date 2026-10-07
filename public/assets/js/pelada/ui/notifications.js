// Notificações na tela: sininho do topo (com contador), painel com as últimas, itens da lista e aviso rápido
// quando chega algo novo com o app aberto.
import { html, ic, render, $ } from '../../ui/dom.js';
import { openDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { navigate } from '../../router.js';
import { N, onNotif, onArrive, refreshNotifications, markAllRead, markRead, serverNow } from '../notify.js';
import { NOTIF_BY_KEY, timeAgo } from '../../shared/notifications.js';

const countLabel = n => (n ? `Notificações: ${n} ${n === 1 ? 'nova' : 'novas'}` : 'Notificações');
const countText = n => (n > 99 ? '99+' : String(n));

/** Botão do sininho (o contador é atualizado em todos os sininhos da tela). */
export const bellButton = () => html`<button type="button" class="icon-btn bell" data-bell aria-label="${countLabel(N.unread)}" title="Notificações">${ic('bell', { size: 22 })}<span class="bell-count" data-bell-count ${N.unread ? '' : 'hidden'}>${countText(N.unread)}</span></button>`;

function syncBells() {
  document.querySelectorAll('[data-bell]').forEach(b => {
    b.setAttribute('aria-label', countLabel(N.unread));
    const c = b.querySelector('[data-bell-count]');
    if (c) { c.hidden = !N.unread; c.textContent = countText(N.unread); }
  });
}

/** Um item da lista. `hl` = destacar como não lida. */
export function itemHTML(it, { now = serverNow(), hl = it.unread } = {}) {
  const type = NOTIF_BY_KEY[it.type];
  return html`<li><a class="ntf-item${hl ? ' unread' : ''}" href="${it.url}" data-ntf="${it.id}">
    <span class="ntf-ico t-${it.type}" aria-hidden="true">${ic(type?.icon || 'bell', { size: 18 })}</span>
    <span class="ntf-body"><b class="ntf-title">${it.title}</b><span class="ntf-text">${it.text}</span>
      <span class="ntf-meta"><span class="ellipsis">${it.pelada.name}</span> · <time datetime="${new Date(it.at).toISOString()}">${timeAgo(it.at, now)}</time></span></span>
    ${hl ? html`<span class="ntf-dot"><span class="sr-only">Não lida</span></span>` : ''}</a></li>`;
}

/** Lista (ou o estado vazio). `hl` = conjunto de ids destacados. */
export function listHTML(items, { hl = new Set(), compact = false } = {}) {
  if (N.prefs && !N.prefs.enabled) {
    return html`<div class="empty">${ic('bell')}<strong>Notificações desligadas</strong><span>Ligue em Configurações para saber quem entrou na pelada, presenças, sorteios e resultados.</span><a class="btn btn-sm btn-primary" href="/pelada/configuracoes" data-close>${ic('settings', { size: 16 })} Abrir configurações</a></div>`;
  }
  if (!N.loaded) return html`<div class="ntf-list">${[1, 2, 3].map(() => html`<div class="skeleton" style="height:64px;border-radius:12px"></div>`)}</div>`;
  if (!items.length) {
    return html`<div class="empty">${ic('bell')}<strong>Nenhuma notificação por enquanto</strong><span>${compact ? 'Aqui aparecem' : 'Quando acontecer algo nas suas peladas, aparece aqui:'} novos participantes, presenças no jogo do dia, sorteio de times e resultados.</span></div>`;
  }
  const now = serverNow();
  return html`<ul class="ntf-list">${items.map(it => itemHTML(it, { now, hl: hl.has(it.id) || it.unread }))}</ul>`;
}

/** Abre o painel com as últimas notificações e marca todas como lidas (os novos continuam destacados enquanto aberto). */
export function openNotifPanel() {
  const hl = new Set(N.items.filter(i => i.unread).map(i => i.id));
  const d = openDialog({
    title: 'Notificações',
    cls: 'ntf-dlg',
    body: html`<div data-ntf-panel aria-live="polite"></div>`,
    foot: html`<a class="btn btn-sm btn-ghost" href="/pelada/configuracoes" data-close>${ic('settings', { size: 16 })} Configurar</a><a class="btn btn-sm btn-primary" href="/pelada/notificacoes" data-close>Ver todas</a>`,
  });
  const box = $('[data-ntf-panel]', d.el);
  const paint = () => { N.items.forEach(i => { if (i.unread) hl.add(i.id); }); render(box, listHTML(N.items.slice(0, 20), { hl, compact: true })); };
  paint();
  const off = onNotif(paint);
  d.closed.then(off);
  d.el.addEventListener('click', e => { if (e.target.closest('[data-ntf]')) d.close(); });
  refreshNotifications().then(() => { paint(); return markAllRead(); });
  return d;
}

function announce(fresh) {
  if (N.prefs && N.prefs.popup === false) return;
  if (document.querySelector('dialog.ntf-dlg[open]') || location.pathname === '/pelada/notificacoes') return; // já está vendo a lista
  if (fresh.length === 1) {
    const it = fresh[0];
    toast(`${it.title}: ${it.text}`, { ms: 7000, action: { label: 'Ver', fn: () => { markRead([it.id]); navigate(it.url); } } });
  } else {
    toast(`Você tem ${fresh.length} notificações novas.`, { ms: 7000, action: { label: 'Ver', fn: openNotifPanel } });
  }
}

let wired = false;
/** Liga o contador dos sininhos, os avisos de chegada e o clique no sininho (uma vez por carregamento do app). */
export function initNotifUi() {
  if (wired) return;
  wired = true;
  onNotif(syncBells);
  onArrive(announce);
  document.addEventListener('click', e => {
    if (e.defaultPrevented || !e.target.closest('[data-bell]')) return;
    openNotifPanel();
  });
}
