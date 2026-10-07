import { $, $$ } from './dom.js';
import { maskCPF, maskPhone } from '../shared/validators.js';

/** Mostra/limpa erro em um .field (procura .field-error dentro). */
export function setFieldError(field, msg) {
  if (!field) return;
  field.classList.toggle('has-error', !!msg);
  const err = $('.field-error', field);
  if (err) err.textContent = msg || '';
  const input = $('input,select,textarea', field);
  if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
}
export const clearErrors = root => $$('.field.has-error', root).forEach(f => setFieldError(f, ''));

/** Marca erros vindos da API (details.field) e retorna true se achou o campo. */
export function applyApiError(root, err) {
  const name = err?.details?.field;
  if (!name) return false;
  const input = root.querySelector(`[name="${name}"]`);
  const field = input?.closest('.field');
  if (!field) return false;
  setFieldError(field, err.message);
  input.focus();
  return true;
}

export const bindCpfMask = el => el.addEventListener('input', () => { el.value = maskCPF(el.value); });
export const bindPhoneMask = el => el.addEventListener('input', () => { el.value = maskPhone(el.value); });
export function bindCardMasks(root) {
  const num = $('[name=cardNumber]', root), exp = $('[name=cardExpiry]', root), cvv = $('[name=cardCvv]', root);
  num?.addEventListener('input', () => { num.value = num.value.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 '); });
  exp?.addEventListener('input', () => { const d = exp.value.replace(/\D/g, '').slice(0, 4); exp.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d; });
  cvv?.addEventListener('input', () => { cvv.value = cvv.value.replace(/\D/g, '').slice(0, 4); });
}

/** "R$ 1.234,56" | "150" | "150,5" → centavos (inteiro) ou NaN */
export function parseMoney(str) {
  const s = String(str ?? '').replace(/[^\d,.-]/g, '').trim();
  if (!s) return 0;
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
export const centsToInput = cents => (cents / 100).toFixed(2).replace('.', ',');

const pad = n => String(n).padStart(2, '0');
/** ISO → { date: 'YYYY-MM-DD', time: 'HH:MM' } no fuso local do navegador */
export function isoToLocalParts(iso) {
  if (!iso) return { date: '', time: '23:59' };
  const d = new Date(iso);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
export function localPartsToIso(date, time) {
  if (!date) return null;
  const d = new Date(`${date}T${time || '23:59'}:00`);
  return isNaN(d) ? null : d.toISOString();
}

/** Lê um arquivo de imagem, redimensiona para `max` px e devolve data URL (webp/jpeg) com no máximo ~`maxBytes`. */
export async function imageToDataUrl(file, { max = 192, maxBytes = 55_000 } = {}) {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) throw new Error('Formato não aceito. Use PNG, JPG ou WEBP.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Imagem muito grande (máx. 8 MB).');
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('Não foi possível ler esta imagem.');
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d'); c.drawImage(bmp, 0, 0, w, h);
  for (const [type, q] of [['image/webp', .85], ['image/webp', .7], ['image/jpeg', .7], ['image/jpeg', .5]]) {
    const url = cv.toDataURL(type, q);
    if (url.startsWith('data:' + type) && Math.floor(url.split(',')[1].length * 3 / 4) <= maxBytes) return url;
  }
  throw new Error('Não foi possível reduzir esta imagem. Tente uma menor.');
}
