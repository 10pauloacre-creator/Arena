// Notificações do app Pelada (servidor + navegador): tipos, preferências e textos de cada aviso.
// O servidor guarda os eventos de cada pelada; o texto é montado na leitura, já personalizado para quem lê.
import { gx, cap } from './gender.js';

/** Tipos que o usuário liga/desliga em Configurações. `on` = padrão para quem nunca mexeu. */
export const NOTIF_TYPES = [
  { key: 'join', label: 'Novos participantes', desc: 'Alguém entrou na pelada (pelo link de convite ou pelo ID).', icon: 'user-plus', on: true },
  { key: 'presence', label: 'Presenças no jogo do dia', desc: 'Alguém confirmou presença no jogo (inclui convidados adicionados pelo organizador).', icon: 'circle-check', on: true },
  { key: 'absence', label: 'Desistências', desc: 'Alguém retirou a presença ou saiu da lista do jogo.', icon: 'circle-x', on: true },
  { key: 'draw', label: 'Sorteio de times', desc: 'Os times do dia foram sorteados (e em qual time você ficou).', icon: 'shuffle', on: true },
  { key: 'match', label: 'Início das partidas', desc: 'Uma partida começou: bola rolando.', icon: 'play', on: false },
  { key: 'result', label: 'Resultados dos jogos', desc: 'Placar final de cada partida, com quem fez os gols.', icon: 'trophy', on: true },
  { key: 'schedule', label: 'Agenda de jogos', desc: 'Nova data de jogo marcada, jogo remarcado ou cancelado.', icon: 'calendar', on: true },
  { key: 'reminder', label: 'Lembrete no dia do jogo', desc: 'No dia do jogo, um aviso para confirmar presença.', icon: 'bell', on: true },
];
export const NOTIF_KEYS = NOTIF_TYPES.map(t => t.key);
export const NOTIF_BY_KEY = Object.fromEntries(NOTIF_TYPES.map(t => [t.key, t]));
export const MAX_MUTED = 200;
const PELADA_ID = /^PL-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/;

/**
 * Preferências: { enabled, popup, types: { chave: bool }, muted: [IDs de peladas silenciadas] }.
 * `enabled` desliga tudo; `popup` mostra o aviso na tela quando chega uma notificação com o app aberto.
 */
export function defaultPrefs() {
  return { enabled: true, popup: true, types: Object.fromEntries(NOTIF_TYPES.map(t => [t.key, t.on])), muted: [] };
}

/** Preferências salvas (podem ser antigas ou incompletas) + padrões para o que faltar. */
export function normalizePrefs(saved) {
  const out = defaultPrefs();
  if (!saved || typeof saved !== 'object') return out;
  if (typeof saved.enabled === 'boolean') out.enabled = saved.enabled;
  if (typeof saved.popup === 'boolean') out.popup = saved.popup;
  if (saved.types && typeof saved.types === 'object') for (const k of NOTIF_KEYS) if (typeof saved.types[k] === 'boolean') out.types[k] = saved.types[k];
  if (Array.isArray(saved.muted)) out.muted = [...new Set(saved.muted.filter(id => typeof id === 'string' && PELADA_ID.test(id)))].slice(0, MAX_MUTED);
  return out;
}

/** Aplica uma alteração parcial ({ enabled?, popup?, types?: {...}, muted?: [...] }). Lança Error com `field` se inválida. */
export function mergePrefs(current, patch) {
  const fail = (msg, field) => Object.assign(new Error(msg), { field });
  const next = normalizePrefs(current);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw fail('Preferências inválidas.');
  for (const k of ['enabled', 'popup']) {
    if (patch[k] === undefined) continue;
    if (typeof patch[k] !== 'boolean') throw fail('Valor inválido.', k);
    next[k] = patch[k];
  }
  if (patch.types !== undefined) {
    if (!patch.types || typeof patch.types !== 'object' || Array.isArray(patch.types)) throw fail('Tipos de notificação inválidos.', 'types');
    for (const [k, v] of Object.entries(patch.types)) {
      if (!NOTIF_KEYS.includes(k)) throw fail(`Tipo de notificação desconhecido: ${k}.`, 'types');
      if (typeof v !== 'boolean') throw fail('Valor inválido.', 'types');
      next.types[k] = v;
    }
  }
  if (patch.muted !== undefined) {
    if (!Array.isArray(patch.muted) || patch.muted.length > MAX_MUTED) throw fail('Lista de peladas silenciadas inválida.', 'muted');
    if (!patch.muted.every(id => typeof id === 'string' && PELADA_ID.test(id))) throw fail('ID de pelada inválido.', 'muted');
    next.muted = [...new Set(patch.muted)];
  }
  return next;
}

