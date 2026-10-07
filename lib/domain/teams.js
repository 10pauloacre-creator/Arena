// Inscrição de times: validação de elenco, reservas, confirmação e remoção.

import { SPORTS } from '../../public/assets/js/shared/sports.js';
import { hash } from '../../public/assets/js/shared/format.js';
import { validCPF, cpfDigits, validEmail, normEmail, validPhone } from '../../public/assets/js/shared/validators.js';
import { badRequest, conflict } from '../errors.js';
import { randomId, shortCode } from '../auth.js';
import { cleanText, registrationState, RESERVATION_MS, isReservationActive, pushActivity } from './tournament.js';

export const DEFAULT_RATING = 1500;
const IMG_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
export const MAX_EMBLEM_BYTES = 60_000;

/** Valida o emblema (data URL) e devolve { mime, b64 } ou null. */
export function parseEmblem(dataUrl) {
  if (dataUrl == null || dataUrl === '') return null;
  const m = IMG_RE.exec(String(dataUrl));
  if (!m) throw badRequest('Emblema inválido. Use PNG, JPG ou WEBP.', 'VALIDATION', { field: 'emblem' });
  const bytes = Math.floor(m[2].length * 3 / 4);
  if (bytes > MAX_EMBLEM_BYTES) throw badRequest('Emblema muito grande. Use uma imagem menor (até 60 KB).', 'VALIDATION', { field: 'emblem' });
  return { mime: m[1], b64: m[2] };
}

/** Times que ainda "existem" no torneio (ignora cancelados/expirados). */
const liveTeams = (t, now) => t.teams.filter(x => x.status === 'confirmed' || isReservationActive(x, now));

