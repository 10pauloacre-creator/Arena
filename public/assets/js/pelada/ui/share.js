// Compartilhar resultados: texto formatado (emojis de futebol e medalhas) e imagem no estilo do flyer aprovado no Canva
// (azul-marinho, gramado, pódio ouro/prata/bronze). A imagem é copiada para a área de transferência ou baixada.
import { drawQr } from '../../ui/qr.js';
import { ensureFonts } from '../../ui/flyer.js';
import { initials } from '../../shared/format.js';
import { dayFull, dayLong } from './shell.js';
import { userImg } from './img.js';

const FONT = '"Plus Jakarta Sans", system-ui, sans-serif';
const pn = n => `${n} ${n === 1 ? 'gol' : 'gols'}`;

/** Monta os dados do compartilhamento. scope: 'day' | 'general'. */
export function resultsData(pel, { scope, dayId }, origin = location.origin) {
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
  return {
    pelada: pel.name, id: pel.id, general, ranking, results, url: `${origin}/pelada/p/${pel.id}`,
    title: general ? 'Artilharia Geral' : 'Artilharia do Dia', sub: general ? 'Soma de todas as partidas' : dayLong(day.date), dateLine: general ? 'Todas as datas' : dayFull(day.date),
    gender: pel.gender,
  };
}

/** Texto limpo para WhatsApp (emojis de futebol e medalhas). */
export function shareText(d) {
  const medal = { gold: '🥇', silver: '🥈', bronze: '🥉' };
  const lines = [`⚽ *${d.pelada}* ⚽`, `🏆 *${d.title}* · ${d.general ? 'todas as datas' : d.dateLine}`, ''];
  if (!d.ranking.length) lines.push('Ainda sem gols anotados. 🥅');
  for (const r of d.ranking) lines.push(`${r.medal ? medal[r.medal] : `${r.rank}º`} ${r.name} — ${pn(r.goals)}`);
  if (d.results.length) { lines.push('', '📋 *Placar das partidas*'); for (const m of d.results) lines.push(`⚽ ${m.a} ${m.sa} x ${m.sb} ${m.b}`); }
  lines.push('', `🔗 ${d.url}`, `🆔 ${d.id}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- imagem
function fit(c, text, maxW, size, min, maxLines, weight = 800) {
  let s = size;
  for (;;) {
    c.font = `${weight} ${s}px ${FONT}`;
    const lines = []; let cur = '';
    String(text).split(/\s+/).forEach(w => { const t = cur ? cur + ' ' + w : w; if (c.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } });
    if (cur) lines.push(cur);
    if ((lines.length <= maxLines && lines.every(l => c.measureText(l).width <= maxW)) || s <= min) return { lines: lines.slice(0, maxLines), size: s };
    s -= 3;
  }
}
const ell = (c, text, maxW) => { let t = String(text); while (t.length > 1 && c.measureText(t).width > maxW) t = t.slice(0, -1); return t === String(text) ? t : t.trimEnd() + '…'; };
const tracking = (c, px) => { if ('letterSpacing' in c) c.letterSpacing = px + 'px'; };
function glow(c, x, y, r, color, a) { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)'); c.save(); c.globalAlpha = a; c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.restore(); }
const METAL = { gold: ['#ffe27a', '#d89a00'], silver: ['#f4f6fa', '#9aa5b5'], bronze: ['#f0b283', '#9d5a26'] };

function ball(c, x, y, r, stroke = 'rgba(255,255,255,.12)') {
  c.save(); c.strokeStyle = stroke; c.lineWidth = r * .04; c.lineJoin = 'round';
  c.beginPath(); c.arc(x, y, r, 0, 7); c.stroke();
  c.beginPath(); for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * 2 * Math.PI / 5; const px = x + Math.cos(a) * r * .34, py = y + Math.sin(a) * r * .34; k ? c.lineTo(px, py) : c.moveTo(px, py); } c.closePath(); c.stroke();
  for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * 2 * Math.PI / 5; c.beginPath(); c.moveTo(x + Math.cos(a) * r * .34, y + Math.sin(a) * r * .34); c.lineTo(x + Math.cos(a) * r * .98, y + Math.sin(a) * r * .98); c.stroke(); }
  c.restore();
}

function medal(c, kind, rank, x, y, r) {
  const [a, b] = METAL[kind];
  c.save();
  c.fillStyle = '#d92d4a'; c.beginPath(); c.moveTo(x - r * .75, y - r * 1.9); c.lineTo(x - r * .05, y - r * 1.9); c.lineTo(x + r * .35, y - r * .4); c.lineTo(x - r * .3, y - r * .1); c.closePath(); c.fill();
  c.fillStyle = '#1a66f0'; c.beginPath(); c.moveTo(x + r * .75, y - r * 1.9); c.lineTo(x + r * .05, y - r * 1.9); c.lineTo(x - r * .35, y - r * .4); c.lineTo(x + r * .3, y - r * .1); c.closePath(); c.fill();
  const g = c.createLinearGradient(x - r, y - r, x + r, y + r); g.addColorStop(0, a); g.addColorStop(1, b);
  c.fillStyle = g; c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = r * .08; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.stroke();
  c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = r * .07; c.beginPath(); c.arc(x, y, r * .72, 0, 7); c.stroke();
  c.fillStyle = 'rgba(45,30,0,.8)'; c.font = `800 ${r}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(rank), x, y + r * .05);
  c.restore();
}

