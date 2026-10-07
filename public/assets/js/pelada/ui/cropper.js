// Recorte e redimensionamento de foto: arraste para posicionar, zoom por controle, roda do mouse ou pinça.
// Devolve um data URL (WEBP/JPEG) já no tamanho final e abaixo de `maxBytes`.
import { html, ic, $ } from '../../ui/dom.js';
import { openDialog } from '../../ui/dialog.js';

async function loadBitmap(file) {
  if (!/^image\//.test(file.type)) throw new Error('Escolha um arquivo de imagem (PNG, JPG ou WEBP).');
  if (file.size > 12 * 1024 * 1024) throw new Error('Imagem muito grande (máx. 12 MB).');
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Não foi possível ler esta imagem.')); i.src = url; });
    } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
  }
}

function encode(cv, maxBytes) {
  const size = url => Math.floor(url.split(',')[1].length * 3 / 4);
  let work = cv;
  for (let shrink = 0; shrink < 5; shrink++) {
    for (const [type, q] of [['image/webp', .84], ['image/webp', .7], ['image/jpeg', .72], ['image/jpeg', .55], ['image/jpeg', .4]]) {
      const url = work.toDataURL(type, q);
      if (url.startsWith('data:' + type) && size(url) <= maxBytes) return url;
    }
    const next = document.createElement('canvas');
    next.width = Math.round(work.width * .85); next.height = Math.round(work.height * .85);
    next.getContext('2d').drawImage(work, 0, 0, next.width, next.height);
    work = next;
  }
  throw new Error('Não foi possível reduzir esta imagem. Tente outra.');
}

/**
 * Abre o editor. `aspect` = largura/altura do recorte. Resolve com o data URL ou null se cancelar.
 * Lança Error (para o chamador mostrar) se o arquivo não for uma imagem utilizável.
 */
export async function openCropper(file, { aspect = 1, outW = 256, circle = false, title = 'Ajustar foto', maxBytes = 80_000 } = {}) {
  const bmp = await loadBitmap(file);
  const iw = bmp.width, ih = bmp.height, outH = Math.round(outW / aspect);
  const st = { z: 1, cx: iw / 2, cy: ih / 2 };
  const base = Math.max(outW / iw, outH / ih);
  const half = () => ({ x: outW / (2 * base * st.z), y: outH / (2 * base * st.z) });
  const clamp = () => {
    const h = half();
    st.cx = Math.min(iw - h.x, Math.max(h.x, st.cx));
    st.cy = Math.min(ih - h.y, Math.max(h.y, st.cy));
  };

  const d = openDialog({
    title,
    body: html`<div class="crop">
      <div class="crop-view ${circle ? 'circle' : ''}" data-view tabindex="0" style="aspect-ratio:${outW}/${outH}" aria-label="Área de recorte: arraste ou use as setas para posicionar a imagem"><canvas width="${outW}" height="${outH}"></canvas><span class="crop-grid" aria-hidden="true"></span></div>
      <div class="crop-ctl"><button type="button" class="icon-btn" data-zoom="-0.2" aria-label="Diminuir zoom">${ic('minus')}</button>
        <input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom">
        <button type="button" class="icon-btn" data-zoom="0.2" aria-label="Aumentar zoom">${ic('plus')}</button></div>
      <p class="hint center">Arraste a imagem para posicionar e use o controle para aproximar. Tamanho final: ${outW}×${outH}px.</p>
    </div>`,
    foot: html`<button class="btn" data-close="cancel">Cancelar</button><button class="btn btn-primary" data-close="ok">${ic('check', { size: 18 })} Usar foto</button>`,
  });
  const view = $('[data-view]', d.el), cv = $('canvas', view), range = $('input[type=range]', d.el), ctx = cv.getContext('2d');

  const draw = () => {
    clamp();
    const h = half();
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, outW, outH);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, st.cx - h.x, st.cy - h.y, h.x * 2, h.y * 2, 0, 0, outW, outH);
    range.value = String(st.z);
  };
  const setZoom = z => { st.z = Math.min(4, Math.max(1, z)); draw(); };
  draw();

  // arrastar (1 dedo/mouse) e pinça (2 dedos)
  const ptrs = new Map();
  let pinch = 0;
  view.addEventListener('pointerdown', e => { view.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); } });
  view.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const rect = view.getBoundingClientRect(), k = outW / rect.width / (base * st.z);
    if (ptrs.size === 1) { st.cx -= (e.clientX - p.x) * k; st.cy -= (e.clientY - p.y) * k; }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], dist = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) st.z = Math.min(4, Math.max(1, st.z * dist / pinch)); pinch = dist; }
    draw();
  });
  const up = e => { ptrs.delete(e.pointerId); pinch = 0; };
  view.addEventListener('pointerup', up); view.addEventListener('pointercancel', up);
  view.addEventListener('wheel', e => { e.preventDefault(); setZoom(st.z * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  view.addEventListener('keydown', e => {
    const step = 24 / (base * st.z);
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) { e.preventDefault(); st.cx += mv[0]; st.cy += mv[1]; draw(); }
    else if (e.key === '+' || e.key === '=') setZoom(st.z + .2);
    else if (e.key === '-') setZoom(st.z - .2);
  });
  range.addEventListener('input', () => setZoom(Number(range.value)));
  d.el.addEventListener('click', e => { const z = e.target.closest('[data-zoom]'); if (z) setZoom(st.z + Number(z.dataset.zoom)); });

  const result = await d.closed;
  if (result !== 'ok') { bmp.close?.(); return null; }
  const url = encode(cv, maxBytes);
  bmp.close?.();
  return url;
}

/** Abre o seletor de arquivos e depois o recorte. Resolve com data URL ou null (cancelou). */
export function pickAndCrop(opts) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/*';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      try { resolve(await openCropper(f, opts)); } catch (err) { reject(err); }
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
