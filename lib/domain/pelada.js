// Modelo e regras da pelada (servidor): configurações, dias, presença, convidados, sorteio, partidas e gols.
// Tudo aqui opera sobre o documento da pelada (objeto simples) e lança HttpError quando a regra é violada.

import { randomBytes } from 'node:crypto';
import { badRequest, conflict, notFound } from '../errors.js';
import { shortCode } from '../auth.js';
import { cleanText } from './tournament.js';
import { parseDay } from '../../public/assets/js/shared/format.js';
import {
  GENDERS, DEFAULT_MATCH_MIN, PELADA_ALPHABET, drawTeams, matchScore, nameKey,
  nextPairing, timerRemaining, mulberry32,
} from '../../public/assets/js/shared/pelada.js';

export const MAX_DAYS = 80;
export const MAX_MATCHES_PER_DAY = 40;
export const MAX_MEMBERS = 2000;
export const MAX_ATTENDANCE = 300;
export const MAX_GUESTS = 300;
export const MIN_PER_TEAM = { min: 2, max: 15 };

const bad = (msg, field) => badRequest(msg, 'VALIDATION', field ? { field } : undefined);
const rid = (prefix, taken = []) => {
  for (;;) { const id = prefix + shortCode(5).toLowerCase(); if (!taken.includes(id)) return id; }
};
export const peladaId = () => {
  const bytes = randomBytes(6);
  let s = 'PL-';
  for (let i = 0; i < 6; i++) s += PELADA_ALPHABET[bytes[i] % PELADA_ALPHABET.length];
  return s;
};

// ---------------------------------------------------------------- imagens (avatar/capa)
const SIGS = { 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
/** Valida um data URL de imagem e devolve { mime, b64 } (ou null se vazio). */
export function parseImage(dataUrl, { maxBytes, field, label }) {
  if (dataUrl === undefined || dataUrl === null || dataUrl === '') return null;
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl));
  if (!m) throw bad(`${label} inválida. Use PNG, JPG ou WEBP.`, field);
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxBytes) throw bad(`${label} muito grande (até ${Math.round(maxBytes / 1000)} KB). Recorte uma área menor.`, field);
  const sig = SIGS[m[1]];
  if (!sig.every((b, i) => buf[i] === b)) throw bad(`${label} inválida.`, field);
  return { mime: m[1], b64: m[2] };
}
export const AVATAR_MAX = 90_000;
export const COVER_MAX = 260_000;

