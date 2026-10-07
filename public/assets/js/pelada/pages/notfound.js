import { html, render, ic } from '../../ui/dom.js';
import { page, wireShell } from '../ui/shell.js';

export default function (ctx) {
  document.title = 'Página não encontrada · Pelada';
  render(ctx.root, page(html`<div class="empty" style="margin-top:40px">${ic('search')}<strong>Página não encontrada</strong><span>O endereço não existe no app Pelada.</span><a class="btn btn-primary" href="/pelada/">Voltar ao início</a></div>`));
  wireShell(ctx.root, ctx.signal);
}
