// Validação das regras do torneio (checklist) e da premiação enviadas pelo organizador.

import {
  RULE_DEFS, MAX_CUSTOM_RULES, MAX_CUSTOM_RULE_LEN, normalizeRules,
  PRIZE_CATEGORIES, PRIZE_CATEGORY_KEYS, MAX_PRIZES, MAX_PRIZE_AMOUNT, normalizePrizes, placeLabel,
} from '../../public/assets/js/shared/rules.js';
import { badRequest } from '../errors.js';
import { cleanText } from './text.js';

const isObject = v => v && typeof v === 'object' && !Array.isArray(v);

/** cleanText cuja mensagem usa `label`, mas cujo `details.field` aponta para o campo do formulário. */
function clean(v, max, label, field) {
  try { return cleanText(v, max, { field: label }); }
  catch (err) { if (err.extra) err.extra = { ...err.extra, field }; throw err; }
}

/**
 * Valida o checklist de regras. Chaves ausentes mantêm o valor de `current`.
 * Regras numéricas: `null`/`false`/'' desligam; ligadas, precisam estar dentro dos limites da modalidade.
 */
export function sanitizeRules(input, sport, current = null) {
  if (!isObject(input)) throw badRequest('Regras inválidas.', 'VALIDATION', { field: 'rules' });
  const out = normalizeRules(current);
  for (const d of RULE_DEFS) {
    if (!(d.key in input)) continue;
    const v = input[d.key];
    if (d.type === 'bool') {
      if (typeof v !== 'boolean') throw badRequest(`Regra "${d.label}": valor inválido.`, 'VALIDATION', { field: `rules.${d.key}` });
      out[d.key] = v;
      continue;
    }
    if (v === null || v === false || v === '') { out[d.key] = null; continue; }
    const { min, max } = d.bounds(sport), n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`${d.label}: use um número de ${min} a ${max} ${d.unit}.`, 'VALIDATION', { field: `rules.${d.key}` });
    out[d.key] = n;
  }
  if ('custom' in input) {
    if (!Array.isArray(input.custom)) throw badRequest('Lista de regras adicionais inválida.', 'VALIDATION', { field: 'rules.custom' });
    const seen = new Set(), list = [];
    for (const raw of input.custom) {
      const text = clean(raw, MAX_CUSTOM_RULE_LEN, 'Regra adicional', 'rules.custom');
      if (!text) continue;
      if (text.length < 3) throw badRequest('Regra adicional: informe ao menos 3 caracteres.', 'VALIDATION', { field: 'rules.custom' });
      if (!seen.has(text.toLowerCase())) { seen.add(text.toLowerCase()); list.push(text); }
    }
    if (list.length > MAX_CUSTOM_RULES) throw badRequest(`Use no máximo ${MAX_CUSTOM_RULES} regras adicionais.`, 'VALIDATION', { field: 'rules.custom' });
    out.custom = list;
  }
  return out;
}

/**
 * Valida a premiação por categoria (geral, masculino, feminino). A posição é a ordem da lista (1º, 2º, 3º…).
 * Categorias ausentes mantêm o valor de `current`.
 */
export function sanitizePrizes(input, current = null) {
  if (!isObject(input)) throw badRequest('Premiação inválida.', 'VALIDATION', { field: 'prizes' });
  const out = normalizePrizes(current);
  for (const cat of PRIZE_CATEGORY_KEYS) {
    if (!(cat in input)) continue;
    if (!Array.isArray(input[cat])) throw badRequest(`Premiação ${PRIZE_CATEGORIES[cat].toLowerCase()}: lista inválida.`, 'VALIDATION', { field: 'prizes' });
    if (input[cat].length > MAX_PRIZES) throw badRequest(`Premiação ${PRIZE_CATEGORIES[cat].toLowerCase()}: no máximo ${MAX_PRIZES} colocações.`, 'VALIDATION', { field: 'prizes' });
    out[cat] = input[cat].map((p, i) => {
      const where = `Premiação ${PRIZE_CATEGORIES[cat].toLowerCase()}, ${placeLabel(i)}`;
      if (!isObject(p)) throw badRequest(`${where}: dados inválidos.`, 'VALIDATION', { field: 'prizes' });
      const description = clean(p.description, 80, where, 'prizes');
      let amount = null;
      if (p.amount !== null && p.amount !== undefined && p.amount !== '' && p.amount !== 0) {
        amount = Number(p.amount);
        if (!Number.isInteger(amount) || amount < 100 || amount > MAX_PRIZE_AMOUNT) throw badRequest(`${where}: valor inválido (de R$ 1,00 a R$ 100.000,00).`, 'VALIDATION', { field: 'prizes' });
      }
      if (!description && amount == null) throw badRequest(`${where}: informe o prêmio (texto ou valor) ou remova a colocação.`, 'VALIDATION', { field: 'prizes' });
      return { description, amount };
    });
  }
  return out;
}
