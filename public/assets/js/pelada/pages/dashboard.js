// Dashboard do jogador: peladas que organiza, peladas em que participa, criar nova e entrar por ID.
import { html, render, ic, $ } from '../../ui/dom.js';
import { api } from '../../api.js';
import { S, setPlayer } from '../session.js';
import { navigate } from '../../router.js';
import { page, wireShell, dayShort } from '../ui/shell.js';
import { peladaAvatar } from '../ui/img.js';
import { GENDERS, firstName } from '../../shared/pelada.js';

function card(p) {
  return html`<a class="pel-card" href="/pelada/p/${p.id}">
    ${peladaAvatar(p, 56)}
    <div class="grow" style="min-width:0"><strong class="ellipsis" style="display:block;font-size:16px">${p.name}</strong>
      <span class="muted small">${p.nextDate ? html`${ic('calendar', { size: 13 })} Próximo jogo: <b>${dayShort(p.nextDate)}</b>` : p.lastDate ? html`Último jogo: ${dayShort(p.lastDate)}` : 'Sem datas ainda'}</span>
      <div class="row wrap" style="gap:6px;margin-top:6px"><span class="badge ${p.gender === 'feminino' ? 'pink' : 'info'}">${GENDERS[p.gender].label}</span><span class="badge">${ic('users', { size: 13 })} ${p.members}</span>${p.role === 'owner' ? html`<span class="badge gold">Organizador</span>` : p.owner ? html`<span class="badge">de ${firstName(p.owner)}</span>` : ''}${p.demo ? html`<span class="badge warn">Demonstração</span>` : ''}</div></div>
    ${ic('chevron-right', { size: 20 })}</a>`;
}

export default async function (ctx) {
  if (!S.player) return navigate('/pelada/entrar?next=' + encodeURIComponent('/pelada/painel'), { replace: true });
  document.title = 'Minhas peladas · Pelada';
  render(ctx.root, page(html`
    <div class="row between wrap" style="gap:16px"><div><h1 style="font-size:28px">Olá, ${firstName(S.player.name)}!</h1><p class="muted">Crie uma pelada nova, ou entre em uma com o ID ou o link de convite.</p></div>
      <a class="btn btn-lg btn-gold" href="/pelada/nova">${ic('plus', { size: 20 })} Criar nova pelada</a></div>
    <form class="join-inline card" data-idform><div class="grow"><label for="dash-id" class="label">Entrar numa pelada pelo ID</label><div class="row" style="gap:8px;margin-top:6px"><input id="dash-id" name="id" placeholder="Cole o ID ou o link de convite" autocomplete="off" maxlength="80" class="input"><button class="btn btn-primary" type="submit">Entrar ${ic('arrow-right', { size: 18 })}</button></div></div></form>
    <div id="lists"><div class="pel-list">${[1, 2].map(() => html`<div class="skeleton" style="height:96px;border-radius:16px"></div>`)}</div></div>`));
  wireShell(ctx.root, ctx.signal);
  try {
    const { created, joined } = await api.get('/pelada/mine');
    if (!ctx.isCurrent()) return;
    $('#lists', ctx.root).innerHTML = html`
      <section class="dash-sec"><h2 class="section-title">Peladas que eu organizo</h2>
        ${created.length ? html`<div class="pel-list">${created.map(card)}</div>` : html`<div class="empty">${ic('trophy')}<strong>Você ainda não criou nenhuma pelada</strong><span>Defina nome, regras e datas em um minuto e compartilhe o link de convite.</span><a class="btn btn-primary" href="/pelada/nova">${ic('plus', { size: 18 })} Criar minha primeira pelada</a></div>`}</section>
      <section class="dash-sec"><h2 class="section-title">Peladas que eu participo</h2>
        ${joined.length ? html`<div class="pel-list">${joined.map(card)}</div>` : html`<div class="empty">${ic('users')}<strong>Você ainda não entrou em nenhuma pelada</strong><span>Abra o link que o organizador enviou ou cole o ID no campo acima.</span></div>`}</section>`.s;
  } catch (err) {
    if (err.status === 401) { setPlayer(null); return navigate('/pelada/entrar?next=' + encodeURIComponent('/pelada/painel'), { replace: true }); }
    $('#lists', ctx.root).innerHTML = html`<div class="form-error">${err.message}</div>`.s;
  }
}
