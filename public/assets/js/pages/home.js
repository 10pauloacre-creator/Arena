import { html, render, ic, $, on, setBusy } from '../ui/dom.js';
import { brand, userMenuHTML, wireMenus, storageBanner } from '../ui/brand.js';
import { heroArt, sportIcon, statusBadge } from '../ui/util.js';
import { openDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { setFieldError, clearErrors } from '../ui/forms.js';
import { api } from '../api.js';
import { session } from '../session.js';
import { navigate } from '../router.js';
import { SPORTS } from '../shared/sports.js';
import { fmtDayShort, normalizeTournamentId, TOURNAMENT_ID_RE } from '../shared/format.js';
import { isoDay } from '../shared/dates.js';

const topbar = () => html`${storageBanner()}<header class="public-top">${brand()}<span class="spacer"></span>
  <form class="id-form id-form-top" data-idform role="search"><input name="id" placeholder="ID do torneio" aria-label="ID do torneio" autocomplete="off" maxlength="20"><button class="btn btn-sm" type="submit">Acessar</button></form>
  ${userMenuHTML()}</header>`;

function goToTournament(raw) {
  const id = normalizeTournamentId(raw);
  if (!TOURNAMENT_ID_RE.test(id)) { toast('Digite o ID completo, por exemplo AM-2026-9843.', { type: 'warn' }); return false; }
  navigate('/t/' + id);
  return true;
}

function newTournamentDialog() {
  const d = openDialog({
    title: 'Novo torneio',
    body: html`<form id="newT" class="stack" novalidate>
      <div class="field" data-f="name"><label for="nt-name">Nome do torneio <span class="req">*</span></label><input id="nt-name" name="name" maxlength="60" autocomplete="off" placeholder="Ex.: Copa de Futsal Amigos da Vila 2026"><span class="field-error"></span></div>
      <fieldset style="border:0;padding:0;margin:0"><legend class="label" style="margin-bottom:8px">Modalidade</legend>
        <div class="tiles c2">${Object.values(SPORTS).map((s, i) => html`<div class="tile sm"><input type="radio" name="sport" id="nt-${s.key}" value="${s.key}" ${i === 1 ? 'checked' : ''}><label for="nt-${s.key}"><span class="t-ico">${ic(s.icon, { size: 22 })}</span><span><span class="t-title">${s.label}</span><span class="t-sub">${s.sub}</span></span></label></div>`)}</div></fieldset>
      <div class="field" data-f="finalDate"><label for="nt-date">Data da grande final</label><input id="nt-date" type="date" name="finalDate" value="${isoDay(new Date(Date.now() + 30 * 86400_000))}"><span class="field-error"></span></div>
      <label class="check"><input type="checkbox" name="demo"><span><b>Torneio de demonstração</b><br><span class="muted small">Já vem com 8 times de exemplo para você testar sorteio, jogos ao vivo e repescagem sem inscrições reais.</span></span></label>
      <div class="form-error" hidden></div>
    </form>`,
    foot: html`<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" type="submit" form="newT" id="ntGo">${ic('plus', { size: 18 })} Criar torneio</button>`,
  });
  const form = $('#newT', d.el);
  $('#nt-name', d.el).focus();
  form.addEventListener('submit', async e => {
    e.preventDefault(); clearErrors(form);
    const body = { name: form.name.value.trim(), sport: form.sport.value, finalDate: form.finalDate.value, demo: form.demo.checked };
    if (body.name.length < 3) { setFieldError($('[data-f=name]', form), 'Informe o nome do torneio (mínimo 3 letras).'); form.name.focus(); return; }
    if (!body.finalDate) { setFieldError($('[data-f=finalDate]', form), 'Escolha a data da final.'); return; }
    const btn = $('#ntGo', d.el); setBusy(btn, true);
    try {
      const r = await api.post('/tournaments', body);
      d.close('ok');
      toast('Torneio criado! Ajuste as configurações e abra as inscrições.', { type: 'success' });
      navigate('/admin/' + r.tournament.id);
    } catch (err) {
      setBusy(btn, false);
      const box = $('.form-error', form); box.hidden = false; box.textContent = err.message;
    }
  });
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
      <div class="card feature"><span class="f-ico">${ic('qr-code', { size: 22 })}</span><h3>Inscrição com pagamento</h3><p>Cada time se inscreve pelo link, paga por PIX ou cartão e entra na lista assim que o pagamento é confirmado.</p></div>
      <div class="card feature"><span class="f-ico">${ic('network', { size: 22 })}</span><h3>Chaveamento justo</h3><p>Sorteio que equilibra as chaves, evita confrontos entre times do mesmo bairro e registra uma semente auditável.</p></div>
      <div class="card feature"><span class="f-ico">${ic('radio', { size: 22 })}</span><h3>Jogos ao vivo</h3><p>Placar, relógio e lances em tempo real para os visitantes, mais transmissão do YouTube ou Twitch.</p></div>
    </section></main>`);
  wire(ctx);
}

function wire(ctx) {
  wireMenus(ctx.root, ctx.signal);
  on(ctx.root, 'click', '[data-new]', () => newTournamentDialog());
  ctx.root.addEventListener('submit', e => { const f = e.target.closest('[data-idform]'); if (f) { e.preventDefault(); goToTournament(f.id.value); } });
}

export default async function (ctx) {
  document.title = 'ArenaMaster AI — Torneios sem complicação';
  if (session.user) await loggedIn(ctx); else landing(ctx);
}
