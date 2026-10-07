// Abas do visitante: Início, Jogos, Chaveamento e Times.
import { html, render, ic, $, on } from '../../ui/dom.js';
import { emblem, streamEmbedHTML } from '../../ui/util.js';
import { scoreboardHTML, teamMap, minuteOf, openMatchDialog, mountBracket, startClockTicker, phaseBadge, scoreValues } from '../../ui/match.js';
import { SPORTS, TOURNAMENT_TYPES } from '../../shared/sports.js';
import { fmtBRL, fmtDay, fmtDateTime } from '../../shared/format.js';

const allMatches = t => t.bracket ? [...t.bracket.rounds.flatMap(r => r.matches), ...t.bracket.playins].filter(m => !m.bye) : [];

export function matchRow(t, m, now) {
  const teams = teamMap(t), A = teams.get(m.a), B = teams.get(m.b), sp = SPORTS[t.sport];
  const v = scoreValues(t.sport, m);
  const showScore = m.phase === 'live' || m.phase === 'paused' || m.phase === 'finished';
  const mid = showScore ? html`<span class="sc num">${v.a} : ${v.b}</span>` : html`<span class="sc muted">×</span>`;
  const sub = m.phase === 'live' && sp.mode === 'clock' ? html`<small data-minute="${m.key}">${minuteOf(m.clock, now)}'</small>` : html`<small>${m.phase === 'finished' ? 'Encerrado' : (m.phase === 'paused' ? 'Em andamento' : m.phase === 'blocked' ? 'Aguardando revanche' : m.label)}</small>`;
  const win = s => m.win === s ? 'strong' : '';
  return html`<button type="button" class="match-card ${m.phase === 'live' ? 'live' : ''}" data-open="${m.key}" aria-label="${m.label}: ${A?.name || 'A definir'} contra ${B?.name || 'A definir'}">
    <span class="side">${emblem(A, 'md')}<b class="${win('a')}">${A?.name || 'A definir'}</b></span>
    <span class="mid">${mid}${sub}</span>
    <span class="side r">${emblem(B, 'md')}<b class="${win('b')}">${B?.name || 'A definir'}</b></span></button>`;
}

const section = (title, body, extra = '') => html`<div class="stack-sm"><div class="row between"><h3 style="font-size:17px">${title}</h3>${extra}</div>${body}</div>`;

export function infoCard(t) {
  const rows = [
    ['calendar', 'Grande final', fmtDay(t.finalDate)],
    t.regDeadline ? ['clock', 'Inscrições até', fmtDateTime(t.regDeadline)] : null,
    ['wallet', 'Inscrição', t.fee ? `${fmtBRL(t.fee)} por time` : 'Gratuita'],
    ['users', 'Vagas', `${t.teamsConfirmed} de ${t.maxTeams} preenchidas`],
    ['badge-check', 'Tipo', TOURNAMENT_TYPES[t.type]],
    t.venue ? ['map-pin', 'Local', t.venue] : null,
  ].filter(Boolean);
  return html`<div class="card"><h3 class="card-title">${ic('info')} Sobre o torneio</h3>
    ${t.description ? html`<p style="margin-bottom:12px;white-space:pre-line">${t.description}</p>` : ''}
    <ul class="stack-sm">${rows.map(([i, l, v]) => html`<li class="row small">${ic(i, { size: 18 })}<span class="muted" style="min-width:110px">${l}</span><b>${v}</b></li>`)}</ul></div>`;
}