// ---------------------------------------------------------------- configurações
function int(v, { min, max, field, label }) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label}: informe um número inteiro entre ${min} e ${max}.`, field);
  return n;
}
export const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !!parseDay(s);

/** Organização (regras de formação): { minPerTeam, noTeams, matchMinutes }. */
export function sanitizeOrg(o, base) {
  const src = o && typeof o === 'object' ? o : {};
  const has = k => src[k] !== undefined && src[k] !== null && src[k] !== '';
  return {
    minPerTeam: has('minPerTeam') ? int(src.minPerTeam, { ...MIN_PER_TEAM, field: 'minPerTeam', label: 'Mínimo de jogadores por time' }) : base.minPerTeam,
    noTeams: has('noTeams') ? !!src.noTeams : base.noTeams,
    matchMinutes: has('matchMinutes') ? int(src.matchMinutes, { min: 1, max: 90, field: 'matchMinutes', label: 'Duração da partida (min)' }) : base.matchMinutes,
  };
}

export function sanitizeSettings(input, base = null) {
  const out = {};
  const has = k => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
  if (has('name') || !base) out.name = cleanText(input.name, 50, { min: 3, field: 'Nome da pelada' });
  if (has('gender') || !base) {
    if (!(input.gender in GENDERS)) throw bad('Escolha se a pelada é feminina ou masculina.', 'gender');
    out.gender = input.gender;
  }
  if (has('minPerTeam') || !base) out.minPerTeam = int(input.minPerTeam ?? 5, { ...MIN_PER_TEAM, field: 'minPerTeam', label: 'Mínimo de jogadores por time' });
  if (has('noTeams')) out.noTeams = !!input.noTeams; else if (!base) out.noTeams = false;
  if (has('matchMinutes') || !base) out.matchMinutes = int(input.matchMinutes ?? DEFAULT_MATCH_MIN, { min: 1, max: 90, field: 'matchMinutes', label: 'Duração da partida (min)' });
  return out;
}

export const orgOf = (p, day) => day.org
  ? { minPerTeam: day.org.minPerTeam, noTeams: !!day.org.noTeams, matchMinutes: day.org.matchMinutes }
  : { minPerTeam: p.minPerTeam, noTeams: !!p.noTeams, matchMinutes: p.matchMinutes };

// ---------------------------------------------------------------- criação
export function newMatch(day, org, now, { a = null, b = null, auto = false } = {}) {
  const n = day.matches.reduce((m, x) => Math.max(m, x.n), 0) + 1;
  return {
    id: rid('m_', day.matches.map(x => x.id)), n, a, b, status: 'scheduled', auto, goals: [], loans: {},
    timer: { durationMs: org.matchMinutes * 60_000, elapsedMs: 0, startedAt: null }, createdAt: now, startedAt: null, finishedAt: null, result: null,
  };
}

export function newDay(p, { date, org = null, matches = 0 }, now) {
  if (!validDate(date)) throw bad('Data do jogo inválida.', 'date');
  const day = {
    id: rid('d_', p.days.map(d => d.id)), date, org: null, attendance: [], draw: null, queue: [], streaks: {},
    matches: [], looseGoals: {}, createdAt: now,
  };
  if (org) day.org = sanitizeOrg(org, orgOf(p, { org: null }));
  const count = int(matches ?? 0, { min: 0, max: MAX_MATCHES_PER_DAY, field: 'matches', label: 'Partidas' });
  for (let i = 0; i < count; i++) day.matches.push(newMatch(day, orgOf(p, day), now));
  return day;
}

export function addDay(p, input, now) {
  if (p.days.length >= MAX_DAYS) throw bad(`Máximo de ${MAX_DAYS} datas por pelada.`, 'date');
  if (p.days.some(d => d.date === input.date)) throw conflict('Já existe um jogo nesta data.', 'DUPLICATE_DAY', { field: 'date' });
  const day = newDay(p, input, now);
  p.days.push(day);
  p.days.sort((a, b) => a.date.localeCompare(b.date));
  return day;
}

export function newPelada({ id, owner, input }, now) {
  const s = sanitizeSettings(input);
  const p = {
    id, ownerId: owner.id, ...s, members: [{ userId: owner.id, at: now }], guests: [], days: [],
    img: { avatar: 0, cover: 0 }, createdAt: now, updatedAt: now, version: 1,
  };
  const days = Array.isArray(input.days) ? input.days : [];
  if (days.length > MAX_DAYS) throw bad(`Máximo de ${MAX_DAYS} datas por pelada.`, 'days');
  const seen = new Set();
  for (const d of days) {
    if (seen.has(d.date)) continue; // datas repetidas na lista são ignoradas
    seen.add(d.date);
    addDay(p, { date: d.date, org: d.org || null, matches: d.matches || 0 }, now);
  }
  return p;
}

export function getDay(p, dayId) {
  const day = p.days.find(d => d.id === dayId);
  if (!day) throw notFound('Data de jogo não encontrada.');
  return day;
}
export function getMatch(day, mid) {
  const m = day.matches.find(x => x.id === mid);
  if (!m) throw notFound('Partida não encontrada.');
  return m;
}

export function addMember(p, userId, now) {
  if (p.members.some(m => m.userId === userId)) return false;
  if (p.members.length >= MAX_MEMBERS) throw conflict('Esta pelada atingiu o limite de participantes.', 'LIMIT_MEMBERS');
  p.members.push({ userId, at: now });
  return true;
}

// ---------------------------------------------------------------- presença / convidados
export const userPid = id => `u:${id}`;
export const guestPid = id => `g:${id}`;
export const isGuestPid = pid => String(pid).startsWith('g:');

const unfinished = day => day.matches.filter(m => m.status !== 'finished');

/** Jogadores presentes que não estão em nenhum time (chegaram depois do sorteio ou ficaram avulsos). */
export function freePids(day) {
  if (!day.draw) return [];
  const inTeam = new Set(day.draw.teams.flatMap(t => t.players));
  return day.attendance.map(a => a.pid).filter(pid => !inTeam.has(pid));
}

/** Mantém `day.queue` coerente: só times do sorteio e que não estejam em partida aberta; os que voltam entram no fim. */
export function normalizeQueue(day, front = []) {
  const ids = day.draw ? day.draw.teams.map(t => t.id) : [];
  const busy = new Set();
  for (const m of unfinished(day)) { if (m.a) busy.add(m.a); if (m.b) busy.add(m.b); }
  const q = [];
  for (const id of [...front, ...day.queue, ...ids]) if (ids.includes(id) && !busy.has(id) && !q.includes(id)) q.push(id);
  day.queue = q;
}

function removeFromTeams(day, pid) {
  if (!day.draw) return;
  for (const t of day.draw.teams) {
    const i = t.players.indexOf(pid);
    if (i < 0) continue;
    t.players.splice(i, 1);
    if (t.captain === pid) t.captain = t.players[0] || null;
    if (t.incomplete) t.missing = Math.max(0, orgMinOf(day) - t.players.length);
  }
}
const orgMinOf = day => day.draw?.min || 0;

export function setPresence(p, day, userId, present, now) {
  addMember(p, userId, now);
  const pid = userPid(userId);
  const i = day.attendance.findIndex(a => a.pid === pid);
  if (present && i < 0) {
    if (day.attendance.length >= MAX_ATTENDANCE) throw conflict('A lista de presença deste dia está cheia.', 'LIMIT_ATTENDANCE');
    day.attendance.push({ pid, at: now });
  }
  if (!present && i >= 0) { day.attendance.splice(i, 1); removeFromTeams(day, pid); }
  return day;
}

export function findGuest(p, name) {
  const key = nameKey(name);
  return p.guests.find(g => nameKey(g.name) === key);
}

/** Convidado do organizador (nome apenas). `teamId`: 'free' | id do time | undefined (antes do sorteio entra na lista). */
export function addGuest(p, day, rawName, teamId, now, nameOfPid) {
  const name = cleanText(rawName, 40, { min: 2, field: 'Nome do convidado' });
  const key = nameKey(name);
  if (day.attendance.some(a => nameKey(nameOfPid(a.pid)) === key)) throw conflict('Já existe alguém com este nome na lista de presença.', 'DUPLICATE_NAME', { field: 'name' });
  if (day.attendance.length >= MAX_ATTENDANCE) throw conflict('A lista de presença deste dia está cheia.', 'LIMIT_ATTENDANCE');
  let g = findGuest(p, name);
  if (!g && p.guests.length >= MAX_GUESTS) throw conflict('Limite de convidados desta pelada atingido.', 'LIMIT_GUESTS');
  if (!g) { g = { id: rid('g_', p.guests.map(x => x.id)), name, at: now }; p.guests.push(g); }
  const pid = guestPid(g.id);
  day.attendance.push({ pid, at: now, guest: true });
  if (day.draw && teamId && teamId !== 'free') {
    const t = day.draw.teams.find(x => x.id === teamId);
    if (!t) throw notFound('Time não encontrado.');
    t.players.push(pid);
    if (t.incomplete) t.missing = Math.max(0, day.draw.min - t.players.length);
  }
  return g;
}

export function removeAttendance(day, pid) {
  const i = day.attendance.findIndex(a => a.pid === pid);
  if (i < 0) throw notFound('Esta pessoa não está na lista de presença.');
  day.attendance.splice(i, 1);
  removeFromTeams(day, pid);
}

// ---------------------------------------------------------------- sorteio
/** `players` = presentes com nome: [{ pid, name, guest }]. */
export function performDraw(p, day, players, { by, now, rnd }) {
  const org = orgOf(p, day);
  if (org.noTeams) throw badRequest('Esta data está configurada como "Sem formação de times".', 'NO_TEAMS');
  if (day.matches.some(m => m.status !== 'scheduled')) throw conflict('Já existem partidas em andamento ou encerradas: não é possível refazer o sorteio.', 'HAS_MATCHES');
  const seed = rnd ? Math.floor(rnd() * 2 ** 32) : randomBytes(4).readUInt32BE(0);
  const res = drawTeams(players, org.minPerTeam, rnd || mulberry32(seed));
  if (!res.ok) throw badRequest(res.error, 'DRAW_IMPOSSIBLE');
  day.draw = { id: rid('s_'), at: now, seed, by, min: org.minPerTeam, teams: res.teams, notes: res.notes, count: players.length };
  day.streaks = {};
  day.queue = res.teams.map(t => t.id);
  for (const m of day.matches) { m.a = null; m.b = null; m.loans = {}; m.goals = []; }
  return day.draw;
}

export function assignPlayer(day, pid, teamId) {
  if (!day.draw) throw badRequest('Faça o sorteio antes de montar os times.', 'NO_DRAW');
  if (!day.attendance.some(a => a.pid === pid)) throw notFound('Esta pessoa não está na lista de presença.');
  const target = teamId ? day.draw.teams.find(t => t.id === teamId) : null;
  if (teamId && !target) throw notFound('Time não encontrado.');
  removeFromTeams(day, pid);
  if (target) {
    target.players.push(pid);
    if (!target.captain) target.captain = pid;
    if (target.incomplete) target.missing = Math.max(0, day.draw.min - target.players.length);
  }
}

// ---------------------------------------------------------------- partidas
function teamExists(day, id) { return !!day.draw?.teams.some(t => t.id === id); }
function busyElsewhere(day, teamId, exceptMatchId) {
  return unfinished(day).some(m => m.id !== exceptMatchId && (m.a === teamId || m.b === teamId));
}

export function createMatch(p, day, { a = null, b = null }, now) {
  if (orgOf(p, day).noTeams) throw badRequest('Esta data não forma times: anote os gols direto na lista de presença.', 'NO_TEAMS');
  if (day.matches.length >= MAX_MATCHES_PER_DAY) throw bad(`Máximo de ${MAX_MATCHES_PER_DAY} partidas por dia.`);
  const m = newMatch(day, orgOf(p, day), now);
  day.matches.push(m);
  if (a || b) setMatchTeams(day, m, { a: a || null, b: b || null });
  normalizeQueue(day);
  return m;
}

/** Define os times da partida (apenas enquanto não encerrada/iniciada). `null` limpa a vaga. */
export function setMatchTeams(day, m, { a, b }) {
  if (m.status !== 'scheduled') throw conflict('A partida já começou: não dá para trocar os times.', 'MATCH_STARTED');
  const next = { a: a === undefined ? m.a : a, b: b === undefined ? m.b : b };
  for (const k of ['a', 'b']) {
    const id = next[k];
    if (!id) continue;
    if (!teamExists(day, id)) throw badRequest('Faça o sorteio e escolha entre os times criados.', 'NO_DRAW');
    if (busyElsewhere(day, id, m.id)) throw conflict('Este time já está em outra partida em aberto.', 'TEAM_BUSY');
  }
  if (next.a && next.a === next.b) throw badRequest('Escolha dois times diferentes.', 'SAME_TEAM');
  const freed = ['a', 'b'].map(k => m[k]).filter(id => id && id !== next.a && id !== next.b);
  m.a = next.a; m.b = next.b; m.loans = {}; m.goals = [];
  normalizeQueue(day, freed);
}

export function deleteMatch(day, m) {
  const freed = [m.a, m.b].filter(Boolean);
  day.matches.splice(day.matches.indexOf(m), 1);
  if (m.status !== 'finished') normalizeQueue(day, freed);
}

export function timerAction(m, { action, minutes }, now) {
  if (m.status === 'finished') throw conflict('A partida já foi encerrada.', 'MATCH_FINISHED');
  const t = m.timer;
  if (action === 'start') {
    if (!m.a || !m.b) throw badRequest('Escolha os dois times antes de iniciar o cronômetro.', 'NO_TEAMS_SET');
    if (t.startedAt) return;
    if (timerRemaining(t, now) <= 0) throw conflict('O tempo desta partida já acabou. Encerre a partida.', 'TIME_UP');
    t.startedAt = now;
    if (m.status === 'scheduled') { m.status = 'live'; m.startedAt = now; }
  } else if (action === 'pause') {
    if (t.startedAt) { t.elapsedMs += Math.max(0, now - t.startedAt); t.startedAt = null; }
  } else if (action === 'reset') {
    t.elapsedMs = 0; t.startedAt = null;
  } else if (action === 'set') {
    const min = int(minutes, { min: 1, max: 90, field: 'minutes', label: 'Tempo da partida (min)' });
    if (t.startedAt) throw conflict('Pause o cronômetro para alterar o tempo.', 'TIMER_RUNNING');
    t.durationMs = min * 60_000; t.elapsedMs = 0;
  } else throw bad('Ação de cronômetro inválida.');
}

const rosterOf = (day, teamId) => day.draw?.teams.find(t => t.id === teamId)?.players || [];

export function addGoal(day, m, { teamId, pid }, now) {
  if (teamId !== m.a && teamId !== m.b) throw badRequest('Esse time não está na partida.', 'BAD_TEAM');
  if (pid) {
    const ok = rosterOf(day, teamId).includes(pid) || (m.loans[teamId] || []).includes(pid);
    if (!ok) throw badRequest('Esse jogador não está neste time. Use "Jogador de fora" para emprestá-lo à partida.', 'NOT_IN_TEAM');
  }
  const g = { id: rid('o_', m.goals.map(x => x.id)), teamId, pid: pid || null, at: now };
  m.goals.push(g);
  syncResult(m);
  return g;
}
export function removeGoal(m, goalId) {
  const i = m.goals.findIndex(g => g.id === goalId);
  if (i < 0) throw notFound('Gol não encontrado.');
  m.goals.splice(i, 1);
  syncResult(m);
}
function syncResult(m) {
  if (m.status !== 'finished') return;
  const s = matchScore(m);
  m.result = { a: s[m.a] || 0, b: s[m.b] || 0 };
}

export function setLoan(day, m, { teamId, pid, remove = false }) {
  if (teamId !== m.a && teamId !== m.b) throw badRequest('Esse time não está na partida.', 'BAD_TEAM');
  if (m.status === 'finished') throw conflict('A partida já foi encerrada.', 'MATCH_FINISHED');
  const list = m.loans[teamId] || (m.loans[teamId] = []);
  if (remove) {
    if (m.goals.some(g => g.teamId === teamId && g.pid === pid)) throw conflict('Esse jogador já marcou nesta partida: remova os gols dele antes.', 'HAS_GOALS');
    m.loans[teamId] = list.filter(x => x !== pid);
    return;
  }
  if (!day.attendance.some(a => a.pid === pid)) throw badRequest('Só quem está na lista de presença pode ser emprestado.', 'NOT_PRESENT');
  if (rosterOf(day, m.a).includes(pid) || rosterOf(day, m.b).includes(pid)) throw badRequest('Esse jogador já está em um dos times desta partida.', 'IN_MATCH');
  if ((m.loans[m.a] || []).includes(pid) || (m.loans[m.b] || []).includes(pid)) throw conflict('Esse jogador já foi emprestado nesta partida.', 'ALREADY_LOANED');
  list.push(pid);
}

/**
 * Encerra a partida, atualiza as sequências e cria o próximo confronto automaticamente
 * ("quem ganha fica"; empate: sai quem está há mais partidas seguidas). Retorna { next, info }.
 */
export function finishMatch(p, day, m, { auto = false, now }) {
  if (m.status === 'finished') throw conflict('A partida já foi encerrada.', 'MATCH_FINISHED');
  if (!m.a || !m.b) throw badRequest('Escolha os dois times antes de encerrar.', 'NO_TEAMS_SET');
  if (auto && timerRemaining(m.timer, now) > 0) throw conflict('O tempo ainda não acabou.', 'TIMER_RUNNING');
  const t = m.timer;
  if (t.startedAt) { t.elapsedMs += Math.max(0, now - t.startedAt); t.startedAt = null; }
  if (auto) t.elapsedMs = Math.min(t.elapsedMs, t.durationMs); // o apito é no tempo regulamentar, mesmo que o fechamento chegue atrasado
  if (!m.startedAt) m.startedAt = now;
  m.status = 'finished'; m.finishedAt = now; m.autoEnded = !!auto;
  const s = matchScore(m);
  const sa = s[m.a] || 0, sb = s[m.b] || 0;
  m.result = { a: sa, b: sb };
  day.streaks[m.a] = (day.streaks[m.a] || 0) + 1;
  day.streaks[m.b] = (day.streaks[m.b] || 0) + 1;

  normalizeQueue(day); // a e b agora não estão em partida aberta: voltam ao fim da fila
  const queue = day.queue.filter(id => id !== m.a && id !== m.b);
  const planned = unfinished(day).filter(x => x.a && x.b);
  const pair = nextPairing({ a: m.a, b: m.b, scoreA: sa, scoreB: sb, queue, streaks: day.streaks });
  day.streaks[pair.leaver] = 0;
  const placeholder = unfinished(day).find(x => !x.a && !x.b);

  if (planned.length) {
    // o organizador já deixou outra partida montada: os dois times só entram na fila (quem fica primeiro)
    day.queue = [...queue, pair.stayer, pair.leaver];
    return { next: null, info: { reason: pair.reason, stayer: pair.stayer, leaver: pair.leaver, planned: true } };
  }
  const target = placeholder || (() => { const x = newMatch(day, orgOf(p, day), now, { auto: true }); day.matches.push(x); return x; })();
  target.a = pair.a; target.b = pair.b; target.auto = true; target.loans = {}; target.goals = [];
  target.timer = { durationMs: orgOf(p, day).matchMinutes * 60_000, elapsedMs: 0, startedAt: null };
  day.queue = pair.queue;
  normalizeQueue(day);
  m.next = { matchId: target.id, reason: pair.reason, stayer: pair.stayer, leaver: pair.leaver };
  return { next: target, info: { ...m.next, planned: false } };
}

// ---------------------------------------------------------------- gols do dia (sem formação de times)
export function adjustLooseGoal(p, day, pid, delta) {
  if (!orgOf(p, day).noTeams) throw badRequest('Nesta data os gols são anotados dentro das partidas.', 'HAS_TEAMS');
  if (!day.attendance.some(a => a.pid === pid)) throw notFound('Esta pessoa não está na lista de presença.');
  const d = Number(delta) >= 0 ? 1 : -1;
  const cur = day.looseGoals[pid] || 0;
  const next = Math.max(0, cur + d);
  if (next > 99) throw bad('Gols demais para uma pessoa em um dia.');
  if (next === 0) delete day.looseGoals[pid]; else day.looseGoals[pid] = next;
}

// ---------------------------------------------------------------- artilharia
export function dayGoals(day) {
  const g = {};
  for (const m of day.matches) for (const x of m.goals) if (x.pid) g[x.pid] = (g[x.pid] || 0) + 1;
  for (const [pid, n] of Object.entries(day.looseGoals || {})) g[pid] = (g[pid] || 0) + n;
  return g;
}
export function allGoals(p) {
  const g = {};
  for (const d of p.days) for (const [pid, n] of Object.entries(dayGoals(d))) g[pid] = (g[pid] || 0) + n;
  return g;
}
