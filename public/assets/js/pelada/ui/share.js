// Compartilhar resultados. A imagem usa a ARTE EXATA do modelo criado no Canva (2172×2896, o dobro do tamanho do design)
// como fundo e desenha por cima só o que muda: período, nomes, gols e as fotos nas molduras.
// As medidas abaixo são as do modelo (px do design de 1086×1448); `K` converte para o tamanho real do canvas.
import { html, ic, $ } from '../../ui/dom.js';
import { openDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { initials } from '../../shared/format.js';
import { isoDay } from '../../shared/dates.js';
import { sharePeriod } from '../../shared/pelada.js';
import { dayFull } from './shell.js';
import { userImg } from './img.js';

export const MODEL_URL = '/pelada/share/modelo-compartilhamento.webp';
const DESIGN_W = 1086;
const COND = '"Barlow Condensed", "Arial Narrow", Impact, sans-serif'; // textos de nomes e gols no modelo
const ROUND = '"League Spartan", "Century Gothic", system-ui, sans-serif'; // data (mesma família do subtítulo do modelo)
const GOLD = '#ffdf42';

// molduras redondas (centro e raio interno) e plaquinhas dos pedestais: [1º (centro), 2º (esquerda), 3º (direita)]
const RINGS = [{ x: 543.7, y: 594.9, r: 127 }, { x: 209.4, y: 654.5, r: 119.5 }, { x: 871.8, y: 654.1, r: 114.5 }];
const PEDESTALS = [
  { cx: 539.6, nameTop: 854.86, nameSize: 44.72, goalTop: 905.77, goalSize: 50.29, goalColor: GOLD, goalAlpha: 0.9, maxW: 255 },
  { cx: 202.0, nameTop: 884.54, nameSize: 36.37, goalTop: 922.72, goalSize: 40.54, goalColor: '#ffffff', goalAlpha: 0.7, maxW: 230 },
  { cx: 879.7, nameTop: 884.54, nameSize: 36.37, goalTop: 922.72, goalSize: 40.54, goalColor: GOLD, goalAlpha: 0.7, maxW: 230 },
];
// "Demais resultados": 4º e 5º na coluna da esquerda, 6º e 7º na da direita
const ROWS = [
  { rankCx: 117.5, rankTop: 1139.08, nameLeft: 171.2, nameTop: 1143.31, maxW: 325 },
  { rankCx: 117.5, rankTop: 1215.44, nameLeft: 171.2, nameTop: 1219.67, maxW: 325 },
  { rankCx: 624.3, rankTop: 1139.08, nameLeft: 685.04, nameTop: 1143.31, maxW: 313 },
  { rankCx: 624.3, rankTop: 1215.44, nameLeft: 685.04, nameTop: 1219.67, maxW: 313 },
];
const DATE_BOX = { cx: 543, top: 411.79, size: 33.4 };
// distância do topo da caixa de texto do Canva até a linha de base (em múltiplos do tamanho da fonte)
const BASE = { cond: 0.875, round: 0.84 };
// compressão horizontal para casar a largura das letras com a do modelo
const SX = { cond: 0.955, cond700: 0.99, round: 0.87, rank: 1.06 };

const pn = n => `${n} ${n === 1 ? 'gol' : 'gols'}`;

/** Dados do compartilhamento. scope: 'day' | 'general'. `today` = dia da emissão (padrão: hoje). */
export function resultsData(pel, { scope, dayId }, { origin = location.origin, today = isoDay(new Date()) } = {}) {
  const day = pel.days.find(d => d.id === dayId) || null;
  const general = scope === 'general' || !day;
  const nameOf = pid => pel.people[pid]?.name || '?';
  const ranking = (general ? pel.ranking : day.ranking).map(r => ({ pid: r.pid, name: nameOf(r.pid), goals: r.goals, rank: r.rank, medal: r.medal, av: pel.people[r.pid]?.av || 0 }));
  const label = (d, teamId) => d.draw?.teams.find(t => t.id === teamId)?.label || 'Time';
  const rowsOf = d => d.matches.filter(m => m.status === 'finished' && m.a && m.b).map(m => ({ a: label(d, m.a), b: label(d, m.b), sa: m.score.a, sb: m.score.b }));
  let results = [];
  if (general) {
    for (const d of [...pel.days].reverse()) { if (results.length >= 4) break; results.push(...rowsOf(d).reverse()); }
    results = results.slice(0, 4);
  } else results = rowsOf(day).slice(-4);
  // período: do início da pelada (primeira data de jogo) até o dia da emissão; "do dia" mostra a data do jogo
  const period = sharePeriod({ general, firstDay: pel.days[0]?.date || null, dayDate: day?.date || null, today });
  return {
    pelada: pel.name, id: pel.id, general, ranking, results, url: `${origin}/pelada/p/${pel.id}`, period: period.label,
    title: general ? 'Artilharia Geral' : 'Artilharia do Dia', dateLine: general ? 'Todas as datas' : dayFull(day.date), gender: pel.gender,
  };
}

/** Texto limpo para WhatsApp (emojis de futebol e medalhas). */
export function shareText(d) {
  const medal = { gold: '🥇', silver: '🥈', bronze: '🥉' };
  const lines = [`⚽ *${d.pelada}* ⚽`, `🏆 *${d.title}* · 🗓 ${d.period}`, ''];
  if (!d.ranking.length) lines.push('Ainda sem gols anotados. 🥅');
  for (const r of d.ranking) lines.push(`${r.medal ? medal[r.medal] : `${r.rank}º`} ${r.name} — ${pn(r.goals)}`);
  if (d.results.length) { lines.push('', '📋 *Placar das partidas*'); for (const m of d.results) lines.push(`⚽ ${m.a} ${m.sa} x ${m.sb} ${m.b}`); }
  lines.push('', `🔗 ${d.url}`, `🆔 ${d.id}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- imagem
function loadImg(src) {
  return new Promise(res => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}

async function ensureFonts() {
  try {
    await Promise.all(['800 40px "Barlow Condensed"', '700 40px "Barlow Condensed"', '800 28px "League Spartan"'].map(f => document.fonts.load(f)));
  } catch { /* usa a fonte reserva */ }
}

/**
 * Escreve texto na posição do modelo. `top` = topo da caixa de texto do Canva; x = centro (align 'center') ou início ('left').
 * `sx` comprime o texto na horizontal para casar com a largura das letras do modelo.
 */
function put(c, K, text, { x, top, size, weight = 800, family = COND, base = BASE.cond, color = '#fff', alpha = 0.9, align = 'center', maxW = 0, sx = 1 }) {
  let s = size;
  c.font = `${weight} ${s * K}px ${family}`;
  const wide = () => c.measureText(String(text)).width * sx;
  if (maxW) { while (s > size * 0.55 && wide() > maxW * K) { s -= 0.5; c.font = `${weight} ${s * K}px ${family}`; } }
  let t = String(text);
  if (maxW) { while (t.length > 1 && c.measureText(t).width * sx > maxW * K) t = t.slice(0, -1); if (t.length < String(text).length) t = t.trimEnd() + '…'; }
  c.save(); c.globalAlpha = alpha; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'alphabetic';
  c.translate(x * K, (top + size * base) * K); c.scale(sx, 1);
  c.fillText(t, 0, 0);
  c.restore();
}

/** Colocação no estilo do modelo: número grande + "o" pequeno elevado (ex.: 4º). */
function putRank(c, K, rank, { cx, top, size = 44.72, color = GOLD, alpha = 0.9 }) {
  const num = String(rank), small = size * 0.55;
  c.save(); c.globalAlpha = alpha; c.fillStyle = color; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  c.font = `800 ${size * K}px ${COND}`; const wn = c.measureText(num).width * SX.rank;
  c.font = `800 ${small * K}px ${COND}`; const wo = c.measureText('o').width * SX.rank;
  const start = cx * K - (wn + wo) / 2, baseline = (top + size * BASE.cond) * K;
  c.font = `800 ${size * K}px ${COND}`; c.save(); c.translate(start, baseline); c.scale(SX.rank, 1); c.fillText(num, 0, 0); c.restore();
  c.font = `800 ${small * K}px ${COND}`; c.save(); c.translate(start + wn + K, baseline - size * 0.43 * K); c.scale(SX.rank, 1); c.fillText('o', 0, 0); c.restore();
  c.restore();
}

/** Foto (ou iniciais) dentro da moldura. */
async function ring(c, K, spec, entry, kind) {
  const { x, y, r } = spec, cx = x * K, cy = y * K, R = r * K;
  c.save(); c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.clip();
  const img = entry.av ? await loadImg(userImg(entry.pid.slice(2), entry.av)) : null;
  if (img) {
    const s = Math.max(2 * R / img.width, 2 * R / img.height);
    c.drawImage(img, cx - img.width * s / 2, cy - img.height * s / 2, img.width * s, img.height * s);
  } else {
    const tone = { gold: ['#3a2a05', '#14100a', '#ffdf42'], silver: ['#2a3140', '#0d1118', '#e8edf5'], bronze: ['#3a2112', '#120b07', '#e7a778'] }[kind];
    const g = c.createRadialGradient(cx, cy - R * 0.25, R * 0.1, cx, cy, R);
    g.addColorStop(0, tone[0]); g.addColorStop(1, tone[1]);
    c.fillStyle = g; c.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    c.fillStyle = tone[2]; c.globalAlpha = 0.92; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `800 ${R * 0.95}px ${COND}`; c.fillText(initials(entry.name), cx, cy + R * 0.04);
  }
  // sombra interna para a foto "entrar" na moldura
  const v = c.createRadialGradient(cx, cy, R * 0.72, cx, cy, R);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.45)');
  c.globalAlpha = 1; c.fillStyle = v; c.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  c.restore();
}

/** Desenha a imagem de compartilhamento no canvas (mesmo tamanho do modelo exportado). */
export async function drawShareImage(cv, d) {
  const [bg] = await Promise.all([loadImg(MODEL_URL), ensureFonts()]);
  if (!bg) throw new Error('Não foi possível carregar o modelo da imagem. Verifique a conexão e tente de novo.');
  cv.width = bg.width; cv.height = bg.height;
  const K = cv.width / DESIGN_W, c = cv.getContext('2d');
  c.drawImage(bg, 0, 0);

  // período: início da pelada até o dia da emissão
  put(c, K, d.period, { x: DATE_BOX.cx, top: DATE_BOX.top, size: DATE_BOX.size, weight: 800, family: ROUND, base: BASE.round, maxW: 420, sx: SX.round });

  // pódio: o 1º no centro, o 2º à esquerda e o 3º à direita (como no modelo)
  const kinds = ['gold', 'silver', 'bronze'];
  for (let i = 0; i < 3; i++) {
    const e = d.ranking[i], p = PEDESTALS[i];
    if (!e) { put(c, K, '—', { x: p.cx, top: p.nameTop, size: p.nameSize, alpha: 0.45, sx: SX.cond }); continue; }
    await ring(c, K, RINGS[i], e, kinds[i]);
    put(c, K, e.name, { x: p.cx, top: p.nameTop, size: p.nameSize, maxW: p.maxW, sx: SX.cond });
    put(c, K, pn(e.goals), { x: p.cx, top: p.goalTop, size: p.goalSize, color: p.goalColor, alpha: p.goalAlpha, sx: SX.cond });
  }

  // demais resultados (4º ao 7º)
  d.ranking.slice(3, 7).forEach((e, i) => {
    const row = ROWS[i];
    putRank(c, K, e.rank, { cx: row.rankCx, top: row.rankTop });
    put(c, K, `${e.name} - ${pn(e.goals)}`, { x: row.nameLeft, top: row.nameTop, size: 36.37, weight: 700, align: 'left', maxW: row.maxW, sx: SX.cond700 });
  });
  return cv;
}

async function renderCanvas(d) {
  const cv = document.createElement('canvas');
  await drawShareImage(cv, d);
  return cv;
}
const canvasBlob = cv => new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('Não foi possível gerar a imagem.')), 'image/png'));

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.append(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch { return false; }
  }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const fileName = d => `artilharia-${d.id.toLowerCase()}${d.general ? '-geral' : ''}.png`;

/** Copia a imagem para a área de transferência (gravação com Promise: mantém o "gesto do usuário"). */
async function copyImage(blobPromise) {
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]); return 'copied'; } catch (err) { if (err?.name === 'AbortError') return 'cancel'; }
  }
  return 'unsupported';
}
async function shareFile(blob, d) {
  const file = new File([blob], fileName(d), { type: 'image/png' });
  if (!navigator.canShare?.({ files: [file] })) return 'unsupported';
  try { await navigator.share({ files: [file], text: shareText(d) }); return 'shared'; } catch (err) { return err?.name === 'AbortError' ? 'cancel' : 'unsupported'; }
}

const MESSAGES = { copied: 'Imagem copiada! Cole no grupo do WhatsApp.', shared: 'Compartilhado!', downloaded: 'Imagem baixada (e texto copiado).', text: 'Texto copiado! Cole no WhatsApp.', fail: 'Não foi possível copiar.' };
const say = out => { if (MESSAGES[out]) toast(MESSAGES[out], { type: out === 'fail' ? 'error' : 'success' }); };

/**
 * Tela de compartilhamento: mostra a imagem do modelo com os dados e já tenta copiá-la para a área de transferência
 * (se o navegador não permitir, use "Copiar imagem", "Enviar" ou "Baixar"). Retorna a promessa do canvas.
 */
export function openShareScreen(d) {
  const canvasP = renderCanvas(d);
  const blobP = canvasP.then(canvasBlob);
  blobP.catch(() => {}); // erros aparecem na prévia
  const auto = copyImage(blobP).then(out => { if (out === 'copied') say('copied'); return out; });

  const dlg = openDialog({
    title: 'Compartilhar resultados', wide: true,
    body: html`<div class="share-screen"><div class="share-prev" data-prev><div class="spinner" role="status" aria-label="Gerando imagem"></div></div>
      <p class="hint center" data-hint>Gerando a imagem do modelo…</p></div>`,
    foot: html`<button class="btn" data-close>Fechar</button><button class="btn" data-sh="text">${ic('copy', { size: 16 })} Copiar texto</button><button class="btn" data-sh="download">${ic('download', { size: 16 })} Baixar imagem</button>${navigator.canShare ? html`<button class="btn" data-sh="send">${ic('share', { size: 16 })} Enviar</button>` : ''}<button class="btn btn-gold" data-sh="copy">${ic('copy', { size: 16 })} Copiar imagem</button>`,
  });
  const prev = $('[data-prev]', dlg.el), hint = $('[data-hint]', dlg.el);
  canvasP.then(cv => {
    cv.className = 'share-canvas'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', `Imagem de compartilhamento: ${d.title} de ${d.pelada}, ${d.period}`);
    prev.replaceChildren(cv);
    hint.textContent = 'A imagem já foi copiada, se o seu navegador permitir. É só colar no grupo do WhatsApp.';
    auto.then(out => { if (out !== 'copied') hint.textContent = 'Toque em "Copiar imagem", "Enviar" ou "Baixar imagem" para levar o resultado ao WhatsApp.'; });
  }, err => { prev.innerHTML = ''; const e = document.createElement('div'); e.className = 'form-error'; e.textContent = err.message; prev.append(e); hint.textContent = ''; });

  dlg.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-sh]');
    if (!b) return;
    b.disabled = true;
    try {
      const mode = b.dataset.sh;
      if (mode === 'text') say((await copyText(shareText(d))) ? 'text' : 'fail');
      else if (mode === 'download') { download(await blobP, fileName(d)); say('downloaded'); }
      else if (mode === 'send') { const out = await shareFile(await blobP, d); if (out === 'unsupported') toast('Compartilhamento indisponível aqui: use "Baixar imagem".', { type: 'warn' }); else say(out); }
      else { const out = await copyImage(blobP); if (out === 'copied') say('copied'); else toast('Este navegador não permite copiar imagens: use "Baixar imagem" ou "Enviar".', { type: 'warn' }); }
    } catch (err) { toast(err.message || 'Não foi possível gerar a imagem.', { type: 'error' }); }
    b.disabled = false;
  });
  return canvasP;
}

/**
 * Ação dos botões do pódio. 'copy' abre a tela de compartilhamento (e já copia a imagem);
 * 'download' baixa o PNG; 'text' copia o texto formatado.
 */
export async function runShare(d, mode) {
  try {
    if (mode === 'copy') { await openShareScreen(d); return; }
    if (mode === 'text') { say((await copyText(shareText(d))) ? 'text' : 'fail'); return; }
    const blob = await canvasBlob(await renderCanvas(d));
    download(blob, fileName(d)); say('downloaded');
  } catch (err) { toast(err.message || 'Não foi possível gerar a imagem.', { type: 'error' }); }
}