function loadImg(src) { return new Promise(res => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }

async function personDot(c, entry, x, y, r) {
  const img = await loadImg(userImg(entry.pid.slice(2), entry.av));
  c.save(); c.beginPath(); c.arc(x, y, r, 0, 7); c.clip();
  if (img) {
    const s = Math.max(2 * r / img.width, 2 * r / img.height);
    c.drawImage(img, x - img.width * s / 2, y - img.height * s / 2, img.width * s, img.height * s);
  } else {
    let h = 0; for (const ch of entry.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const g = c.createLinearGradient(x - r, y - r, x + r, y + r); g.addColorStop(0, `hsl(${h % 360} 70% 52%)`); g.addColorStop(1, `hsl(${h % 360} 65% 30%)`);
    c.fillStyle = g; c.fillRect(x - r, y - r, 2 * r, 2 * r);
    c.fillStyle = '#fff'; c.font = `800 ${r * .78}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(initials(entry.name), x, y + r * .05);
  }
  c.restore();
}

/** Desenha o flyer 1080×1350 no canvas. */
export async function drawShareImage(cv, d) {
  const W = 1080, H = 1350;
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.textBaseline = 'alphabetic'; c.textAlign = 'center'; tracking(c, 0);

  // fundo: azul-marinho + gramado em listras + brilhos
  const bg = c.createLinearGradient(0, 0, W * .7, H); bg.addColorStop(0, '#0a1a3d'); bg.addColorStop(1, '#06102a'); c.fillStyle = bg; c.fillRect(0, 0, W, H);
  glow(c, W * .1, H * .04, 760, '#1b6dff', .35); glow(c, W * .95, H * .55, 640, '#12a150', .25);
  c.save(); c.fillStyle = '#fff'; c.globalAlpha = .05; [[.62, .17], [.86, .07]].forEach(([x0, wd]) => { c.beginPath(); c.moveTo(W * x0, 0); c.lineTo(W * (x0 + wd), 0); c.lineTo(W * (x0 + wd - .3), H); c.lineTo(W * (x0 - .3), H); c.closePath(); c.fill(); }); c.restore();
  const grass = c.createLinearGradient(0, H * .62, 0, H); grass.addColorStop(0, 'rgba(18,161,80,0)'); grass.addColorStop(1, 'rgba(18,161,80,.38)'); c.fillStyle = grass; c.fillRect(0, H * .62, W, H * .38);
  c.save(); c.globalAlpha = .08; c.fillStyle = '#fff'; for (let i = 0; i < 6; i++) c.fillRect(0, H * .66 + i * 70, W, 35); c.restore();
  ball(c, W * .86, H * .13, 190);
  // confetes dourados
  c.save(); c.fillStyle = '#f6b21b'; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 40; i++) { const x = rnd() * W, y = rnd() * H * .36, s = 5 + rnd() * 9; c.globalAlpha = .22 + rnd() * .5; c.save(); c.translate(x, y); c.rotate(rnd() * 3); c.fillRect(-s, -s / 2, s * 2, s); c.restore(); }
  c.restore();

  // ---- cabeçalho
  tracking(c, 7); c.fillStyle = '#4fd68b'; c.font = `800 27px ${FONT}`; c.fillText('⚽  PELADA  ⚽', W / 2, 78); tracking(c, 0);
  const nm = fit(c, d.pelada.toUpperCase(), W * .84, 60, 34, 2, 800);
  c.fillStyle = '#fff'; c.font = `800 ${nm.size}px ${FONT}`; let y = 146; nm.lines.forEach(l => { c.fillText(l, W / 2, y); y += nm.size * 1.05; });
  const ttl = fit(c, d.title.toUpperCase(), W * .9, 92, 50, 1, 800);
  c.fillStyle = '#ffc93c'; c.font = `800 ${ttl.size}px ${FONT}`; y += 40; tracking(c, -1); c.fillText(ttl.lines[0], W / 2, y); tracking(c, 0);
  c.font = `700 29px ${FONT}`;
  const sub = (d.general ? 'TODAS AS DATAS' : `${d.sub} · ${d.dateLine.slice(-4)}`).toUpperCase();
  const sw = Math.min(W * .88, c.measureText(sub).width + 70);
  c.fillStyle = 'rgba(255,255,255,.1)'; c.strokeStyle = '#ffc93c'; c.lineWidth = 3; c.beginPath(); c.roundRect((W - sw) / 2, y + 24, sw, 58, 29); c.fill(); c.stroke();
  c.fillStyle = '#ffc93c'; c.fillText(ell(c, sub, sw - 40), W / 2, y + 63);
  y += 112;

  // área disponível entre o cabeçalho e o rodapé (QR)
  const ph = 190, py = H - ph - 36, limit = py - 22;

  // ---- pódio (top 3 com medalha; empates dividem a colocação)
  const top = d.ranking.filter(r => r.medal).slice(0, 3);
  const rest = d.ranking.filter(r => !top.includes(r));
  if (!top.length) {
    c.fillStyle = 'rgba(255,255,255,.8)'; c.font = `700 40px ${FONT}`; c.fillText('Ainda sem gols anotados', W / 2, y + 150);
    y += 250;
  } else {
    const order = top.length === 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[0], top[1]] : [top[0]];
    const colW = 300, gap = 22, total = order.length * colW + (order.length - 1) * gap, x0 = (W - total) / 2;
    const STEP = { 1: 156, 2: 124, 3: 108 };
    const base = y + 400;
    for (let i = 0; i < order.length; i++) {
      const r = order[i], cx = x0 + i * (colW + gap) + colW / 2, first = r.rank === 1;
      const stepH = STEP[r.rank], [m1, m2] = METAL[r.medal];
      const g = c.createLinearGradient(0, base - stepH, 0, base); g.addColorStop(0, m1); g.addColorStop(1, m2);
      c.fillStyle = g; c.beginPath(); c.roundRect(cx - colW / 2, base - stepH, colW, stepH, [18, 18, 0, 0]); c.fill();
      c.fillStyle = 'rgba(45,30,0,.78)'; c.font = `800 ${first ? 62 : r.rank === 2 ? 50 : 42}px ${FONT}`; c.fillText(`${r.rank}º`, cx, base - stepH + (first ? 66 : r.rank === 2 ? 54 : 46));
      c.font = `800 27px ${FONT}`; c.fillText(pn(r.goals), cx, base - 16);
      // nome (até 2 linhas) acima do degrau
      const nf = fit(c, r.name, colW - 12, first ? 32 : 28, 22, 2, 800);
      const lh = nf.size * 1.12, nameTop = base - stepH - 16 - (nf.lines.length - 1) * lh;
      c.fillStyle = '#fff'; c.font = `800 ${nf.size}px ${FONT}`; nf.lines.forEach((l, k) => c.fillText(l, cx, nameTop + k * lh));
      // avatar e medalha acima do nome
      const ar = first ? 56 : 46, ay = nameTop - nf.size - 22 - ar;
      await personDot(c, r, cx, ay, ar);
      c.strokeStyle = m1; c.lineWidth = 6; c.beginPath(); c.arc(cx, ay, ar + 4, 0, 7); c.stroke();
      medal(c, r.medal, r.rank, cx + ar * .78, ay - ar * .72, first ? 28 : 23);
    }
    y = base + 56;
  }

  // ---- demais colocados e placar, ajustados ao espaço que sobrou
  const resultRows = Math.min(d.results.length, 3);
  const resultsH = resultRows ? 62 + resultRows * 58 : 0;
  const restRows = Math.max(0, Math.min(rest.length, 3, Math.floor((limit - y - resultsH) / 54)));
  if (restRows) {
    c.textAlign = 'left';
    rest.slice(0, restRows).forEach((r, i) => {
      const yy = y + i * 54;
      c.fillStyle = 'rgba(255,255,255,.07)'; c.beginPath(); c.roundRect(110, yy - 36, W - 220, 46, 23); c.fill();
      c.fillStyle = '#9fb0cc'; c.font = `800 26px ${FONT}`; c.fillText(`${r.rank}º`, 134, yy - 4);
      c.fillStyle = '#fff'; c.font = `700 27px ${FONT}`; c.fillText(ell(c, r.name, 560), 200, yy - 4);
      c.textAlign = 'right'; c.fillStyle = '#ffc93c'; c.fillText(pn(r.goals), W - 134, yy - 4); c.textAlign = 'left';
    });
    c.textAlign = 'center'; y += restRows * 54 + 8;
  }
  const rows = Math.max(0, Math.min(resultRows, Math.floor((limit - y - 62) / 58)));
  if (rows) {
    c.fillStyle = '#4fd68b'; tracking(c, 5); c.font = `800 24px ${FONT}`; c.fillText('PLACAR DAS PARTIDAS', W / 2, y + 22); tracking(c, 0);
    d.results.slice(0, rows).forEach((m, i) => {
      const yy = y + 72 + i * 58;
      c.fillStyle = 'rgba(255,255,255,.09)'; c.beginPath(); c.roundRect(90, yy - 38, W - 180, 50, 25); c.fill();
      c.fillStyle = '#fff'; c.font = `700 25px ${FONT}`; c.textAlign = 'right'; c.fillText(ell(c, m.a, 330), W / 2 - 62, yy - 3);
      c.textAlign = 'left'; c.fillText(ell(c, m.b, 330), W / 2 + 62, yy - 3);
      c.textAlign = 'center'; c.fillStyle = '#ffc93c'; c.font = `800 30px ${FONT}`; c.fillText(`${m.sa} × ${m.sb}`, W / 2, yy - 2);
    });
  }

  // ---- rodapé com QR
  const qs = 150;
  c.fillStyle = '#fff'; c.beginPath(); c.roundRect(70, py, W - 140, ph, 30); c.fill();
  drawQr(c, d.url, 70 + 20, py + 20, qs + 10, { margin: 1 });
  c.textAlign = 'left'; c.fillStyle = '#0a0f1d';
  const head = fit(c, 'Organize a sua pelada!', W - 140 - qs - 90, 42, 28, 1, 800); c.font = `800 ${head.size}px ${FONT}`; c.fillText(head.lines[0], 70 + qs + 56, py + 70);
  c.fillStyle = '#12a150'; c.font = `700 25px ${FONT}`; c.fillText(ell(c, d.url.replace(/^https?:\/\//, ''), W - 140 - qs - 90), 70 + qs + 56, py + 114);
  c.fillStyle = '#6b7a93'; c.font = `600 23px ${FONT}`; c.fillText(`ID ${d.id} · sorteio, presença e artilharia`, 70 + qs + 56, py + 152);
  c.textAlign = 'center';
}

async function renderBlob(d) {
  await ensureFonts();
  const cv = document.createElement('canvas');
  await drawShareImage(cv, d);
  return new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('Não foi possível gerar a imagem.')), 'image/png'));
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.append(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch { return false; }
  }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * mode: 'copy' (copia a imagem; se o navegador não permitir, abre o compartilhamento nativo ou baixa),
 *       'download' (baixa o PNG) e 'text' (copia o texto formatado). Retorna 'copied' | 'shared' | 'downloaded' | 'text' | 'cancel' | 'fail'.
 */
export async function shareResults(d, mode) {
  const text = shareText(d);
  const name = `artilharia-${d.id.toLowerCase()}${d.general ? '-geral' : ''}.png`;
  if (mode === 'text') return (await copyText(text)) ? 'text' : 'fail';
  if (mode === 'download') { download(await renderBlob(d), name); return 'downloaded'; }
  // 'copy': a gravação com Promise mantém o "gesto do usuário" exigido pelo navegador
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': renderBlob(d) })]); return 'copied'; } catch (err) { if (err?.name === 'AbortError') return 'cancel'; }
  }
  const blob = await renderBlob(d);
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); return 'shared'; } catch (err) { if (err?.name === 'AbortError') return 'cancel'; }
  }
  download(blob, name); await copyText(text);
  return 'downloaded';
}
