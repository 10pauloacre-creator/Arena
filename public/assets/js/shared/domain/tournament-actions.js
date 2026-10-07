// Ações do organizador sobre um torneio. Como em pelada-actions.js: o servidor as executa dentro do lock do documento
// e o navegador as repete sobre a cópia local quando está sem internet. Só conhecem o documento do torneio.

import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { withDeterministic } from '../rand.js';
import { compileRoute, matchRoute } from '../route.js';
import { sanitizeSettings } from './tournament.js';
import { registerTeam, confirmTeam, updateTeam, removeTeam } from './teams.js';
import { drawTournament, resetBracket, teamById, canRepesc, findMatch } from './bracket.js';
import { applyAction } from './live.js';
import { registerDonation } from './payments.js';
import { pushActivity } from './tournament.js';

export const MAX_OPS = 100;
export const BASE = '/tournaments/:id';

export const TOURNAMENT_ACTIONS = [];
function def(key, method, path, label, opts, run) {
  const action = { key, method, path: BASE + path, label, ...opts, run };
  action.route = compileRoute(action.path);
  TOURNAMENT_ACTIONS.push(action);
  return action;
}

/** Aceita links do YouTube e da Twitch; devolve dados para o player embutido. */
export function parseStream(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return { error: 'Link inválido. Cole o endereço completo, começando com https://' }; }
  if (u.protocol !== 'https:') return { error: 'Use um link https do YouTube ou da Twitch.' };
  const h = u.hostname.replace(/^www\.|^m\./, '');
  if (h === 'youtube.com' || h === 'youtu.be') {
    const id = h === 'youtu.be' ? u.pathname.slice(1) : (u.searchParams.get('v') || (u.pathname.match(/^\/(?:live|embed|shorts)\/([^/?]+)/) || [])[1]);
    if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return { error: 'Não encontramos o ID do vídeo neste link do YouTube.' };
    return { stream: { platform: 'youtube', id, url: u.href, label: 'YouTube' } };
  }
  if (h === 'twitch.tv') {
    const ch = u.pathname.split('/').filter(Boolean)[0];
    if (!ch || !/^[A-Za-z0-9_]{3,25}$/.test(ch)) return { error: 'Inclua o nome do canal da Twitch no link.' };
    return { stream: { platform: 'twitch', id: ch, url: u.href, label: 'Twitch' } };
  }
  return { error: 'Aceitamos apenas links do YouTube (youtube.com, youtu.be) ou da Twitch (twitch.tv).' };
}

// `env.effects` recebe o que depende do servidor (ex.: guardar o emblema); no navegador é ignorado.
def('settings', 'PATCH', '', 'Salvar configurações do torneio', {}, (t, { body, now }) => {
  Object.assign(t, sanitizeSettings(body, t, now));
});

export const teamAddAction = def('team.add', 'POST', '/teams', 'Cadastrar time', { queueable: body => !body.emblem }, (t, { body, now, effects }) => {
  const { team, emblem } = registerTeam(t, body, now, { admin: true, paid: body.paid !== false });
  if (emblem) effects.push({ type: 'emblem:set', teamId: team.id, emblem });
});

def('team.edit', 'PATCH', '/teams/:teamId', 'Editar time', {}, (t, { params, body, now }) => {
  const team = teamById(t, params.teamId);
  if (!team) throw notFound('Time não encontrado.');
  updateTeam(t, team, body, now);
});

def('team.confirm', 'POST', '/teams/:teamId/confirm', 'Confirmar time', {}, (t, { params, now }) => {
  const team = teamById(t, params.teamId);
  if (!team) throw notFound('Time não encontrado.');
  if (team.status === 'confirmed') return;
  if (team.status === 'cancelled') throw conflict('Este time foi cancelado.', 'STATE');
  const r = confirmTeam(t, team, 'manual', now);
  if (r === 'no_slot') throw conflict('Não há vaga disponível para confirmar este time.', 'FULL');
});

def('team.remove', 'DELETE', '/teams/:teamId', 'Remover time', {}, (t, { params, now, effects }) => {
  const team = teamById(t, params.teamId);
  if (!team) throw notFound('Time não encontrado.');
  removeTeam(t, team, now);
  if (team.hasEmblem && !t.teams.some(x => x.id === team.id)) effects.push({ type: 'emblem:del', teamId: team.id });
});

