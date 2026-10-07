// Modelo de torneio: criação, validação de configurações, status e regras de inscrição.

import { SPORTS, SPORT_KEYS, BRACKET_SIZES, TOURNAMENT_TYPES, DEFAULT_CAUSES } from '../../public/assets/js/shared/sports.js';
import { parseDay } from '../../public/assets/js/shared/format.js';
import { badRequest } from '../errors.js';

export const RESERVATION_MS = 30 * 60 * 1000; // vaga reservada enquanto o pagamento é feito
export const TZ_OFFSET = '-03:00'; // padrão Brasil (Brasília) para prazos criados sem fuso

const pad = n => String(n).padStart(2, '0');
export const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Gera ID público no formato AM-2026-9843. */
export function makeTournamentId(now, rnd = Math.random, digits = 4) {
  const year = new Date(now).getFullYear();
  const lo = 10 ** (digits - 1), hi = 10 ** digits - 1;
  return `AM-${year}-${lo + Math.floor(rnd() * (hi - lo + 1))}`;
}

export function defaultFinalDate(now) {
  const d = new Date(now + 30 * 86400_000);
  return isoDay(d);
}
/** Prazo padrão de inscrição: 7 dias antes da final, às 23:59 (Brasília). */
export function defaultDeadline(finalDate, now) {
  const fd = parseDay(finalDate);
  const base = fd ? new Date(fd.getTime() - 7 * 86400_000) : new Date(now + 14 * 86400_000);
  const iso = new Date(`${isoDay(base)}T23:59:00${TZ_OFFSET}`);
  return (iso.getTime() > now ? iso : new Date(now + 7 * 86400_000)).toISOString();
}

export function cleanText(v, max, { min = 0, field = 'Campo' } = {}) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < min) throw badRequest(`${field}: informe ao menos ${min} caracteres.`, 'VALIDATION', { field });
  if (s.length > max) throw badRequest(`${field}: máximo de ${max} caracteres.`, 'VALIDATION', { field });
  return s;
}

