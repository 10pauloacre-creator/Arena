// Página "Notificações": tudo o que aconteceu nas peladas do jogador, agrupado por dia. Abrir a página marca como lidas.
import { html, render, ic, $ } from '../../ui/dom.js';
import { S } from '../session.js';
import { navigate } from '../../router.js';
import { page, wireShell } from '../ui/shell.js';
import { listHTML } from '../ui/notifications.js';
import { N, onNotif, refreshNotifications, markAllRead, serverNow } from '../notify.js';
import { isoBR, dayName } from '../../shared/notifications.js';

const GROUPS = { hoje: 'Hoje', ontem: 'Ontem' };

export default async function (ctx) {
  if (!S.player) return navigate('/pelada/entrar?next=' + encodeURIComponent('/pelada/notificacoes'), { replace: true });
  document.title = 'Notificações · Pelada';
  const hl = new Set();
  render(ctx.root, page(html`
    <div class="row between wrap" style="gap:12px"><div><h1 style="font-size:28px">Notificações</h1><p class="muted">O que aconteceu nas suas peladas: participantes, presenças, sorteios, partidas e agenda.</p></div>
      <a class="btn" href="/pelada/configuracoes">${ic('settings', { size: 18 })} Configurar notificações</a></div>
    <section class="card ntf-card" aria-label="Lista de notificações"><div data-ntf-page aria-live="polite"></div></section>`, { cls: 'narrow' }));
  wireShell(ctx.root, ctx.signal);

  function paint() {
    N.items.forEach(i => { if (i.unread) hl.add(i.id); });
    const box = $('[data-ntf-page]', ctx.root);
    if (!box) return;
    if (!N.loaded || !N.items.length || (N.prefs && !N.prefs.enabled)) { render(box, listHTML(N.items, { hl })); return; }
    // agrupa por dia: Hoje, Ontem, sáb, 03/10…
    const today = isoBR(serverNow());
    const groups = new Map();
    for (const it of N.items) {
      const d = isoBR(it.at), name = dayName(d, today);
      const key = GROUPS[name] || name.charAt(0).toUpperCase() + name.slice(1);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    render(box, html`${[...groups].map(([title, items]) => html`<h2 class="ntf-group">${title}</h2>${listHTML(items, { hl })}`)}`);
  }
  paint();
  const off = onNotif(paint);
  ctx.onLeave(off);
  await refreshNotifications();
  if (!ctx.isCurrent()) return;
  paint();
  await markAllRead();
}