export function homeTab(v) {
  const t = v.t, now = v.now, teams = teamMap(t);
  const ms = allMatches(t);
  const live = ms.filter(m => m.phase === 'live' || m.phase === 'paused');
  const next = ms.filter(m => m.phase === 'scheduled' && m.a && m.b).slice(0, 5);
  const done = ms.filter(m => m.phase === 'finished').slice(-5).reverse();
  const champ = t.champion ? teams.get(t.champion) : null;
  return html`<div class="stack">
    ${champ ? html`<div class="champion-banner">${ic('trophy')}${emblem(champ, 'lg')}<div><span class="label">CAMPEÃO</span><div style="font-size:24px;font-weight:800;line-height:1.2">${champ.name}</div>${champ.repescada ? html`<span class="tag-benef">${ic('heart', { size: 11 })} Equipe Repescada · Benfeitora</span>` : ''}</div></div>` : ''}
    ${live.length ? section(html`<span class="badge live"><span class="dot"></span>Ao vivo agora</span>`, html`${live.slice(0, 1).map(m => html`<div data-open="${m.key}" style="cursor:pointer">${scoreboardHTML(t, m, { now })}</div>`)}${live.slice(1).map(m => matchRow(t, m, now))}`) : ''}
    ${t.stream ? section('Transmissão ao vivo', streamEmbedHTML(t.stream)) : ''}
    ${next.length ? section('Próximos jogos', html`<div class="stack-sm">${next.map(m => matchRow(t, m, now))}</div>`, html`<a class="small" href="/t/${t.id}/jogos">Ver todos</a>`) : ''}
    ${done.length ? section('Resultados recentes', html`<div class="stack-sm">${done.map(m => matchRow(t, m, now))}</div>`) : ''}
    ${!t.bracket ? html`<div class="card"><h3 class="card-title">${ic('users')} Times confirmados (${t.teamsConfirmed})</h3>${t.teams.length ? html`<div class="row wrap" style="gap:10px">${t.teams.map(x => html`<span class="row" style="gap:8px;padding:6px 12px 6px 6px;border:1px solid var(--line);border-radius:99px;background:#fff">${emblem(x, 'sm')}<b class="small">${x.name}</b></span>`)}</div>` : html`<div class="empty">${ic('users')}<span>Nenhum time confirmado ainda. Seja o primeiro!</span></div>`}<p class="hint" style="margin-top:10px">O chaveamento é publicado depois do sorteio, quando as inscrições terminam.</p></div>` : ''}
    ${infoCard(t)}</div>`;
}

export function matchesTab(v) {
  const t = v.t, now = v.now, ms = allMatches(t);
  if (!t.bracket) return html`<div class="empty" style="padding:48px 16px">${ic('calendar-clock', { size: 34 })}<strong style="font-size:18px">Os jogos ainda não foram definidos</strong><span>As partidas aparecem aqui depois do sorteio do chaveamento.</span></div>`;
  const groups = [
    ['Ao vivo', ms.filter(m => m.phase === 'live' || m.phase === 'paused')],
    ['Próximos jogos', ms.filter(m => (m.phase === 'scheduled' || m.phase === 'blocked') && m.a && m.b)],
    ['Aguardando definição', ms.filter(m => m.phase === 'tbd')],
    ['Encerrados', ms.filter(m => m.phase === 'finished').reverse()],
  ].filter(([, l]) => l.length);
  return html`<div class="stack">${groups.map(([title, list]) => section(title, html`<div class="stack-sm">${list.map(m => html`${list === groups[0]?.[1] ? '' : ''}<div><div class="xs muted" style="margin:0 4px 4px">${m.roundName}</div>${matchRow(t, m, now)}</div>`)}</div>`))}</div>`;
}

export function teamsTab(v) {
  const t = v.t;
  if (!t.teams.length) return html`<div class="empty" style="padding:48px 16px">${ic('users', { size: 34 })}<strong style="font-size:18px">Nenhum time confirmado</strong><span>Os times aparecem aqui assim que a inscrição (e o pagamento) for confirmada.</span>${t.registration.open ? html`<a class="btn btn-primary" href="/t/${t.id}/inscricao">Inscrever meu time</a>` : ''}</div>`;
  return html`<div class="t-grid">${t.teams.map(x => html`<div class="card team-card"><div class="tc-head">${emblem(x, 'md')}<div class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${x.name}</b><span class="muted small">${x.origin || 'Sem bairro/clube'}</span></div>${x.repescada ? html`<span class="tag-benef">${ic('heart', { size: 11 })}</span>` : ''}${x.eliminated ? html`<span class="badge">Eliminado</span>` : ''}</div>
    <details><summary>Elenco (${x.players.length})</summary><ul class="player-grid">${x.players.map(p => html`<li class="player"><span class="jersey">${p.number}</span><div class="p-n ellipsis">${p.name}</div></li>`)}</ul></details></div>`)}</div>`;
}

export function bracketTab(v) {
  const t = v.t;
  if (!t.bracket) return html`<div class="empty" style="padding:48px 16px">${ic('network', { size: 34 })}<strong style="font-size:18px">O chaveamento será publicado após o sorteio</strong><span>Volte quando as inscrições terminarem para ver os confrontos.</span></div>`;
  return html`<div class="card flush" id="bracketCard"></div>`;
}

export { on, render, startClockTicker, mountBracket, openMatchDialog, phaseBadge, $ };
