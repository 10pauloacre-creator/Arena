// Gerenciador de partidas ao vivo: relógio, placar, lances e encerramento.
// O estado do relógio é guardado como (elapsedMs, startedAt) para que qualquer cliente calcule o minuto atual.

import { SPORTS } from '../../public/assets/js/shared/sports.js';
import { badRequest, conflict } from '../errors.js';
import { applyPlayinResult, findMatch, isBlocked, setWinner, teamById, totalRounds } from './bracket.js';
import { pushActivity } from './tournament.js';

export const newLive = () => ({ status: 'idle', elapsedMs: 0, startedAt: null, events: [], eid: 0 });

export const elapsedMs = (live, now) => !live ? 0 : live.elapsedMs + (live.status === 'running' && live.startedAt ? Math.max(0, now - live.startedAt) : 0);
export const minuteOf = (live, now) => {
  if (!live || (live.status === 'idle' && !live.elapsedMs)) return 0;
  return Math.floor(elapsedMs(live, now) / 60000) + 1;
};

/** Reproduz os pontos do vôlei: separa sets, placar de cada set e detecta o fim da partida. */
export function replayVolley(events, setsToWin = 3) {
  let set = 1, a = 0, b = 0;
  const sets = { a: 0, b: 0 }, setScores = [], marks = {};
  let decided = null;
  for (const ev of events) {
    if (ev.type !== 'goal') { marks[ev.id] = { set }; continue; }
    if (decided) { marks[ev.id] = { set, ignored: true }; continue; }
    if (ev.team === 'a') a += ev.pts || 1; else b += ev.pts || 1;
    marks[ev.id] = { set };
    const target = set === 2 * setsToWin - 1 ? 15 : 25;
    if (Math.max(a, b) >= target && Math.abs(a - b) >= 2) {
      const w = a > b ? 'a' : 'b';
      sets[w]++;
      setScores.push({ a, b, winner: w });
      marks[ev.id].setEnd = { a, b, winner: w };
      if (sets[w] === setsToWin) decided = w;
      else { set++; a = 0; b = 0; }
    }
  }
  return { set, cur: { a, b }, sets, setScores, decided, marks };
}

/** Placar atual de uma partida (ao vivo ou encerrada). */
export function scoreOf(match, sport) {
  if (match.win && match.sa != null) return { a: match.sa, b: match.sb, sets: sport.mode === 'sets' ? { a: match.sa, b: match.sb } : null, setScores: match.setScores || [], cur: null, set: null };
  const events = match.live?.events || [];
  if (sport.mode === 'sets') {
    const r = replayVolley(events, sport.setsToWin);
    return { a: r.sets.a, b: r.sets.b, sets: r.sets, setScores: r.setScores, cur: r.cur, set: r.set, decided: r.decided };
  }
  let a = 0, b = 0;
  for (const e of events) if (e.type === 'goal') { if (e.team === 'a') a += e.pts || 1; else b += e.pts || 1; }
  return { a, b, sets: null, setScores: [], cur: null, set: null };
}

export function matchPhase(t, match) {
  if (match.bye) return 'bye';
  if (match.win) return 'finished';
  if (!match.a || !match.b) return 'tbd';
  if (match.live && match.live.status === 'running') return 'live';
  if (match.live && (match.live.status === 'paused' || match.live.events.length)) return 'paused';
  if (!match.id && isBlocked(t, match)) return 'blocked';
  return 'scheduled';
}

function ensureLive(match) { if (!match.live) match.live = newLive(); return match.live; }
function nextEventId(live) { live.eid = (live.eid || 0) + 1; return live.eid; }

function assertEditable(t, match) {
  if (match.win) throw conflict('Esta partida já foi encerrada.', 'FINISHED');
  if (!match.a || !match.b) throw conflict('Esta partida ainda não tem os dois times definidos.', 'NOT_READY');
  if (!match.id && isBlocked(t, match)) throw conflict('Aguardando a revanche de repescagem desta vaga.', 'BLOCKED');
  if (match.id && match.status === 'done') throw conflict('Esta revanche já foi encerrada.', 'FINISHED');
}

