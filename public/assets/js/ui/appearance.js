// Seção "Aparência" do perfil: Automático (tema do celular), Claro ou Escuro. A lógica está em /assets/js/theme.js.
import { html } from './dom.js';

const MODES = [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']];
const current = () => window.AMTheme?.get() || 'auto';

export const appearanceHTML = () => html`<div class="appearance" data-appearance>
  <h4 style="margin:6px 0 0;font-size:15px">Aparência</h4>
  <div class="seg" role="group" aria-label="Aparência do app">${MODES.map(([k, label]) => html`<button type="button" data-theme-mode="${k}" aria-pressed="${String(current() === k)}">${label}</button>`)}</div>
  <p class="muted small" style="margin:0">Automático usa o tema do seu celular (claro ou escuro).</p></div>`;

/** Liga os botões de aparência dentro de `root`. */
export function wireAppearance(root) {
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-theme-mode]');
    if (!b) return;
    window.AMTheme?.set(b.dataset.themeMode);
    root.querySelectorAll('[data-theme-mode]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
}
