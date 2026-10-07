// Gerador de flyer em canvas (feed, stories, quadrado, capa) com QR Code do link do torneio.
import { drawQr } from './qr.js';
import { initials, fmtBRL, fmtDay, parseDay } from '../shared/format.js';

export const FORMATS = {
  feed: { w: 1080, h: 1350, label: 'Feed 4:5', hint: 'Instagram / Facebook' },
  story: { w: 1080, h: 1920, label: 'Stories 9:16', hint: 'Stories · Reels · Status' },
  square: { w: 1080, h: 1080, label: 'Quadrado', hint: 'WhatsApp · Telegram' },
  wide: { w: 1600, h: 900, label: 'Capa 16:9', hint: 'X · LinkedIn · Capa' },
};
export const THEMES = {
  azul: { label: 'Azul', bg1: '#0a1a3d', bg2: '#06102a', accent: '#4a94ff', accent2: '#1b6dff', swatch: 'linear-gradient(135deg,#4a94ff,#0d2a66)' },
  noite: { label: 'Noite', bg1: '#151a26', bg2: '#05070d', accent: '#35d07f', accent2: '#12a150', swatch: 'linear-gradient(135deg,#35d07f,#151a26)' },
  ouro: { label: 'Ouro', bg1: '#3a1d00', bg2: '#140a00', accent: '#ffb938', accent2: '#ff8a00', swatch: 'linear-gradient(135deg,#ffb938,#6b3400)' },
};
const FONT = '"Plus Jakarta Sans", system-ui, sans-serif';

export async function ensureFonts() {
  try { await Promise.all(['500 20px', '600 20px', '700 20px', '800 20px'].map(f => document.fonts.load(`${f} "Plus Jakarta Sans"`))); } catch { /* usa fallback */ }
}

const pad = n => String(n).padStart(2, '0');
export function deadlineText(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function dateShort(iso) {
  const d = parseDay(iso);
  if (!d) return 'DATA A DEFINIR';
  const parts = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).formatToParts(d);
  const g = t => (parts.find(p => p.type === t)?.value || '').replace('.', '');
  return `${g('weekday')} · ${g('day')} ${g('month')} ${g('year')}`.toUpperCase();
}

/** Dados do flyer a partir do torneio (visão pública ou do admin). */
export function flyerData(t, url) {
  const teams = new Map((t.teams || []).map(x => [x.id, x]));
  let fin = null;
  if (t.champion) fin = { mode: 'champion', label: 'CAMPEÃO', teams: [teams.get(t.champion)] };
  else if (t.bracket) {
    const last = t.bracket.rounds[t.bracket.rounds.length - 1].matches[0];
    if (last?.a && last?.b) fin = { mode: 'final', label: 'GRANDE FINAL', teams: [teams.get(last.a), teams.get(last.b)] };
  }
  const open = t.registration?.open;
  return {
    name: t.name, sportLabel: t.sportLabel, sport: t.sport, type: t.type, id: t.id, url,
    dateText: dateShort(t.finalDate), finalDay: fmtDay(t.finalDate),
    open, deadline: t.regDeadline ? deadlineText(t.regDeadline) : '', fee: t.fee, slotsLeft: t.registration?.slotsLeft ?? 0, maxTeams: t.maxTeams,
    confirmed: t.teamsConfirmed, fin, venue: t.venue,
  };
}

function fit(c, text, maxW, size, min, maxLines, weight = 800) {
  let s = size;
  for (;;) {
    c.font = `${weight} ${s}px ${FONT}`;
    const lines = []; let cur = '';
    text.split(/\s+/).forEach(w => { const t = cur ? cur + ' ' + w : w; if (c.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } });
    if (cur) lines.push(cur);
    if ((lines.length <= maxLines && lines.every(l => c.measureText(l).width <= maxW)) || s <= min) return { lines: lines.slice(0, maxLines), size: s };
    s -= 4;
  }
}
function spacing(c, px) { if ('letterSpacing' in c) c.letterSpacing = px + 'px'; }
function glow(c, x, y, r, color, a) { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)'); c.save(); c.globalAlpha = a; c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.restore(); }