def('refunded', 'POST', '/payments/:pid/refunded', 'Marcar reembolso como feito', {}, (t, { params, now }) => {
  const p = t.payments.find(x => x.id === params.pid);
  if (!p) throw notFound('Pagamento não encontrado.');
  if (!p.needsRefund) throw conflict('Este pagamento não tem reembolso pendente.', 'STATE');
  p.needsRefund = false; p.status = 'refunded'; p.updatedAt = now;
  pushActivity(t, 'refund', 'Reembolso marcado como concluído.', now);
});

def('draw', 'POST', '/draw', 'Sortear chaveamento', {}, (t, { now }) => {
  const res = drawTournament(t, now);
  return { draw: { balance: res.balance, tried: res.tried, valid: res.valid, conflicts: res.conflicts, seed: res.seed, byes: res.byes } };
});

def('reset', 'POST', '/reset-bracket', 'Reiniciar chaveamento', {}, (t, { body, now }) => {
  if (!body.confirm) throw badRequest('Confirmação necessária.', 'CONFIRM');
  if (!t.bracket) return;
  resetBracket(t, now);
  t.registrationOpen = false;
});

const MATCH_LABELS = {
  start: 'Iniciar partida', pause: 'Pausar partida', adjust: 'Ajustar relógio', event: 'Lance da partida',
  'score-minus': 'Remover ponto', undo: 'Desfazer lance', finalize: 'Encerrar partida', reopen: 'Reabrir partida', result: 'Lançar resultado',
};
def('match', 'POST', '/matches/:key', body => MATCH_LABELS[body?.action] || 'Partida', {}, (t, { params, body, now }) => {
  if (!t.bracket) throw conflict('O chaveamento ainda não foi sorteado.', 'NO_BRACKET');
  const match = findMatch(t, params.key);
  if (!match) throw notFound('Partida não encontrada.');
  applyAction(t, match, body, now);
});

def('donation', 'POST', '/donations', 'Registrar doação', {}, (t, { body, now }) => {
  const team = teamById(t, body.teamId);
  if (!team) throw notFound('Time não encontrado.');
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount < t.minDonation || amount > 1_000_000) throw badRequest('Valor da doação inválido.', 'VALIDATION', { field: 'amount' });
  const check = canRepesc(t, team);
  if (!check.ok) throw conflict(check.reason, 'NOT_ELIGIBLE');
  const cause = t.causes.includes(body.cause) ? body.cause : t.causes[0];
  t.payments.push({ id: 'pay_m' + now.toString(36), kind: 'donation', teamId: team.id, amount, method: 'manual', provider: 'manual', status: 'approved', createdAt: now, updatedAt: now, paidAt: now, expiresAt: now, meta: { cause } });
  registerDonation(t, team, { amount, cause, method: 'manual' }, now);
});

def('stream.set', 'PUT', '/stream', 'Definir transmissão', {}, (t, { body }) => {
  const s = parseStream(body.url);
  if (s.error) throw badRequest(s.error, 'VALIDATION', { field: 'url' });
  t.stream = s.stream;
});

def('stream.clear', 'DELETE', '/stream', 'Remover transmissão', {}, t => { t.stream = null; });

// ---------------------------------------------------------------- execução
export function matchTournamentAction(method, path) {
  for (const action of TOURNAMENT_ACTIONS) {
    if (action.method !== method) continue;
    const params = matchRoute(action.route, path);
    if (params) return { action, params };
  }
  return null;
}

export const labelOf = (action, body) => typeof action.label === 'function' ? action.label(body) : action.label;

/** Executa a ação sobre o torneio `t` (muda o objeto). Retorna os dados extras da resposta. */
export function runTournamentAction(t, action, env, opId = null) {
  if (!t.admins.some(a => a.userId === env.me.id)) throw forbidden('Você não administra este torneio.');
  const effects = env.effects || [];
  return withDeterministic(opId, () => action.run(t, { ...env, effects }));
}

export const hasOp = (t, opId) => !!opId && Array.isArray(t.ops) && t.ops.includes(opId);
export function rememberOp(t, opId) {
  if (!opId) return;
  t.ops = (t.ops || []).filter(x => x !== opId);
  t.ops.push(opId);
  if (t.ops.length > MAX_OPS) t.ops.splice(0, t.ops.length - MAX_OPS);
}
