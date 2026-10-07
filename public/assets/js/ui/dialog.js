import { html, render, ic, $, $$ } from './dom.js';

/**
 * Abre um modal. `body`/`foot` são templates html``. Retorna { el, close, closed }.
 * Elementos com [data-close] fecham o modal; [data-close="value"] define o returnValue.
 */
export function openDialog({ title, body, foot = null, wide = false, onOpen = null, dismissible = true }) {
  const dlg = document.createElement('dialog');
  if (wide) dlg.className = 'wide';
  render(dlg, html`
    <div class="dlg-head"><h3>${title}</h3>${dismissible ? html`<button type="button" class="icon-btn" data-close aria-label="Fechar">${ic('x')}</button>` : ''}</div>
    <div class="dlg-body" data-body>${body}</div>
    ${foot ? html`<div class="dlg-foot" data-foot>${foot}</div>` : ''}`);
  document.body.append(dlg);
  const closed = new Promise(res => dlg.addEventListener('close', () => { res(dlg.returnValue); dlg.remove(); }, { once: true }));
  dlg.addEventListener('click', e => {
    const c = e.target.closest('[data-close]');
    if (c) { dlg.close(c.dataset.close || ''); return; }
    if (dismissible && e.target === dlg) dlg.close('');
  });
  if (!dismissible) dlg.addEventListener('cancel', e => e.preventDefault());
  dlg.showModal();
  if (onOpen) onOpen(dlg);
  return { el: dlg, close: v => dlg.close(v || ''), closed };
}

export async function confirmDialog({ title, text, ok = 'Confirmar', cancel = 'Cancelar', danger = false }) {
  const d = openDialog({
    title, body: html`<p>${text}</p>`,
    foot: html`<button class="btn" data-close="cancel">${cancel}</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-close="ok">${ok}</button>`,
  });
  return (await d.closed) === 'ok';
}

export { $, $$ };
