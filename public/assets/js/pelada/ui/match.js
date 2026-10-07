// Partida: escolha dos times, cronômetro, súmula (gols por jogador), "jogador de fora" e próxima partida automática.
import { html, ic } from '../../ui/dom.js';
import { fmtClock, timerRemaining, firstName } from '../../shared/pelada.js';

const STATUS = { scheduled: ['Agendada', ''], live: ['Ao vivo', 'live'], paused: ['Pausada', 'warn'], finished: ['Encerrada', 'dark'] };

export const teamOf = (day, id) => day.draw?.teams.find(t => t.id === id) || null;
export const isRunning = m => m.status === 'live' && !!m.timer.startedAt;
const statusKey = m => (m.status === 'live' && !m.timer.startedAt ? 'paused' : m.status);

function slot(day, m, side, isOwner) {
  const id = m[side], t = id ? teamOf(day, id) : null;
  if (t) return html`<button type="button" class="slot filled" data-slot="${side}" data-match="${m.id}" ${isOwner && m.status === 'scheduled' ? '' : 'disabled'} title="${isOwner && m.status === 'scheduled' ? 'Trocar time' : t.label}"><span class="team-num sm">${t.number}</span><span class="slot-name">${t.label}</span></button>`;
  return html`<button type="button" class="slot empty" data-slot="${side}" data-match="${m.id}" ${isOwner ? '' : 'disabled'}>${ic('plus', { size: 16 })}<span>${isOwner ? 'Escolher time' : 'A definir'}</span></button>`;
}

const scorersText = (pel, m, teamId) => {
  const by = new Map();
  for (const g of m.goals) if (g.teamId === teamId) { const k = g.pid || '_'; by.set(k, (by.get(k) || 0) + 1); }
  return [...by].map(([pid, n]) => `${pid === '_' ? 'Sem autor' : firstName(pel.people[pid]?.name || '?')}${n > 1 ? ` (${n})` : ''}`).join(', ');
};

/** Primeiro nome; com a inicial do sobrenome quando outro jogador da partida tem o mesmo primeiro nome. */
function shortName(pel, pid, everyone) {
  const full = pel.people[pid]?.name || '?', first = firstName(full);
  const dup = everyone.some(o => o !== pid && firstName(pel.people[o]?.name || '') === first);
  const last = full.split(' ').slice(1).filter(Boolean).pop();
  return dup && last ? `${first} ${last[0]}.` : first;
}

function sumulaCol(pel, day, m, side) {
  const teamId = m[side], t = teamOf(day, teamId);
  if (!t) return '';
  const loans = m.loans[teamId] || [];
  const roster = [...t.players, ...loans];
  const everyone = [...(teamOf(day, m.a)?.players || []), ...(teamOf(day, m.b)?.players || []), ...Object.values(m.loans).flat()];
  const count = pid => m.goals.filter(g => g.teamId === teamId && g.pid === pid).length;
  const noAuthor = m.goals.filter(g => g.teamId === teamId && !g.pid).length;
  return html`<div class="sum-col"><h5>${t.label}${t.incomplete ? html` <span class="badge warn" title="Time incompleto: pode pegar jogadores de fora">incompleto</span>` : ''}</h5>
    <div class="chips">${roster.map(pid => {
      const n = count(pid), loan = loans.includes(pid);
      return html`<span class="chip${n ? ' has' : ''}${loan ? ' loan' : ''}"><button type="button" class="chip-main" data-goal="${teamId}|${pid}" data-match="${m.id}" aria-label="Gol de ${pel.people[pid]?.name || ''}">${ic('goal', { size: 14 })}<span>${shortName(pel, pid, everyone)}</span>${n ? html`<b>${n}</b>` : ''}</button>${n ? html`<button type="button" class="chip-minus" data-ungoal="${teamId}|${pid}" data-match="${m.id}" aria-label="Remover um gol de ${pel.people[pid]?.name || ''}">${ic('minus', { size: 12 })}</button>` : ''}${loan && !n ? html`<button type="button" class="chip-minus" data-unloan="${teamId}|${pid}" data-match="${m.id}" aria-label="Devolver ${pel.people[pid]?.name || ''}">${ic('x', { size: 12 })}</button>` : ''}</span>`;
    })}
      <span class="chip noauthor"><button type="button" class="chip-main" data-goal="${teamId}|" data-match="${m.id}" aria-label="Gol sem autor">${ic('goal', { size: 14 })}<span>Sem autor</span>${noAuthor ? html`<b>${noAuthor}</b>` : ''}</button>${noAuthor ? html`<button type="button" class="chip-minus" data-ungoal="${teamId}|" data-match="${m.id}" aria-label="Remover gol sem autor">${ic('minus', { size: 12 })}</button>` : ''}</span>
    </div>
    <button type="button" class="btn btn-sm btn-ghost" data-loan="${teamId}" data-match="${m.id}">${ic('user-plus', { size: 15 })} Jogador de fora</button></div>`;
}

export function nextInfoText(day, m) {
  if (!m.next) return '';
  const st = teamOf(day, m.next.stayer), lv = teamOf(day, m.next.leaver);
  if (!st || !lv) return '';
  return m.next.reason === 'venceu'
    ? `${st.label} venceu e continua; ${lv.label} vai para o fim da fila.`
    : `Empate: ${lv.label} (há mais partidas seguidas na quadra) dá lugar ao próximo da fila; ${st.label} continua.`;
}