export function newTournament({ id, user, name, sport, finalDate, demo = false }, now) {
  return {
    id,
    ownerId: user.id,
    admins: [{ userId: user.id, role: 'owner', addedAt: now }],
    invites: [],
    name,
    sport,
    type: 'amador',
    finalDate,
    regDeadline: defaultDeadline(finalDate, now),
    registrationOpen: true,
    fee: 0,
    maxTeams: 8,
    venue: '',
    description: '',
    causes: [...DEFAULT_CAUSES],
    minDonation: 2000,
    donationEnabled: true,
    teams: [],
    payments: [],
    bracket: null,
    playins: [],
    champion: null,
    donations: { total: 0, count: 0, items: [] },
    stats: { blocked: 0 },
    stream: null,
    activity: [],
    demo: !!demo,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

/** Valida e normaliza um PATCH de configurações. Retorna apenas os campos aceitos. */
export function sanitizeSettings(patch, t, now) {
  const out = {};
  const has = k => Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined;
  const hasTeams = t.teams.some(x => x.status === 'confirmed' || x.status === 'pending_payment');

  if (has('name')) out.name = cleanText(patch.name, 60, { min: 3, field: 'Nome do torneio' });

  if (has('sport')) {
    if (!SPORT_KEYS.includes(patch.sport)) throw badRequest('Modalidade inválida.', 'VALIDATION', { field: 'sport' });
    if (patch.sport !== t.sport) {
      if (t.bracket) throw badRequest('O chaveamento já foi sorteado: não é possível trocar a modalidade.', 'LOCKED', { field: 'sport' });
      if (hasTeams) throw badRequest('Já existem times inscritos: não é possível trocar a modalidade.', 'LOCKED', { field: 'sport' });
      out.sport = patch.sport;
    }
  }

  if (has('type')) {
    if (!(patch.type in TOURNAMENT_TYPES)) throw badRequest('Tipo de torneio inválido.', 'VALIDATION', { field: 'type' });
    if (patch.type !== t.type) {
      if (hasTeams) throw badRequest('Já existem times inscritos: não é possível trocar o tipo do torneio.', 'LOCKED', { field: 'type' });
      out.type = patch.type;
    }
  }

  if (has('finalDate')) {
    if (!parseDay(patch.finalDate)) throw badRequest('Data da final inválida.', 'VALIDATION', { field: 'finalDate' });
    out.finalDate = patch.finalDate;
  }

  if (has('regDeadline')) {
    if (patch.regDeadline === null || patch.regDeadline === '') out.regDeadline = null;
    else {
      const d = new Date(patch.regDeadline);
      if (isNaN(d)) throw badRequest('Prazo de inscrição inválido.', 'VALIDATION', { field: 'regDeadline' });
      out.regDeadline = d.toISOString();
    }
  }

  if (has('fee')) {
    const fee = Number(patch.fee);
    if (!Number.isInteger(fee) || fee < 0 || fee > 1_000_000) throw badRequest('Valor da inscrição inválido (use de R$ 0 a R$ 10.000).', 'VALIDATION', { field: 'fee' });
    if (fee > 0 && fee < 500) throw badRequest('O valor mínimo cobrável é R$ 5,00 (ou deixe R$ 0 para inscrição gratuita).', 'VALIDATION', { field: 'fee' });
    out.fee = fee;
  }

  if (has('maxTeams')) {
    const n = Number(patch.maxTeams);
    if (!BRACKET_SIZES.includes(n)) throw badRequest(`Número de vagas inválido. Use ${BRACKET_SIZES.join(', ')}.`, 'VALIDATION', { field: 'maxTeams' });
    const active = t.teams.filter(x => x.status === 'confirmed').length;
    if (n < active) throw badRequest(`Já há ${active} times confirmados: reduza o número de times antes de diminuir as vagas.`, 'VALIDATION', { field: 'maxTeams' });
    if (t.bracket && n !== t.maxTeams) throw badRequest('O chaveamento já foi sorteado: não é possível alterar as vagas.', 'LOCKED', { field: 'maxTeams' });
    out.maxTeams = n;
  }

  if (has('registrationOpen')) out.registrationOpen = !!patch.registrationOpen;
  if (has('venue')) out.venue = cleanText(patch.venue, 80, { field: 'Local' });
  if (has('description')) out.description = cleanText(patch.description, 400, { field: 'Descrição' });

  if (has('donationEnabled')) out.donationEnabled = !!patch.donationEnabled;
  if (has('minDonation')) {
    const v = Number(patch.minDonation);
    if (!Number.isInteger(v) || v < 500 || v > 1_000_000) throw badRequest('Doação mínima inválida (de R$ 5 a R$ 10.000).', 'VALIDATION', { field: 'minDonation' });
    out.minDonation = v;
  }
  if (has('causes')) {
    if (!Array.isArray(patch.causes)) throw badRequest('Lista de causas inválida.', 'VALIDATION', { field: 'causes' });
    const list = [...new Set(patch.causes.map(c => cleanText(c, 60, { field: 'Causa' })).filter(Boolean))];
    if (!list.length || list.length > 6) throw badRequest('Informe de 1 a 6 causas beneficiadas.', 'VALIDATION', { field: 'causes' });
    out.causes = list;
  }
  return out;
}

export const confirmedTeams = t => t.teams.filter(x => x.status === 'confirmed');
export const isReservationActive = (team, now) => team.status === 'pending_payment' && (team.reservedUntil || 0) > now;
/** Times que ocupam vaga: confirmados + reservas válidas. */
export const occupiedTeams = (t, now) => t.teams.filter(x => x.status === 'confirmed' || isReservationActive(x, now));

/** Estado das inscrições em um instante. */
export function registrationState(t, now) {
  const occupied = occupiedTeams(t, now).length;
  const slotsLeft = Math.max(0, t.maxTeams - occupied);
  const deadlinePassed = !!t.regDeadline && now > new Date(t.regDeadline).getTime();
  let open = true, reason = null;
  if (t.bracket) { open = false; reason = 'O chaveamento já foi sorteado.'; }
  else if (!t.registrationOpen) { open = false; reason = 'As inscrições foram encerradas pelo organizador.'; }
  else if (deadlinePassed) { open = false; reason = 'O prazo de inscrição terminou.'; }
  else if (slotsLeft === 0) { open = false; reason = 'Vagas esgotadas.'; }
  return { open, reason, slotsLeft, occupied, deadlinePassed, closesAt: t.regDeadline };
}

export const STATUS_LABELS = {
  inscricoes: 'Inscrições abertas',
  encerradas: 'Inscrições encerradas',
  chaveamento: 'Chaveamento definido',
  andamento: 'Em andamento',
  finalizado: 'Finalizado',
};

export function statusOf(t, now) {
  if (t.champion) return 'finalizado';
  if (t.bracket) {
    const started = t.bracket.rounds.flat().some(m => m.win || (m.live && m.live.status !== 'idle'));
    return started ? 'andamento' : 'chaveamento';
  }
  return registrationState(t, now).open ? 'inscricoes' : 'encerradas';
}

export function pushActivity(t, type, text, now) {
  t.activity.unshift({ id: now.toString(36) + Math.random().toString(36).slice(2, 6), at: now, type, text });
  if (t.activity.length > 60) t.activity.length = 60;
}

export const sportOf = t => SPORTS[t.sport];
