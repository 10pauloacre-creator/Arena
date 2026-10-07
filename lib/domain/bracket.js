// Chaveamento eliminatório: sorteio equilibrado, byes, avanço de vencedores e repescagem (revanche).

import { nextPow2, log2, roundName, matchLabel } from '../../public/assets/js/shared/sports.js';
import { mulberry32, shuffle, avg } from '../../public/assets/js/shared/format.js';
import { badRequest, conflict } from '../errors.js';
import { randomId } from '../auth.js';
import { confirmedTeams, pushActivity } from './tournament.js';

export const matchKey = (r, m) => `${r}-${m}`;
export const playinKey = id => `p:${id}`;

export const teamById = (t, id) => t.teams.find(x => x.id === id) || null;
export const totalRounds = t => t.bracket ? t.bracket.rounds.length : 0;

export function findMatch(t, key) {
  if (!t.bracket) return null;
  if (key.startsWith('p:')) return t.playins.find(p => p.id === key.slice(2)) || null;
  const m = /^(\d+)-(\d+)$/.exec(key);
  if (!m) return null;
  return t.bracket.rounds[+m[1]]?.[+m[2]] || null;
}

export function newMatch(r, m) {
  return { r, m, a: null, b: null, win: null, sa: null, sb: null, pa: null, pb: null, note: '', bye: false, live: null };
}

function emptyRounds(size) {
  const R = log2(size);
  return Array.from({ length: R }, (_, r) => Array.from({ length: size / 2 ** (r + 1) }, (_, m) => newMatch(r, m)));
}

/** Ordem bit-reversa: espalha os byes entre as metades da chave. */
function bitReversalOrder(n) {
  const bits = log2(n);
  const rev = i => { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); return r; };
  return Array.from({ length: n }, (_, i) => rev(i));
}

const groupKey = team => {
  const g = String(team.origin || '').trim().toLowerCase();
  return g && g !== 'independente' ? g : null;
};

/**
 * Sorteio: testa milhares de combinações e escolhe a de menor custo
 * (conflitos de origem na 1ª fase + desequilíbrio de força entre as metades da chave).
 */
export function runDraw(teams, { seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0, iterations = 6000 } = {}) {
  const n = teams.length;
  if (n < 2) throw badRequest('São necessários ao menos 2 times confirmados para sortear.', 'NOT_ENOUGH_TEAMS');
  const size = nextPow2(n);
  const byes = size - n;
  const rnd = mulberry32(seed);

  const ranked = shuffle(teams, rnd).sort((a, b) => b.rating - a.rating); // empate de força: desempate aleatório
  const byeTeams = ranked.slice(0, byes);
  const rest = ranked.slice(byes);
  const half = size / 2;
  const byeMatches = bitReversalOrder(half).slice(0, byes);
  const isBye = new Array(half).fill(false);
  byeMatches.forEach(i => { isBye[i] = true; });

  const realSlots = [];
  for (let i = 0; i < half; i++) if (!isBye[i]) realSlots.push(2 * i, 2 * i + 1);

  let best = null, valid = 0;
  for (let it = 0; it < iterations; it++) {
    const slots = new Array(size).fill(null);
    const bt = shuffle(byeTeams, rnd);
    byeMatches.forEach((mi, k) => { slots[2 * mi + (rnd() < 0.5 ? 0 : 1)] = bt[k]; });
    const rp = shuffle(rest, rnd);
    realSlots.forEach((s, k) => { slots[s] = rp[k]; });

    let conflicts = 0;
    const gaps = [];
    for (let i = 0; i < half; i++) {
      const a = slots[2 * i], b = slots[2 * i + 1];
      if (a && b) {
        const ga = groupKey(a);
        if (ga && ga === groupKey(b)) conflicts++;
        gaps.push(Math.abs(a.rating - b.rating));
      }
    }
    if (!conflicts) valid++;
    const sum = arr => arr.reduce((s, x) => s + (x ? x.rating : 0), 0);
    const halfDiff = Math.abs(sum(slots.slice(0, half)) - sum(slots.slice(half)));
    const gm = avg(gaps), sd = Math.sqrt(avg(gaps.map(g => (g - gm) ** 2)));
    const cost = conflicts * 100000 + halfDiff + sd * 1.2;
    if (!best || cost < best.cost) best = { slots, cost, halfDiff, sd, conflicts };
  }

  const mean = avg(teams.map(x => x.rating));
  const halfScore = Math.max(0, 1 - best.halfDiff / (mean * 0.25));
  const gapScore = Math.max(0, 1 - best.sd / 80);
  return {
    slots: best.slots.map(x => x ? x.id : null),
    size, byes, seed, tried: iterations, valid,
    conflicts: best.conflicts,
    balance: Math.round((0.6 * halfScore + 0.4 * gapScore) * 1000) / 10,
    halfDiff: best.halfDiff,
  };
}

