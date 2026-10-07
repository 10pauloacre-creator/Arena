// Visões (JSON enviado ao navegador) da pelada: pública + dados do espectador (dono, participante, presença).

import { matchScore, rankGoals, teamLabel } from '../pelada.js';
import { orgOf, userPid, freePids, dayGoals, allGoals } from './pelada.js';

const pad = n => String(n).padStart(2, '0');
/** Data de hoje no fuso de Brasília (UTC-3), "YYYY-MM-DD". */
export function todayBR(now) {
  const d = new Date(now - 3 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** IDs de jogadores (contas) citados em qualquer parte da pelada. */
export function referencedUserIds(p) {
  const ids = new Set([p.ownerId, ...p.members.map(m => m.userId)]);
  const add = pid => { if (typeof pid === 'string' && pid.startsWith('u:')) ids.add(pid.slice(2)); };
  for (const d of p.days) {
    d.attendance.forEach(a => add(a.pid));
    Object.keys(d.looseGoals || {}).forEach(add);
    d.draw?.teams.forEach(t => { t.players.forEach(add); add(t.captain); });
    d.matches.forEach(m => { m.goals.forEach(g => add(g.pid)); Object.values(m.loans || {}).forEach(l => l.forEach(add)); });
  }
  return [...ids];
}

function personMap(p, users) {
  const people = {};
  for (const [id, u] of users) people[userPid(id)] = { name: u.name, av: u.av || 0 };
  for (const g of p.guests) people[`g:${g.id}`] = { name: g.name, av: 0, guest: true };
  return people;
}

function matchView(m, now) {
  const s = matchScore(m);
  return {
    id: m.id, n: m.n, a: m.a, b: m.b, status: m.status, auto: !!m.auto,
    goals: m.goals.map(g => ({ id: g.id, teamId: g.teamId, pid: g.pid, at: g.at })),
    loans: m.loans || {}, score: { a: m.a ? s[m.a] || 0 : 0, b: m.b ? s[m.b] || 0 : 0 },
    timer: { durationMs: m.timer.durationMs, elapsedMs: m.timer.elapsedMs, startedAt: m.timer.startedAt },
    startedAt: m.startedAt, finishedAt: m.finishedAt, next: m.next || null,
  };
}

function drawView(day, people) {
  if (!day.draw) return null;
  const nameOf = pid => people[pid]?.name || '?';
  return {
    id: day.draw.id, at: day.draw.at, min: day.draw.min, count: day.draw.count, notes: day.draw.notes, by: day.draw.by,
    teams: day.draw.teams.map(t => ({ id: t.id, number: t.number, captain: t.captain, label: t.captain ? teamLabel(t, nameOf) : `Time ${t.number}`, players: t.players, incomplete: !!t.incomplete, missing: t.missing || 0 })),
  };
}

export function dayView(p, day, { people, viewer, now }) {
  const org = orgOf(p, day);
  const goals = rankGoals(dayGoals(day), pid => people[pid]?.name || '');
  return {
    id: day.id, date: day.date, custom: !!day.org, org,
    attendance: day.attendance.map(a => ({ pid: a.pid, at: a.at, guest: !!a.guest || a.pid.startsWith('g:') })),
    present: !!viewer && day.attendance.some(a => a.pid === userPid(viewer.id)),
    draw: drawView(day, people), free: freePids(day), queue: day.queue, streaks: day.streaks,
    matches: day.matches.map(m => matchView(m, now)),
    looseGoals: day.looseGoals || {},
    ranking: goals,
    isToday: day.date === todayBR(now), isPast: day.date < todayBR(now),
  };
}

export function peladaView(p, { users, viewer, now, base = '' }) {
  const people = personMap(p, users);
  const isOwner = !!viewer && viewer.id === p.ownerId;
  const view = {
    id: p.id, name: p.name, gender: p.gender, minPerTeam: p.minPerTeam, noTeams: !!p.noTeams, matchMinutes: p.matchMinutes,
    owner: userPid(p.ownerId), img: p.img, createdAt: p.createdAt,
    people, members: p.members.map(m => userPid(m.userId)),
    days: p.days.map(d => dayView(p, d, { people, viewer, now })),
    ranking: rankGoals(allGoals(p), pid => people[pid]?.name || ''),
    viewer: viewer ? { id: viewer.id, pid: userPid(viewer.id), name: viewer.name, av: viewer.av || 0, isOwner, isMember: p.members.some(m => m.userId === viewer.id) } : null,
  };
  // o link de convite só é enviado ao criador
  if (isOwner) view.invite = { id: p.id, url: `${base}/pelada/p/${p.id}` };
  return view;
}

/** Resumo para o painel "minhas peladas". */
export function peladaSummary(p, role, now, owner) {
  const today = todayBR(now);
  const next = p.days.find(d => d.date >= today);
  return {
    id: p.id, name: p.name, gender: p.gender, role, img: p.img, members: p.members.length, days: p.days.length,
    nextDate: next?.date || null, lastDate: p.days.length ? p.days[p.days.length - 1].date : null, owner: owner?.name || null,
  };
}