const int = (v, field, { min = 0, max = 999 } = {}) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`Valor inválido para ${field}.`, 'VALIDATION', { field });
  return n;
};

export function applyAction(t, match, body, now) {
  const sport = SPORTS[t.sport];
  const action = body?.action;
  const live = match.live;

  // reabrir é a única ação permitida em partida encerrada
  if (action === 'reopen') return reopen(t, match, now);
  if (action === 'result') return manualResult(t, match, body, now);

  assertEditable(t, match);
  const L = ensureLive(match);

  switch (action) {
    case 'start': {
      if (L.status === 'running') throw conflict('A partida já está em andamento.', 'STATE');
      if (L.status === 'idle') L.events.push({ id: nextEventId(L), min: 0, type: 'start', team: null, text: 'Bola rolando!', at: now });
      L.status = 'running'; L.startedAt = now;
      break;
    }
    case 'pause': {
      if (L.status !== 'running') throw conflict('A partida não está em andamento.', 'STATE');
      L.elapsedMs += now - L.startedAt; L.startedAt = null; L.status = 'paused';
      break;
    }
    case 'adjust': {
      if (sport.mode === 'sets') throw badRequest('O vôlei não usa relógio.', 'VALIDATION');
      const minutes = int(body.minutes, 'minutos', { min: -90, max: 90 });
      L.elapsedMs = Math.max(0, L.elapsedMs + minutes * 60000);
      break;
    }
    case 'event': {
      const type = body.type;
      if (!sport.events.includes(type)) throw badRequest('Este tipo de lance não existe nesta modalidade.', 'VALIDATION', { field: 'type' });
      const side = body.team;
      if (side !== 'a' && side !== 'b') throw badRequest('Informe a equipe do lance.', 'VALIDATION', { field: 'team' });
      let pts = 1;
      if (type === 'goal' && t.sport === 'basquete') pts = int(body.pts ?? 2, 'pontos', { min: 1, max: 3 });
      if (sport.mode === 'sets' && replayVolley(L.events, sport.setsToWin).decided) throw conflict('A partida já foi decidida. Encerre para lançar o resultado.', 'DECIDED');
      const num = body.num === '' || body.num == null ? null : int(body.num, 'camisa', { min: 0, max: 99 });
      if (L.status === 'idle') { L.status = 'paused'; L.events.push({ id: nextEventId(L), min: 0, type: 'start', team: null, text: 'Partida iniciada pelo organizador.', at: now }); }
      L.events.push({ id: nextEventId(L), min: minuteOf(L, now), type, team: side, num, pts: type === 'goal' ? pts : undefined, at: now });
      break;
    }
    case 'score-minus': {
      const side = body.team;
      if (side !== 'a' && side !== 'b') throw badRequest('Informe a equipe.', 'VALIDATION');
      if (sport.mode === 'sets' && replayVolley(L.events, sport.setsToWin).decided) throw conflict('A partida já foi decidida.', 'DECIDED');
      const idx = [...L.events].reverse().findIndex(e => e.type === 'goal' && e.team === side);
      if (idx < 0) throw conflict('Não há pontos para remover neste placar.', 'EMPTY');
      L.events.splice(L.events.length - 1 - idx, 1);
      break;
    }
    case 'undo': {
      const last = L.events[L.events.length - 1];
      if (!last || last.type === 'start') throw conflict('Não há lances para desfazer.', 'EMPTY');
      L.events.pop();
      break;
    }
    case 'finalize': return finalize(t, match, body, now);
    default: throw badRequest('Ação desconhecida.', 'VALIDATION', { field: 'action' });
  }
  return { ok: true };
}

function resolveWinner(t, match, sa, sb, body, sport) {
  if (sa !== sb) return { side: sa > sb ? 'a' : 'b', pa: null, pb: null, note: '' };
  if (sport.tiebreak === 'pênaltis') {
    if (body.pa == null || body.pb == null) throw conflict('Empate: informe o resultado dos pênaltis para definir quem avança.', 'TIE', { tiebreak: 'pênaltis' });
    const pa = int(body.pa, 'pênaltis', { min: 0, max: 50 }), pb = int(body.pb, 'pênaltis', { min: 0, max: 50 });
    if (pa === pb) throw badRequest('Os pênaltis não podem terminar empatados.', 'VALIDATION');
    return { side: pa > pb ? 'a' : 'b', pa, pb, note: `Decidido nos pênaltis: ${pa} × ${pb}` };
  }
  throw conflict(t.sport === 'basquete' ? 'Empate: registre os pontos da prorrogação até haver um vencedor.' : 'Empate: a partida precisa ter um vencedor.', 'TIE', { tiebreak: sport.tiebreak });
}

