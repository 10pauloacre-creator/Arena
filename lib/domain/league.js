// Campeonato de pontos corridos (todos contra todos): tabela de jogos por rodada, classificação e campeão.
// O organizador define o máximo de partidas por time; sem limite, é turno único (cada time enfrenta todos uma vez).

import { mulberry32, shuffle } from '../../public/assets/js/shared/format.js';
import { badRequest, conflict } from '../errors.js';
import { confirmedTeams, pushActivity } from './tournament.js';

export const POINTS = { win: 3, draw: 1, loss: 0 };
export const MAX_LEAGUE_MATCHES = 80;

/** Rodadas do turno único: n−1 (n par) ou n (n ímpar, um time folga por rodada). */
export const singleRounds = n => (n % 2 ? n : n - 1);
/** Máximo possível de rodadas (turno e returno). */
export const doubleRounds = n => 2 * singleRounds(n);

/** Método do círculo: todas as rodadas do turno único; null = folga. */
function circle(ids) {
  const arr = ids.slice();
  if (arr.length % 2) arr.push(null);
  const n = arr.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const round = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a && b) round.push(r % 2 ? { a: b, b: a } : { a, b }); // alterna o mando
    }
    rounds.push(round);
    arr.splice(1, 0, arr.pop());
  }
  return rounds;
}

/** Monta a tabela de jogos. `maxMatches` = máximo de partidas por time (rodadas); sem valor, turno único. */
export function buildLeague(teams, { maxMatches = null, seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0 } = {}) {
  if (teams.length < 3) throw badRequest('Pontos corridos precisam de ao menos 3 times confirmados.', 'NOT_ENOUGH_TEAMS');
  const rnd = mulberry32(seed);
  const single = circle(shuffle(teams.map(t => t.id), rnd));
  const all = [...single, ...single.map(rd => rd.map(m => ({ a: m.b, b: m.a })))]; // returno: mando invertido
  const wanted = maxMatches ? Math.min(Number(maxMatches), all.length) : single.length;
  const rounds = all.slice(0, wanted).map((rd, r) => rd.map((m, i) => ({ key: `${r}-${i}`, r, i, a: m.a, b: m.b, sa: null, sb: null, done: false })));
  return { seed, maxMatches: wanted, full: single.length, teamIds: teams.map(t => t.id), rounds };
}

export const allLeagueMatches = t => (t.league ? t.league.rounds.flat() : []);

export function findLeagueMatch(t, key) {
  if (!t.league) return null;
  const m = /^(\d+)-(\d+)$/.exec(key);
  return m ? t.league.rounds[+m[1]]?.[+m[2]] || null : null;
}

/** Classificação: pontos, vitórias, saldo de gols, gols pró e nome. Posições empatadas em tudo dividem o lugar. */
export function leagueTable(t, nameOf = id => id) {
  const rows = new Map(t.league.teamIds.map(id => [id, { id, name: nameOf(id), pts: 0, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0 }]));
  for (const m of allLeagueMatches(t)) {
    if (!m.done) continue;
    const a = rows.get(m.a), b = rows.get(m.b);
    if (!a || !b) continue;
    a.p++; b.p++; a.gf += m.sa; a.ga += m.sb; b.gf += m.sb; b.ga += m.sa;
    if (m.sa > m.sb) { a.w++; b.l++; a.pts += POINTS.win; b.pts += POINTS.loss; }
    else if (m.sa < m.sb) { b.w++; a.l++; b.pts += POINTS.win; a.pts += POINTS.loss; }
    else { a.d++; b.d++; a.pts += POINTS.draw; b.pts += POINTS.draw; }
  }
  const list = [...rows.values()];
  for (const r of list) r.gd = r.gf - r.ga;
  const key = r => [r.pts, r.w, r.gd, r.gf];
  list.sort((x, y) => { const kx = key(x), ky = key(y); for (let i = 0; i < kx.length; i++) if (kx[i] !== ky[i]) return ky[i] - kx[i]; return String(x.name).localeCompare(String(y.name), 'pt-BR'); });
  let pos = 0;
  list.forEach((r, i) => { if (i === 0 || key(r).some((v, k) => v !== key(list[i - 1])[k])) pos = i + 1; r.pos = pos; });
  return list;
}

export const leagueFinished = t => !!t.league && allLeagueMatches(t).every(m => m.done);

const score = (v, label) => {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !Number.isInteger(n) || n < 0 || n > 99) throw badRequest(`Placar inválido (${label}): use um número inteiro de 0 a 99.`, 'VALIDATION');
  return n;
};

/** Atualiza o campeão conforme a tabela: só quando todas as partidas terminaram (quem tem mais pontos). */
function syncChampion(t, now) {
  const had = t.champion;
  if (leagueFinished(t)) {
    const top = leagueTable(t, id => t.teams.find(x => x.id === id)?.name || id)[0];
    t.champion = top.id;
    if (had !== top.id) pushActivity(t, 'champion', `${top.name} é o campeão do campeonato de pontos corridos com ${top.pts} pontos!`, now);
  } else t.champion = null;
}

/** Registra (ou corrige) o resultado de uma partida; `clear: true` desfaz. */
export function recordLeagueResult(t, key, { sa, sb, clear = false }, now) {
  const m = findLeagueMatch(t, key);
  if (!m) throw badRequest('Partida não encontrada.', 'NOT_FOUND');
  const name = id => t.teams.find(x => x.id === id)?.name || '?';
  if (clear) { m.sa = null; m.sb = null; m.done = false; }
  else {
    m.sa = score(sa, name(m.a)); m.sb = score(sb, name(m.b)); m.done = true;
    pushActivity(t, 'match', `Rodada ${m.r + 1}: ${name(m.a)} ${m.sa} × ${m.sb} ${name(m.b)}.`, now);
  }
  syncChampion(t, now);
  return m;
}

export function drawLeague(t, now, opts = {}) {
  if (allLeagueMatches(t).some(m => m.done)) throw conflict('O campeonato já começou (há resultados registrados): não é possível sortear novamente.', 'STARTED');
  const teams = confirmedTeams(t);
  const league = buildLeague(teams, { maxMatches: t.leagueMax || null, ...opts });
  t.teams.forEach(x => { if (x.status === 'pending_payment') x.status = 'expired'; });
  t.league = league; t.champion = null; t.registrationOpen = false;
  pushActivity(t, 'draw', `Tabela do campeonato gerada: ${teams.length} times, ${league.rounds.length} rodadas.`, now);
  return league;
}

export function resetLeague(t, now) {
  t.league = null; t.champion = null;
  pushActivity(t, 'reset', 'Tabela do campeonato reiniciada pelo organizador.', now);
}

/** Simula a próxima rodada (apenas demonstração). */
export function simulateLeagueRound(t, now, rnd = Math.random) {
  if (!t.league) throw conflict('Gere a tabela primeiro.', 'NO_BRACKET');
  const round = t.league.rounds.find(rd => rd.some(m => !m.done));
  if (!round) return;
  for (const m of round) {
    if (m.done) continue;
    const a = t.teams.find(x => x.id === m.a), b = t.teams.find(x => x.id === m.b);
    const pa = 1 / (1 + Math.pow(10, ((b?.rating || 1000) - (a?.rating || 1000)) / 400));
    const draw = rnd() < 0.22, aWins = rnd() < pa;
    const hi = 1 + Math.floor(rnd() * 4), lo = Math.floor(rnd() * hi);
    recordLeagueResult(t, m.key, draw ? { sa: lo, sb: lo } : aWins ? { sa: hi, sb: lo } : { sa: lo, sb: hi }, now);
  }
}
