// Página pública de UMA partida: /AM-2026-9843/flamengo-x-vasco — para compartilhar só aquele jogo.
import { html, render, ic, $ } from '../../ui/dom.js';
import { brand } from '../../ui/brand.js';
import { scoreboardHTML, timelineHTML, startClockTicker } from '../../ui/match.js';
import { shareButton, wireShare } from '../../ui/share-link.js';
import { fetchPublicTournament, ApiError } from '../../api.js';
import { navigate } from '../../router.js';
import { normalizeTournamentId, TOURNAMENT_ID_RE } from '../../shared/format.js';
import { findMatchBySlug, matchPath, matchTitle, flyerImage } from '../../shared/matchlink.js';
import notFoundPage from '../notfound.js';

export default async function (ctx) {
  const id = normalizeTournamentId(ctx.params.tid);
  // /qualquer-coisa não é um torneio: cai na página de "não encontrada"
  if (!TOURNAMENT_ID_RE.test(id)) return notFoundPage(ctx);
  if (!ctx.params.slug) return navigate(`/t/${id}`, { replace: true });

  const gone = (title, msg) => {
    document.title = `${title} · ArenaMaster AI`;
    render(ctx.root, html`<header class="public-top">${brand()}</header>
      <main class="v-wrap"><div class="card"><div class="empty" style="padding:48px 16px">${ic('search', { size: 36 })}<strong style="font-size:18px">${title}</strong><span>${msg}</span>
        <a class="btn btn-primary" href="/t/${id}">${ic('trophy', { size: 16 })} Ver o torneio</a></div></div></main>`);
  };

  let first;
  try { first = await fetchPublicTournament(id); }
  catch (err) { return gone('Torneio não encontrado', err.status === 404 ? 'Confira o link ou peça um novo a quem enviou.' : err.message); }
  if (!ctx.isCurrent()) return;

  const state = { t: first.tournament, etag: first.etag, offset: first.offset };
  const now = () => Date.now() + state.offset;
  const slug = ctx.params.slug;
  const current = () => findMatchBySlug(state.t, slug);
  let m = current();
  if (!m) return gone('Partida não encontrada', 'Esta partida não existe (mais) neste torneio. Veja todos os jogos no torneio.');

  // se o link veio por outro apelido (ex.: jogo-1-0) e agora a partida tem nome de times, mantém o que foi aberto: ambos funcionam.
  const canonical = () => matchPath(state.t, m.key);

  function paint() {
    const t = state.t; m = current() || m;
    document.title = `${matchTitle(t, m)} · ${t.name}`;
    render(ctx.root, html`
      <div class="v-top"><header class="public-top">${brand()}<span class="spacer"></span>${shareButton('Compartilhar')}</header></div>
      <main class="v-wrap">
        <div class="row between wrap" style="gap:8px"><div><span class="small muted">${t.name}${m.roundName ? ' · ' + m.roundName : ''}</span></div>
          <a class="btn btn-sm" href="/t/${t.id}/jogos">${ic('trophy', { size: 15 })} Ver torneio completo</a></div>
        <section class="card" aria-label="Placar">${scoreboardHTML(t, m, { now: now() })}</section>
        ${m.note ? html`<div class="form-note">${ic('info')}<span>${m.note}</span></div>` : ''}
        <section class="card"><h4>Lance a lance</h4>${timelineHTML(t, m)}</section>
        <footer class="v-footer">Criado com <a href="/">ArenaMaster AI</a> · <a href="/t/${t.id}">${t.name}</a></footer>
      </main>`);
  }
  paint();
  wireShare(ctx.root, () => {
    const p = canonical(); if (!p) return null;
    return { title: 'Compartilhar partida', heading: matchTitle(state.t, m), text: `${matchTitle(state.t, m)} — ${state.t.name}`, url: p, image: flyerImage(state.t, m) };
  }, ctx.signal);

  const stopTicker = startClockTicker(() => state.t, now, ctx.root);
  const live = () => m.phase === 'live';
  let polling = false;
  async function poll() {
    if (polling || document.hidden) return;
    polling = true;
    try {
      const r = await fetchPublicTournament(id, state.etag);
      if (!ctx.isCurrent()) return;
      state.offset = r.offset;
      if (r.notModified) return;
      state.t = r.tournament; state.etag = r.etag;
      paint();
    } catch (err) { if (!(err instanceof ApiError) || err.status !== 0) console.warn('sincronização falhou', err.message); }
    finally { polling = false; }
  }
  let timer = setInterval(poll, live() ? 3000 : 8000);
  const retune = setInterval(() => { clearInterval(timer); timer = setInterval(poll, live() ? 3000 : 8000); }, 30000);
  const vis = () => { if (!document.hidden) poll(); };
  document.addEventListener('visibilitychange', vis);
  ctx.onLeave(() => { clearInterval(timer); clearInterval(retune); stopTicker(); document.removeEventListener('visibilitychange', vis); });
}
