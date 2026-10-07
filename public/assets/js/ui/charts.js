// Gráficos SVG simples (sem dependências): linha com área e barras.
import { raw } from './dom.js';

function niceMax(v) {
  if (v <= 0) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}
const fmt = v => (Math.round(v * 10) / 10).toString().replace('.', ',');
let uid = 0;

export function lineChart(data, { height = 260, label = 'Gráfico de linha' } = {}) {
  const W = 600, H = height, pl = 34, pr = 14, pt = 14, pb = 32;
  const max = niceMax(Math.max(...data.map(d => d.value), 0));
  const ticks = 4;
  const x = i => pl + (data.length === 1 ? (W - pl - pr) / 2 : i * (W - pl - pr) / (data.length - 1));
  const y = v => pt + (1 - v / max) * (H - pt - pb);
  const id = 'lg' + (++uid);
  const pts = data.map((d, i) => [x(i), y(d.value)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = line + ` L${pts[pts.length - 1][0].toFixed(1)} ${H - pb} L${pts[0][0].toFixed(1)} ${H - pb} Z`;
  const grid = Array.from({ length: ticks + 1 }, (_, k) => {
    const v = max / ticks * k, yy = y(v);
    return `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}"/><text x="${pl - 8}" y="${yy + 4}" text-anchor="end">${fmt(v)}</text>`;
  }).join('');
  const labels = data.map((d, i) => `<text class="axis-lbl" x="${x(i)}" y="${H - 8}" text-anchor="middle">${d.label}</text>`).join('');
  const dots = pts.map((p, i) => `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="4.5"><title>${data[i].label}: ${data[i].value}</title></circle>`).join('');
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b6dff" stop-opacity=".22"/><stop offset="1" stop-color="#1b6dff" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path d="${area}" fill="url(#${id})"/><path class="line" d="${line}"/>${dots}${labels}</svg>`);
}

export function barChart(data, { height = 260, label = 'Gráfico de barras' } = {}) {
  const W = 600, H = height, pl = 36, pr = 14, pt = 22, pb = 34;
  const max = niceMax(Math.max(...data.map(d => d.value), 0) * 1.05);
  const ticks = 4;
  const slot = (W - pl - pr) / data.length, bw = Math.min(88, slot * .5);
  const y = v => pt + (1 - v / max) * (H - pt - pb);
  const grid = Array.from({ length: ticks + 1 }, (_, k) => {
    const v = max / ticks * k, yy = y(v);
    return `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}"/><text x="${pl - 8}" y="${yy + 4}" text-anchor="end">${fmt(v)}</text>`;
  }).join('');
  const bars = data.map((d, i) => {
    const cx = pl + slot * i + slot / 2, yy = y(d.value);
    return `<rect class="bar ${d.real ? '' : 'proj'}" x="${cx - bw / 2}" y="${yy}" width="${bw}" height="${Math.max(0, H - pb - yy)}" rx="6"><title>${d.label}: ${fmt(d.value)} ${d.real ? '(real)' : '(projeção)'}</title></rect>
      <text class="val" x="${cx}" y="${yy - 6}" text-anchor="middle">${fmt(d.value)}</text>
      <text class="axis-lbl" x="${cx}" y="${H - 10}" text-anchor="middle">${d.label}</text>`;
  }).join('');
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${grid}${bars}</svg>`);
}
