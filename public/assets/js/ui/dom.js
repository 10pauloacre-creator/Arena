// Utilitários de DOM: template com escape automático (anti-XSS), seletores e delegação de eventos.
import { icon } from '../icons.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(String(s ?? ''));
const part = v => {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
};
/** Template tag: valores são escapados, exceto os criados por html``/raw(). */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Raw(out);
}
export const ic = (name, opts) => raw(icon(name, opts));
export const render = (el, tpl) => { el.innerHTML = tpl instanceof Raw ? tpl.s : String(tpl); return el; };

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

/** Delegação: on(root, 'click', '[data-act]', (e, el) => …) */
export function on(root, type, selector, handler) {
  root.addEventListener(type, e => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) handler(e, el);
  });
}

export function setBusy(btn, busy) {
  if (!btn) return;
  btn.classList.toggle('is-loading', !!busy);
  btn.disabled = !!busy;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    try {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.append(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch { return false; }
  }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
