// Regras do torneio (checklist do organizador) e premiação.
// Catálogo e textos compartilhados entre servidor e navegador; a validação fica em lib/domain/rules.js.

import { SPORTS } from './sports.js';

/**
 * kind: 'enforced' = o sistema confere na inscrição; 'ack' = o capitão declara que cumpre (aceite das regras).
 * type: 'bool' liga/desliga; 'int' liga com um número (null = desligada).
 */
export const RULE_DEFS = [
  { key: 'minPlayers', kind: 'enforced', type: 'int', unit: 'atletas', label: 'Quantidade mínima de jogadores', hint: 'O elenco só é aceito com pelo menos esta quantidade de atletas.', bounds: sport => ({ min: SPORTS[sport].min, max: SPORTS[sport].max, def: SPORTS[sport].min }), text: n => `Mínimo de ${n} jogadores por time` },
  { key: 'shirtNumbers', kind: 'enforced', type: 'bool', label: 'Cada jogador com seu número de camisa', hint: 'Número obrigatório e sem repetição no elenco. Desligada, o número da camisa fica opcional.', text: () => 'Cada jogador com seu número de camisa, sem repetir no time' },
  { key: 'emblemRequired', kind: 'enforced', type: 'bool', label: 'Emblema (escudo) do time obrigatório', hint: 'A inscrição só é concluída com o emblema do time enviado.', text: () => 'Emblema (escudo) do time enviado na inscrição' },
  { key: 'uniform', kind: 'ack', type: 'bool', label: 'Uniforme padronizado', hint: 'O capitão declara, na inscrição, que todos os atletas jogarão com a mesma camisa.', text: () => 'Uniforme padronizado: todos os atletas com a mesma camisa' },
  { key: 'idDocument', kind: 'ack', type: 'bool', label: 'Documento oficial com foto nos jogos', hint: 'Os atletas devem apresentar documento com foto quando o organizador pedir.', text: () => 'Documento oficial com foto de cada atleta em todos os jogos' },
  { key: 'minAge', kind: 'ack', type: 'int', unit: 'anos', label: 'Idade mínima dos atletas', hint: 'O capitão declara que todos os atletas têm a idade mínima informada.', bounds: () => ({ min: 5, max: 99, def: 16 }), text: n => `Idade mínima de ${n} anos para todos os atletas` },
  { key: 'punctuality', kind: 'ack', type: 'bool', label: 'Chegar 15 minutos antes de cada jogo', hint: 'Atrasos podem resultar em W.O. conforme decisão da organização.', text: () => 'Chegar com 15 minutos de antecedência a cada jogo' },
  { key: 'captainPresent', kind: 'ack', type: 'bool', label: 'Capitão presente em todas as partidas', hint: 'O responsável pela inscrição acompanha o time nos jogos.', text: () => 'Capitão presente em todas as partidas' },
];

export const RULE_KEYS = RULE_DEFS.map(d => d.key);
export const MAX_CUSTOM_RULES = 8;
export const MAX_CUSTOM_RULE_LEN = 120;
export const MAX_DETAILS_LEN = 4000;

/** Padrão de um torneio novo: só o número da camisa (comportamento original do sistema). */
export function defaultRules() {
  const r = { custom: [] };
  for (const d of RULE_DEFS) r[d.key] = d.type === 'int' ? null : d.key === 'shirtNumbers';
  return r;
}

/** Preenche o que faltar (torneios antigos, dados parciais) sem validar. */
export function normalizeRules(rules) {
  const base = defaultRules(), src = rules && typeof rules === 'object' ? rules : {};
  for (const d of RULE_DEFS) {
    if (!(d.key in src)) continue;
    base[d.key] = d.type === 'int' ? (Number.isInteger(src[d.key]) ? src[d.key] : null) : !!src[d.key];
  }
  base.custom = Array.isArray(src.custom) ? src.custom.filter(x => typeof x === 'string' && x).slice(0, MAX_CUSTOM_RULES) : [];
  return base;
}

/** Lista legível das regras ativas: [{ key, kind, text }]. */
export function ruleList(rules) {
  const r = normalizeRules(rules), out = [];
  for (const d of RULE_DEFS) {
    const v = r[d.key];
    if (d.type === 'int' ? v != null : v) out.push({ key: d.key, kind: d.kind, text: d.text(v) });
  }
  r.custom.forEach((text, i) => out.push({ key: `custom-${i}`, kind: 'ack', text }));
  return out;
}

/** Há alguma regra que o capitão precisa declarar que cumpre? */
export const needsAcceptance = rules => ruleList(rules).some(x => x.kind === 'ack');

/** Mínimo de atletas de fato exigido: o da modalidade ou o da regra, o que for maior. */
export const effectiveMinPlayers = (rules, sport) => Math.max(SPORTS[sport].min, normalizeRules(rules).minPlayers || 0);

// ---------------------------------------------------------------- premiação
export const PRIZE_CATEGORIES = { geral: 'Geral', masculino: 'Masculino', feminino: 'Feminino' };
export const PRIZE_CATEGORY_KEYS = Object.keys(PRIZE_CATEGORIES);
export const MAX_PRIZES = 10;
export const MAX_PRIZE_AMOUNT = 10_000_000; // R$ 100.000,00 em centavos

export const emptyPrizes = () => ({ geral: [], masculino: [], feminino: [] });

export function normalizePrizes(prizes) {
  const out = emptyPrizes(), src = prizes && typeof prizes === 'object' ? prizes : {};
  for (const k of PRIZE_CATEGORY_KEYS) {
    if (!Array.isArray(src[k])) continue;
    out[k] = src[k].slice(0, MAX_PRIZES).map(p => ({ description: String(p?.description || ''), amount: Number.isInteger(p?.amount) && p.amount > 0 ? p.amount : null }));
  }
  return out;
}

export const hasPrizes = prizes => PRIZE_CATEGORY_KEYS.some(k => normalizePrizes(prizes)[k].length > 0);
export const prizeTotal = list => list.reduce((s, p) => s + (p.amount || 0), 0);
export const placeLabel = i => `${i + 1}º lugar`;
