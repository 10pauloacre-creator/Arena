// Modelo e regras da pelada (servidor): configurações, dias, presença, convidados, sorteio, partidas e gols.
// Tudo aqui opera sobre o documento da pelada (objeto simples) e lança HttpError quando a regra é violada.

import { randomBytes } from 'node:crypto';
import { badRequest, conflict, notFound } from '../errors.js';
import { shortCode } from '../auth.js';
import { cleanText } from './tournament.js';
import { parseDay } from '../../public/assets/js/shared/format.js';
import {
  GENDERS, DEFAULT_MATCH_MIN, DEFAULT_GENERAL_EVERY, PELADA_ALPHABET, formTeams, drawNotes, joinNames, matchScore, nameKey,
  nextPairing, timerRemaining, mulberry32, teamLabel, shuffle, pickCaptain,
} from '../../public/assets/js/shared/pelada.js';
import { dayStats, goalsByPid, pairHistory, leaveOrder, stayCmp, planGeneral } from './pelada-engine.js';
import { gx, cap } from '../../public/assets/js/shared/gender.js';
import { newIdentity, fallbackIdentity } from '../../public/assets/js/shared/team-catalog.js';

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
/** Prévia do link de convite (capa + foto + nome, 1200×630), montada no navegador de quem organiza. */
export const PREVIEW_MAX = 230_000;