// ---------------------------------------------------------------- datas
const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const pad = n => String(n).padStart(2, '0');
const utc = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
/** Dia (YYYY-MM-DD) no fuso de Brasília (UTC-3). */
export function isoBR(ts) {
  const d = new Date(ts - 3 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
/** Início do dia (00:00 de Brasília) em ms. */
export const startOfDayBR = iso => utc(iso) + 3 * 3600_000;
const shift = (iso, days) => { const d = new Date(utc(iso) + days * 86_400_000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };

/** "hoje", "amanhã", "ontem" ou "sáb, 12/10". */
export function dayName(iso, today) {
  if (!iso) return '';
  if (today) {
    if (iso === today) return 'hoje';
    if (iso === shift(today, 1)) return 'amanhã';
    if (iso === shift(today, -1)) return 'ontem';
  }
  return `${WEEK[new Date(utc(iso)).getUTCDay()]}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** "agora", "há 5 min", "há 2 h", "ontem", "há 3 dias" ou "12/10". */
export function timeAgo(at, now) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'agora';
  const min = Math.floor(s / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24 && isoBR(at) === isoBR(now)) return `há ${h} h`;
  const days = Math.round((startOfDayBR(isoBR(now)) - startOfDayBR(isoBR(at))) / 86_400_000);
  if (days <= 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  const d = isoBR(at);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

// ---------------------------------------------------------------- textos
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const count = (n, G) => (Number.isInteger(n) ? ` (${plural(n, G.confirmed, G.confirmeds)})` : '');

/**
 * Título e texto de um evento, personalizado para quem lê.
 * `ev` = { t, by, who, day?: { id, date }, d?: {...} }; `viewerId` = id da conta de quem lê; `today` = YYYY-MM-DD.
 */
export function describe(ev, { viewerId, today, gender } = {}) {
  const G = gx(gender);
  const d = ev.d || {};
  const who = ev.who || 'Alguém';
  const day = ev.day ? dayName(ev.day.date, today) : '';
  const jogo = day ? `jogo de ${day}` : 'jogo';
  switch (ev.t) {
    case 'join':
      return { title: `${cap(G.newOne)} participante`, text: `${who} entrou na pelada.` };
    case 'presence':
      if (d.guest) return { title: `${cap(G.guest)} na lista`, text: `${who} adicionou ${d.guest} (${G.guest}) ao ${jogo}${count(d.n, G)}.` };
      return { title: 'Presença confirmada', text: `${who} confirmou presença no ${jogo}${count(d.n, G)}.` };
    case 'absence':
      if (d.removed) {
        if (d.uid && d.uid === viewerId) return { title: 'Você saiu da lista', text: `${who} tirou você da lista do ${jogo}.` };
        return { title: 'Saiu da lista', text: `${who} tirou ${d.removed} da lista do ${jogo}${count(d.n, G)}.` };
      }
      return { title: 'Desistência', text: `${who} retirou a presença do ${jogo}${count(d.n, G)}.` };
    case 'draw': {
      const mine = viewerId && d.slot ? d.slot[viewerId] : null;
      const teams = Number.isInteger(d.teams) ? `: ${plural(d.teams, 'time', 'times')}` : '';
      return {
        title: d.redo ? 'Sorteio refeito' : 'Times sorteados',
        text: `${who} ${d.redo ? 'refez o sorteio' : 'sorteou os times'} do ${jogo}${teams}.${mine === 'Cerca' ? ' Você ficou na Cerca: aguarda a próxima partida e entra no time que perder.' : mine ? ` Você está no ${mine}.` : ''}`,
      };
    }
    case 'match': {
      const mine = viewerId && ((d.pa || []).includes(viewerId) || (d.pb || []).includes(viewerId));
      return { title: 'Bola rolando', text: `Partida ${d.n} começou: ${d.a} × ${d.b}.${mine ? ' Seu time está em campo!' : ''}` };
    }
    case 'result': {
      const side = viewerId ? ((d.pa || []).includes(viewerId) ? 'a' : (d.pb || []).includes(viewerId) ? 'b' : null) : null;
      let personal = '';
      if (side) {
        const mine = side === 'a' ? d.sa : d.sb, other = side === 'a' ? d.sb : d.sa;
        personal = mine > other ? ' Seu time venceu! 🎉' : mine < other ? ' Seu time perdeu.' : ' Seu time empatou.';
      }
      return { title: `Resultado da partida ${d.n}`, text: `${d.a} ${d.sa} × ${d.sb} ${d.b}.${d.goals ? ` Gols: ${d.goals}.` : ''}${personal}` };
    }
    case 'schedule':
      if (d.kind === 'moved') return { title: 'Jogo remarcado', text: `O jogo de ${dayName(d.from, today)} foi remarcado para ${day}.` };
      if (d.kind === 'cancel') return { title: 'Jogo cancelado', text: `${who} cancelou o ${jogo}.` };
      return { title: 'Nova data de jogo', text: `${who} marcou um jogo para ${day}.` };
    case 'reminder':
      return d.present
        ? { title: 'Hoje tem jogo! ⚽', text: 'Sua presença está confirmada. Acompanhe a lista e o sorteio dos times.' }
        : { title: 'Hoje tem jogo! ⚽', text: 'Confirme sua presença para entrar na lista e no sorteio dos times.' };
    default:
      return { title: 'Notificação', text: '' };
  }
}

/** Link aberto ao tocar na notificação. */
export function notifUrl(ev, peladaId) {
  const base = `/pelada/p/${peladaId}`;
  if (ev.t === 'join') return `${base}/jogadores`;
  if (ev.t === 'schedule' && ev.d?.kind === 'cancel') return base;
  return ev.day?.id ? `${base}/d/${ev.day.id}` : base;
}