function commit(t, match, side, data, now) {
  if (match.id) applyPlayinResult(t, match, side, data, now);
  else setWinner(t, match, side, data, now);
}

function finalize(t, match, body, now) {
  const sport = SPORTS[t.sport];
  const score = scoreOf(match, sport);
  if (sport.mode === 'sets') {
    if (!score.decided) throw conflict(`No vôlei, a partida só termina quando uma equipe vence ${sport.setsToWin} sets.`, 'NOT_DECIDED');
    match.setScores = score.setScores;
    commit(t, match, score.decided, { sa: score.sets.a, sb: score.sets.b, note: '' }, now);
    return { ok: true };
  }
  const r = resolveWinner(t, match, score.a, score.b, body, sport);
  commit(t, match, r.side, { sa: score.a, sb: score.b, pa: r.pa, pb: r.pb, note: r.note }, now);
  return { ok: true };
}

function manualResult(t, match, body, now) {
  const sport = SPORTS[t.sport];
  if (match.win) throw conflict('Esta partida já foi encerrada.', 'FINISHED');
  if (!match.a || !match.b) throw conflict('Esta partida ainda não tem os dois times definidos.', 'NOT_READY');
  if (!match.id && isBlocked(t, match)) throw conflict('Aguardando a revanche de repescagem desta vaga.', 'BLOCKED');
  const sa = int(body.sa, 'placar', { min: 0, max: 300 }), sb = int(body.sb, 'placar', { min: 0, max: 300 });
  if (sport.mode === 'sets') {
    if (Math.max(sa, sb) !== sport.setsToWin || Math.min(sa, sb) >= sport.setsToWin) throw badRequest(`Informe o resultado em sets (vencedor com ${sport.setsToWin}).`, 'VALIDATION');
    commit(t, match, sa > sb ? 'a' : 'b', { sa, sb, note: '' }, now);
    return { ok: true };
  }
  const r = resolveWinner(t, match, sa, sb, body, sport);
  commit(t, match, r.side, { sa, sb, pa: r.pa, pb: r.pb, note: r.note }, now);
  return { ok: true };
}

/** Desfaz o encerramento de uma partida, se o resultado ainda não influenciou fases seguintes. */
function reopen(t, match, now) {
  if (!match.win) throw conflict('Esta partida não está encerrada.', 'STATE');
  if (match.bye) throw conflict('Partidas com bye não podem ser reabertas.', 'STATE');
  const R = totalRounds(t);
  if (match.id) throw conflict('Revanches encerradas não podem ser reabertas.', 'STATE');
  const loserId = match[match.win === 'a' ? 'b' : 'a'];
  if (match.r < R - 1) {
    const next = t.bracket.rounds[match.r + 1][match.m >> 1];
    if (next.win || (next.live && next.live.status !== 'idle')) throw conflict('A fase seguinte já começou: não é possível reabrir esta partida.', 'LOCKED');
    if (t.playins.some(p => p.r === next.r && p.m === next.m)) throw conflict('Há uma revanche de repescagem ligada a esta vaga: não é possível reabrir.', 'LOCKED');
    next[match.m % 2 === 0 ? 'a' : 'b'] = null;
  } else t.champion = null;
  const loser = teamById(t, loserId);
  if (loser) { loser.elim = null; }
  match.win = null; match.sa = null; match.sb = null; match.pa = null; match.pb = null; match.note = ''; match.setScores = undefined;
  if (match.live) match.live.status = 'paused';
  pushActivity(t, 'match', `Partida reaberta pelo organizador.`, now);
  return { ok: true };
}

export function locateMatch(t, key) {
  const match = findMatch(t, key);
  if (!match) return null;
  return match;
}
