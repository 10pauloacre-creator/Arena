import { esc } from './dom.js';
import { icon } from '../icons.js';

const ICONS = { success: 'circle-check', error: 'circle-x', warn: 'triangle-alert', info: 'info' };

export function toast(msg, { type = 'info', ms = 4200, action = null } = {}) {
  let host = document.getElementById('toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.append(host); }
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `${icon(ICONS[type] || 'info', { size: 20 })}<span>${esc(msg)}</span>`;
  let timer;
  const remove = () => { clearTimeout(timer); el.classList.add('out'); setTimeout(() => el.remove(), 220); };
  if (action) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = action.label;
    b.addEventListener('click', () => { action.fn(); remove(); });
    el.append(b);
  }
  host.append(el);
  timer = setTimeout(remove, ms);
  return remove;
}
