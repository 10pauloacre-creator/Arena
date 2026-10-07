// Orquestração de pagamentos (inscrição e doações de repescagem), independente do provedor.

import { randomId } from '../auth.js';
import { badRequest, conflict } from '../errors.js';
import { confirmTeam } from './teams.js';
import { canRepesc, createPlayin, teamById } from './bracket.js';
import { pushActivity, RESERVATION_MS, isReservationActive } from './tournament.js';
import { fmtBRL } from '../../public/assets/js/shared/format.js';

const METHODS = ['pix', 'card'];

export const paymentById = (t, id) => t.payments.find(p => p.id === id) || null;

/** Visão pública de um pagamento (nunca inclui dados de cartão). */
export function paymentView(p) {
  return {
    id: p.id, kind: p.kind, teamId: p.teamId, amount: p.amount, method: p.method, status: p.status,
    createdAt: p.createdAt, expiresAt: p.expiresAt, paidAt: p.paidAt || null,
    pix: p.pix ? { code: p.pix.code, qrBase64: p.pix.qrBase64 || null } : null,
    card: p.card ? { brand: p.card.brand, last4: p.card.last4 } : null,
    failReason: p.failReason || null, mock: p.provider === 'mock',
  };
}

/**
 * Cria (ou reaproveita) um pagamento pendente para o time. O chamador executa a chamada ao provedor
 * e depois `applyProviderResult`.
 */
export function openPayment(t, { kind, team, method, amount, meta = {}, provider }, now) {
  if (!METHODS.includes(method)) throw badRequest('Forma de pagamento inválida.', 'VALIDATION', { field: 'method' });
  if (method === 'card' && !provider.publicConfig().methods.includes('card')) throw badRequest('Pagamento com cartão indisponível no momento. Use PIX.', 'METHOD_UNAVAILABLE');
  if (!(amount > 0)) throw badRequest('Valor inválido.', 'VALIDATION');

  const existing = t.payments.find(p => p.teamId === team.id && p.kind === kind && p.status === 'approved' && kind === 'registration');
  if (existing) throw conflict('O pagamento desta inscrição já foi confirmado.', 'ALREADY_PAID');

  // reaproveita PIX pendente igual (ex.: o capitão recarregou a página)
  const reusable = t.payments.find(p => p.teamId === team.id && p.kind === kind && p.status === 'pending' && p.method === 'pix' && method === 'pix' && p.amount === amount && p.expiresAt > now && p.provider === provider.name);
  if (reusable) return { payment: reusable, reused: true };

  // cancela outras tentativas pendentes
  t.payments.filter(p => p.teamId === team.id && p.kind === kind && p.status === 'pending').forEach(p => { p.status = 'cancelled'; p.updatedAt = now; });

  if (kind === 'registration' && team.status === 'pending_payment') {
    // quem já começou a pagar ganha uma folga na reserva (no máximo 60 min desde a inscrição)
    team.reservedUntil = Math.min(team.createdAt + 2 * RESERVATION_MS, Math.max(team.reservedUntil || 0, now + RESERVATION_MS / 2));
  }
  const expiresAt = kind === 'registration' ? team.reservedUntil : now + RESERVATION_MS;
  const payment = {
    id: randomId('pay_'), kind, teamId: team.id, amount, method, provider: provider.name,
    status: 'pending', createdAt: now, updatedAt: now, expiresAt, meta,
  };
  t.payments.push(payment);
  team.paymentId = payment.id;
  return { payment, reused: false };
}

/** Aplica o retorno imediato do provedor (PIX gerado / cartão aprovado ou recusado). */
export function applyProviderResult(t, payment, res, now) {
  if (res.providerRef) payment.providerRef = res.providerRef;
  if (res.pix) payment.pix = res.pix;
  if (res.card) payment.card = res.card;
  if (res.failReason) payment.failReason = res.failReason;
  payment.updatedAt = now;
  if (res.status) applyStatus(t, payment, res.status, now);
}

/** Aplica uma mudança de status (aprovado, recusado...) de forma idempotente e propaga os efeitos. */
export function applyStatus(t, payment, status, now) {
  if (payment.status === 'approved' || payment.status === 'refunded') return payment.status;
  if (status === 'pending') return payment.status;
  payment.updatedAt = now;
  if (status !== 'approved') { payment.status = status; return status; }

  payment.status = 'approved';
  payment.paidAt = now;
  const team = teamById(t, payment.teamId);
  if (!team) { payment.needsRefund = true; return 'approved'; }

  if (payment.kind === 'registration') {
    const result = confirmTeam(t, team, payment.method, now);
    if (result === 'no_slot') {
      payment.needsRefund = true;
      pushActivity(t, 'refund', `Pagamento de "${team.name}" recebido sem vaga disponível (${fmtBRL(payment.amount)}). Reembolso necessário.`, now);
    }
  } else if (payment.kind === 'donation') {
    const check = canRepesc(t, team);
    if (!check.ok) {
      payment.needsRefund = true;
      pushActivity(t, 'refund', `Doação de "${team.name}" aprovada, mas a repescagem não está mais disponível (${fmtBRL(payment.amount)}). Reembolso necessário.`, now);
    } else {
      registerDonation(t, team, { amount: payment.amount, cause: payment.meta?.cause, method: payment.method, paymentId: payment.id }, now);
    }
  }
  return 'approved';
}

/** Registra a doação e abre a revanche. Usado tanto por pagamentos aprovados quanto por doações manuais. */
export function registerDonation(t, team, { amount, cause, method, paymentId = null }, now) {
  const playin = createPlayin(t, team, now);
  t.donations.total += amount; t.donations.count += 1;
  t.donations.items.push({ id: randomId('dn_'), teamId: team.id, amount, cause: cause || '', method, paymentId, at: now });
  const defender = teamById(t, playin.defender);
  pushActivity(t, 'donation', `${team.name} re-inscrita com ${fmtBRL(amount)}${cause ? ` para "${cause}"` : ''}. Revanche contra ${defender?.name} liberada!`, now);
  return playin;
}

/** Expira PIX pendentes vencidos. */
export function expirePayments(t, now) {
  let changed = false;
  for (const p of t.payments) if (p.status === 'pending' && p.expiresAt <= now) { p.status = 'expired'; changed = true; }
  return changed;
}

export const reservationLeft = (team, now) => isReservationActive(team, now) ? team.reservedUntil - now : 0;