function validatePlayers(t, players, now, { ignoreTeamId = null } = {}) {
  const sport = SPORTS[t.sport];
  const official = t.type === 'oficial';
  if (!Array.isArray(players)) throw badRequest('Elenco inválido.', 'VALIDATION', { field: 'players' });
  if (players.length < sport.min) throw badRequest(`O elenco precisa de ao menos ${sport.min} atletas (faltam ${sport.min - players.length}).`, 'VALIDATION', { field: 'players' });
  if (players.length > sport.max) throw badRequest(`O elenco pode ter no máximo ${sport.max} atletas.`, 'VALIDATION', { field: 'players' });

  const usedNumbers = new Set(), usedCpf = new Set();
  const otherCpfs = new Set();
  liveTeams(t, now).filter(x => x.id !== ignoreTeamId).forEach(x => x.players.forEach(p => { if (p.cpf) otherCpfs.add(cpfDigits(p.cpf)); }));

  let dup = 0;
  const out = players.map((raw, i) => {
    const label = `Atleta ${i + 1}`;
    const name = cleanText(raw?.name, 40, { min: 3, field: `${label} (nome)` });
    const number = Number(raw?.number);
    if (raw?.number === '' || raw?.number == null || !Number.isInteger(number) || number < 0 || number > 99) throw badRequest(`${label}: use um número de camisa entre 0 e 99.`, 'VALIDATION', { field: 'players' });
    if (usedNumbers.has(number)) throw badRequest(`A camisa ${number} está repetida no elenco.`, 'VALIDATION', { field: 'players' });
    usedNumbers.add(number);
    const p = { id: 'p' + (i + 1), name, number };
    if (official) {
      if (!validCPF(raw?.cpf)) throw badRequest(`${label} (${name}): CPF inválido.`, 'VALIDATION', { field: 'players' });
      const cpf = cpfDigits(raw.cpf);
      if (usedCpf.has(cpf)) throw badRequest(`${name}: CPF repetido no elenco.`, 'VALIDATION', { field: 'players' });
      usedCpf.add(cpf);
      if (otherCpfs.has(cpf)) dup++;
      const rg = cleanText(raw?.rg, 16, { field: `${label} (RG)` });
      if (rg.replace(/[^0-9a-z]/gi, '').length < 5) throw badRequest(`${label} (${name}): informe o RG com ao menos 5 caracteres.`, 'VALIDATION', { field: 'players' });
      const doc = raw?.doc;
      if (!doc || typeof doc.name !== 'string' || !/\.pdf$/i.test(doc.name)) throw badRequest(`${label} (${name}): anexe o documento de identidade em PDF.`, 'VALIDATION', { field: 'players' });
      if (!(Number(doc.size) > 0) || Number(doc.size) > 5 * 1024 * 1024) throw badRequest(`${label} (${name}): o PDF deve ter até 5 MB.`, 'VALIDATION', { field: 'players' });
      Object.assign(p, { cpf: cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4'), rg, doc: { name: cleanText(doc.name, 80), size: Math.floor(Number(doc.size)) } });
    }
    return p;
  });
  return { players: out, dup };
}

/**
 * Cria a inscrição. Retorna { team, emblem }.
 * - Sem taxa: o time já entra confirmado.
 * - Com taxa: fica "pending_payment" com a vaga reservada por 30 min.
 * `admin: true` (inscrição manual do organizador) ignora prazo/trava de inscrições, mas respeita capacidade.
 */
export function registerTeam(t, input, now, { admin = false, paid = false } = {}) {
  if (t.bracket) throw conflict('O chaveamento já foi sorteado. Não é possível inscrever novos times.', 'CLOSED');
  const reg = registrationState(t, now);
  if (!admin && !reg.open) throw conflict(reg.reason || 'Inscrições encerradas.', reg.slotsLeft <= 0 && t.registrationOpen && !reg.deadlinePassed ? 'FULL' : 'CLOSED');
  if (reg.slotsLeft <= 0) throw conflict('Vagas esgotadas.', 'FULL');

  const name = cleanText(input?.name, 32, { min: 3, field: 'Nome do time' });
  if (liveTeams(t, now).some(x => x.name.toLowerCase() === name.toLowerCase())) throw conflict('Já existe um time com este nome no torneio.', 'DUPLICATE_NAME', { field: 'name' });
  const origin = cleanText(input?.origin, 32, { field: 'Clube / bairro' });

  const cap = input?.captain || {};
  const captain = {
    name: cleanText(cap.name, 60, { min: 3, field: 'Nome do capitão' }),
    phone: String(cap.phone || '').replace(/\D/g, ''),
    email: normEmail(cap.email),
  };
  if (!validPhone(captain.phone)) throw badRequest('Informe o WhatsApp do capitão com DDD.', 'VALIDATION', { field: 'captain.phone' });
  if (!validEmail(captain.email)) throw badRequest('Informe um e-mail válido para o capitão.', 'VALIDATION', { field: 'captain.email' });

  const { players, dup } = validatePlayers(t, input?.players, now);
  if (dup) {
    t.stats.blocked += dup;
    const err = conflict(`${dup} atleta(s) já estão inscritos em outro time deste torneio (CPF duplicado). A inscrição foi barrada.`, 'DUPLICATE_ATHLETE');
    err.persist = true;
    throw err;
  }

  const emblem = parseEmblem(input?.emblem);
  const id = randomId('tm_');
  const free = !t.fee;
  const team = {
    id, name, origin, hue: hash(name) % 360, rating: DEFAULT_RATING,
    captain, players,
    accessCode: shortCode(8),
    status: (free || paid) ? 'confirmed' : 'pending_payment',
    createdAt: now,
    confirmedAt: (free || paid) ? now : null,
    reservedUntil: (free || paid) ? null : now + RESERVATION_MS,
    paidVia: free ? 'free' : (paid ? 'manual' : null),
    paymentId: null,
    hasEmblem: !!emblem, emblemVer: emblem ? now : 0,
    elim: null, repescada: false, noRepesc: false,
    source: admin ? 'admin' : 'public',
  };
  t.teams.push(team);
  if (team.status === 'confirmed') pushActivity(t, 'team', `Time "${name}" confirmado${admin ? ' pelo organizador' : ''}.`, now);
  else pushActivity(t, 'reserve', `Time "${name}" iniciou a inscrição (aguardando pagamento).`, now);
  return { team, emblem };
}

/** Confirma um time (pagamento aprovado ou confirmação manual). Retorna 'confirmed' | 'no_slot'. */
export function confirmTeam(t, team, via, now) {
  if (team.status === 'confirmed') return 'confirmed';
  if (t.bracket) return 'no_slot';
  const wasActive = isReservationActive(team, now);
  if (!wasActive) {
    const occupied = t.teams.filter(x => x.id !== team.id && (x.status === 'confirmed' || isReservationActive(x, now))).length;
    if (occupied >= t.maxTeams) return 'no_slot';
    // nome ainda livre?
    if (t.teams.some(x => x.id !== team.id && x.name.toLowerCase() === team.name.toLowerCase() && (x.status === 'confirmed' || isReservationActive(x, now)))) return 'no_slot';
  }
  team.status = 'confirmed';
  team.confirmedAt = now;
  team.reservedUntil = null;
  team.paidVia = via;
  pushActivity(t, 'team', `Time "${team.name}" confirmado (${via === 'pix' ? 'PIX' : via === 'card' ? 'cartão' : via === 'manual' ? 'confirmação manual' : via}).`, now);
  return 'confirmed';
}

/** Marca como expiradas as reservas vencidas (chamado de forma preguiçosa em leituras/escritas). */
export function expireReservations(t, now) {
  let changed = false;
  for (const team of t.teams) {
    if (team.status === 'pending_payment' && (team.reservedUntil || 0) <= now) { team.status = 'expired'; changed = true; }
  }
  return changed;
}

export function updateTeam(t, team, patch, now) {
  if (patch.name !== undefined) {
    const name = cleanText(patch.name, 32, { min: 3, field: 'Nome do time' });
    if (t.teams.some(x => x.id !== team.id && x.name.toLowerCase() === name.toLowerCase() && (x.status === 'confirmed' || isReservationActive(x, now)))) throw conflict('Já existe um time com este nome no torneio.', 'DUPLICATE_NAME', { field: 'name' });
    team.name = name; team.hue = hash(name) % 360;
  }
  if (patch.origin !== undefined) team.origin = cleanText(patch.origin, 32, { field: 'Clube / bairro' });
  if (patch.rating !== undefined) {
    const r = Number(patch.rating);
    if (!Number.isInteger(r) || r < 500 || r > 3000) throw badRequest('Força (rating) deve ser um número entre 500 e 3000.', 'VALIDATION', { field: 'rating' });
    team.rating = r;
  }
  if (patch.captain) {
    const c = patch.captain;
    if (c.name !== undefined) team.captain.name = cleanText(c.name, 60, { min: 3, field: 'Nome do capitão' });
    if (c.phone !== undefined) { const ph = String(c.phone).replace(/\D/g, ''); if (!validPhone(ph)) throw badRequest('WhatsApp inválido.', 'VALIDATION'); team.captain.phone = ph; }
    if (c.email !== undefined) { if (!validEmail(c.email)) throw badRequest('E-mail inválido.', 'VALIDATION'); team.captain.email = normEmail(c.email); }
  }
  if (patch.players !== undefined) {
    if (t.bracket) throw conflict('O chaveamento já foi sorteado: o elenco não pode mais ser alterado.', 'LOCKED');
    const { players } = validatePlayers(t, patch.players, now, { ignoreTeamId: team.id });
    team.players = players;
  }
}

/** Remove o time (apenas antes do sorteio). Times com pagamento aprovado ficam registrados como cancelados. */
export function removeTeam(t, team, now) {
  if (t.bracket) throw conflict('O chaveamento já foi sorteado: não é possível remover times.', 'LOCKED');
  const paid = t.payments.some(p => p.teamId === team.id && p.kind === 'registration' && p.status === 'approved');
  if (paid) {
    team.status = 'cancelled';
    const pay = t.payments.find(p => p.teamId === team.id && p.kind === 'registration' && p.status === 'approved');
    pay.needsRefund = true;
    pushActivity(t, 'refund', `Time "${team.name}" removido. Reembolso pendente de ${pay.method === 'pix' ? 'PIX' : 'cartão'}.`, now);
  } else {
    t.teams = t.teams.filter(x => x.id !== team.id);
    pushActivity(t, 'team', `Time "${team.name}" removido.`, now);
  }
}
