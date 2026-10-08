// Shell do administrador: sidebar, topbar, notificações, sincronização e roteamento de seções.
import { html, render, ic, $, $$, esc } from '../../ui/dom.js';
import { brand, userMenuHTML, wireMenus } from '../../ui/brand.js';
import { confirmDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { relTime } from '../../ui/util.js';
import { api, ApiError } from '../../api.js';
import { session } from '../../session.js';
import { navigate } from '../../router.js';

const SECTIONS = [
  { key: 'painel', path: '', label: 'Painel', title: 'Visão geral', icon: 'home', load: () => import('./overview.js') },
  { key: 'times', path: 'times', label: 'Times', title: 'Times e inscrições', icon: 'users', load: () => import('./teams.js') },
  { key: 'ao-vivo', path: 'ao-vivo', label: 'Ao vivo', title: 'Jogos ao vivo', icon: 'radio', load: () => import('./live.js') },
  { key: 'chaveamento', path: 'chaveamento', label: 'Chaveamento', title: 'Chaveamento', icon: 'network', load: () => import('./bracket.js') },
  { key: 'marketing', path: 'marketing', label: 'Marketing', title: 'Marketing', icon: 'megaphone', load: () => import('./marketing.js') },
  { key: 'configuracoes', path: 'configuracoes', label: 'Config.', title: 'Configurações', icon: 'settings', load: () => import('./settings.js') },
];

export default async function (ctx) {
  if (!session.user) return navigate('/entrar?next=' + encodeURIComponent(ctx.path), { replace: true });
  const id = ctx.params.id;
  const sectionKey = ctx.params.section || 'painel';
  const sec = SECTIONS.find(s => s.key === sectionKey);
  if (!sec) return navigate(`/admin/${id}`, { replace: true });

  let t;
  try { t = (await api.get(`/tournaments/${encodeURIComponent(id)}`)).tournament; }
  catch (err) {
    if (err.status === 401) { session.user = null; return navigate('/entrar?next=' + encodeURIComponent(ctx.path), { replace: true }); }
    document.title = 'Torneio · ArenaMaster AI';
    render(ctx.root, html`<div class="auth"><main class="auth-main" style="grid-column:1/-1"><div class="auth-card"><div class="empty">${ic('lock', { size: 30 })}<strong>${err.status === 403 ? 'Sem acesso a este torneio' : err.status === 404 ? 'Torneio não encontrado' : 'Erro ao carregar'}</strong><span>${err.message}</span><a class="btn btn-primary" href="/">Voltar aos meus torneios</a></div></div></main></div>`);
    return;
  }
  if (!ctx.isCurrent()) return;

  const state = { t, section: null, offset: (t.serverNow || Date.now()) - Date.now(), busy: false };
  const app = {
    id,
    get t() { return state.t; },
    get now() { return Date.now() + state.offset; },
    get main() { return $('#adminMain', ctx.root); },
    visitorUrl: () => `${location.origin}/t/${state.t.id}`,
    set(next, { fromPoll = false } = {}) {
      if (!next) return;
      if (next.serverNow) state.offset = next.serverNow - Date.now();
      state.t = next;
      paintChrome();
      state.section?.update?.(next, { fromPoll });
    },
    nav(section) { navigate(`/admin/${id}${section ? '/' + section : ''}`); },
    /** Executa uma chamada que retorna { tournament }, atualiza o estado e trata erros com toast. */
    async act(fn, { ok = null, silent = false } = {}) {
      try {
        const r = await fn();
        if (r?.tournament) app.set(r.tournament);
        if (ok) toast(ok, { type: 'success' });
        return r || true;
      } catch (err) {
        if (err.status === 401) { session.user = null; navigate('/entrar?next=' + encodeURIComponent(location.pathname)); return null; }
        if (!silent) toast(err.message, { type: 'error', ms: 6000 });
        const e = err; e.handled = true;
        throw e;
      }
    },
  };

  const league = t.format === 'league';
  const lbl = s => (league && s.key === 'chaveamento' ? 'Campeonato' : s.label);
  document.title = `${league && sec.key === 'chaveamento' ? 'Campeonato' : sec.title} · ${t.name}`;
  const seenKey = `am_seen_${id}`;
  const seen = () => { try { return Number(localStorage.getItem(seenKey) || 0); } catch { return 0; } };
  const markSeen = () => { try { localStorage.setItem(seenKey, String(Date.now())); } catch { /* ignora */ } };

  render(ctx.root, html`
    <div class="app">
      <aside class="sidebar">
        ${brand()}
        <nav class="sidenav" aria-label="Seções do torneio">${SECTIONS.map(s => html`<a href="/admin/${id}${s.path ? '/' + s.path : ''}" data-sec="${s.key}" ${s.key === sec.key ? 'aria-current="page"' : ''}>${ic(s.icon)}<span>${s.key === 'configuracoes' ? 'Configurações' : lbl(s)}</span><span class="count" data-badge="${s.key}" hidden></span></a>`)}</nav>
        <div class="sidebar-foot"><strong><span class="pulse"></span> Sorteio inteligente ativo</strong>As chaves são equilibradas por algoritmo, sem favorecimento, e o sorteio fica registrado com semente auditável.</div>
      </aside>
      <div class="content">
        <div id="storageWarn"></div>
        <header class="topbar" id="topbar">
          <a class="icon-btn back" href="/" aria-label="Voltar aos meus torneios">${ic('chevron-left', { size: 22 })}</a>
          <h1 id="topTitle">${league && sec.key === 'chaveamento' ? 'Campeonato' : sec.title}</h1>
          <div class="menu" data-bellwrap><button class="icon-btn" id="bellBtn" aria-label="Notificações" aria-haspopup="true" aria-expanded="false">${ic('bell', { size: 22 })}<span class="bell-dot" id="bellDot" hidden></span></button><div class="menu-pop" id="bellPop" hidden style="width:min(360px,calc(100vw - 24px))"></div></div>
          ${userMenuHTML()}
        </header>
        <main class="page" id="adminMain" tabindex="-1"></main>
      </div>
      <nav class="bottomnav" aria-label="Seções do torneio">${SECTIONS.map(s => html`<a href="/admin/${id}${s.path ? '/' + s.path : ''}" data-sec="${s.key}" ${s.key === sec.key ? 'aria-current="page"' : ''}>${ic(s.icon)}<span>${lbl(s)}</span><span class="count" data-badge="${s.key}" hidden></span></a>`)}</nav>
    </div>`);

  wireMenus(ctx.root, ctx.signal);

  // ----- cabeçalho: notificações, avisos, selos
  function paintChrome() {
    const t = state.t;
    const warn = $('#storageWarn', ctx.root);
    warn.innerHTML = session.config?.storage?.persistent === false
      ? `<div class="storage-warn">⚠ Armazenamento temporário: os dados podem ser perdidos. Conecte um banco Redis (veja o README) antes de usar de verdade.</div>` : '';
    const lastSeen = seen();
    const unread = t.activity.filter(a => a.at > lastSeen).length;
    $('#bellDot', ctx.root).hidden = unread === 0;
    const pendingTeams = t.teams.filter(x => x.status === 'pending_payment' && x.reservationActive).length;
    const refunds = t.stats.refundsPending;
    const setBadge = (key, n) => $$(`[data-badge="${key}"]`, ctx.root).forEach(b => { b.hidden = !n; b.textContent = n; });
    setBadge('times', refunds + pendingTeams);
    setBadge('ao-vivo', t.bracket ? [...t.bracket.rounds.flatMap(r => r.matches), ...t.bracket.playins].filter(m => m.phase === 'live').length : 0);
    const pop = $('#bellPop', ctx.root);
    pop.innerHTML = `<div class="who"><b>Atividade recente</b></div>` + (t.activity.length
      ? `<ul class="feed" style="padding:0 12px 8px;max-height:340px">${t.activity.slice(0, 15).map(a => `<li><span class="f-ico ${a.type === 'refund' ? 'red' : a.type === 'donation' ? 'gold' : a.type === 'champion' ? 'green' : ''}">${ic({ team: 'users', reserve: 'clock', refund: 'banknote', donation: 'heart', draw: 'network', match: 'flag', champion: 'trophy', admin: 'user-plus', reset: 'rotate-ccw' }[a.type] || 'info', { size: 16 }).s}</span><div><div>${esc(a.text)}</div><time>${relTime(a.at, app.now)}</time></div></li>`).join('')}</ul>`
      : `<div class="empty" style="margin:8px">${ic('bell').s}<span>Nenhuma atividade ainda.</span></div>`);
  }
  $('#bellBtn', ctx.root).addEventListener('click', e => {
    const pop = $('#bellPop', ctx.root), open = pop.hidden;
    pop.hidden = !open; e.currentTarget.setAttribute('aria-expanded', String(open));
    if (open) { markSeen(); $('#bellDot', ctx.root).hidden = true; }
    e.stopPropagation();
  });
  document.addEventListener('click', e => { if (!e.target.closest('[data-bellwrap]')) { const p = $('#bellPop', ctx.root); if (p) p.hidden = true; } }, { signal: ctx.signal });
  paintChrome();

  // topbar com borda ao rolar
  const onScroll = () => $('#topbar', ctx.root)?.classList.toggle('scrolled', window.scrollY > 4);
  window.addEventListener('scroll', onScroll, { passive: true });
  ctx.onLeave(() => window.removeEventListener('scroll', onScroll));

  // navegação protegida por alterações não salvas
  ctx.root.addEventListener('click', async e => {
    const a = e.target.closest('a[data-sec], a.back');
    if (!a || !state.section?.dirty?.()) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (await confirmDialog({ title: 'Descartar alterações?', text: 'Você tem alterações não salvas. Se sair agora, elas serão perdidas.', ok: 'Descartar e sair', cancel: 'Continuar editando', danger: true })) {
      state.section.discard?.();
      navigate(a.getAttribute('href'));
    }
  }, true);
  const beforeUnload = e => { if (state.section?.dirty?.()) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  ctx.onLeave(() => window.removeEventListener('beforeunload', beforeUnload));

  // ----- seção
  const mod = await sec.load();
  if (!ctx.isCurrent()) return;
  state.section = await mod.default(app, ctx);
  state.section.mount?.(app.main);

  // ----- sincronização periódica (outro administrador pode estar mexendo)
  let polling = false;
  const poll = async () => {
    if (polling || document.hidden) return;
    polling = true;
    try {
      const r = await api.get(`/tournaments/${encodeURIComponent(id)}`);
      if (!ctx.isCurrent()) return;
      const before = state.t;
      if (r.tournament.version !== before.version) app.set(r.tournament, { fromPoll: true });
      else state.t = { ...state.t, serverNow: r.tournament.serverNow };
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) { toast('Você perdeu o acesso a este torneio.', { type: 'warn' }); navigate('/'); }
    } finally { polling = false; }
  };
  const timer = setInterval(poll, 8000);
  document.addEventListener('visibilitychange', poll);
  ctx.onLeave(() => { clearInterval(timer); document.removeEventListener('visibilitychange', poll); state.section?.destroy?.(); });
}

