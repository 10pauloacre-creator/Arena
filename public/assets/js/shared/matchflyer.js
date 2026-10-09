// Flyer do confronto: modelo (SVG) com os dois emblemas, a partida e os dados (local, data e hora).
// Função pura — o servidor transforma em PNG para a pré-visualização do link; o navegador usa o mesmo SVG para baixar/compartilhar.

export const FLYER_FORMATS = {
  og: { w: 1200, h: 630, label: 'Pré-visualização do link' },
  feed: { w: 1080, h: 1350, label: 'Feed 4:5' },
  story: { w: 1080, h: 1920, label: 'Stories 9:16' },
};

const FONT = "'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif";
const WEEK = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MONTH = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "2026-11-14T16:30" → "Sábado, 14 de novembro · 16h30"; só a data ("2026-11-14") → sem a hora; inválida → ''. */
export function whenText(when) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(String(when || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1) return '';
  const day = `${WEEK[d.getUTCDay()]}, ${+m[3]} de ${MONTH[+m[2] - 1]}`;
  if (m[4] == null) return day;
  return `${day} · ${m[4]}h${m[5] === '00' ? '' : m[5]}`;
}

/** Local e horário da partida: o que o organizador agendou; a final, sem horário, usa a data da final do torneio. */
export function matchInfo(t, m) {
  const last = t.bracket?.rounds?.length ? t.bracket.rounds.length - 1 : -1;
  const when = m.when || (!m.id && m.r === last ? t.finalDate : '') || '';
  return { when, venue: m.venue || t.venue || '' };
}

function hex(h, s, l) { // HSL → #rrggbb
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
}

const initialsOf = name => {
  const w = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '?') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
};

/** Quebra o texto em até `maxLines` linhas que caibam em `maxW`, reduzindo a fonte até `min` (largura estimada). */
function fit(text, maxW, size, min, maxLines, factor = 0.6) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  for (let s = size; ; s -= 2) {
    const per = Math.max(1, Math.floor(maxW / (s * factor)));
    const lines = []; let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (next.length <= per || !cur) cur = next; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if ((lines.length <= maxLines && lines.every(l => l.length <= per)) || s <= min) {
      const out = lines.slice(0, maxLines).map(l => l.length > per ? l.slice(0, Math.max(1, per - 1)) + '…' : l);
      if (lines.length > maxLines && out.length) out[out.length - 1] = out[out.length - 1].replace(/…?$/, '…');
      return { lines: out, size: s };
    }
  }
}

