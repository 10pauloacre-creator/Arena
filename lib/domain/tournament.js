// Modelo de torneio: criação, validação de configurações, status e regras de inscrição.

import { SPORTS, SPORT_KEYS, BRACKET_SIZES, TOURNAMENT_TYPES, DEFAULT_CAUSES } from '../../public/assets/js/shared/sports.js';
import { parseDay } from '../../public/assets/js/shared/format.js';
import { defaultRules, emptyPrizes, normalizeRules, MAX_DETAILS_LEN } from '../../public/assets/js/shared/rules.js';
import { badRequest } from '../errors.js';
import { cleanText, cleanMultiline } from './text.js';
import { sanitizeRules, sanitizePrizes } from './rules.js';

export { cleanText };

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

/** Valor da inscrição em centavos: 0 (gratuita) ou de R$ 5,00 a R$ 10.000,00. */
export function parseFee(value) {
  const fee = Number(value);
  if (value === '' || value === null || !Number.isInteger(fee) || fee < 0 || fee > 1_000_000) throw badRequest('Valor da inscrição inválido (use de R$ 0 a R$ 10.000).', 'VALIDATION', { field: 'fee' });
  if (fee > 0 && fee < 500) throw badRequest('O valor mínimo cobrável é R$ 5,00 (ou deixe R$ 0 para inscrição gratuita).', 'VALIDATION', { field: 'fee' });
  return fee;
}

/**
 * Resolve "Inscrição gratuita" + valor. `freeRegistration: true` zera o valor; `false` exige um valor cobrável.
 * Sem o campo, vale o `fee` informado (0 = gratuita); sem nenhum dos dois, `fallback`.
 */
export function resolveFee({ freeRegistration, fee }, fallback = 0) {
  if (freeRegistration !== undefined && typeof freeRegistration !== 'boolean') throw badRequest('Opção "Inscrição gratuita" inválida.', 'VALIDATION', { field: 'freeRegistration' });
  const given = fee !== undefined && fee !== null && fee !== '';
  if (freeRegistration === true) return 0;
  if (freeRegistration === false) {
    const v = given ? parseFee(fee) : fallback;
    if (!v) throw badRequest('Informe o valor da inscrição (mínimo R$ 5,00) ou ative "Inscrição gratuita".', 'VALIDATION', { field: 'fee' });
    return v;
  }
  return given ? parseFee(fee) : fallback;
}

export function newTournament({ id, user, name, sport, finalDate, demo = false, fee = 0, details = '', rules = null, prizes = null, format = 'knockout', leagueMax = null }, now) {
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
    fee,
    maxTeams: 8,
    venue: '',
    description: '',
    details,
    rules: rules || defaultRules(),
    prizes: prizes || emptyPrizes(),
    causes: [...DEFAULT_CAUSES],
    minDonation: 2000,
    donationEnabled: true,
    teams: [],
    payments: [],
    format, leagueMax,
    bracket: null,
    league: null,
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
      if (isDrawn(t)) throw badRequest('O chaveamento já foi sorteado: não é possível trocar a modalidade.', 'LOCKED', { field: 'sport' });
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

  if (has('fee') || has('freeRegistration')) {
    out.fee = resolveFee({ freeRegistration: has('freeRegistration') ? patch.freeRegistration : undefined, fee: has('fee') ? patch.fee : undefined }, t.fee);
  }

  if (has('maxTeams')) {
    const n = Number(patch.maxTeams);
    if (!BRACKET_SIZES.includes(n)) throw badRequest(`Número de vagas inválido. Use ${BRACKET_SIZES.join(', ')}.`, 'VALIDATION', { field: 'maxTeams' });
    const active = t.teams.filter(x => x.status === 'confirmed').length;
    if (n < active) throw badRequest(`Já há ${active} times confirmados: reduza o número de times antes de diminuir as vagas.`, 'VALIDATION', { field: 'maxTeams' });
    if (isDrawn(t) && n !== t.maxTeams) throw badRequest('O chaveamento já foi sorteado: não é possível alterar as vagas.', 'LOCKED', { field: 'maxTeams' });
    out.maxTeams = n;
  }

  if (has('format')) {
    if (!['knockout', 'league'].includes(patch.format)) throw badRequest('Formato inválido. Use mata-mata ou pontos corridos.', 'VALIDATION', { field: 'format' });
    if (patch.format !== (t.format || 'knockout')) {
      if (isDrawn(t)) throw badRequest('O sorteio já foi feito: não é possível trocar o formato. Reinicie o chaveamento antes.', 'LOCKED', { field: 'format' });
      out.format = patch.format;
    }
  }
  if (has('leagueMax')) {
    if (patch.leagueMax === null || patch.leagueMax === '') out.leagueMax = null;
    else {
      const v = Number(patch.leagueMax);
      if (!Number.isInteger(v) || v < 1 || v > 80) throw badRequest('Máximo de partidas por time inválido (de 1 a 80).', 'VALIDATION', { field: 'leagueMax' });
      if (t.league) throw badRequest('A tabela já foi gerada: reinicie para mudar o máximo de partidas.', 'LOCKED', { field: 'leagueMax' });
      out.leagueMax = v;
    }
  }
  if (has('registrationOpen')) out.registrationOpen = !!patch.registrationOpen;
  if (has('venue')) out.venue = cleanText(patch.venue, 80, { field: 'Local' });
  if (has('description')) out.description = cleanText(patch.description, 400, { field: 'Descrição' });
  if (has('details')) out.details = cleanMultiline(patch.details, MAX_DETAILS_LEN, { field: 'Detalhes' });

  const sport = out.sport || t.sport;
  if (has('rules')) out.rules = sanitizeRules(patch.rules, sport, t.rules);
  else if (out.sport) {
    // trocar a modalidade pode deixar o "mínimo de jogadores" fora dos limites da nova modalidade
    const cur = normalizeRules(t.rules), { min, max } = SPORTS[sport];
    if (cur.minPlayers != null && (cur.minPlayers < min || cur.minPlayers > max)) out.rules = { ...cur, minPlayers: null };
  }
  if (has('prizes')) out.prizes = sanitizePrizes(patch.prizes, t.prizes);

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

/** Já houve o sorteio (mata-mata) ou a geração da tabela (pontos corridos)? */
export const isDrawn = t => !!(t.bracket || t.league);
export const isLeague = t => t.format === 'league';
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
  if (isDrawn(t)) { open = false; reason = isLeague(t) ? 'A tabela do campeonato já foi gerada.' : 'O chaveamento já foi sorteado.'; }
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
  if (t.league) return t.league.rounds.flat().some(m => m.done) ? 'andamento' : 'chaveamento';
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
