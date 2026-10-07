// Formatadores e utilitários puros (servidor + navegador).

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const NUM = new Intl.NumberFormat('pt-BR');

/** Centavos → "R$ 1.234,50" */
export const fmtBRL = cents => BRL.format((Number(cents) || 0) / 100);
export const fmtBRLshort = cents => fmtBRL(cents).replace(/,00$/, '');
export const fmtNum = n => NUM.format(Number(n) || 0);

export function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[1][0]).toUpperCase();
}

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);

/** "2026-11-14" → Date em meio-dia local (evita deslocamento de fuso). */
export function parseDay(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
  const d = new Date(iso + 'T12:00:00');
  return isNaN(d) ? null : d;
}
export function fmtDay(iso, opts = { day: '2-digit', month: 'long', year: 'numeric' }) {
  const d = parseDay(iso);
  return d ? new Intl.DateTimeFormat('pt-BR', opts).format(d) : '—';
}
export function fmtDayShort(iso) {
  const d = parseDay(iso);
  return d ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d) : '—';
}
export function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d)) return '—';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}

/** Normaliza o ID digitado pelo usuário: "#am-2026-9843 " → "AM-2026-9843". */
export function normalizeTournamentId(raw) {
  return String(raw || '').trim().replace(/^#/, '').replace(/\s+/g, '').toUpperCase();
}
export const TOURNAMENT_ID_RE = /^AM-\d{4}-\d{4,6}$/;
