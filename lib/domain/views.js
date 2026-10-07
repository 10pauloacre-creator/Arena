// Projeções dos dados: o que o visitante vê (sem dados pessoais) e o que o organizador vê.

import { SPORTS, roundName, matchLabel } from '../../public/assets/js/shared/sports.js';
import { canRepesc, isBlocked, teamById, totalRounds } from './bracket.js';
import { matchPhase, replayVolley, scoreOf } from './live.js';
import { confirmedTeams, registrationState, statusOf, STATUS_LABELS, isReservationActive } from './tournament.js';
import { paymentView } from './payments.js';

const emblemUrl = (t, team) => team.hasEmblem ? `/api/public/${t.id}/emblem/${team.id}?v=${team.emblemVer}` : null;

function publicTeam(t, team) {
  return {
    id: team.id, name: team.name, origin: team.origin, hue: team.hue, emblemUrl: emblemUrl(t, team),
    repescada: team.repescada, eliminated: !!team.elim,
    players: team.players.map(p => ({ name: p.name, number: p.number })),
  };
}

function decorateEvents(t, match, sport) {
  const events = match.live?.events || [];
  if (sport.mode === 'sets') {
    const r = replayVolley(events, sport.setsToWin);
    return events.map(e => ({ ...e, set: r.marks[e.id]?.set, setEnd: r.marks[e.id]?.setEnd || null }));
  }
  return events.map(e => ({ ...e }));
}

function matchView(t, match, now) {
  const sport = SPORTS[t.sport];
  const phase = matchPhase(t, match);
  const sc = scoreOf(match, sport);
  const showEvents = match.live && (match.live.events.length > 0);
  return {
    key: match.id ? `p:${match.id}` : `${match.r}-${match.m}`,
    r: match.r, m: match.m, id: match.id || null,
    a: match.a, b: match.b, win: match.win, bye: !!match.bye,
    phase, blocked: !match.id && isBlocked(t, match),
    score: (phase === 'tbd' || phase === 'bye') ? null : { a: sc.a, b: sc.b, cur: sc.cur, set: sc.set, setScores: sc.setScores },
    pa: match.pa, pb: match.pb, note: match.note || '',
    clock: match.live ? { status: match.live.status, elapsedMs: match.live.elapsedMs, startedAt: match.live.startedAt } : null,
    events: showEvents ? decorateEvents(t, match, sport).slice(-80) : [],
    decided: sport.mode === 'sets' && sc.decided ? sc.decided : null,
    label: match.id ? 'Revanche de repescagem' : matchLabel(totalRounds(t), match.r, match.m),
    roundName: match.id ? 'Revanche de repescagem' : roundName(totalRounds(t), match.r),
    ...(match.id ? { side: match.side, status: match.status } : {}),
  };
}

function bracketView(t, now) {
  if (!t.bracket) return null;
  const R = totalRounds(t);
  return {
    size: t.bracket.size, seed: t.bracket.seed, info: t.bracket.info,
    rounds: t.bracket.rounds.map((round, r) => ({ r, name: roundName(R, r), matches: round.map(m => matchView(t, m, now)) })),
    playins: t.playins.map(p => matchView(t, p, now)),
  };
}

function base(t, now) {
  const reg = registrationState(t, now);
  const status = statusOf(t, now);
  const sport = SPORTS[t.sport];
  return {
    id: t.id, name: t.name, sport: t.sport, sportLabel: sport.label, type: t.type,
    finalDate: t.finalDate, regDeadline: t.regDeadline, registrationOpen: t.registrationOpen,
    fee: t.fee, maxTeams: t.maxTeams, venue: t.venue, description: t.description,
    causes: t.causes, minDonation: t.minDonation, donationEnabled: t.donationEnabled,
    status, statusLabel: STATUS_LABELS[status],
    registration: { open: reg.open, reason: reg.reason, slotsLeft: reg.slotsLeft, occupied: reg.occupied, closesAt: reg.closesAt },
    teamsConfirmed: confirmedTeams(t).length,
    bracket: bracketView(t, now),
    champion: t.champion,
    donations: { total: t.donations.total, count: t.donations.count },
    stream: t.stream,
    demo: t.demo,
    serverNow: now,
    version: t.version,
    rosterRules: { min: sport.min, max: sport.max },
  };
}

/** Visão do visitante: nada de CPF/RG/contatos. */
export function publicView(t, now) {
  const v = base(t, now);
  v.teams = confirmedTeams(t).map(x => publicTeam(t, x));
  // times eliminados no bracket também precisam existir na lista (já confirmados), ok.
  return v;
}

