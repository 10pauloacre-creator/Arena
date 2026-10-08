// Limpeza de textos vindos do usuário (linha única e multilinha).

import { badRequest } from '../errors.js';

export function cleanText(v, max, { min = 0, field = 'Campo' } = {}) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < min) throw badRequest(`${field}: informe ao menos ${min} caracteres.`, 'VALIDATION', { field });
  if (s.length > max) throw badRequest(`${field}: máximo de ${max} caracteres.`, 'VALIDATION', { field });
  return s;
}

/**
 * Texto com quebras de linha (avisos, regras gerais). Normaliza CRLF, remove caracteres de controle,
 * apara o fim de cada linha e limita a no máximo uma linha em branco seguida.
 */
export function cleanMultiline(v, max, { field = 'Campo' } = {}) {
  const s = String(v ?? '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .split('\n').map(l => l.replace(/[ \t]+$/g, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (s.length > max) throw badRequest(`${field}: máximo de ${max} caracteres.`, 'VALIDATION', { field });
  return s;
}
