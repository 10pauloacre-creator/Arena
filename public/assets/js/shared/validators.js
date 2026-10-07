// Validadores puros (servidor + navegador).

export function validCPF(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = n => { let s = 0; for (let i = 0; i < n; i++) s += +d[i] * (n + 1 - i); return (s * 10) % 11 % 10; };
  return dv(9) === +d[9] && dv(10) === +d[10];
}
export function maskCPF(v) {
  const d = String(v || '').replace(/\D/g, '').slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
}
export const cpfDigits = v => String(v || '').replace(/\D/g, '');

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const validEmail = v => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v.trim());
export const normEmail = v => String(v || '').trim().toLowerCase();

export function maskPhone(v) {
  const d = String(v || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
export const validPhone = v => { const d = String(v || '').replace(/\D/g, ''); return d.length === 10 || d.length === 11; };

/** Luhn para cartões (usado apenas no modo de teste). */
export function luhn(num) {
  const d = String(num || '').replace(/\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = +d[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}
export function cardBrand(num) {
  const d = String(num || '').replace(/\D/g, '');
  if (/^4/.test(d)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'Mastercard';
  if (/^3[47]/.test(d)) return 'Amex';
  if (/^(636368|438935|504175|451416|636297|5067|4576|4011|506699)/.test(d)) return 'Elo';
  if (/^(606282|3841)/.test(d)) return 'Hipercard';
  return 'Cartão';
}
