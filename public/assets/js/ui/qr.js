// QR Code via biblioteca qrcode-generator (carregada em /assets/js/vendor/qrcode.js).
import { raw } from './dom.js';

function build(text) {
  if (typeof window.qrcode !== 'function') return null;
  const qr = window.qrcode(0, 'M');
  qr.addData(String(text));
  qr.make();
  return qr;
}

/** SVG escalável (módulos escuros sobre fundo branco, com margem de silêncio). */
export function qrSvg(text, { margin = 2 } = {}) {
  const qr = build(text);
  if (!qr) return raw('<span class="muted small">QR indisponível</span>');
  const n = qr.getModuleCount(), size = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  return raw(`<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QR Code" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#0a0f1d"/></svg>`);
}

/** Desenha o QR em um canvas na posição/tamanho indicados (px). */
export function drawQr(ctx, text, x, y, size, { dark = '#0a0f1d', light = '#ffffff', margin = 2, radius = 0 } = {}) {
  const qr = build(text);
  if (!qr) return false;
  const n = qr.getModuleCount(), total = n + margin * 2, cell = size / total;
  ctx.save();
  ctx.fillStyle = light;
  if (radius && ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, size, size, radius); ctx.fill(); } else ctx.fillRect(x, y, size, size);
  ctx.fillStyle = dark;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(Math.round(x + (c + margin) * cell), Math.round(y + (r + margin) * cell), Math.ceil(cell), Math.ceil(cell));
  ctx.restore();
  return true;
}
