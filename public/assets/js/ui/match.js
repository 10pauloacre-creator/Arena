// Componentes de partida compartilhados: relógio, placar, linha do tempo, detalhe e chaveamento.
import { html, ic, raw, esc, $, $$ } from './dom.js';
import { openDialog } from './dialog.js';
import { emblem } from './util.js';
import { SPORTS, EVENT_LABELS } from '../shared/sports.js';

export const teamMap = t => new Map((t.teams || []).map(x => [x.id, x]));

// ---------------------------------------------------------------- relógio
export function elapsedMs(clock, now) {
  if (!clock) return 0;
  return clock.elapsedMs + (clock.status === 'running' && clock.startedAt ? Math.max(0, now - clock.startedAt) : 0);
}
export function minuteOf(clock, now) {
  if (!clock || (clock.status === 'idle' && !clock.elapsedMs)) return 0;
  return Math.floor(elapsedMs(clock, now) / 60000) + 1;
}
export function clockText(clock, now) {
  const ms = elapsedMs(clock, now);
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
export function periodLabel(sportKey, minute) {
  const sp = SPORTS[sportKey];
  if (sp.mode === 'sets') return '';
  if (!minute) return 'Pré-jogo';
  if (sportKey === 'basquete') return minute > sp.length ? 'Prorrogação' : 'Q' + Math.min(4, Math.max(1, Math.ceil(minute / sp.half)));
  return minute <= sp.half ? '1º tempo' : '2º tempo';
}

export const PHASE_BADGE = {
  live: ['Ao vivo', 'live'], paused: ['Em andamento', 'warn'], finished: ['Encerrado', 'ok'], scheduled: ['Agendado', 'info'],
  tbd: ['A definir', ''], blocked: ['Aguardando revanche', 'gold'], bye: ['Avança direto', ''],
};
export function phaseBadge(m) {
  const [label, cls] = PHASE_BADGE[m.phase] || ['', ''];
  return html`<span class="badge ${cls}">${m.phase === 'live' ? html`<span class="dot"></span>` : ''}${label}</span>`;
}

// ---------------------------------------------------------------- placar
/** Texto/valores do placar principal conforme a modalidade. */
export function scoreValues(sportKey, m) {
  const sc = m.score;
  if (!sc) return { a: '–', b: '–', sub: '' };
  if (SPORTS[sportKey].mode === 'sets') {
    if (m.phase === 'finished') return { a: sc.a, b: sc.b, sub: (sc.setScores || []).map(s => `${s.a}-${s.b}`).join(' · ') };
    return { a: sc.cur?.a ?? 0, b: sc.cur?.b ?? 0, sub: `Set ${sc.set || 1} · Sets ${sc.a} × ${sc.b}` };
  }
  return { a: sc.a, b: sc.b, sub: '' };
}

export function scoreboardHTML(t, m, { now, controls = null } = {}) {
  const teams = teamMap(t), A = teams.get(m.a), B = teams.get(m.b);
  const sportKey = t.sport, sp = SPORTS[sportKey];
  const v = scoreValues(sportKey, m);
  const minute = minuteOf(m.clock, now);
  const clockTxt = sp.mode === 'sets' ? '' : (m.phase === 'finished' ? 'Fim de jogo' : `${periodLabel(sportKey, minute)} · <span data-clock="${m.key}">${clockText(m.clock, now)}</span>`);
  const side = X => html`<div class="sb-team">${emblem(X, 'lg')}<span class="nm">${X?.name || 'A definir'}</span>${X?.repescada ? html`<span class="tag-benef">${ic('heart', { size: 12 })} Repescada</span>` : ''}</div>`;
  const pen = m.pa != null ? html`<div class="sb-sub">Pênaltis ${m.pa} × ${m.pb}</div>` : '';
  return html`<div class="scoreboard" data-sb="${m.key}">
    <div class="sb-top">
      <span class="badge ${m.phase === 'live' ? 'live' : ''}" style="${m.phase === 'live' ? '' : 'background:rgb(255 255 255 / .14);color:#fff'}">${m.phase === 'live' ? html`<span class="dot"></span>` : ''}${(PHASE_BADGE[m.phase] || [''])[0]}</span>
      <span class="sb-sub">${m.roundName} · ${m.label}</span>
    </div>
    <div class="sb-main">
      ${side(A)}
      <div class="sb-mid">
        <div class="sb-score num" aria-label="Placar"><span>${v.a}</span><span class="sep">:</span><span>${v.b}</span></div>
        ${clockTxt ? html`<div class="sb-clock">${raw(clockTxt)}</div>` : ''}
        ${v.sub ? html`<div class="sb-sub">${v.sub}</div>` : ''}${pen}
      </div>
      ${side(B)}
    </div>
    ${controls || ''}
  </div>`;
}

// ---------------------------------------------------------------- lances
function eventTitle(sportKey, e) {
  if (e.type === 'goal') {
    if (sportKey === 'basquete') return `Cesta de ${e.pts} ponto${e.pts > 1 ? 's' : ''}`;
    return SPORTS[sportKey].unit === 'Gol' ? 'GOL!' : 'Ponto';
  }
  if (e.type === 'start') return e.text || 'Partida iniciada';
  return EVENT_LABELS[e.type] || e.text || 'Lance';
}
export function eventIconHTML(sportKey, e) {
  if (e.type === 'yellow') return raw('<span class="cardshape y"></span>');
  if (e.type === 'red') return raw('<span class="cardshape r"></span>');
  const map = { goal: SPORTS[sportKey].icon, foul: 'hand-heart', sub: 'refresh-cw', timeout: 'timer', tech: 'triangle-alert', start: 'play', end: 'flag', info: 'info' };
  return ic(map[e.type] || 'info', { size: 16 });
}

export function timelineHTML(t, m) {
  const teams = teamMap(t), sportKey = t.sport, sets = SPORTS[sportKey].mode === 'sets';
  if (!m.events?.length) return html`<div class="empty">${ic('hourglass')}<span>Nenhum lance registrado ainda.</span></div>`;
  const rows = [];
  for (const e of m.events.slice().reverse()) {
    const T = e.team ? teams.get(e.team === 'a' ? m.a : m.b) : null;
    if (e.setEnd) {
      const w = teams.get(e.setEnd.winner === 'a' ? m.a : m.b);
      rows.push(html`<li class="ev"><span class="m">S${e.set}</span><span class="i">${ic('flag', { size: 16 })}</span><span class="tx"><b>Fim do set ${e.set}: ${e.setEnd.a} × ${e.setEnd.b}</b><small>${w?.name || ''}</small></span></li>`);
    }
    rows.push(html`<li class="ev"><span class="m">${sets ? 'S' + (e.set || 1) : e.min + "'"}</span><span class="i ${e.type === 'goal' ? 'goal' : ''}">${eventIconHTML(sportKey, e)}</span><span class="tx"><b>${eventTitle(sportKey, e)}</b>${T ? html`<small>${T.name}${e.num != null ? ` · camisa ${e.num}` : ''}</small>` : ''}</span></li>`);
  }
  return html`<ol class="timeline" aria-label="Lances da partida">${rows}</ol>`;
}

// ---------------------------------------------------------------- detalhe (modal)
export function openMatchDialog(getTournament, getNow, key) {
  const find = t => t.bracket && [...t.bracket.rounds.flatMap(r => r.matches), ...t.bracket.playins].find(m => m.key === key);
  const draw = () => {
    const t = getTournament(), m = find(t);
    if (!m) return html`<div class="empty">Partida não encontrada.</div>`;
    return html`${scoreboardHTML(t, m, { now: getNow() })}
      ${m.note ? html`<div class="form-note">${ic('info')}<span>${m.note}</span></div>` : ''}
      <h4>Lance a lance</h4>${timelineHTML(t, m)}`;
  };
  const d = openDialog({ title: 'Partida', body: draw(), wide: true });
  d.refresh = () => { const b = $('[data-body]', d.el); if (b) b.innerHTML = draw().s; };
  return d;
}

/** Atualiza todos os relógios [data-clock] a cada segundo. Retorna função para parar. */
export function startClockTicker(getTournament, getNow, root = document) {
  const id = setInterval(() => {
    const t = getTournament(); if (!t?.bracket) return;
    const all = [...t.bracket.rounds.flatMap(r => r.matches), ...t.bracket.playins];
    $$('[data-clock]', root).forEach(el => {
      const m = all.find(x => x.key === el.dataset.clock);
      if (m?.clock) el.textContent = clockText(m.clock, getNow());
    });
    $$('[data-minute]', root).forEach(el => {
      const m = all.find(x => x.key === el.dataset.minute);
      if (m?.clock) el.textContent = minuteOf(m.clock, getNow()) + "'";
    });
  }, 1000);
  return () => clearInterval(id);
}

// ---------------------------------------------------------------- chaveamento
function slot(t, m, side, teams) {
  const id = m[side], T = id ? teams.get(id) : null;
  if (!T) return html`<div class="slot tbd"><span class="emb tbd sm">?</span><span>${m.bye ? 'Bye' : 'A definir'}</span></div>`;
  const cls = m.win ? (m.win === side ? 'win' : 'lose') : '';
  const sc = m.score && m.phase !== 'tbd' && m.phase !== 'bye' ? m.score : null;
  let val = '';
  if (sc) {
    if (SPORTS[t.sport].mode === 'sets') val = m.phase === 'finished' ? sc[side] : (m.phase === 'scheduled' ? '' : sc.cur?.[side] ?? 0);
    else val = m.phase === 'scheduled' ? '' : sc[side];
  }
  const pen = m.pa != null ? html`<small class="muted xs">(${side === 'a' ? m.pa : m.pb})</small>` : '';
  return html`<div class="slot ${cls} ${T.repescada ? 'benef' : ''}">${emblem(T, 'sm')}<div class="s-main"><span class="s-name">${T.name}</span>${T.repescada ? html`<span class="tag-benef" style="width:fit-content">${ic('heart', { size: 11 })} Repescada</span>` : ''}</div><span class="s-score num">${val}${pen}</span></div>`;
}

export function matchCardHTML(t, m, teams, { open = false } = {}) {
  const clk = m.phase === 'live' && m.clock && SPORTS[t.sport].mode !== 'sets' ? html` <span data-minute="${m.key}">${minuteOf(m.clock, Date.now())}'</span>` : '';
  const canOpen = open && m.a && m.b;
  return html`<article class="match ${m.phase === 'live' ? 'live' : ''}" data-r="${m.r}" data-m="${m.m}" data-key="${m.key}" ${canOpen ? raw('data-open tabindex="0" role="button"') : ''} aria-label="${m.label}">
    <header><span>${m.label}</span>${phaseBadge(m)}${clk}</header>
    ${slot(t, m, 'a', teams)}${slot(t, m, 'b', teams)}
    ${m.note ? html`<div class="note">${m.note}</div>` : ''}</article>`;
}

export function bracketHTML(t, { open = true, round = 0 } = {}) {
  const teams = teamMap(t), B = t.bracket, R = B.rounds.length;
  const cols = B.rounds.map((rd, r) => {
    const pins = B.playins.filter(p => p.r === r);
    const pinHTML = pins.map(p => html`<div class="playin"><b>${ic('heart', { size: 14 })} Revanche de repescagem</b>${matchCardHTML(t, p, teams, { open })}</div>`);
    const done = rd.matches.filter(m => m.win && !m.bye).length, total = rd.matches.filter(m => !m.bye).length;
    return html`<section class="round ${r === round ? 'show' : ''}" data-round="${r}" aria-label="${rd.name}"><h4>${rd.name} <small>${done}/${total}</small></h4>${pinHTML}<div class="matches">${rd.matches.map(m => matchCardHTML(t, m, teams, { open }))}</div></section>`;
  });
  const champ = t.champion ? teams.get(t.champion) : null;
  const champCol = html`<section class="round ${round === R ? 'show' : ''}" data-round="${R}" aria-label="Campeão"><h4>Campeão</h4><div class="matches">${champ
    ? html`<div class="champ">${ic('trophy', { size: 40, cls: 'ico-trophy' })}${emblem(champ, 'lg')}<strong style="font-size:18px">${champ.name}</strong>${champ.repescada ? html`<span class="tag-benef">${ic('heart', { size: 11 })} Equipe Repescada · Benfeitora</span>` : ''}<span class="muted small">Campeão do ${t.name}</span></div>`
    : html`<div class="champ-wait">${ic('trophy', { size: 30 })}<span>O campeão aparece aqui após a grande final.</span></div>`}</div></section>`;
  return html`<svg class="links" aria-hidden="true"></svg>${cols}${champCol}`;
}

export function drawConnectors(root, t) {
  const svg = $('svg.links', root); if (!svg || !t.bracket) return;
  const rr = root.getBoundingClientRect(); let d = '';
  const B = t.bracket;
  for (let r = 0; r < B.rounds.length - 1; r++) B.rounds[r].matches.forEach((m, j) => {
    const a = root.querySelector(`.match[data-r="${r}"][data-m="${j}"]`), b = root.querySelector(`.match[data-r="${r + 1}"][data-m="${j >> 1}"]`);
    if (!a || !b) return;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    if (!ra.width || !rb.width) return;
    const x1 = ra.right - rr.left, y1 = ra.top + ra.height / 2 - rr.top, x2 = rb.left - rr.left, y2 = rb.top + rb.height / 2 - rr.top, xm = (x1 + x2) / 2;
    d += `<path class="${m.win ? 'done' : ''}" d="M${x1} ${y1}H${xm}V${y2}H${x2}"/>`;
  });
  svg.innerHTML = d;
}

/** Monta o chaveamento dentro de `container` com abas de fase (mobile) e conectores. Retorna { update, destroy }. */
export function mountBracket(container, getTournament, { onOpen } = {}) {
  let round = 0, ro = null;
  const pickRound = t => {
    if (t.champion) return R;
    const idx = t.bracket.rounds.findIndex(rd => rd.matches.some(m => !m.win));
    return idx < 0 ? R : idx;
  };
  let first = true;
  const render = () => {
    const t = getTournament();
    if (!t?.bracket) { container.innerHTML = ''; return; }
    if (first) { round = pickRound(t); first = false; }
    const tabs = [...t.bracket.rounds.map(r => r.name), 'Campeão'];
    container.innerHTML = `<div class="seg round-tabs" role="group" aria-label="Fase exibida" style="margin:14px 14px 0">${tabs.map((n, i) => `<button type="button" data-round-tab="${i}" aria-pressed="${i === round}">${esc(n)}</button>`).join('')}</div><div class="bracket-scroll"><div class="bracket" id="bracketEl">${bracketHTML(t, { open: true, round }).s}</div></div>`;
    requestAnimationFrame(() => drawConnectors($('#bracketEl', container), t));
  };
  container.addEventListener('click', e => {
    const tab = e.target.closest('[data-round-tab]');
    if (tab) { round = +tab.dataset.roundTab; render(); return; }
    const m = e.target.closest('.match[data-open]');
    if (m && onOpen) onOpen(m.dataset.key);
  });
  container.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const m = e.target.closest('.match[data-open]');
    if (m && onOpen) { e.preventDefault(); onOpen(m.dataset.key); }
  });
  ro = new ResizeObserver(() => { const t = getTournament(); const el = $('#bracketEl', container); if (t && el) drawConnectors(el, t); });
  ro.observe(container);
  render();
  return { update: render, destroy: () => ro.disconnect() };
}
