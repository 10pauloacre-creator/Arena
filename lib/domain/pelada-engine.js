// Motor de sorteio da pelada (funções puras): contagem de jogos e gols do dia, histórico de duplas e sorteio geral
// que evita repetir as mesmas duplas. Quem muda os times é `pelada.js`.

import { shuffle } from '../../public/assets/js/shared/pelada.js';

export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Gols do dia por jogador (partidas + gols avulsos). */
export function goalsByPid(day) {
  const g = {};
  for (const m of day.matches) for (const x of m.goals) if (x.pid) g[x.pid] = (g[x.pid] || 0) + 1;
  for (const [pid, n] of Object.entries(day.looseGoals || {})) g[pid] = (g[pid] || 0) + n;
  return g;
}

/**
 * Contadores do dia, calculados das partidas encerradas (nada fica gravado: editar uma partida corrige tudo):
 * `games` = partidas jogadas por pessoa (quem foi emprestado também conta) e `goals` = gols do dia.
 */
export function dayStats(day) {
  const games = {};
  for (const m of day.matches) {
    if (m.status !== 'finished') continue;
    const played = new Set();
    for (const id of [m.a, m.b]) {
      for (const pid of m.rosters?.[id]?.players || []) played.add(pid);
      for (const pid of m.loans?.[id] || []) played.add(pid);
    }
    for (const pid of played) games[pid] = (games[pid] || 0) + 1;
  }
  return { games, goals: goalsByPid(day) };
}

/** Quantas vezes cada dupla já esteve no mesmo time hoje (partidas encerradas + os times atuais). */
export function pairHistory(day) {
  const pairs = new Map();
  const add = players => {
    for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
      const k = pairKey(players[i], players[j]);
      pairs.set(k, (pairs.get(k) || 0) + 1);
    }
  };
  for (const m of day.matches) if (m.status === 'finished') for (const r of Object.values(m.rosters || {})) add(r.players);
  for (const t of day.draw?.teams || []) add(t.players);
  return pairs;
}

/** Comparador de prioridade para permanecer: menos jogos, depois menos gols, depois o sorteio (`tie`). */
export function stayCmp(stats, tie) {
  return (a, b) => (stats.games[a] || 0) - (stats.games[b] || 0) || (stats.goals[a] || 0) - (stats.goals[b] || 0) || tie.get(a) - tie.get(b);
}

/** Quem sai primeiro do time para dar lugar à Cerca: mais jogos, depois mais gols, depois o sorteio. */
export function leaveOrder(pids, stats, rnd) {
  const tie = new Map(pids.map(p => [p, rnd()]));
  const cmp = stayCmp(stats, tie);
  return [...pids].sort((a, b) => cmp(b, a));
}

const cost = (x, g, skip, pairs) => {
  let s = 0;
  for (const y of g) if (y !== x && y !== skip) { const c = pairs.get(pairKey(x, y)) || 0; s += c * c; }
  return s;
};
export const groupsCost = (groups, pairs) => groups.reduce((s, g) => s + g.reduce((t, x) => t + cost(x, g, null, pairs), 0) / 2, 0);

/** Busca local: troca jogadores entre grupos enquanto isso reduz as duplas repetidas. `canSwap(ia, ib)` limita as trocas. */
export function optimizeGroups(groups, pairs, rnd, { canSwap = () => true, iters = 3000 } = {}) {
  const gs = groups.map(g => g.slice());
  if (gs.length < 2) return gs;
  for (let n = 0; n < iters; n++) {
    const ia = Math.floor(rnd() * gs.length);
    let ib = Math.floor(rnd() * (gs.length - 1));
    if (ib >= ia) ib++;
    if (!canSwap(ia, ib) || !gs[ia].length || !gs[ib].length) continue;
    const i = Math.floor(rnd() * gs[ia].length), j = Math.floor(rnd() * gs[ib].length);
    const x = gs[ia][i], y = gs[ib][j];
    const before = cost(x, gs[ia], null, pairs) + cost(y, gs[ib], null, pairs);
    const after = cost(x, gs[ib], y, pairs) + cost(y, gs[ia], x, pairs);
    if (after < before || (after === before && rnd() < 0.25)) { gs[ia][i] = y; gs[ib][j] = x; }
  }
  return gs;
}

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/**
 * Sorteio geral. `pids` = todos os presentes; `cerca` = quem está na Cerca (entrada garantida); `onCourt` = quem acabou de jogar
 * (ou está jogando): quem não está em quadra ocupa os dois primeiros times, para ter a vez. Forma floor(n / min) times de `min`;
 * os que sobram são os que mais jogaram (depois os que mais fizeram gols) e formam a nova Cerca.
 * Entre as distribuições possíveis, escolhe a que menos repete duplas (`pairs`). Retorna null se não dá para formar 2 times.
 */
export function planGeneral({ pids, cerca = [], onCourt = new Set(), min, stats, pairs, rnd, restarts = 6 }) {
  const k = Math.floor(pids.length / min);
  if (k < 2) return null;
  const cercaSet = new Set(cerca);
  const tie = new Map(pids.map(p => [p, rnd()]));
  const cmp = stayCmp(stats, tie);
  const ranked = [...pids].sort((a, b) => (cercaSet.has(b) ? 1 : 0) - (cercaSet.has(a) ? 1 : 0) || cmp(a, b));
  const inTeams = ranked.slice(0, k * min), fence = ranked.slice(k * min);
  const rested = inTeams.filter(p => !onCourt.has(p)).sort(cmp);
  const court = inTeams.filter(p => onCourt.has(p)).sort(cmp);
  const ordered = [...rested, ...court];
  const front = ordered.slice(0, 2 * min), back = ordered.slice(2 * min);
  const canSwap = (ia, ib) => (ia < 2) === (ib < 2);
  let best = null, bestCost = Infinity;
  for (let r = 0; r < restarts; r++) {
    const start = [...chunk(shuffle(front, rnd), min), ...chunk(shuffle(back, rnd), min)];
    const groups = optimizeGroups(start, pairs, rnd, { canSwap });
    const c = groupsCost(groups, pairs);
    if (c < bestCost) { best = groups; bestCost = c; }
    if (c === 0) break;
  }
  return { groups: best, fence, cost: bestCost };
}