function emblem(c, team, x, y, r, th, u) {
  const hue = team?.hue ?? 215;
  const g = c.createRadialGradient(x - r * .3, y - r * .35, r * .1, x, y, r);
  g.addColorStop(0, `hsl(${hue} 85% 58%)`); g.addColorStop(1, `hsl(${hue} 75% 30%)`);
  c.save(); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  c.lineWidth = 6 * u; c.strokeStyle = th.accent; c.beginPath(); c.arc(x, y, r + 8 * u, 0, 7); c.stroke();
  c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `800 ${r * .78}px ${FONT}`; c.fillText(initials(team?.name || '?'), x, y + r * .04); c.restore();
}

function ballMotif(c, sport, x, y, r, color) {
  c.save(); c.strokeStyle = color; c.lineWidth = r * .035; c.lineJoin = 'round'; c.lineCap = 'round';
  c.beginPath(); c.arc(x, y, r, 0, 7); c.stroke();
  if (sport === 'basquete') { c.beginPath(); c.moveTo(x, y - r); c.lineTo(x, y + r); c.moveTo(x - r, y); c.lineTo(x + r, y); c.stroke(); c.beginPath(); c.arc(x - r * 1.05, y, r * .72, -1.0, 1.0); c.stroke(); c.beginPath(); c.arc(x + r * 1.05, y, r * .72, Math.PI - 1.0, Math.PI + 1.0); c.stroke(); }
  else if (sport === 'volei') { for (let k = 0; k < 3; k++) { c.beginPath(); c.arc(x + Math.cos(k * 2.094) * r * .9, y + Math.sin(k * 2.094) * r * .9, r * .85, k * 2.094 + 1.9, k * 2.094 + 4.3); c.stroke(); } }
  else {
    c.beginPath(); for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * 2 * Math.PI / 5; const px = x + Math.cos(a) * r * .34, py = y + Math.sin(a) * r * .34; k ? c.lineTo(px, py) : c.moveTo(px, py); } c.closePath(); c.stroke();
    for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * 2 * Math.PI / 5; c.beginPath(); c.moveTo(x + Math.cos(a) * r * .34, y + Math.sin(a) * r * .34); c.lineTo(x + Math.cos(a) * r * .98, y + Math.sin(a) * r * .98); c.stroke(); }
  }
  c.restore();
}

function pill(c, text, cx, y, u, th, { size = 38, weight = 700 } = {}) {
  c.font = `${weight} ${size * u}px ${FONT}`;
  const w = c.measureText(text).width + 64 * u, h = (size + 36) * u;
  c.save(); c.fillStyle = 'rgba(255,255,255,.08)'; c.strokeStyle = th.accent; c.lineWidth = 3 * u;
  c.beginPath(); c.roundRect(cx - w / 2, y, w, h, h / 2); c.fill(); c.stroke();
  c.fillStyle = th.accent; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, cx, y + h / 2 + 2 * u); c.restore();
  return h;
}

