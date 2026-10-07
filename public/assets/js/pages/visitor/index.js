// Página do visitante (sem login): /t/:id — início, jogos, chaveamento, times, inscrição e meu time.
import { html, render, ic, $, $$, on } from '../../ui/dom.js';
import { brand, userMenuHTML, wireMenus } from '../../ui/brand.js';
import { heroArt, sportIcon, statusBadge } from '../../ui/util.js';
import { openMatchDialog, mountBracket, startClockTicker } from '../../ui/match.js';
import { toast } from '../../ui/toast.js';
import { fetchPublicTournament, ApiError } from '../../api.js';
import { session } from '../../session.js';
import { navigate } from '../../router.js';
import { homeTab, matchesTab, teamsTab, bracketTab } from './tabs.js';
import { getMyTeam } from './store.js';
import { fmtBRL, fmtDay, normalizeTournamentId, TOURNAMENT_ID_RE } from '../../shared/format.js';

const TABS = [
  { key: '', label: 'Início', icon: 'home' },
  { key: 'jogos', label: 'Jogos', icon: 'radio' },
  { key: 'chaveamento', label: 'Chaveamento', short: 'Chave', icon: 'network' },
  { key: 'times', label: 'Times', icon: 'users' },
  { key: 'meu-time', label: 'Meu time', icon: 'user-check' },
];

function notFound(ctx, msg) {
  document.title = 'Torneio não encontrado · ArenaMaster AI';
  render(ctx.root, html`<header class="public-top">${brand()}<span class="spacer"></span>${userMenuHTML()}</header>
    <main class="v-wrap"><div class="card"><div class="empty" style="padding:48px 16px">${ic('search', { size: 36 })}<strong style="font-size:18px">Torneio não encontrado</strong><span>${msg || 'Confira o ID digitado ou peça o link ao organizador.'}</span>
      <form data-idform class="id-form" style="margin-top:8px"><input name="id" placeholder="AM-2026-9843" aria-label="ID do torneio" style="text-transform:uppercase"><button class="btn btn-primary" type="submit">Acessar</button></form></div></div></main>`);
  wireMenus(ctx.root, ctx.signal);
  ctx.root.addEventListener('submit', e => { const f = e.target.closest('[data-idform]'); if (!f) return; e.preventDefault(); const id = normalizeTournamentId(f.id.value); if (TOURNAMENT_ID_RE.test(id)) navigate('/t/' + id); else toast('Digite o ID completo, ex.: AM-2026-9843.', { type: 'warn' }); });
}

