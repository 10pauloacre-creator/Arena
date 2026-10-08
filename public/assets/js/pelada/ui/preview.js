// Prévia do link de convite (WhatsApp, Telegram…): monta uma imagem 1200×630 com a capa, a foto de perfil e o nome da pelada.
// Fica salva junto da pelada e é a imagem que as redes mostram quando o link é compartilhado (veja lib/domain/pelada-share.js).
import { GENDERS } from '../../shared/pelada.js';

const W = 1200, H = 630;
export const PREVIEW_MAX_BYTES = 200_000; // o servidor aceita até 230 KB

const load = src => new Promise(res => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

/** Desenha `img` preenchendo o retângulo (recorte centralizado, como object-fit: cover). */
function cover(ctx, img, x, y, w, h) {
  const k = Math.max(w / img.width, h / img.height), sw = w / k, sh = h / k;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

function fitText(ctx, text, maxW, size, weight = 800) {
  let s = size;
  for (; s > 30; s -= 2) { ctx.font = `${weight} ${s}px "Plus Jakarta Sans", system-ui, sans-serif`; if (ctx.measureText(text).width <= maxW) return [text, s]; }
  let t = text;
  while (t.length > 3 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return [t + '…', s];
}

/**
 * Retorna um data URL JPEG (≤ 200 KB) ou '' quando a pelada não tem capa nem foto (aí as redes usam o ícone do app).
 * `coverUrl` / `avatarUrl` podem ser data URLs (recém-escolhidas) ou as URLs /pelada-img/… já salvas.
 */
export async function composePreview({ name, gender, coverUrl, avatarUrl }) {
  if (!coverUrl && !avatarUrl) return '';
  try {
    const [cov, av] = await Promise.all([load(coverUrl), load(avatarUrl)]);
    if (!cov && !av) return '';
    try { await document.fonts.load('800 60px "Plus Jakarta Sans"'); } catch { /* usa a fonte do sistema */ }
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const g = GENDERS[gender] || GENDERS.masculino;
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, gender === 'feminino' ? '#8a1f5c' : '#0b3d24'); bg.addColorStop(1, gender === 'feminino' ? '#d6336c' : '#12a150');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (cov) cover(ctx, cov, 0, 0, W, H);
    else if (av) { ctx.save(); ctx.filter = 'blur(28px)'; cover(ctx, av, -60, -60, W + 120, H + 120); ctx.restore(); }
    const shade = ctx.createLinearGradient(0, H * 0.35, 0, H);
    shade.addColorStop(0, 'rgb(0 0 0 / 0)'); shade.addColorStop(1, 'rgb(0 0 0 / .82)');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H);

    // foto de perfil redonda com anel branco
    const D = 232, ax = 56, ay = H - 56 - D;
    ctx.save();
    ctx.beginPath(); ctx.arc(ax + D / 2, ay + D / 2, D / 2 + 8, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(ax + D / 2, ay + D / 2, D / 2, 0, Math.PI * 2); ctx.clip();
    if (av) cover(ctx, av, ax, ay, D, D);
    else { ctx.fillStyle = '#0b3d24'; ctx.fillRect(ax, ay, D, D); ctx.font = '130px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⚽', ax + D / 2, ay + D / 2 + 8); }
    ctx.restore();

    // nome e categoria
    const tx = ax + D + 44, maxW = W - tx - 56;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgb(0 0 0 / .45)'; ctx.shadowBlur = 12;
    const [title, size] = fitText(ctx, name, maxW, 76);
    ctx.font = `800 ${size}px "Plus Jakarta Sans", system-ui, sans-serif`;
    ctx.fillText(title, tx, ay + D / 2 + 6);
    ctx.font = '700 34px "Plus Jakarta Sans", system-ui, sans-serif'; ctx.fillStyle = '#ffdf42';
    ctx.fillText(`${g.emoji} Pelada ${g.adj} · toque para entrar`, tx, ay + D / 2 + 62);

    for (let q = 0.86; q >= 0.4; q -= 0.08) {
      const url = c.toDataURL('image/jpeg', q);
      if ((url.length - url.indexOf(',') - 1) * 0.75 <= PREVIEW_MAX_BYTES) return url;
    }
    return '';
  } catch { return ''; }
}
