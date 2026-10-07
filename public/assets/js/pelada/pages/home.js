// Tela inicial do app Pelada (aberta pelo ícone instalado): destaque "Organize a pelada" e entrada por ID.
import { html, render, ic } from '../../ui/dom.js';
import { S } from '../session.js';
import { navigate } from '../../router.js';
import { page, wireShell } from '../ui/shell.js';
import { isStandalone } from '../pwa.js';

export default async function (ctx) {
  // quem já tem conta (ex.: app instalado) vai direto para o painel
  if (S.player && !ctx.query.inicio) return navigate('/pelada/painel', { replace: true });
  document.title = 'Pelada — organize, sorteie os times e marque os gols';
  render(ctx.root, page(html`
    <section class="pl-hero">
      <div class="hero-copy">
        <span class="eyebrow">${ic('soccer', { size: 16 })} Pelada · grátis</span>
        <h1>Sua pelada, <span class="acc">sem confusão</span>.</h1>
        <p class="lead">Crie a pelada, convide a galera por link, confirme a presença, sorteie os times com animação, anote os gols e compartilhe a artilharia no WhatsApp.</p>
        <div class="hero-cta"><a class="btn btn-xl btn-gold" href="/pelada/organizar">${ic('trophy', { size: 22 })} Organize a pelada</a>
          <span class="muted-on-dark small">Conta em 10 segundos: só nome e data de nascimento.</span></div>
      </div>
      <form class="join-card" data-idform><h2>Entrar numa pelada</h2><p class="muted small" style="margin:0">Cole o ID que o organizador compartilhou (ou abra o link de convite).</p>
        <div class="field"><label for="join-id" class="sr-only">ID da pelada</label><input id="join-id" name="id" placeholder="PL-7K3M9Q" autocomplete="off" maxlength="80" style="text-transform:uppercase;font-weight:700;letter-spacing:.04em"></div>
        <button class="btn btn-primary btn-block" type="submit">Acessar pelada ${ic('arrow-right', { size: 18 })}</button></form>
    </section>
    <section class="features">
      <div class="card feature"><span class="f-ico">${ic('list-checks', { size: 22 })}</span><h3>Lista de presença</h3><p>Cada jogador marca ou retira a presença no dia do jogo. Nome e foto aparecem na hora.</p></div>
      <div class="card feature"><span class="f-ico">${ic('shuffle', { size: 22 })}</span><h3>Sorteio inteligente</h3><p>Times sorteados com animação, capitão e regra de sobra para ninguém ficar de fora.</p></div>
      <div class="card feature"><span class="f-ico">${ic('timer', { size: 22 })}</span><h3>Súmula e cronômetro</h3><p>Placar, gols de cada jogador e próxima partida criada automaticamente: quem ganha fica.</p></div>
      <div class="card feature"><span class="f-ico">${ic('medal', { size: 22 })}</span><h3>Artilharia no WhatsApp</h3><p>Pódio ouro, prata e bronze do dia e geral, em imagem pronta para o grupo.</p></div>
    </section>
    <section class="install-banner" ${isStandalone() ? 'hidden' : ''}><div>${ic('smartphone', { size: 26 })}</div><div class="grow"><strong>Leve a Pelada no celular</strong><span class="muted small" style="display:block">Instale como app ou favorite esta página para abrir direto na sua pelada.</span></div><button class="btn btn-light" type="button" data-install>${ic('download', { size: 18 })} Instalar app</button></section>`));
  wireShell(ctx.root, ctx.signal);
}