/** Monta a estrutura do chaveamento a partir do resultado do sorteio e propaga os byes. */
export function buildBracket(draw) {
  const rounds = emptyRounds(draw.size);
  draw.slots.forEach((id, i) => { rounds[0][i >> 1][i % 2 === 0 ? 'a' : 'b'] = id; });
  rounds[0].forEach(match => {
    const one = (match.a && !match.b) ? 'a' : (!match.a && match.b) ? 'b' : null;
    if (one) {
      match.bye = true; match.win = one;
      placeWinner(rounds, match, match[one]);
    }
  });
  return { size: draw.size, rounds, seed: draw.seed, info: { tried: draw.tried, valid: draw.valid, conflicts: draw.conflicts, balance: draw.balance, byes: draw.byes } };
}

function placeWinner(rounds, match, teamId) {
  const next = rounds[match.r + 1];
  if (next) next[match.m >> 1][match.m % 2 === 0 ? 'a' : 'b'] = teamId;
}

export function drawTournament(t, now, opts = {}) {
  const started = t.bracket && (
    t.bracket.rounds.flat().some(m => (m.win && !m.bye) || (m.live && (m.live.status !== 'idle' || m.live.events.length))) ||
    t.playins.length > 0
  );
  if (started) throw conflict('O torneio já começou (há jogos em andamento, resultados ou revanches): não é possível sortear novamente.', 'STARTED');
  const teams = confirmedTeams(t);
  const res = runDraw(teams, opts);
  // reservas pendentes não entram na chave
  t.teams.forEach(x => { if (x.status === 'pending_payment') x.status = 'expired'; });
  t.teams.forEach(x => { x.elim = null; x.repescada = false; x.noRepesc = false; });
  t.playins = []; t.champion = null;
  t.bracket = buildBracket(res);
  t.registrationOpen = false;
  pushActivity(t, 'draw', `Sorteio realizado com ${teams.length} times (equilíbrio ${String(res.balance).replace('.', ',')}%).`, now);
  return res;
}

export function resetBracket(t, now) {
  t.bracket = null; t.playins = []; t.champion = null;
  t.teams.forEach(x => { x.elim = null; x.repescada = false; x.noRepesc = false; });
  pushActivity(t, 'reset', 'Chaveamento reiniciado pelo organizador.', now);
}

/** Registra o vencedor de uma partida e avança na chave. */
export function setWinner(t, match, side, { sa, sb, pa = null, pb = null, note = '' }, now) {
  const winnerId = match[side], loserId = match[side === 'a' ? 'b' : 'a'];
  match.win = side; match.sa = sa; match.sb = sb; match.pa = pa; match.pb = pb; match.note = note;
  if (match.live) match.live.status = 'over';
  const loser = teamById(t, loserId);
  if (loser) loser.elim = { r: match.r, m: match.m, by: winnerId };
  const R = totalRounds(t);
  if (match.r < R - 1) placeWinner(t.bracket.rounds, match, winnerId);
  else {
    t.champion = winnerId;
    pushActivity(t, 'champion', `${teamById(t, winnerId)?.name} é o campeão!`, now);
  }
  pushActivity(t, 'match', `${matchTitle(t, match)}: ${teamById(t, match.a)?.name} ${sa} × ${sb} ${teamById(t, match.b)?.name}${note ? ` (${note})` : ''}.`, now);
}

export function matchTitle(t, match) {
  if (match.id) return 'Revanche de repescagem';
  return `${roundName(totalRounds(t), match.r)} · ${matchLabel(totalRounds(t), match.r, match.m)}`;
}

/** A partida da chave está bloqueada enquanto houver uma revanche pendente sobre ela. */
export const isBlocked = (t, match) => !match.id && t.playins.some(p => p.status === 'pending' && p.r === match.r && p.m === match.m);

// ------------------------------------------------------------------ repescagem