/** Visão do organizador. */
export function adminView(t, now, { users = {}, me }) {
  const v = base(t, now);
  const sport = SPORTS[t.sport];
  v.teams = t.teams.map(team => ({
    ...publicTeam(t, team),
    status: team.status, createdAt: team.createdAt, confirmedAt: team.confirmedAt, reservedUntil: team.reservedUntil,
    paidVia: team.paidVia, rating: team.rating, captain: team.captain, accessCode: team.accessCode,
    players: team.players.map(p => ({ ...p })), source: team.source,
    elim: team.elim, noRepesc: team.noRepesc,
    repesc: team.elim ? canRepesc(t, team) : null,
    reservationActive: isReservationActive(team, now),
  }));
  v.payments = t.payments.slice(-200).map(p => ({ ...paymentView(p), needsRefund: !!p.needsRefund, teamName: teamById(t, p.teamId)?.name || '—', cause: p.meta?.cause || null }));
  v.donationItems = t.donations.items.map(d => ({ ...d, teamName: teamById(t, d.teamId)?.name || '—' }));
  v.activity = t.activity;
  v.stats = {
    teamsConfirmed: confirmedTeams(t).length,
    athletes: confirmedTeams(t).reduce((s, x) => s + x.players.length, 0),
    blocked: t.stats.blocked,
    matchesDone: t.bracket ? t.bracket.rounds.flat().filter(m => m.win && !m.bye).length : 0,
    matchesTotal: t.bracket ? t.bracket.rounds.flat().filter(m => !m.bye).length : 0,
    revenue: t.payments.filter(p => p.status === 'approved' && p.kind === 'registration').reduce((s, p) => s + p.amount, 0),
    refundsPending: t.payments.filter(p => p.needsRefund).length,
  };
  v.regSeries = regSeries(t, now);
  v.perf = perfSeries(t, sport);
  v.admins = t.admins.map(a => ({ userId: a.userId, role: a.role, addedAt: a.addedAt, name: users[a.userId]?.name || 'Usuário', email: users[a.userId]?.email || '' }));
  v.invites = t.invites.filter(i => !i.revoked && !i.usedBy && i.expiresAt > now).map(i => ({ code: i.code, createdAt: i.createdAt, expiresAt: i.expiresAt, createdBy: users[i.createdBy]?.name || '' }));
  v.me = { userId: me.id, role: t.admins.find(a => a.userId === me.id)?.role || 'admin' };
  return v;
}

/** Inscrições acumuladas nos últimos 7 dias (por data de confirmação). */
function regSeries(t, now) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    days.push(d);
  }
  const confirmed = t.teams.filter(x => x.confirmedAt);
  return days.map(d => {
    const end = d.getTime() + 86400_000;
    return { label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`, value: confirmed.filter(x => x.confirmedAt < end).length };
  });
}

/** Média de gols/pontos por fase: real quando há jogos encerrados, senão a projeção da modalidade. */
function perfSeries(t, sport) {
  const R = t.bracket ? totalRounds(t) : Math.max(1, Math.round(Math.log2(t.maxTeams)));
  const out = [];
  for (let r = 0; r < R; r++) {
    const done = t.bracket ? t.bracket.rounds[r].filter(m => m.win && !m.bye && m.sa != null) : [];
    let value, real = false;
    if (done.length) {
      real = true;
      const total = done.reduce((s, m) => s + (sport.mode === 'sets' ? (m.setScores?.length ? m.setScores.reduce((x, y) => x + y.a + y.b, 0) / m.setScores.length / 2 : 0) : (m.sa + m.sb) / (sport.key === 'basquete' ? 2 : 1)), 0);
      value = Math.round(total / done.length * 10) / 10;
    } else value = sport.perfBaseline[Math.min(r, sport.perfBaseline.length - 1)];
    out.push({ label: roundName(R, r), value, real });
  }
  return out;
}

/** Linha da grade da página inicial. */
export function summaryView(t, userId, now) {
  const status = statusOf(t, now);
  const sport = SPORTS[t.sport];
  return {
    id: t.id, name: t.name, sport: t.sport, sportLabel: sport.label, finalDate: t.finalDate, regDeadline: t.regDeadline,
    status, statusLabel: STATUS_LABELS[status], teamsConfirmed: confirmedTeams(t).length, maxTeams: t.maxTeams,
    role: t.admins.find(a => a.userId === userId)?.role || 'admin', fee: t.fee, demo: t.demo, createdAt: t.createdAt,
  };
}

/** Visão privada do time para o capitão (acesso por código). */
export function captainTeamView(t, team, now) {
  const pay = t.payments.filter(p => p.teamId === team.id && p.kind === 'registration').slice(-1)[0];
  return {
    id: team.id, name: team.name, origin: team.origin, status: team.status, hue: team.hue, emblemUrl: emblemUrl(t, team),
    reservedUntil: team.reservedUntil, reservationLeftMs: isReservationActive(team, now) ? team.reservedUntil - now : 0,
    confirmedAt: team.confirmedAt, paidVia: team.paidVia,
    players: team.players.map(p => ({ name: p.name, number: p.number })),
    payment: pay ? paymentView(pay) : null,
    eliminated: !!team.elim, repescada: team.repescada,
    repesc: team.elim ? canRepesc(t, team) : null,
    repescPayment: t.payments.filter(p => p.teamId === team.id && p.kind === 'donation').slice(-1).map(paymentView)[0] || null,
  };
}