export default async function (ctx) {
  const rawId = normalizeTournamentId(ctx.params.id);
  if (!TOURNAMENT_ID_RE.test(rawId)) return notFound(ctx, 'O ID informado não parece válido. Ele tem o formato AM-2026-9843.');
  if (rawId !== ctx.params.id) return navigate(`/t/${rawId}${ctx.params.tab ? '/' + ctx.params.tab : ''}`, { replace: true });

  let first;
  try { first = await fetchPublicTournament(rawId); }
  catch (err) { return notFound(ctx, err.status === 404 ? null : err.message); }
  if (!ctx.isCurrent()) return;

  const tab = ctx.params.tab || '';
  const state = { t: first.tournament, etag: first.etag, offset: first.offset, tab, section: null, matchDlg: null };
  const v = {
    id: rawId,
    get t() { return state.t; },
    get offset() { return state.offset; },
    get now() { return Date.now() + state.offset; },
    get main() { return $('#vMain', ctx.root); },
    refresh: () => poll(true),
  };

  const known = ['', 'jogos', 'chaveamento', 'times', 'inscricao', 'meu-time'];
  if (!known.includes(tab)) return navigate('/t/' + rawId, { replace: true });

  const mine = () => getMyTeam(rawId);
  const link = k => `/t/${rawId}${k ? '/' + k : ''}`;

  function hero() {
    const t = state.t, r = t.registration;
    const open = r.open;
    if (state.tab === 'inscricao' || state.tab === 'meu-time') {
      // versão compacta nas telas de formulário: o conteúdo principal aparece mais cedo (importante no celular)
      return html`<section class="v-hero compact" aria-label="Resumo do torneio">${heroArt(t.sport)}
        <div class="stack-sm"><div class="row wrap" style="gap:8px">${statusBadge(t.status, t.statusLabel)}<span class="small" style="color:#9fb0cc">ID #${t.id}</span></div>
          <h1>${t.name}</h1>
          <div class="chips"><span class="chip">${ic('wallet', { size: 15 })} ${t.fee ? fmtBRL(t.fee) + ' por time' : 'Inscrição gratuita'}</span>${t.regDeadline ? html`<span class="chip">${ic('clock', { size: 15 })} <span data-cd="${t.regDeadline}" data-compact>Prazo: --</span></span>` : ''}<span class="chip">${ic('users', { size: 15 })} ${t.teamsConfirmed}/${t.maxTeams} times</span></div></div></section>`;
    }
    return html`<section class="v-hero" aria-label="Resumo do torneio">${heroArt(t.sport)}
      <div class="stack"><div class="row wrap" style="gap:8px">${statusBadge(t.status, t.statusLabel)}${t.demo ? html`<span class="badge gold">Demonstração</span>` : ''}${t.status === 'andamento' && state.t.bracket?.rounds.flatMap(rd => rd.matches).some(m => m.phase === 'live') ? html`<span class="badge live"><span class="dot"></span>Ao vivo</span>` : ''}</div>
        <h1>${t.name}</h1>
        <div class="chips"><span class="chip">${ic(sportIcon(t.sport), { size: 15 })} ${t.sportLabel}</span><span class="chip">${ic('calendar', { size: 15 })} Final ${fmtDay(t.finalDate, { day: '2-digit', month: 'short', year: 'numeric' })}</span>${t.venue ? html`<span class="chip">${ic('map-pin', { size: 15 })} ${t.venue}</span>` : ''}<span class="chip">${ic('wallet', { size: 15 })} ${t.fee ? fmtBRL(t.fee) + ' por time' : 'Inscrição gratuita'}</span><span class="chip">${ic('users', { size: 15 })} ${t.teamsConfirmed}/${t.maxTeams} times</span></div>
        <span class="small" style="color:#9fb0cc">ID #${t.id}</span></div>
      <div class="cta-card">${open ? html`
          <div class="row between"><b>Inscrições abertas</b><span class="badge ok">${r.slotsLeft} ${r.slotsLeft === 1 ? 'vaga' : 'vagas'}</span></div>
          ${t.regDeadline ? html`<div><span class="label">Termina em</span><div class="countdown" data-cd="${t.regDeadline}" aria-label="Tempo restante para se inscrever"><div><b data-d>--</b><span>dias</span></div><div><b data-h>--</b><span>horas</span></div><div><b data-m>--</b><span>min</span></div><div><b data-s>--</b><span>seg</span></div></div></div>` : html`<p class="small muted">Sem prazo definido: as inscrições fecham quando o organizador encerrar ou as vagas acabarem.</p>`}
          <a class="btn btn-primary btn-lg btn-block" href="${link('inscricao')}">${ic('user-plus', { size: 18 })} Inscrever meu time</a>`
        : html`<div class="row" style="align-items:flex-start">${ic('door-closed', { size: 22 })}<div><b>Inscrições encerradas</b><p class="small muted">${r.reason || ''}</p></div></div><a class="btn btn-primary btn-block" href="${link(t.bracket ? 'jogos' : '')}">Acompanhar o torneio</a>`}
        <a class="btn btn-block" href="${link('meu-time')}">${ic('user-check', { size: 16 })} ${mine() ? 'Meu time' : 'Já me inscrevi'}</a></div>
    </section>`;
  }

  function tabsNav() {
    const list = TABS.filter(x => x.key !== 'meu-time' || true);
    const showReg = state.tab === 'inscricao';
    return html`<nav class="v-tabs" aria-label="Seções do torneio"><div class="seg">${list.map(x => html`<a href="${link(x.key)}" ${state.tab === x.key ? 'aria-current="page"' : ''}>${ic(x.icon, { size: 16 })} <span class="lg">${x.label}</span><span class="sm">${x.short || x.label}</span></a>`)}${showReg ? html`<a href="${link('inscricao')}" aria-current="page">${ic('user-plus', { size: 16 })} Inscrição</a>` : ''}</div></nav>`;
  }

  function paintCountdown() {
    const el = $('[data-cd]', ctx.root); if (!el) return;
    const left = Math.max(0, new Date(el.dataset.cd).getTime() - v.now);
    const d = Math.floor(left / 86400000), h = Math.floor(left / 3600000) % 24, m = Math.floor(left / 60000) % 60, s = Math.floor(left / 1000) % 60;
    if (el.hasAttribute('data-compact')) { el.textContent = left > 0 ? `Faltam ${d ? d + 'd ' : ''}${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}min` : 'Prazo encerrado'; return; }
    const set = (k, val) => { const n = $(`[data-${k}]`, el); if (n) n.textContent = String(val).padStart(2, '0'); };
    set('d', d); set('h', h); set('m', m); set('s', s);
  }

  function frame() {
    document.title = `${state.t.name} · ArenaMaster AI`;
    render(ctx.root, html`
      ${session.config?.storage?.persistent === false ? html`<div class="storage-warn">⚠ Ambiente de demonstração com armazenamento temporário: os dados podem ser apagados.</div>` : ''}
      <div class="v-top"><header class="public-top">${brand()}<span class="spacer"></span>${session.user ? html`<a class="btn btn-sm" href="/">Meus torneios</a>` : html`<a class="btn btn-sm" href="/entrar">Sou organizador</a>`}${session.user ? userMenuHTML() : ''}</header></div>
      <main class="v-wrap"><div id="vHero">${hero()}</div>${tabsNav()}<div id="vMain" tabindex="-1"></div>
      <footer class="v-footer">Criado com <a href="/">ArenaMaster AI</a> · <a href="/cadastro">Crie seu torneio</a></footer></main>`);
    wireMenus(ctx.root, ctx.signal);
  }

  // ----- seções
  function simple(renderFn, { bracket = false } = {}) {
    let bc = null, stopTicker = null;
    const paint = root => {
      render(root, renderFn(v));
      if (bracket && state.t.bracket) { bc?.destroy(); bc = mountBracket($('#bracketCard', root), () => state.t, { onOpen: openMatch }); }
    };
    return { mount(root) { paint(root); stopTicker = startClockTicker(() => state.t, () => v.now, root); }, update() { const root = v.main; if (root && !document.querySelector('dialog[open]')) paint(root); }, destroy() { bc?.destroy(); stopTicker?.(); } };
  }
  function openMatch(key) { state.matchDlg = openMatchDialog(() => state.t, () => v.now, key); state.matchDlg.closed.then(() => { state.matchDlg = null; }); }

  async function loadSection() {
    state.section?.destroy?.();
    const root = v.main;
    if (state.tab === 'inscricao') state.section = (await import('./register.js')).default(v);
    else if (state.tab === 'meu-time') state.section = (await import('./myteam.js')).default(v);
    else if (state.tab === 'jogos') state.section = simple(matchesTab);
    else if (state.tab === 'times') state.section = simple(teamsTab);
    else if (state.tab === 'chaveamento') state.section = simple(bracketTab, { bracket: true });
    else state.section = simple(homeTab);
    state.section.mount(root);
  }

  frame();
  await loadSection();
  paintCountdown();

  // abrir partida ao clicar em qualquer elemento [data-open] fora do chaveamento
  ctx.root.addEventListener('click', e => { const el = e.target.closest('[data-open]:not(.match)'); if (el) openMatch(el.dataset.open); });

  const cd = setInterval(paintCountdown, 1000);
  let polling = false;
  async function poll(force = false) {
    if (polling || (document.hidden && !force)) return;
    polling = true;
    try {
      const r = await fetchPublicTournament(rawId, force ? null : state.etag);
      if (!ctx.isCurrent()) return;
      state.offset = r.offset;
      if (r.notModified) return;
      state.t = r.tournament; state.etag = r.etag;
      $('#vHero', ctx.root).innerHTML = hero().s;
      paintCountdown();
      state.section?.update?.(state.t);
      state.matchDlg?.refresh?.();
    } catch (err) { if (!(err instanceof ApiError) || err.status !== 0) console.warn('sincronização falhou', err.message); }
    finally { polling = false; }
  }
  let timer = setInterval(() => poll(), hasLive() ? 3000 : 6000);
  function hasLive() { return !!state.t.bracket && [...state.t.bracket.rounds.flatMap(r => r.matches), ...state.t.bracket.playins].some(m => m.phase === 'live'); }
  const retune = setInterval(() => { clearInterval(timer); timer = setInterval(() => poll(), hasLive() ? 3000 : 6000); }, 30000);
  const vis = () => { if (!document.hidden) poll(); };
  document.addEventListener('visibilitychange', vis);
  ctx.onLeave(() => { clearInterval(cd); clearInterval(timer); clearInterval(retune); document.removeEventListener('visibilitychange', vis); state.section?.destroy?.(); state.matchDlg?.close?.(); });
  void on; void $$;
}
