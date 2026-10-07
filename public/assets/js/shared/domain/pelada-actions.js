// Ações sobre uma pelada. O servidor as executa dentro do lock do documento; o navegador as repete sobre a cópia
// local quando está sem internet. Por isso este módulo só conhece o documento (nada de rede, banco ou HTTP) e
// toda ação é síncrona e determinística (ids e sorteios derivam do id da operação).

import { badRequest, conflict, forbidden } from '../errors.js';
import { withDeterministic } from '../rand.js';
import { compileRoute, matchRoute } from '../route.js';
import {
  sanitizeSettings, sanitizeOrg, orgOf, addDay, getDay, getMatch, validDate, setPresence, addGuest, removeAttendance,
  performDraw, assignPlayer, createMatch, setMatchTeams, deleteMatch, timerAction, addGoal, removeGoal, setLoan,
  finishMatch, adjustLooseGoal, addMember, userPid, guestPid,
} from './pelada.js';

/** Quantos ids de operações recentes o documento guarda (para ignorar repetições de uma mesma operação). */
export const MAX_OPS = 100;
export const BASE = '/pelada/peladas/:id';

/**
 * Cada ação: { key, method, path, owner, label, run(p, env) }.
 *   env = { params, body, now, me: { id }, nameOf(pid) }.  `run` pode devolver dados extras (ids criados etc.).
 */
export const PELADA_ACTIONS = [];
function def(key, method, path, label, opts, run) {
  const action = { key, method, path: BASE + path, label, owner: false, ...opts, run };
  action.route = compileRoute(action.path);
  PELADA_ACTIONS.push(action);
  return action;
}

// ---------------------------------------------------------------- pelada e datas
/** Só as configurações; a troca de fotos acontece no servidor (e exige internet). */
export const settingsAction = def('settings', 'PATCH', '', 'Salvar configurações da pelada', { owner: true, queueable: body => !('avatar' in body) && !('cover' in body) }, (p, { body }) => {
  Object.assign(p, sanitizeSettings(body, p));
});

export const joinAction = def('join', 'POST', '/join', 'Entrar na pelada', {}, (p, { me, now }) => { addMember(p, me.id, now); });

def('day.add', 'POST', '/days', 'Adicionar data de jogo', { owner: true }, (p, { body, now }) => {
  const day = addDay(p, { date: body.date, org: body.org || null, matches: body.matches || 0 }, now);
  return { dayId: day.id };
});

def('day.edit', 'PATCH', '/days/:dayId', 'Editar data de jogo', { owner: true }, (p, { params, body }) => {
  const day = getDay(p, params.dayId);
  if ('date' in body) {
    if (!validDate(body.date)) throw badRequest('Data do jogo inválida.', 'VALIDATION', { field: 'date' });
    if (p.days.some(d => d.id !== day.id && d.date === body.date)) throw conflict('Já existe um jogo nesta data.', 'DUPLICATE_DAY', { field: 'date' });
    day.date = body.date;
    p.days.sort((a, b) => a.date.localeCompare(b.date));
  }
  if ('org' in body) day.org = body.org ? sanitizeOrg(body.org, orgOf(p, day)) : null;
});

def('day.remove', 'DELETE', '/days/:dayId', 'Excluir data de jogo', { owner: true }, (p, { params }) => {
  const day = getDay(p, params.dayId);
  p.days.splice(p.days.indexOf(day), 1);
});

// ---------------------------------------------------------------- presença e convidados
export const presenceAction = def('presence', 'POST', '/days/:dayId/presence', 'Presença no jogo', {}, (p, { params, body, me, now }) => {
  setPresence(p, getDay(p, params.dayId), me.id, body.present !== false, now);
});

def('guest.add', 'POST', '/days/:dayId/guests', 'Adicionar convidado', { owner: true }, (p, { params, body, now, nameOf }) => {
  const day = getDay(p, params.dayId);
  const g = addGuest(p, day, body.name, body.teamId, now, nameOf);
  return { guestPid: guestPid(g.id) };
});

def('attendance.remove', 'DELETE', '/days/:dayId/attendance/:pid', 'Remover da lista de presença', { owner: true }, (p, { params }) => {
  removeAttendance(getDay(p, params.dayId), params.pid);
});

def('assign', 'POST', '/days/:dayId/assign', 'Mover jogador de time', { owner: true }, (p, { params, body }) => {
  assignPlayer(getDay(p, params.dayId), String(body.pid || ''), body.teamId || null);
});

// ---------------------------------------------------------------- sorteio
def('draw', 'POST', '/days/:dayId/draw', 'Sortear times', {}, (p, { params, me, now, nameOf }) => {
  const day = getDay(p, params.dayId);
  const isOwner = p.ownerId === me.id;
  // o criador sorteia (e refaz) quando quiser; um confirmado só pode fazer o primeiro sorteio do dia
  if (!isOwner) {
    if (!day.attendance.some(a => a.pid === userPid(me.id))) throw forbidden('Marque presença para poder sortear os times.');
    if (day.draw) throw forbidden('Os times já foram sorteados. Só o criador da pelada pode refazer o sorteio.');
  }
  const players = day.attendance.map(a => ({ pid: a.pid, name: nameOf(a.pid), guest: a.pid.startsWith('g:') }));
  const draw = performDraw(p, day, players, { by: me.id, now });
  return { drawId: draw.id };
});

