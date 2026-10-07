// Indicador do modo offline (selo fixo no canto) e painel "Sincronização" com o que está guardado ou deu problema.
import { html, render, ic, $, esc } from '../ui/dom.js';
import { openDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Estado do selo a partir do status do motor. Retorna null quando não há nada a mostrar.
 * Prioridade: precisa entrar → sem internet → sincronizando → aguardando envio → com problemas → "tudo sincronizado".
 */
export function describeStatus(s, { justSynced = false } = {}) {
  const alt = plural(s.pending, 'alteração', 'alterações');
  if (s.needsLogin && s.pending) return { state: 'login', icon: 'lock', text: `Entre de novo para enviar ${alt}` };
  if (!s.online) { // tentativas de envio sem conexão não contam como "sincronizando"
    return s.pending
      ? { state: 'offline', icon: 'wifi-off', text: `Sem internet · ${s.pending === 1 ? '1 alteração guardada' : `${s.pending} alterações guardadas`}` }
      : { state: 'offline', icon: 'wifi-off', text: 'Sem internet · o app continua funcionando' };
  }
  if (s.syncing && s.pending) return { state: 'syncing', icon: 'refresh-cw', text: `Sincronizando ${alt}…` };
  if (s.pending) return { state: 'pending', icon: 'refresh-cw', text: `${alt[0].toUpperCase()}${alt.slice(1)} aguardando envio` };
  if (s.failed) return { state: 'error', icon: 'triangle-alert', text: `${plural(s.failed, 'alteração não foi sincronizada', 'alterações não foram sincronizadas')}` };
  if (justSynced) return { state: 'ok', icon: 'circle-check', text: 'Tudo sincronizado' };
  return null;
}

const hhmm = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const when = ts => hhmm.format(new Date(ts));

function panelBody(s, pending, failed) {
  const intro = s.needsLogin ? 'Sua sessão expirou. Entre de novo para enviar o que foi feito sem internet; nada se perde enquanto isso.'
    : !s.online ? 'Você está sem internet. Pode continuar usando o app normalmente: tudo o que for feito fica guardado neste aparelho e é enviado sozinho quando a conexão voltar.'
      : s.pending ? 'A conexão voltou. As alterações abaixo estão sendo enviadas.'
        : 'Tudo o que foi feito neste aparelho já está no servidor.';
  return html`<div class="stack">
    <p style="margin:0">${intro}</p>
    ${s.durable === false ? html`<div class="form-note warn">${ic('triangle-alert', { size: 16 })}<span>Este navegador não permite guardar dados offline de forma durável: se você fechar o app agora, o que estiver aguardando envio pode se perder.</span></div>` : ''}
    ${pending.length ? html`<section><h4 class="list-title" style="margin:0 0 6px">Aguardando envio (${pending.length})</h4>
      <ul class="sync-list">${pending.map(o => html`<li><span class="grow">${o.label}</span><time class="muted small">${when(o.createdAt)}</time></li>`)}</ul></section>` : ''}
    ${failed.length ? html`<section><h4 class="list-title" style="margin:0 0 6px">Não foi possível enviar (${failed.length})</h4>
      <p class="muted small" style="margin:0 0 8px">O servidor recusou estas alterações (por exemplo, porque algo mudou enquanto você estava sem internet). As telas já mostram a situação real. Descarte para tirar da lista.</p>
      <ul class="sync-list">${failed.map(o => html`<li class="bad"><span class="grow"><b>${o.label}</b><br><span class="small">${o.error.message}</span></span><button type="button" class="btn btn-sm" data-discard="${o.key}">Descartar</button></li>`)}</ul></section>` : ''}
  </div>`;
}

/**
 * Cria o selo e liga ao motor. `onLogin` é chamado quando o usuário toca em "Entrar" (sessão expirada).
 * Retorna uma função para remover o selo.
 */
export function mountSyncStatus(engine, { onLogin } = {}) {
  if (!engine || typeof document === 'undefined') return () => {};
  const host = document.createElement('div');
  host.className = 'sync-host';
  host.innerHTML = '<button type="button" class="sync-chip" hidden aria-haspopup="dialog"></button>';
  document.body.append(host);
  const chip = $('.sync-chip', host);
  let ok = false, okTimer = 0, wasOffline = false, panel = null;

  const paint = s => {
    const d = describeStatus(s, { justSynced: ok });
    if (!d) { chip.hidden = true; chip.removeAttribute('data-state'); return; }
    chip.hidden = false; chip.dataset.state = d.state;
    chip.innerHTML = `<span class="sync-ico${d.state === 'syncing' || d.state === 'pending' ? ' spin' : ''}">${ic(d.icon, { size: 16 }).s}</span><span class="sync-text">${esc(d.text)}</span>`;
    chip.setAttribute('aria-label', `${d.text}. Toque para ver os detalhes.`);
  };

  const refreshPanel = async s => {
    if (!panel) return;
    const [pending, failed] = await Promise.all([engine.listPending(), engine.listFailed()]);
    const body = $('[data-body]', panel.el);
    if (body) render(body, panelBody(s, pending, failed));
    const retry = $('[data-retry]', panel.el);
    if (retry) retry.hidden = !(pending.length || failed.length);
    const login = $('[data-login]', panel.el);
    if (login) login.hidden = !s.needsLogin;
  };

  chip.addEventListener('click', async () => {
    if (panel) return;
    panel = openDialog({
      title: 'Sincronização',
      body: html`<div class="page-loading"><div class="spinner" role="status" aria-label="Carregando"></div></div>`,
      foot: html`<button class="btn btn-primary" data-login hidden>Entrar</button><button class="btn" data-retry hidden>${ic('refresh-cw', { size: 16 })} Tentar agora</button><button class="btn" data-close>Fechar</button>`,
    });
    panel.closed.then(() => { panel = null; });
    panel.el.addEventListener('click', async e => {
      const d = e.target.closest('[data-discard]');
      if (d) { await engine.discard(d.dataset.discard); return; }
      if (e.target.closest('[data-retry]')) { await engine.retryFailed(); await engine.flush({ manual: true }); return; }
      if (e.target.closest('[data-login]')) { panel.close(); onLogin?.(); }
    });
    await refreshPanel(engine.status());
  });

  const off = engine.subscribe(s => {
    if (s.type === 'offline' && !wasOffline) {
      wasOffline = true;
      toast('Você está sem internet. O app continua funcionando e envia tudo sozinho quando ela voltar.', { type: 'warn', ms: 6500 });
    }
    if (s.type === 'online' && wasOffline) wasOffline = false;
    if (s.type === 'synced') {
      ok = true; clearTimeout(okTimer); okTimer = setTimeout(() => { ok = false; paint(engine.status()); }, 3500);
      toast(s.sent === 1 ? 'Alteração sincronizada com o servidor.' : `${s.sent} alterações sincronizadas com o servidor.`, { type: 'success', ms: 3500 });
    }
    if (s.type === 'conflict') {
      toast(`Não foi possível sincronizar uma alteração (${s.op.label}): ${s.op.error.message}`, { type: 'error', ms: 9000 });
    }
    paint(s);
    refreshPanel(s);
  });
  paint(engine.status());

  return () => { off(); clearTimeout(okTimer); host.remove(); };
}