/** `now` = relógio do servidor estimado (ms). */
export function matchCard(pel, day, m, { isOwner, now, index }) {
  const [label, cls] = STATUS[statusKey(m)];
  const a = teamOf(day, m.a), b = teamOf(day, m.b);
  const ready = !!(m.a && m.b);
  const remaining = timerRemaining(m.timer, now);
  const running = isRunning(m);
  const finished = m.status === 'finished';
  const mins = Math.round(m.timer.durationMs / 60000);
  const timeUp = !finished && m.status === 'live' && remaining <= 0;
  const nextText = nextInfoText(day, m);
  const nextMatch = m.next ? day.matches.find(x => x.id === m.next.matchId) : null;
  return html`<article class="match ${finished ? 'finished' : ''} ${running ? 'running' : ''}" data-match-card="${m.id}">
    <header class="match-head"><span class="match-n">Partida ${index + 1}</span><span class="badge ${cls}">${running ? html`<span class="dot"></span> ` : ''}${label}</span>${m.auto && m.status === 'scheduled' ? html`<span class="badge info" title="Criada automaticamente pela fila">${ic('wand-sparkles', { size: 13 })} automática</span>` : ''}<span class="spacer"></span>
      ${isOwner ? html`<button type="button" class="btn btn-sm btn-outline-danger" data-del-match="${m.id}" aria-label="Excluir partida ${index + 1}">${ic('trash', { size: 15 })} Excluir partida</button>` : ''}</header>
    <div class="match-board">
      <div class="side">${slot(day, m, 'a', isOwner)}<output class="big-score" aria-label="Gols do time A">${ready ? m.score.a : '–'}</output></div>
      <span class="vs" aria-hidden="true">×</span>
      <div class="side">${slot(day, m, 'b', isOwner)}<output class="big-score" aria-label="Gols do time B">${ready ? m.score.b : '–'}</output></div>
    </div>
    ${ready || !finished ? html`<div class="match-clock ${timeUp ? 'up' : ''}"><span class="clock" data-clock="${m.id}" role="timer" aria-label="Tempo restante">${fmtClock(remaining)}</span>
      ${finished ? html`<span class="muted small">Tempo regulamentar: ${mins} min</span>` : timeUp ? html`<span class="muted small">Tempo esgotado!</span>` : html`<span class="muted small">${m.status === 'scheduled' ? `Cronômetro de ${mins} min` : running ? 'Rodando…' : 'Cronômetro pausado'}</span>`}
      ${isOwner && !finished ? html`<div class="clock-ctl">
        ${running ? html`<button class="btn btn-sm" data-timer="pause" data-match="${m.id}">${ic('pause', { size: 15 })} Pausar</button>` : html`<button class="btn btn-sm btn-primary" data-timer="start" data-match="${m.id}" ${ready && !timeUp ? '' : 'disabled'}>${ic('play', { size: 15 })} ${m.status === 'scheduled' ? 'Iniciar' : 'Continuar'}</button>`}
        <button class="btn btn-sm" data-timer="reset" data-match="${m.id}" ${m.timer.elapsedMs || running ? '' : 'disabled'}>${ic('rotate-ccw', { size: 15 })} Zerar</button>
        <label class="mins"><span class="sr-only">Duração em minutos</span><input type="number" min="1" max="90" value="${mins}" data-mins="${m.id}" ${running ? 'disabled' : ''} aria-label="Duração da partida em minutos"> <span>min</span></label>
        <button class="btn btn-sm" data-timer="set" data-match="${m.id}" ${running ? 'disabled' : ''}>Definir</button></div>` : ''}</div>` : ''}
    ${isOwner && ready && !finished ? html`<div class="sumula"><h4>${ic('clipboard-check', { size: 18 })} Súmula: toque no jogador que fez o gol</h4><div class="sum-cols">${sumulaCol(pel, day, m, 'a')}${sumulaCol(pel, day, m, 'b')}</div>
      <div class="row wrap" style="justify-content:flex-end;margin-top:10px"><button class="btn btn-gold" data-finish="${m.id}">${ic('flag', { size: 18 })} Encerrar partida</button></div></div>` : ''}
    ${!isOwner && ready && m.goals.length ? html`<div class="scorers"><p><b>${a?.label || 'Time A'}:</b> ${scorersText(pel, m, m.a) || '—'}</p><p><b>${b?.label || 'Time B'}:</b> ${scorersText(pel, m, m.b) || '—'}</p></div>` : ''}
    ${finished && isOwner && m.goals.length ? html`<div class="scorers"><p><b>${a?.label}:</b> ${scorersText(pel, m, m.a) || '—'}</p><p><b>${b?.label}:</b> ${scorersText(pel, m, m.b) || '—'}</p>
      <details class="fix"><summary>Corrigir gols</summary><div class="sum-cols">${sumulaCol(pel, day, { ...m, status: 'live' }, 'a')}${sumulaCol(pel, day, { ...m, status: 'live' }, 'b')}</div></details></div>` : ''}
    ${finished && nextText ? html`<div class="next-info">${ic('wand-sparkles', { size: 16 })} <span><b>Próxima partida criada${nextMatch ? `: ${teamOf(day, nextMatch.a)?.label} × ${teamOf(day, nextMatch.b)?.label}` : ''}.</b> ${nextText}</span></div>` : ''}
  </article>`;
}

/** Cartão de partida (histórico): resultado compacto + quem fez os gols. */
export function matchLine(pel, day, m) {
  const a = teamOf(day, m.a), b = teamOf(day, m.b);
  if (!a || !b) return '';
  return html`<li class="hist-match"><div class="hm-score"><span class="ellipsis">${a.label}</span><b class="num">${m.score.a} × ${m.score.b}</b><span class="ellipsis">${b.label}</span></div>
    ${m.goals.length ? html`<div class="hm-goals muted small">${ic('goal', { size: 13 })} ${scorersText(pel, m, m.a) || '—'} <span aria-hidden="true">|</span> ${scorersText(pel, m, m.b) || '—'}</div>` : ''}</li>`;
}