// ---------------------------------------------------------------- partidas e súmula
const matchOf = (p, params) => { const day = getDay(p, params.dayId); return { day, m: getMatch(day, params.mid) }; };

def('match.add', 'POST', '/days/:dayId/matches', 'Adicionar partida', { owner: true }, (p, { params, body, now }) => {
  const m = createMatch(p, getDay(p, params.dayId), { a: body.a, b: body.b }, now);
  return { matchId: m.id };
});

def('match.teams', 'PATCH', '/days/:dayId/matches/:mid', 'Escolher times da partida', { owner: true }, (p, { params, body }) => {
  const { day, m } = matchOf(p, params);
  setMatchTeams(day, m, { a: 'a' in body ? (body.a || null) : undefined, b: 'b' in body ? (body.b || null) : undefined });
});

def('match.remove', 'DELETE', '/days/:dayId/matches/:mid', 'Excluir partida', { owner: true }, (p, { params }) => {
  const { day, m } = matchOf(p, params);
  deleteMatch(day, m);
});

const TIMER_LABELS = { start: 'Iniciar cronômetro', pause: 'Pausar cronômetro', reset: 'Zerar cronômetro', set: 'Definir tempo da partida' };
def('match.timer', 'POST', '/days/:dayId/matches/:mid/timer', body => TIMER_LABELS[body?.action] || 'Cronômetro', { owner: true }, (p, { params, body, now }) => {
  const { m } = matchOf(p, params);
  timerAction(m, { action: body.action, minutes: body.minutes }, now);
});

def('goal.add', 'POST', '/days/:dayId/matches/:mid/goals', 'Gol', { owner: true }, (p, { params, body, now }) => {
  const { day, m } = matchOf(p, params);
  const g = addGoal(day, m, { teamId: body.teamId, pid: body.pid || null }, now);
  return { goalId: g.id };
});

def('goal.remove', 'DELETE', '/days/:dayId/matches/:mid/goals/:gid', 'Remover gol', { owner: true }, (p, { params }) => {
  const { m } = matchOf(p, params);
  removeGoal(m, params.gid);
});

def('loan', 'POST', '/days/:dayId/matches/:mid/loans', body => body?.remove ? 'Devolver jogador de fora' : 'Jogador de fora', { owner: true }, (p, { params, body }) => {
  const { day, m } = matchOf(p, params);
  setLoan(day, m, { teamId: body.teamId, pid: String(body.pid || ''), remove: !!body.remove });
});

def('match.finish', 'POST', '/days/:dayId/matches/:mid/finish', 'Encerrar partida', { owner: true }, (p, { params, body, now }) => {
  const { day, m } = matchOf(p, params);
  const { next, info } = finishMatch(p, day, m, { auto: !!body.auto, now });
  return { next: next ? next.id : null, info };
});

// gols do dia quando a data é "sem formação de times"
def('goal.loose', 'POST', '/days/:dayId/goals', 'Gol do dia', { owner: true }, (p, { params, body }) => {
  adjustLooseGoal(p, getDay(p, params.dayId), String(body.pid || ''), body.delta);
});

// ---------------------------------------------------------------- execução
/** Encontra a ação de uma requisição (método + caminho sem "/api"). Retorna { action, params } ou null. */
export function matchPeladaAction(method, path) {
  for (const action of PELADA_ACTIONS) {
    if (action.method !== method) continue;
    const params = matchRoute(action.route, path);
    if (params) return { action, params };
  }
  return null;
}

/** Texto curto que descreve a operação (para listas "alterações aguardando envio"). */
export const labelOf = (action, body) => typeof action.label === 'function' ? action.label(body) : action.label;

/**
 * Executa a ação sobre o documento `p` (muda o próprio objeto) e registra o id da operação.
 * `opId` (opcional) deixa os ids/sorteios determinísticos; sem ele, aleatórios.
 */
export function runPeladaAction(p, action, env, opId = null) {
  if (action.owner && p.ownerId !== env.me.id) throw forbidden('Só quem criou a pelada pode fazer isso.');
  return withDeterministic(opId, () => action.run(p, env));
}

export const hasOp = (p, opId) => !!opId && Array.isArray(p.ops) && p.ops.includes(opId);
export function rememberOp(p, opId) {
  if (!opId) return;
  p.ops = (p.ops || []).filter(x => x !== opId);
  p.ops.push(opId);
  if (p.ops.length > MAX_OPS) p.ops.splice(0, p.ops.length - MAX_OPS);
}