export function canRepesc(t, team) {
  if (!t.donationEnabled) return { ok: false, reason: 'A repescagem beneficente não está habilitada neste torneio.' };
  if (!t.bracket) return { ok: false, reason: 'O chaveamento ainda não foi sorteado.' };
  if (!team.elim) return { ok: false, reason: 'A equipe ainda está em disputa.' };
  if (team.repescada) return { ok: false, reason: 'Esta equipe já usou a repescagem beneficente.' };
  if (team.noRepesc) return { ok: false, reason: 'Eliminada em revanche de repescagem.' };
  const R = totalRounds(t);
  if (team.elim.r >= R - 1) return { ok: false, reason: 'Eliminada na final: não há fase seguinte para retornar.' };
  const next = t.bracket.rounds[team.elim.r + 1][team.elim.m >> 1];
  const side = team.elim.m % 2 === 0 ? 'a' : 'b';
  if (next.win) return { ok: false, reason: 'Janela encerrada: o adversário já disputou a fase seguinte.' };
  if (next.live && next.live.status !== 'idle') return { ok: false, reason: 'Janela encerrada: o adversário já está em quadra na fase seguinte.' };
  if (next[side] !== team.elim.by) return { ok: false, reason: 'Janela encerrada: a vaga já foi decidida.' };
  if (t.playins.some(p => p.status === 'pending' && p.r === next.r && p.m === next.m)) return { ok: false, reason: 'Já existe uma revanche pendente nesta vaga.' };
  return { ok: true, reason: 'Elegível até o adversário entrar em quadra na fase seguinte.' };
}

/** Cria a revanche (play-in) após a doação aprovada. */
export function createPlayin(t, team, now) {
  const c = canRepesc(t, team);
  if (!c.ok) throw conflict(c.reason, 'NOT_ELIGIBLE');
  const r = team.elim.r + 1, m = team.elim.m >> 1, side = team.elim.m % 2 === 0 ? 'a' : 'b';
  const next = t.bracket.rounds[r][m];
  const playin = { ...newMatch(r, m), id: randomId('pi_'), side, a: team.id, b: next[side], challenger: team.id, defender: next[side], status: 'pending' };
  t.playins.push(playin);
  team.repescada = true;
  return playin;
}

export function applyPlayinResult(t, playin, side, { sa, sb, pa = null, pb = null, note = '' }, now) {
  playin.win = side; playin.sa = sa; playin.sb = sb; playin.pa = pa; playin.pb = pb; playin.note = note; playin.status = 'done';
  if (playin.live) playin.live.status = 'over';
  const ch = teamById(t, playin.challenger), df = teamById(t, playin.defender);
  if (side === 'a') {
    t.bracket.rounds[playin.r][playin.m][playin.side] = ch.id;
    ch.elim = null;
    df.elim = { r: playin.r, m: playin.m, by: ch.id, playin: true };
    df.noRepesc = true;
    pushActivity(t, 'match', `Revanche: ${ch.name} venceu ${df.name} e voltou à tabela!`, now);
  } else {
    ch.noRepesc = true;
    pushActivity(t, 'match', `Revanche: ${df.name} confirmou a vaga contra ${ch.name}.`, now);
  }
}

// ------------------------------------------------------------------ demonstração

export function weightedWinner(a, b, rnd = Math.random) {
  return rnd() < 1 / (1 + Math.pow(10, (b.rating - a.rating) / 400)) ? 'a' : 'b';
}

export function genScore(sport, rnd = Math.random) {
  const r = n => Math.floor(rnd() * n);
  switch (sport) {
    case 'futebol': { const w = 1 + r(4); return [w, r(w)]; }
    case 'futsal': { const w = 2 + r(6); return [w, r(w)]; }
    case 'volei': return [3, r(3)];
    default: { const w = 68 + r(33); return [w, w - (2 + r(17))]; }
  }
}

/** Simula a próxima fase (apenas torneios de demonstração). */
export function simulatePhase(t, now, rnd = Math.random) {
  if (!t.bracket) throw conflict('Sorteie o chaveamento primeiro.', 'NO_BRACKET');
  for (const p of t.playins.filter(x => x.status === 'pending')) {
    const side = weightedWinner(teamById(t, p.a), teamById(t, p.b), rnd), [w, l] = genScore(t.sport, rnd);
    applyPlayinResult(t, p, side, { sa: side === 'a' ? w : l, sb: side === 'a' ? l : w }, now);
  }
  const r = t.bracket.rounds.findIndex(rd => rd.some(m => !m.win));
  if (r < 0) return;
  for (const m of t.bracket.rounds[r]) {
    if (m.a && m.b && !m.win) {
      const side = weightedWinner(teamById(t, m.a), teamById(t, m.b), rnd), [w, l] = genScore(t.sport, rnd);
      setWinner(t, m, side, { sa: side === 'a' ? w : l, sb: side === 'a' ? l : w }, now);
    }
  }
}
