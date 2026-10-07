import { html, render, ic } from '../ui/dom.js';
import { brand } from '../ui/brand.js';

export default function (ctx) {
  document.title = 'Página não encontrada · ArenaMaster AI';
  render(ctx.root, html`<div class="auth"><div class="auth-main"><div class="auth-card center">
    <div style="display:grid;place-items:center;color:var(--ink)">${brand()}</div>
    <div class="empty" style="margin-top:12px">${ic('search')}<strong>Página não encontrada</strong><span>O endereço digitado não existe.</span><a class="btn btn-primary" href="/">Ir para o início</a></div>
  </div></div></div>`);
}