// ---------------------------------------------------------------- configurações
function int(v, { min, max, field, label }) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label}: informe um número inteiro entre ${min} e ${max}.`, field);
  return n;
}
export const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !!parseDay(s);

/** De quantas em quantas partidas o sorteio automático geral refaz os times (1 a 10). */
const generalEvery = v => int(v, { min: 1, max: 10, field: 'generalEvery', label: 'Sorteio automático geral a cada (partidas)' });

/** Organização (regras de formação): { minPerTeam, noTeams, matchMinutes, autoDraw (Cerca), generalDraw, generalEvery }. */
export function sanitizeOrg(o, base) {
  const src = o && typeof o === 'object' ? o : {};
  const has = k => src[k] !== undefined && src[k] !== null && src[k] !== '';
  return {
    minPerTeam: has('minPerTeam') ? int(src.minPerTeam, { ...MIN_PER_TEAM, field: 'minPerTeam', label: 'Mínimo de jogadores por time' }) : base.minPerTeam,
    noTeams: has('noTeams') ? !!src.noTeams : base.noTeams,
    matchMinutes: has('matchMinutes') ? int(src.matchMinutes, { min: 1, max: 90, field: 'matchMinutes', label: 'Duração da partida (min)' }) : base.matchMinutes,
    autoDraw: has('autoDraw') ? !!src.autoDraw : !!base.autoDraw,
    generalDraw: has('generalDraw') ? !!src.generalDraw : !!base.generalDraw,
    generalEvery: has('generalEvery') ? generalEvery(src.generalEvery) : (base.generalEvery ?? DEFAULT_GENERAL_EVERY),
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
  if (has('autoDraw')) out.autoDraw = !!input.autoDraw; else if (!base) out.autoDraw = false;
  if (has('generalDraw')) out.generalDraw = !!input.generalDraw; else if (!base) out.generalDraw = false;
  if (has('generalEvery') || !base) out.generalEvery = generalEvery(input.generalEvery ?? DEFAULT_GENERAL_EVERY);
  return out;
}

export const orgOf = (p, day) => {
  const o = day.org || p;
  return { minPerTeam: o.minPerTeam, noTeams: !!o.noTeams, matchMinutes: o.matchMinutes, autoDraw: !!o.autoDraw, generalDraw: !!o.generalDraw, generalEvery: o.generalEvery ?? DEFAULT_GENERAL_EVERY };
};

// ---------------------------------------------------------------- criação
export function newMatch(day, org, now, { a = null, b = null, auto = false } = {}) {
  const n = day.matches.reduce((m, x) => Math.max(m, x.n), 0) + 1;
  return {
    id: rid('m_', day.matches.map(x => x.id)), n, a, b, status: 'scheduled', auto, stay: null, goals: [], loans: {},
    timer: { durationMs: org.matchMinutes * 60_000, elapsedMs: 0, startedAt: null }, createdAt: now, startedAt: null, finishedAt: null, result: null,
  };
}

export function newDay(p, { date, org = null, matches = 0 }, now) {
  if (!validDate(date)) throw bad('Data do jogo inválida.', 'date');
  const day = {
    id: rid('d_', p.days.map(d => d.id)), date, org: null, attendance: [], draw: null, queue: [], streaks: {}, sinceDraw: 0, lastLeaver: null, pending: null,
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
  inheritFixed(p, day, now);
  return day;
}

export function newPelada({ id, owner, input }, now) {
  const s = sanitizeSettings(input);
  const p = {
    id, ownerId: owner.id, ...s, members: [{ userId: owner.id, at: now }], guests: [], days: [],
    img: { avatar: 0, cover: 0, preview: 0 }, createdAt: now, updatedAt: now, version: 1,
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

/** Times criados antes do catálogo ganham nome e emblema (os mesmos que a tela já mostrava como reserva). */
export function ensureIdentities(p, day) {
  if (!day.draw) return;
  const used = [];
  for (const t of day.draw.teams) {
    if (!(t.name && t.emb)) Object.assign(t, fallbackIdentity(`${day.id}:${t.id}`, p.gender, used.map(u => u.name)));
    used.push(t);
  }
}

export function getDay(p, dayId) {
  const day = p.days.find(d => d.id === dayId);
  if (!day) throw notFound('Data de jogo não encontrada.');
  ensureIdentities(p, day);
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

/** A Cerca: presentes que não estão em nenhum time (sobraram do sorteio ou chegaram depois). Aguardam a próxima partida. */
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
  }
}

export function setPresence(p, day, userId, present, now) {
  addMember(p, userId, now);
  const pid = userPid(userId);
  const i = day.attendance.findIndex(a => a.pid === pid);
  if (present && i < 0) {
    if (day.attendance.length >= MAX_ATTENDANCE) throw conflict('A lista de presença deste dia está cheia.', 'LIMIT_ATTENDANCE');
    day.attendance.push({ pid, at: now });
    backToFixedTeam(day, pid);
  }
  if (!present && i >= 0) { day.attendance.splice(i, 1); removeFromTeams(day, pid); }
  return day;
}

export function findGuest(p, name) {
  const key = nameKey(name);
  return p.guests.find(g => nameKey(g.name) === key);
}

/**
 * Convidado do organizador (nome apenas). `teamId`: 'free' (Cerca) | id do time | undefined.
 * Depois do sorteio, quem chega entra na Cerca (aguarda a próxima partida) a menos que o organizador o encaixe em um time.
 */
export function addGuest(p, day, rawName, teamId, now, nameOfPid) {
  const G = gx(p.gender);
  const name = cleanText(rawName, 40, { min: 2, field: `Nome d${G.o} ${G.guest}` });
  const key = nameKey(name);
  if (day.attendance.some(a => nameKey(nameOfPid(a.pid)) === key)) throw conflict('Já existe alguém com este nome na lista de presença.', 'DUPLICATE_NAME', { field: 'name' });
  if (day.attendance.length >= MAX_ATTENDANCE) throw conflict('A lista de presença deste dia está cheia.', 'LIMIT_ATTENDANCE');
  const target = day.draw && teamId && teamId !== 'free' ? day.draw.teams.find(x => x.id === teamId) : null;
  if (day.draw && teamId && teamId !== 'free' && !target) throw notFound('Time não encontrado.');
  let g = findGuest(p, name);
  if (!g && p.guests.length >= MAX_GUESTS) throw conflict(`Limite de ${G.guests} desta pelada atingido.`, 'LIMIT_GUESTS');
  if (!g) { g = { id: rid('g_', p.guests.map(x => x.id)), name, at: now }; p.guests.push(g); }
  const pid = guestPid(g.id);
  day.attendance.push({ pid, at: now, guest: true });
  if (target) { target.players.push(pid); if (day.fixed) day.fixed.roster[pid] = target.id; if (!target.captain) target.captain = pid; } else backToFixedTeam(day, pid);
  return g;
}

export function removeAttendance(day, pid) {
  const i = day.attendance.findIndex(a => a.pid === pid);
  if (i < 0) throw notFound('Esta pessoa não está na lista de presença.');
  day.attendance.splice(i, 1);
  removeFromTeams(day, pid);
}

/**
 * Sai da pelada (ou é excluído pelo organizador): deixa de ser participante e sai das listas de hoje e das datas futuras.
 * Datas passadas, partidas e gols não mudam: a artilharia continua somando tudo o que a pessoa marcou.
 */
export function removeMember(p, userId, today) {
  if (userId === p.ownerId) throw conflict(`${cap(gx(p.gender).o)} ${gx(p.gender).owner} não pode sair da própria pelada. Exclua a pelada se não quiser mais organizá-la.`, 'OWNER_CANNOT_LEAVE');
  const i = p.members.findIndex(m => m.userId === userId);
  if (i < 0) throw notFound('Esta pessoa não participa da pelada.');
  p.members.splice(i, 1);
  const pid = userPid(userId);
  for (const day of p.days) {
    if (day.date >= today && day.fixed) delete day.fixed.roster[pid];
    if (day.date < today || !day.attendance.some(a => a.pid === pid)) continue;
    day.attendance = day.attendance.filter(a => a.pid !== pid);
    removeFromTeams(day, pid);
    for (const m of day.matches) if (m.status !== 'finished') for (const k of Object.keys(m.loans || {})) if (!m.goals.some(g => g.pid === pid)) m.loans[k] = m.loans[k].filter(x => x !== pid);
  }
}

// ---------------------------------------------------------------- sorteio e Cerca
const maxNumber = teams => teams.reduce((n, t) => Math.max(n, t.number), 0);
const chunk = (list, size) => { const out = []; for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out; };
const teamName = (t, p, day) => t ? teamLabel(t, day.id, p.gender) : '';
const isLive = (day, teamId) => day.matches.some(m => m.status === 'live' && (m.a === teamId || m.b === teamId));
export const hasLiveMatch = day => day.matches.some(m => m.status === 'live');

/** Número novo de time: nunca repete o de um time que já jogou (as súmulas guardam os números). */
function nextNumber(day) {
  let n = Math.max(day.teamSeq || 0, maxNumber(day.draw?.teams || []));
  for (const m of day.matches) for (const r of Object.values(m.rosters || {})) n = Math.max(n, r.number || 0);
  day.teamSeq = n + 1;
  return n + 1;
}

function makeTeam(p, day, players, rnd, { core = new Set(), used = day.draw.teams } = {}) {
  const number = nextNumber(day);
  const list = players.map(pid => ({ pid, guest: isGuestPid(pid) }));
  return { id: `t${number}`, number, captain: pickCaptain(list, core, rnd), players, ...newIdentity(used, p.gender, rnd) };
}

/** Foto de quem está em cada time e na Cerca, para descrever o que mudou depois de um sorteio. */
const snapDraw = day => ({ teams: Object.fromEntries((day.draw?.teams || []).map(t => [t.id, [...t.players]])), fence: freePids(day) });
function diffDraw(before, day) {
  const after = snapDraw(day);
  const changes = [];
  for (const [id, now] of Object.entries(after.teams)) {
    const was = before.teams[id] || [];
    const inn = now.filter(x => !was.includes(x)), out = was.filter(x => !now.includes(x));
    if (inn.length || out.length || !before.teams[id]) changes.push({ teamId: id, isNew: !before.teams[id], in: inn, out });
  }
  return {
    changes, gone: Object.keys(before.teams).filter(id => !after.teams[id]),
    fenceIn: before.fence.filter(x => !after.fence.includes(x)), fenceOut: after.fence.filter(x => !before.fence.includes(x)),
  };
}
const changeText = (p, day, d, nameOf, head) => {
  const label = id => teamName(day.draw.teams.find(t => t.id === id), p, day);
  const parts = d.changes.filter(c => c.in.length || c.out.length).map(c =>
    `${label(c.teamId)}${c.isNew ? ' (novo)' : ''}: ${[c.in.length && `entram ${joinNames(c.in, nameOf)}`, c.out.length && `saem ${joinNames(c.out, nameOf)}`].filter(Boolean).join('; ')}`);
  const fence = d.fenceOut.length ? `Nova Cerca: ${joinNames(d.fenceOut, nameOf)}.` : 'A Cerca ficou vazia.';
  return `${head} ${parts.length ? `${parts.join('. ')}. ` : ''}${fence}`.slice(0, 700);
};
const pushLog = (day, text) => { day.draw.log = [...(day.draw.log || []), text].slice(-6); day.draw.count = day.attendance.length; };

/** Primeiro sorteio do dia (ainda sem times): a Cerca nasce do que sobrar. Calcula sem alterar nada. */
function planInitial(p, day, { rnd, nameOf }) {
  const min = orgOf(p, day).minPerTeam;
  const pool = day.attendance.map(a => a.pid);
  const k = Math.floor(pool.length / min);
  if (k < 2) return { ok: false, error: `Faltam ${gx(p.gender).players}: para sortear ao menos 2 times com mínimo de ${min} é preciso ter ${2 * min} presentes (há ${pool.length}).` };
  const res = formTeams(pool.map(pid => ({ pid, name: nameOf(pid), guest: isGuestPid(pid) })), min, rnd, { mustTeams: 2 });
  const used = [];
  const created = res.teams.map((t, i) => {
    const team = { id: `t${i + 1}`, number: i + 1, captain: t.captain, players: t.players, ...newIdentity(used, p.gender, rnd) };
    used.push(team);
    return team;
  });
  return { ok: true, created, fence: res.fence, poolSize: pool.length, min };
}

/** `players` = presentes com nome: [{ pid, name, guest }]. Só o primeiro sorteio; depois use `manualDraw`. */
export function performDraw(p, day, players, { by, now, rnd }) {
  const org = orgOf(p, day);
  if (org.noTeams) throw badRequest('Esta data está configurada como "Sem formação de times".', 'NO_TEAMS');
  if (day.draw) throw conflict('Os times deste dia já foram sorteados: use o sorteio da Cerca ou o sorteio geral.', 'ALREADY_DRAWN');
  const seed = rnd ? Math.floor(rnd() * 2 ** 32) : randomBytes(4).readUInt32BE(0);
  const names = new Map(players.map(x => [x.pid, x.name]));
  const nameOf = pid => names.get(pid) || '?';
  const plan = planInitial(p, day, { rnd: rnd || mulberry32(seed), nameOf });
  if (!plan.ok) throw badRequest(plan.error, 'DRAW_IMPOSSIBLE');
  const notes = drawNotes({ total: plan.poolSize, min: plan.min, teams: plan.created.length, fence: plan.fence, nameOf });
  day.draw = { id: rid('s_'), at: now, seed, by, min: org.minPerTeam, teams: plan.created, notes, log: [], count: day.attendance.length };
  day.streaks = Object.fromEntries(plan.created.map(t => [t.id, 0]));
  day.queue = plan.created.map(t => t.id);
  day.sinceDraw = 0; day.lastLeaver = null; day.pending = null; day.teamSeq = plan.created.length;
  for (const m of day.matches) if (m.status === 'scheduled') { m.a = null; m.b = null; m.stay = null; m.loans = {}; m.goals = []; }
  normalizeQueue(day);
  return day.draw;
}

/** Times da lista `teams` (na ordem de entrada em quadra) passam a valer; os demais deixam de existir. */
function applyTeamsSet(day, teams, { target = null } = {}) {
  day.draw.teams = [...teams].sort((a, b) => a.number - b.number);
  day.queue = teams.map(t => t.id);
  day.streaks = Object.fromEntries(teams.map(t => [t.id, 0]));
  day.pending = null; day.sinceDraw = 0;
  const open = day.matches.filter(m => m.status === 'scheduled');
  for (const m of open) { m.a = null; m.b = null; m.stay = null; m.loans = {}; m.goals = []; }
  const first = target || open[0];
  if (first && teams.length >= 2) { first.a = teams[0].id; first.b = teams[1].id; first.stay = null; }
  normalizeQueue(day);
}

/** Cada grupo herda a identidade (id, número, nome, emblema) do time atual com mais jogadores em comum; sobrando grupos, nascem times novos. */
function mapGroups(p, day, groups, rnd) {
  const free = [...day.draw.teams].sort((a, b) => a.number - b.number);
  const made = [];
  const teams = groups.map(g => {
    const set = new Set(g);
    let old = null, best = -1;
    for (const t of free) { const n = t.players.filter(x => set.has(x)).length; if (n > best) { old = t; best = n; } }
    if (old) free.splice(free.indexOf(old), 1);
    const team = old
      ? { ...old, players: g, captain: g.includes(old.captain) ? old.captain : pickCaptain(g.map(pid => ({ pid, guest: isGuestPid(pid) })), new Set(), rnd) }
      : makeTeam(p, day, g, rnd, { used: [...day.draw.teams, ...made] });
    made.push(team);
    return team;
  });
  return teams;
}

const generalPlan = (p, day, { rnd, onCourt }) => planGeneral({
  pids: day.attendance.map(a => a.pid), cerca: freePids(day), onCourt, min: orgOf(p, day).minPerTeam,
  stats: dayStats(day), pairs: pairHistory(day), rnd,
});
const tooFew = (p, day) => badRequest(`Faltam ${gx(p.gender).players} para refazer os times: são necessários ${2 * orgOf(p, day).minPerTeam} e há ${day.attendance.length}.`, 'DRAW_IMPOSSIBLE');
const playersOf = (m, ids) => new Set(ids.flatMap(id => [...(m.rosters?.[id]?.players || []), ...(m.loans?.[id] || [])]));

/**
 * Sorteio da Cerca: a Cerca vira times. Cada grupo completo (`minPerTeam`) forma um time novo, que entra na fila antes do time
 * derrotado; o resto (Cerca incompleta) entra no time derrotado `leaver`, no lugar de quem mais jogou e mais fez gols no dia, que
 * passam a formar a nova Cerca. Quem está na Cerca sempre entra. Os demais times não mudam.
 */
export function fenceDraw(p, day, { leaver = null, rnd, nameOf }) {
  if (!day.draw || orgOf(p, day).noTeams) return null;
  const min = orgOf(p, day).minPerTeam;
  const fence = freePids(day);
  if (!fence.length) return null;
  const before = snapDraw(day);
  const stats = dayStats(day);
  const tie = new Map(fence.map(pid => [pid, rnd()]));
  const ordered = [...fence].sort(stayCmp(stats, tie));
  const k = Math.floor(ordered.length / min);
  const fresh = [];
  for (const g of chunk(shuffle(ordered.slice(0, k * min), rnd), min)) {
    const t = makeTeam(p, day, g, rnd);
    day.draw.teams.push(t);
    day.streaks[t.id] = 0;
    fresh.push(t.id);
  }
  const rest = ordered.slice(k * min);
  const L = leaver && !isLive(day, leaver) ? day.draw.teams.find(t => t.id === leaver) : null;
  if (L && rest.length) {
    const leaving = Math.max(0, L.players.length + rest.length - min);
    const out = leaveOrder(L.players, stats, rnd).slice(0, leaving);
    L.players = [...L.players.filter(x => !out.includes(x)), ...rest];
    if (!L.players.includes(L.captain)) L.captain = rest[0] || L.players[0] || null;
  }
  day.draw.teams.sort((a, b) => a.number - b.number);
  normalizeQueue(day);
  if (leaver && day.queue.includes(leaver)) day.queue = [...day.queue.filter(x => x !== leaver), leaver];
  // a partida já montada que tinha o time derrotado como desafiante passa a ter o primeiro time novo
  const m = fresh.length && leaver ? day.matches.find(x => x.status === 'scheduled' && x.stay && (x.a === leaver || x.b === leaver)) : null;
  if (m) {
    m[m.a === leaver ? 'a' : 'b'] = fresh[0];
    m.loans = {}; m.goals = [];
    normalizeQueue(day);
    day.queue = [...day.queue.filter(x => x !== leaver), ...(day.queue.includes(leaver) ? [leaver] : [])];
  }
  const diff = diffDraw(before, day);
  return { kind: 'fence', ...diff, fresh, leaver: L ? L.id : null };
}

/** Chegou gente depois do sorteio (presença ou convidada): se a Cerca já completa um time, ele nasce na hora. */
export function settleArrivals(p, day, { rnd = mulberry32(randomBytes(4).readUInt32BE(0)), nameOf }) {
  const org = orgOf(p, day);
  if (!org.autoDraw || !day.draw || org.noTeams || day.fixed || freePids(day).length < org.minPerTeam) return null;
  const r = fenceDraw(p, day, { leaver: null, rnd, nameOf });
  if (r) pushLog(day, changeText(p, day, r, nameOf, 'A Cerca completou um time:'));
  return r;
}

/** Sorteio geral aplicado já (sem partida em andamento): `onCourt` = quem acabou de jogar, que fica por último na vez. */
function generalNow(p, day, { rnd, nameOf, onCourt, target = null, head }) {
  const plan = generalPlan(p, day, { rnd, onCourt });
  if (!plan) throw tooFew(p, day);
  const before = snapDraw(day);
  applyTeamsSet(day, mapGroups(p, day, plan.groups, rnd), { target });
  const diff = diffDraw(before, day);
  pushLog(day, `${head} ${diff.fenceOut.length ? `Nova Cerca: ${joinNames(diff.fenceOut, nameOf)}.` : 'A Cerca ficou vazia.'}`);
  return { kind: 'general', ...diff };
}

/** Sorteio geral combinado durante uma partida: fica guardado e vale quando ela terminar (quem está em quadra espera a vez). */
function generalLater(p, day, { rnd, nameOf, by, now }) {
  const live = day.matches.filter(m => m.status === 'live');
  const onCourt = new Set(live.flatMap(m => [m.a, m.b]).flatMap(id => day.draw.teams.find(t => t.id === id)?.players || []));
  const plan = generalPlan(p, day, { rnd, onCourt });
  if (!plan) throw tooFew(p, day);
  const teams = mapGroups(p, day, plan.groups, rnd);
  day.pending = { kind: 'general', at: now, by, teams, fence: plan.fence };
  day.draw.log = [...(day.draw.log || []), `Sorteio geral combinado: vale quando a partida terminar. ${plan.fence.length ? `Cerca: ${joinNames(plan.fence, nameOf)}.` : 'Sem Cerca.'}`].slice(-6);
  return { kind: 'general', later: true, pending: day.pending };
}

/** Aplica o sorteio geral combinado, ajustando a quem chegou ou saiu desde então. Retorna null se não deu (ou ainda há partida em quadra). */
function applyPending(p, day, { rnd, nameOf, target }) {
  const pd = day.pending;
  if (!pd || hasLiveMatch(day)) return null;
  const min = orgOf(p, day).minPerTeam;
  const present = new Set(day.attendance.map(a => a.pid));
  const teams = pd.teams.map(t => ({ ...t, players: t.players.filter(x => present.has(x)) }));
  const taken = new Set(teams.flatMap(t => t.players));
  const stats = dayStats(day);
  const spare = day.attendance.map(a => a.pid).filter(x => !taken.has(x));
  spare.sort(stayCmp(stats, new Map(spare.map(x => [x, rnd()]))));
  for (const t of teams) while (t.players.length < min && spare.length) t.players.push(spare.shift());
  const ok = teams.filter(t => t.players.length >= min);
  if (ok.length < 2) { day.pending = null; return null; }
  for (const t of ok) if (!t.players.includes(t.captain)) t.captain = t.players[0];
  const before = snapDraw(day);
  applyTeamsSet(day, ok, { target });
  const diff = diffDraw(before, day);
  return { kind: 'general', ...diff };
}

// ---------------------------------------------------------------- times fixos
/** Quem está em cada time quando eles são fixados: { pid: idDoTime }. Quem não está presente hoje volta ao seu time quando confirmar. */
const rosterOfTeams = day => Object.fromEntries((day.draw?.teams || []).flatMap(t => t.players.map(pid => [pid, t.id])));

/** Quem volta de um dia com times fixos (ou chega depois) entra de novo no time dele. */
function backToFixedTeam(day, pid) {
  const tid = day.fixed?.roster?.[pid];
  const t = tid && day.draw?.teams.find(x => x.id === tid);
  if (!t || t.players.includes(pid) || day.draw.teams.some(x => x.players.includes(pid))) return;
  t.players.push(pid);
  if (!t.captain) t.captain = pid;
}

/** Fixa os times: os mesmos jogadores seguem nos mesmos times em todas as partidas, sem sorteios (nem automáticos nem manuais). */
export function fixTeams(p, day, { by, now }) {
  if (orgOf(p, day).noTeams) throw badRequest('Esta data não forma times.', 'NO_TEAMS');
  if (!day.draw) throw badRequest('Faça o sorteio antes de fixar os times.', 'NO_DRAW');
  if (day.fixed && !day.fixed.inherited) return day.fixed;
  day.pending = null;
  day.fixed = { at: now, by, inherited: false, fromDayId: null, roster: { ...(day.fixed?.roster || {}), ...rosterOfTeams(day) } };
  for (const later of p.days) if (later.date > day.date) inheritFixed(p, later, now);
  return day.fixed;
}

/** Libera os times: os sorteios voltam a valer. As datas que herdaram e ainda não começaram deixam de herdar. */
export function unfixTeams(p, day) {
  if (!day.fixed) return;
  day.fixed = null;
  for (const later of [...p.days].sort((a, b) => a.date.localeCompare(b.date))) {
    const f = later.fixed;
    if (!f?.inherited || p.days.find(d => d.id === f.fromDayId)?.fixed || later.matches.some(m => m.status !== 'scheduled')) continue;
    later.fixed = null; later.draw = null; later.queue = []; later.streaks = {}; later.pending = null;
    for (const m of later.matches) { m.a = null; m.b = null; m.stay = null; }
  }
}

/**
 * Uma data que ainda não teve sorteio nem partidas herda os times fixos do último dia de jogo anterior (mesmo nome, emblema e número;
 * os jogadores entram nos times ao confirmar presença).
 */
export function inheritFixed(p, day, now) {
  if (day.draw || day.fixed || orgOf(p, day).noTeams || day.matches.some(m => m.status !== 'scheduled')) return false;
  const src = [...p.days].filter(d => d.date < day.date && d.fixed && d.draw).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!src) return false;
  const teams = src.draw.teams.map(t => ({ id: t.id, number: t.number, name: t.name, emb: t.emb, captain: null, players: [] }));
  day.draw = {
    id: rid('s_'), at: now, seed: 0, by: null, min: orgOf(p, day).minPerTeam, teams, log: [], count: day.attendance.length,
    notes: [`Times fixos, mantidos do último dia de jogo (${src.date.slice(8, 10)}/${src.date.slice(5, 7)}): ${gx(p.gender).players} voltam ao próprio time ao confirmar presença.`],
  };
  day.fixed = { at: now, by: null, inherited: true, fromDayId: src.id, roster: { ...src.fixed.roster } };
  day.queue = teams.map(t => t.id); day.streaks = Object.fromEntries(teams.map(t => [t.id, 0]));
  day.sinceDraw = 0; day.lastLeaver = null; day.pending = null; day.teamSeq = maxNumber(teams);
  for (const a of day.attendance) backToFixedTeam(day, a.pid);
  normalizeQueue(day);
  return true;
}

/**
 * Sorteio manual (só o organizador). `mode`: 'fence' = Cerca + time derrotado | 'general' = todos os jogadores.
 * Sem partida em quadra vale na hora; com partida em quadra, o da Cerca define o próximo time agora (precisa de um grupo completo
 * na Cerca) e o geral fica combinado para quando ela terminar.
 */
export function manualDraw(p, day, mode, { rnd = mulberry32(randomBytes(4).readUInt32BE(0)), nameOf, by, now }) {
  const org = orgOf(p, day);
  if (org.noTeams) throw badRequest('Esta data está configurada como "Sem formação de times".', 'NO_TEAMS');
  if (!day.draw) throw badRequest('Faça o primeiro sorteio antes.', 'NO_DRAW');
  if (mode === 'cancel') { day.pending = null; return { kind: 'cancel' }; }
  if (day.fixed) throw conflict('Os times estão fixos: libere os times para sortear de novo.', 'TEAMS_FIXED');
  const G = gx(p.gender);
  const live = hasLiveMatch(day);
  if (mode === 'fence') {
    const fence = freePids(day), min = org.minPerTeam;
    if (live && fence.length < min) throw badRequest(`Durante a partida, o sorteio da Cerca precisa de ao menos ${min} ${G.players} na Cerca para formar o próximo time (há ${fence.length}).`, 'FENCE_TOO_SMALL');
    if (!live && !fence.length) throw badRequest('A Cerca está vazia: não há quem sortear.', 'FENCE_EMPTY');
    const leaver = live ? null : (day.matches.some(m => m.status === 'finished') ? day.lastLeaver : null);
    if (!live && fence.length < min && !(leaver && day.draw.teams.some(t => t.id === leaver))) throw badRequest('Ainda não há time derrotado para receber a Cerca.', 'NO_LEAVER');
    const r = fenceDraw(p, day, { leaver, rnd, nameOf });
    if (!r) throw badRequest('Nada para sortear.', 'FENCE_EMPTY');
    pushLog(day, changeText(p, day, r, nameOf, live ? 'Sorteio da Cerca:' : 'Sorteio da Cerca + time derrotado:'));
    return r;
  }
  if (mode !== 'general') throw bad('Escolha o tipo de sorteio.');
  if (live) return generalLater(p, day, { rnd, nameOf, by, now });
  const last = [...day.matches].reverse().find(m => m.status === 'finished');
  const onCourt = last ? playersOf(last, [last.a, last.b]) : new Set();
  const r = generalNow(p, day, { rnd, nameOf, onCourt, head: 'Sorteio geral:' });
  day.lastLeaver = null;
  return r;
}

export function assignPlayer(day, pid, teamId) {
  if (!day.draw) throw badRequest('Faça o sorteio antes de montar os times.', 'NO_DRAW');
  if (!day.attendance.some(a => a.pid === pid)) throw notFound('Esta pessoa não está na lista de presença.');
  const target = teamId ? day.draw.teams.find(t => t.id === teamId) : null;
  if (teamId && !target) throw notFound('Time não encontrado.');
  removeFromTeams(day, pid);
  day.pending = null; // o encaixe manual muda os times: o sorteio geral combinado deixa de valer
  if (day.fixed) { if (target) day.fixed.roster[pid] = target.id; else delete day.fixed.roster[pid]; }
  if (target) {
    target.players.push(pid);
    if (!target.captain) target.captain = pid;
  }
}

/** Troca o capitão de um time (vale também durante a partida: o elenco só é gravado ao encerrá-la). */
export function setCaptain(day, teamId, pid) {
  const t = day.draw?.teams.find(x => x.id === teamId);
  if (!t) throw notFound('Time não encontrado.');
  if (!t.players.includes(pid)) throw badRequest('O capitão precisa ser alguém do time.', 'NOT_IN_TEAM');
  t.captain = pid;
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
  if (m.stay && m.stay !== m.a && m.stay !== m.b) m.stay = null;
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
/** Elenco do time NA partida: o de quando ela terminou (os times mudam de jogadores nos sorteios), senão o atual. */
export const rosterFor = (day, m, teamId) => m.rosters?.[teamId]?.players || rosterOf(day, teamId);

export function addGoal(day, m, { teamId, pid }, now, G = gx()) {
  if (teamId !== m.a && teamId !== m.b) throw badRequest('Esse time não está na partida.', 'BAD_TEAM');
  if (pid) {
    const ok = rosterFor(day, m, teamId).includes(pid) || (m.loans[teamId] || []).includes(pid);
    if (!ok) throw badRequest(`${cap(G.esse)} ${G.player} não está neste time. Use "${cap(G.player)} de fora" para emprestá-l${G.o} à partida.`, 'NOT_IN_TEAM');
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

export function setLoan(day, m, { teamId, pid, remove = false }, G = gx()) {
  if (teamId !== m.a && teamId !== m.b) throw badRequest('Esse time não está na partida.', 'BAD_TEAM');
  const list = m.loans[teamId] || (m.loans[teamId] = []);
  if (remove) {
    if (m.goals.some(g => g.teamId === teamId && g.pid === pid)) throw conflict(`${cap(G.esse)} ${G.player} já marcou nesta partida: remova os gols d${G.ele} antes.`, 'HAS_GOALS');
    m.loans[teamId] = list.filter(x => x !== pid);
    return;
  }
  if (!day.attendance.some(a => a.pid === pid)) throw badRequest('Só quem está na lista de presença pode ser emprestad' + G.o + '.', 'NOT_PRESENT');
  if (rosterFor(day, m, m.a).includes(pid) || rosterFor(day, m, m.b).includes(pid)) throw badRequest(`${cap(G.esse)} ${G.player} já está em um dos times desta partida.`, 'IN_MATCH');
  if ((m.loans[m.a] || []).includes(pid) || (m.loans[m.b] || []).includes(pid)) throw conflict(`${cap(G.esse)} ${G.player} já foi emprestad${G.o} nesta partida.`, 'ALREADY_LOANED');
  list.push(pid);
}

const snapTeam = (day, id) => { const t = day.draw.teams.find(x => x.id === id); return { id, number: t.number, name: t.name, emb: t.emb, captain: t.captain, players: [...t.players] }; };

/**
 * Encerra a partida, atualiza as sequências e cria o próximo confronto automaticamente ("quem ganha fica"; empate: sai quem está
 * há mais partidas seguidas). Depois, conforme a configuração: sorteio geral combinado (ou automático a cada N partidas) refaz todos
 * os times; senão, com o sorteio da Cerca ligado, a Cerca entra no time derrotado e os substituídos formam a nova Cerca.
 * Com os times fixos nada é sorteado. Retorna { next, info }.
 */
export function finishMatch(p, day, m, { auto = false, now, rnd, nameOf = pid => pid }) {
  if (m.status === 'finished') throw conflict('A partida já foi encerrada.', 'MATCH_FINISHED');
  if (!m.a || !m.b) throw badRequest('Escolha os dois times antes de encerrar.', 'NO_TEAMS_SET');
  if (auto && timerRemaining(m.timer, now) > 0) throw conflict('O tempo ainda não acabou.', 'TIMER_RUNNING');
  const t = m.timer;
  if (t.startedAt) { t.elapsedMs += Math.max(0, now - t.startedAt); t.startedAt = null; }
  if (auto) t.elapsedMs = Math.min(t.elapsedMs, t.durationMs); // o apito é no tempo regulamentar, mesmo que o fechamento chegue atrasado
  if (!m.startedAt) m.startedAt = now;
  m.rosters = { [m.a]: snapTeam(day, m.a), [m.b]: snapTeam(day, m.b) }; // os times mudam de jogadores nos sorteios: guarda quem jogou
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
  day.sinceDraw = (day.sinceDraw || 0) + 1;
  day.lastLeaver = pair.leaver;
  const placeholder = unfinished(day).find(x => !x.a && !x.b);

  if (planned.length) {
    // o organizador já deixou outra partida montada: os dois times só entram na fila (quem fica primeiro)
    day.queue = [...queue, pair.stayer, pair.leaver];
    return { next: null, info: { reason: pair.reason, stayer: pair.stayer, leaver: pair.leaver, planned: true } };
  }
  const org = orgOf(p, day);
  const target = placeholder || (() => { const x = newMatch(day, org, now, { auto: true }); day.matches.push(x); return x; })();
  target.loans = {}; target.goals = []; target.auto = true; target.stay = pair.stayer;
  target.timer = { durationMs: org.matchMinutes * 60_000, elapsedMs: 0, startedAt: null };
  target.a = pair.a; target.b = pair.b;
  day.queue = pair.queue;
  normalizeQueue(day);

  const R = rnd || mulberry32(randomBytes(4).readUInt32BE(0));
  let r = null;
  if (!day.fixed) {
    if (day.pending && !hasLiveMatch(day)) r = applyPending(p, day, { rnd: R, nameOf, target });
    if (!r && !day.pending) {
      const canGeneral = Math.floor(day.attendance.length / org.minPerTeam) >= 2;
      if (org.generalDraw && canGeneral && day.sinceDraw >= org.generalEvery) {
        r = generalNow(p, day, { rnd: R, nameOf, onCourt: playersOf(m, [m.a, m.b]), target, head: `Após a partida ${m.n}: sorteio geral.` });
      } else if (org.autoDraw) {
        r = fenceDraw(p, day, { leaver: pair.leaver, rnd: R, nameOf });
        if (r) pushLog(day, changeText(p, day, r, nameOf, `Após a partida ${m.n}: ${teamName(day.draw.teams.find(x => x.id === pair.stayer), p, day)} ${pair.reason === 'venceu' ? 'venceu e continua' : 'continua (empate)'}.`));
      }
    }
  }
  if (r && r.kind === 'general') {
    target.stay = null;
    if (r.later === undefined && !day.draw.log.at(-1)?.startsWith('Após')) pushLog(day, changeText(p, day, r, nameOf, `Após a partida ${m.n}: sorteio geral combinado.`));
  }
  const rotation = r && (r.changes.some(c => c.in.length || c.out.length) || r.fenceIn.length || r.fenceOut.length)
    ? { kind: r.kind, teamId: target.b, changes: r.changes, gone: r.gone || [], fenceIn: r.fenceIn, fenceOut: r.fenceOut }
    : null;
  m.next = { matchId: target.id, reason: pair.reason, stayer: pair.stayer, leaver: pair.leaver, rotation };
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
export const dayGoals = goalsByPid;
export function allGoals(p) {
  const g = {};
  for (const d of p.days) for (const [pid, n] of Object.entries(dayGoals(d))) g[pid] = (g[pid] || 0) + n;
  return g;
}