const text = (x, y, t, { size, weight = 700, fill = '#fff', anchor = 'middle', ls = 0, op = 1 }) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${ls ? ` letter-spacing="${ls}"` : ''}${op < 1 ? ` fill-opacity="${op}"` : ''}>${esc(t)}</text>`;

const LAYOUT = {
  og: { logo: { x: 40, y: 26, w: 210 }, chip: { y: 58 }, head: { y: 140, size: 30, w: 760 }, em: { cy: 300, r: 100, dx: 300 }, vs: 62, name: { y: 452, size: 36, min: 24, w: 420, lines: 2 }, card: { y: 522, h: 84, w: 900 }, foot: null },
  feed: { logo: { x: 390, y: 62, w: 300 }, chip: null, head: { y: 262, size: 44, w: 900 }, em: { cy: 590, r: 140, dx: 300 }, vs: 100, name: { y: 800, size: 54, min: 34, w: 450, lines: 3 }, card: { y: 985, h: 230, w: 900 }, foot: { y: 1296 } },
  story: { logo: { x: 390, y: 150, w: 300 }, chip: null, head: { y: 410, size: 46, w: 900 }, em: { cy: 880, r: 150, dx: 305 }, vs: 110, name: { y: 1100, size: 56, min: 34, w: 450, lines: 3 }, card: { y: 1350, h: 270, w: 900 }, foot: { y: 1800 } },
};

/**
 * data: { tournament, sport, round, a:{name,hue,emblem}, b:{...}, score:{a,b}|null, state:'live'|'done'|null, when, venue, logo }
 * `emblem` e `logo` são data URLs (o SVG precisa ser autossuficiente para virar PNG).
 */
export function matchFlyerSvg(data, format = 'og') {
  const F = FLYER_FORMATS[format] || FLYER_FORMATS.og, L = LAYOUT[FLYER_FORMATS[format] ? format : 'og'];
  const { w: W, h: H } = F;
  const cx = W / 2, xa = cx - L.em.dx, xb = cx + L.em.dx, cy = L.em.cy, r = L.em.r;
  const hueA = data.a?.hue ?? 220, hueB = data.b?.hue ?? 20;
  const wide = format === 'og';
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  out.push(`<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1535"/><stop offset="1" stop-color="#04070f"/></linearGradient>
<radialGradient id="ga" cx="${xa}" cy="${cy}" r="${Math.round(W * 0.62)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${hex(hueA, 80, 50)}" stop-opacity="0.55"/><stop offset="1" stop-color="${hex(hueA, 80, 50)}" stop-opacity="0"/></radialGradient>
<radialGradient id="gb" cx="${xb}" cy="${cy}" r="${Math.round(W * 0.62)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${hex(hueB, 80, 50)}" stop-opacity="0.55"/><stop offset="1" stop-color="${hex(hueB, 80, 50)}" stop-opacity="0"/></radialGradient>
<linearGradient id="acc" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1b6dff"/><stop offset="1" stop-color="#4a94ff"/></linearGradient>
<clipPath id="ca"><circle cx="${xa}" cy="${cy}" r="${r - 6}"/></clipPath><clipPath id="cb"><circle cx="${xb}" cy="${cy}" r="${r - 6}"/></clipPath>
</defs>`);
  out.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#ga)"/><rect width="${W}" height="${H}" fill="url(#gb)"/>`);
  out.push(`<polygon points="${Math.round(W * 0.38)},0 ${Math.round(W * 0.55)},0 ${Math.round(W * 0.22)},${H} ${Math.round(W * 0.05)},${H}" fill="#fff" fill-opacity="0.035"/>`);
  out.push(`<polygon points="${Math.round(W * 0.8)},0 ${Math.round(W * 0.88)},0 ${Math.round(W * 0.62)},${H} ${Math.round(W * 0.54)},${H}" fill="#fff" fill-opacity="0.03"/>`);
  out.push(`<rect y="${H - 10}" width="${W}" height="10" fill="url(#acc)"/>`);

  // marca
  const lw = L.logo.w, lh = Math.round(lw / 3);
  if (data.logo) out.push(`<rect x="${L.logo.x - 14}" y="${L.logo.y - 8}" width="${lw + 28}" height="${lh + 16}" rx="${Math.round(lh / 3)}" fill="#fff"/><image x="${L.logo.x}" y="${L.logo.y}" width="${lw}" height="${lh}" preserveAspectRatio="xMidYMid meet" href="${esc(data.logo)}"/>`);
  else out.push(text(L.logo.x + lw / 2, L.logo.y + lh * 0.7, 'ArenaMaster AI', { size: Math.round(lh * 0.5), weight: 800 }));
  if (L.chip && data.sport) {
    const c = String(data.sport).toUpperCase(), cw = Math.round(c.length * 17 + 56);
    out.push(`<rect x="${W - 40 - cw}" y="${L.chip.y - 32}" width="${cw}" height="52" rx="26" fill="#fff" fill-opacity="0.12"/>${text(W - 40 - cw / 2, L.chip.y + 4, c, { size: 24, weight: 800, ls: 2 })}`);
  }

  // campeonato e fase
  const head = fit(data.tournament, L.head.w, L.head.size, 26, 2, 0.58);
  head.lines.forEach((l, i) => out.push(text(cx, L.head.y + i * (head.size + 8), l.toUpperCase(), { size: head.size, weight: 800, ls: 2 })));
  let ry = L.head.y + (head.lines.length - 1) * (head.size + 8) + (wide ? 44 : 56);
  const roundLine = [data.round, !wide && data.sport ? data.sport : null].filter(Boolean).join(' · ');
  if (roundLine) out.push(text(cx, ry, roundLine, { size: wide ? 26 : 34, weight: 700, fill: '#7db3ff', ls: 1 }));

  // times
  const side = (team, x, cid) => {
    const g = [`<circle cx="${x}" cy="${cy}" r="${r + 10}" fill="#fff" fill-opacity="0.10"/><circle cx="${x}" cy="${cy}" r="${r}" fill="${team?.emblem ? '#fff' : hex(team?.hue ?? 220, 62, 42)}"/>`];
    if (team?.emblem) g.push(`<image x="${x - r + 6}" y="${cy - r + 6}" width="${(r - 6) * 2}" height="${(r - 6) * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${cid})" href="${esc(team.emblem)}"/>`);
    else g.push(text(x, cy + Math.round(r * 0.3), initialsOf(team?.name), { size: Math.round(r * 0.9), weight: 800 }));
    g.push(`<circle cx="${x}" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-width="6" stroke-opacity="0.9"/>`);
    const n = fit(team?.name || 'A definir', L.name.w, L.name.size, L.name.min, L.name.lines, 0.6);
    n.lines.forEach((l, i) => g.push(text(x, L.name.y + i * (n.size + 6), l, { size: n.size, weight: 800 })));
    return g.join('');
  };
  out.push(side(data.a, xa, 'ca'), side(data.b, xb, 'cb'));

  // centro: placar (ao vivo / encerrada) ou "VS"
  if (data.score && data.a && data.b) {
    out.push(text(cx, cy + Math.round(L.vs * 0.34), `${data.score.a} × ${data.score.b}`, { size: Math.round(L.vs * 1.15), weight: 800 }));
    if (data.state) {
      const live = data.state === 'live', label = live ? 'AO VIVO' : 'ENCERRADA', sw = label.length * 17 + 52, sy = cy + Math.round(L.vs * 0.34) + (wide ? 36 : 60);
      out.push(`<rect x="${cx - sw / 2}" y="${sy - 28}" width="${sw}" height="44" rx="22" fill="${live ? '#e5322d' : '#fff'}" fill-opacity="${live ? 1 : 0.16}"/>${text(cx, sy + 3, label, { size: 22, weight: 800, ls: 2 })}`);
    }
  } else {
    out.push(`<circle cx="${cx}" cy="${cy}" r="${Math.round(L.vs * 0.78)}" fill="#fff" fill-opacity="0.08"/>${text(cx, cy + Math.round(L.vs * 0.35), 'VS', { size: L.vs, weight: 800, fill: '#fff' })}`);
  }

  // cartão com data/hora e local
  const info = [];
  const when = whenText(data.when);
  if (when) info.push(['DATA E HORÁRIO', when]);
  if (data.venue) info.push(['LOCAL', data.venue]);
  if (info.length) {
    const cw = L.card.w, x0 = cx - cw / 2;
    out.push(`<rect x="${x0}" y="${L.card.y}" width="${cw}" height="${L.card.h}" rx="${wide ? 24 : 36}" fill="#fff" fill-opacity="0.10" stroke="#fff" stroke-opacity="0.18" stroke-width="2"/>`);
    if (wide) {
      const line = info.map(i => i[1]).join('   •   ');
      const f = fit(line, cw - 60, 30, 20, 1, 0.56);
      out.push(text(cx, L.card.y + L.card.h / 2 + f.size * 0.35, f.lines[0], { size: f.size, weight: 800 }));
    } else {
      const rows = info.length, rh = L.card.h / rows;
      info.forEach(([k, v], i) => {
        const top = L.card.y + i * rh, f = fit(v, cw - 80, i === 0 ? 50 : 42, 26, 1, 0.56);
        out.push(text(cx, top + rh * 0.34, k, { size: 22, weight: 800, fill: '#7db3ff', ls: 4 }));
        out.push(text(cx, top + rh * 0.34 + f.size + 14, f.lines[0], { size: f.size, weight: 800 }));
        if (i < rows - 1) out.push(`<rect x="${x0 + 60}" y="${top + rh - 1}" width="${cw - 120}" height="2" fill="#fff" fill-opacity="0.14"/>`);
      });
    }
  }
  if (L.foot) out.push(text(cx, L.foot.y, 'Acompanhe esta partida no ArenaMaster AI', { size: 28, weight: 700, fill: '#fff', op: 0.7 }));
  out.push('</svg>');
  return out.join('\n');
}