export function drawFlyer(cv, fmt, d, themeKey = 'azul') {
  const F = FORMATS[fmt], w = F.w, h = F.h, th = THEMES[themeKey] || THEMES.azul;
  if (cv.width !== w) cv.width = w; if (cv.height !== h) cv.height = h;
  const c = cv.getContext('2d'); c.clearRect(0, 0, w, h); c.textBaseline = 'alphabetic'; c.textAlign = 'center'; spacing(c, 0);
  const wide = fmt === 'wide', u = wide ? h / 1080 : Math.min(w / 1080, h / 1350);

  // fundo
  const bg = c.createLinearGradient(0, 0, w * .7, h); bg.addColorStop(0, th.bg1); bg.addColorStop(1, th.bg2); c.fillStyle = bg; c.fillRect(0, 0, w, h);
  glow(c, w * .1, h * .05, Math.max(w, h) * .6, th.accent2, .35); glow(c, w * .95, h * .92, Math.max(w, h) * .55, th.accent, .22);
  c.save(); c.fillStyle = '#fff'; c.globalAlpha = .06;
  [[.62, .17], [.84, .08]].forEach(([x0, wd]) => { c.beginPath(); c.moveTo(w * x0, 0); c.lineTo(w * (x0 + wd), 0); c.lineTo(w * (x0 + wd - .3), h); c.lineTo(w * (x0 - .3), h); c.closePath(); c.fill(); });
  c.restore();
  ballMotif(c, d.sport, wide ? w * .73 : w * .5, wide ? h * .5 : h * .56, (wide ? h : w) * (wide ? .46 : .5), 'rgba(255,255,255,.07)');

  const cx = wide ? w * .28 : w / 2, colW = wide ? w * .46 : w * .84, top = h * (wide ? .12 : .065);
  // marca + tipo
  spacing(c, 6 * u); c.fillStyle = th.accent; c.font = `800 ${28 * u}px ${FONT}`; c.fillText('ARENAMASTER AI', cx, top);
  spacing(c, 3 * u); c.fillStyle = '#9fb0cc'; c.font = `600 ${25 * u}px ${FONT}`; c.fillText(`${d.type === 'oficial' ? 'TORNEIO OFICIAL' : 'TORNEIO AMADOR'} · ${d.sportLabel.toUpperCase()}`, cx, top + 44 * u); spacing(c, 0);
  // título
  const t = fit(c, d.name.toUpperCase(), colW, (wide ? 104 : 92) * u, 46 * u, 3);
  c.font = `800 ${t.size}px ${FONT}`; c.fillStyle = '#fff';
  let y = top + 44 * u + 40 * u + t.size * .85; spacing(c, -1 * u);
  t.lines.forEach(l => { c.fillText(l, cx, y); y += t.size * 1.06; }); spacing(c, 0);
  y += 4 * u;
  y += pill(c, `FINAL · ${d.dateText.replace(/^[^·]*· /, '')}`, cx, y, u, th) + 10 * u;
  if (d.venue) { c.fillStyle = '#c4d2ea'; c.font = `500 ${30 * u}px ${FONT}`; c.fillText('📍 ' + d.venue.slice(0, 48), cx, y + 36 * u); }

  // bloco central
  const bx = wide ? w * .73 : w / 2, by = wide ? h * .30 : Math.max(y + 110 * u, h * (fmt === 'story' ? .5 : .56)), R = 96 * u;
  c.textAlign = 'center';
  const label = (txt, yy) => { spacing(c, 6 * u); c.fillStyle = th.accent; c.font = `800 ${32 * u}px ${FONT}`; c.fillText(txt, bx, yy); spacing(c, 0); };
  if (d.fin?.mode === 'champion') {
    label('CAMPEÃO', by);
    emblem(c, d.fin.teams[0], bx, by + 40 * u + R * 1.15, R * 1.15, th, u);
    const fl = fit(c, d.fin.teams[0].name.toUpperCase(), colW * .9, 62 * u, 30 * u, 2);
    c.fillStyle = '#fff'; c.font = `800 ${fl.size}px ${FONT}`; fl.lines.forEach((l, i) => c.fillText(l, bx, by + 40 * u + R * 2.3 + 80 * u + i * fl.size * 1.08));
  } else if (d.fin?.mode === 'final') {
    label('GRANDE FINAL', by);
    const dx = 235 * u, cy = by + 40 * u + R;
    emblem(c, d.fin.teams[0], bx - dx, cy, R, th, u); emblem(c, d.fin.teams[1], bx + dx, cy, R, th, u);
    c.fillStyle = th.accent; c.font = `800 ${70 * u}px ${FONT}`; c.textBaseline = 'middle'; c.fillText('VS', bx, cy + 4 * u); c.textBaseline = 'alphabetic';
    d.fin.teams.forEach((tm, i) => { const fl = fit(c, tm.name.toUpperCase(), 420 * u, 34 * u, 20 * u, 2, 700); c.fillStyle = '#fff'; c.font = `700 ${fl.size}px ${FONT}`; fl.lines.forEach((l, k) => c.fillText(l, bx + (i ? dx : -dx), cy + R + 58 * u + k * fl.size * 1.1)); });
  } else {
    label(d.open ? 'INSCRIÇÕES ABERTAS' : 'INSCRIÇÕES ENCERRADAS', by);
    const lines = d.open
      ? [d.deadline ? `Até ${d.deadline}` : 'Garanta sua vaga', d.fee ? `${fmtBRL(d.fee)} por time` : 'Inscrição gratuita', `${d.slotsLeft} de ${d.maxTeams} vagas`]
      : [`${d.confirmed} times confirmados`, 'Acompanhe jogos e chaveamento'];
    c.fillStyle = '#fff';
    lines.forEach((l, i) => { c.font = `${i === 0 ? 800 : 600} ${(i === 0 ? 62 : 44) * u}px ${FONT}`; c.fillText(l, bx, by + 84 * u + i * 66 * u); });
  }

  // rodapé com QR
  const qs = (wide ? 250 : 230) * u, pw = wide ? w * .46 : w * .84, ph = qs + 40 * u, px = wide ? w * .73 - pw / 2 : (w - pw) / 2, py = wide ? h - ph - 70 * u : h - ph - h * .045;
  c.save(); c.fillStyle = '#fff'; c.beginPath(); c.roundRect(px, py, pw, ph, 28 * u); c.fill(); c.restore();
  drawQr(c, d.url, px + 20 * u, py + 20 * u, qs, { margin: 1 });
  const tx = px + qs + 56 * u, tw = pw - qs - 84 * u;
  c.textAlign = 'left'; c.fillStyle = '#0a0f1d';
  const head = fit(c, 'Inscreva seu time e acompanhe os jogos ao vivo', tw, 40 * u, 26 * u, 3, 800);
  c.font = `800 ${head.size}px ${FONT}`; head.lines.forEach((l, i) => c.fillText(l, tx, py + 70 * u + i * head.size * 1.15));
  const short = d.url.replace(/^https?:\/\//, '');
  const sf = fit(c, short, tw, 26 * u, 14 * u, 1, 700); c.font = `700 ${sf.size}px ${FONT}`; c.fillStyle = th.accent2; c.fillText(sf.lines[0], tx, py + ph - 62 * u);
  c.fillStyle = '#6b7a93'; c.font = `600 ${24 * u}px ${FONT}`; c.fillText(`ID #${d.id}`, tx, py + ph - 26 * u);
  c.textAlign = 'center';
}

export function captionText(d) {
  const lines = [`🏆 ${d.name} · ${d.sportLabel}`, `📅 Final: ${d.finalDay}`];
  if (d.fin?.mode === 'champion') lines.push(`👑 Campeão: ${d.fin.teams[0].name}`);
  else if (d.fin?.mode === 'final') lines.push(`🔥 Grande final: ${d.fin.teams[0].name} x ${d.fin.teams[1].name}`);
  else if (d.open) lines.push(`📝 Inscrições até ${d.deadline || 'as vagas acabarem'} · ${d.fee ? fmtBRL(d.fee) + ' por time' : 'gratuitas'} · ${d.slotsLeft} vagas`);
  if (d.venue) lines.push(`📍 ${d.venue}`);
  lines.push('', `🔗 ${d.url}`, `ID do torneio: #${d.id}`, '', `#ArenaMasterAI #Torneio #${d.sportLabel.replace(/\s/g, '')}`);
  return lines.join('\n');
}
