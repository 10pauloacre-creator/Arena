import { html, render, ic, $, on } from '../ui/dom.js';
import { brand, userMenuHTML, wireMenus, storageBanner } from '../ui/brand.js';
import { heroArt, sportIcon, statusBadge } from '../ui/util.js';
import { toast } from '../ui/toast.js';
import { api } from '../api.js';
import { session } from '../session.js';
import { navigate } from '../router.js';
import { fmtDayShort, normalizeTournamentId, TOURNAMENT_ID_RE } from '../shared/format.js';

const topbar = () => html`${storageBanner()}<header class="public-top">${brand()}<span class="spacer"></span>
  <form class="id-form id-form-top" data-idform role="search"><input name="id" placeholder="ID do torneio" aria-label="ID do torneio" autocomplete="off" maxlength="20"><button class="btn btn-sm" type="submit">Acessar</button></form>
  ${userMenuHTML()}</header>`;

function goToTournament(raw) {
  const id = normalizeTournamentId(raw);
  if (!TOURNAMENT_ID_RE.test(id)) { toast('Digite o ID completo, por exemplo AM-2026-9843.', { type: 'warn' }); return false; }
  navigate('/t/' + id);
  return true;
}

function tournamentCard(t) {
  const final = t.finalDate ? fmtDayShort(t.finalDate) : '—';
  const pct = Math.round(t.teamsConfirmed / t.maxTeams * 100);
  return html`<a class="t-card" href="/admin/${t.id}">
    <div class="t-top"><span class="t-sport">${ic(sportIcon(t.sport), { size: 24 })}</span>${statusBadge(t.status, t.statusLabel)}</div>
    <div><h3>${t.name}</h3><span class="t-id">#${t.id}</span></div>
    <div class="t-info">
      <div>${ic('trophy', { size: 16 })} ${t.sportLabel}${t.demo ? html` <span class="badge gold">Demo</span>` : ''}${t.role === 'owner' ? '' : html` <span class="badge">Co-admin</span>`}</div>
      <div>${ic('calendar', { size: 16 })} Final em ${final}</div>
      <div>${ic('users', { size: 16 })} ${t.teamsConfirmed} de ${t.maxTeams} times</div>
    </div>
    <div class="progress" aria-hidden="true"><span style="width:${pct}%"></span></div>
  </a>`;
}

async function loggedIn(ctx) {
  render(ctx.root, html`${topbar()}<main class="home"><div class="row between wrap"><div><h1 style="font-size:28px">Meus torneios</h1><p class="muted">Olá, ${session.user.name.split(' ')[0]}! Escolha um torneio para gerenciar ou crie um novo.</p></div><button class="btn btn-primary" data-new>${ic('plus', { size: 18 })} Novo torneio</button></div><div id="grid" class="t-grid">${[1, 2, 3].map(() => html`<div class="skeleton" style="height:240px;border-radius:16px"></div>`)}</div></main>`);
  wire(ctx);
  try {
    const { tournaments } = await api.get('/tournaments');
    if (!ctx.isCurrent()) return;
    $('#grid', ctx.root).innerHTML = (tournaments.length
      ? html`${tournaments.map(tournamentCard)}<button type="button" class="t-card new" data-new><span class="plus">${ic('plus', { size: 26 })}</span><strong>Criar novo torneio</strong><span class="muted small">Comece em menos de um minuto</span></button>`
      : html`<div class="empty" style="grid-column:1/-1;padding:56px 16px">${ic('trophy', { size: 40 })}<strong style="font-size:18px">Você ainda não tem torneios</strong><span>Crie o primeiro, convide outros organizadores e compartilhe o link com os times.</span><button class="btn btn-primary" data-new>${ic('plus', { size: 18 })} Criar meu primeiro torneio</button></div>`).s;
  } catch (err) {
    if (err.status === 401) { session.user = null; return navigate('/entrar'); }
    $('#grid', ctx.root).innerHTML = `<div class="form-error" style="grid-column:1/-1">${err.message}</div>`;
  }
}

function landing(ctx) {
  render(ctx.root, html`${topbar()}<main class="home">
    <section class="landing-hero">${heroArt('futsal')}
      <div><h1>Seu torneio, do <span class="acc">sorteio</span> ao campeão.</h1>
        <p>Abra inscrições com pagamento por PIX ou cartão, sorteie o chaveamento de forma justa e deixe todo mundo acompanhar os jogos ao vivo — tudo em um único painel.</p>
        <div class="ctas"><a class="btn btn-lg btn-light" href="/cadastro">${ic('trophy', { size: 20 })} Criar meu torneio</a><a class="btn btn-lg" style="background:rgb(255 255 255 / .1);color:#fff;border-color:rgb(255 255 255 / .25)" href="/entrar">Já tenho conta</a></div></div>
      <form class="join-card" data-idform><h2 style="font-size:20px">Participar de um torneio</h2><p class="muted small" style="margin:0">Digite o ID que o organizador compartilhou (ou abra o link direto).</p>
        <div class="field"><label for="join-id" class="sr-only">ID do torneio</label><input id="join-id" name="id" placeholder="AM-2026-9843" autocomplete="off" maxlength="20" style="text-transform:uppercase;font-weight:700;letter-spacing:.04em"></div>
        <button class="btn btn-primary btn-block" type="submit">Acessar torneio ${ic('arrow-right', { size: 18 })}</button></form>
    </section>
    <section class="features">
      <div class="card feature"><span class="f-ico">${ic('qr-code', { size: 22 })}</span><h3>Inscrição paga ou gratuita</h3><p>Cada time se inscreve pelo link. Com valor, paga por PIX ou cartão e entra na lista assim que o pagamento é confirmado; se for gratuita, entra na hora.</p></div>
      <div class="card feature"><span class="f-ico">${ic('network', { size: 22 })}</span><h3>Chaveamento justo</h3><p>Sorteio que equilibra as chaves, evita confrontos entre times do mesmo bairro e registra uma semente auditável.</p></div>
      <div class="card feature"><span class="f-ico">${ic('radio', { size: 22 })}</span><h3>Jogos ao vivo</h3><p>Placar, relógio e lances em tempo real para os visitantes, mais transmissão do YouTube ou Twitch.</p></div>
    </section></main>`);
  wire(ctx);
}

function wire(ctx) {
  wireMenus(ctx.root, ctx.signal);
  on(ctx.root, 'click', '[data-new]', () => navigate('/novo-torneio'));
  ctx.root.addEventListener('submit', e => { const f = e.target.closest('[data-idform]'); if (f) { e.preventDefault(); goToTournament(f.id.value); } });
}

export default async function (ctx) {
  document.title = 'ArenaMaster AI — Torneios sem complicação';
  if (session.user) await loggedIn(ctx); else landing(ctx);
}
