// Utilitários de apresentação compartilhados entre administrador e visitante.
import { html, ic, raw } from './dom.js';
import { SPORTS } from '../shared/sports.js';
import { initials } from '../shared/format.js';
import { ICON_PATHS } from '../icons.js';

export const sportIcon = key => SPORTS[key]?.icon || 'trophy';

export function emblem(team, cls = '') {
  if (!team) return html`<span class="emb tbd ${cls}">?</span>`;
  if (team.emblemUrl) return html`<span class="emb ${cls}"><img src="${team.emblemUrl}" alt="" loading="lazy"></span>`;
  return html`<span class="emb ${cls}" style="--h:${team.hue ?? 215}">${initials(team.name)}</span>`;
}

export const STATUS_CLASS = { inscricoes: 'info', encerradas: 'warn', chaveamento: 'info', andamento: 'ok', finalizado: 'dark' };
export const STATUS_ICON = { inscricoes: 'door-open', encerradas: 'door-closed', chaveamento: 'network', andamento: 'zap', finalizado: 'trophy' };
export const statusBadge = (status, label) => html`<span class="badge ${STATUS_CLASS[status] || ''}">${ic(STATUS_ICON[status] || 'info', { size: 14 })} ${label}</span>`;

export const TEAM_STATUS = {
  confirmed: ['Confirmado', 'ok'], pending_payment: ['Aguardando pagamento', 'warn'], expired: ['Reserva expirada', 'bad'], cancelled: ['Cancelado', 'bad'],
};

export const PAY_METHOD = { pix: 'PIX', card: 'Cartão', manual: 'Manual', free: 'Gratuita', demo: 'Demo' };

/** Hero decorativo (listras + bola), em SVG inline. */
export function heroArt(sport) {
  const glyph = { futebol: 'soccer', futsal: 'soccer', volei: 'volleyball', basquete: 'basketball' }[sport] || 'soccer';
  return html`<div class="hero-art" aria-hidden="true">
    <svg viewBox="0 0 600 400" fill="none" preserveAspectRatio="xMaxYMid slice">
      <polygon points="430,0 520,0 380,400 290,400" fill="#fff" fill-opacity=".10"/>
      <polygon points="540,0 575,0 435,400 400,400" fill="#fff" fill-opacity=".07"/>
      <circle cx="470" cy="250" r="150" fill="#1b6dff" fill-opacity=".18"/>
      <g transform="translate(350 120) scale(10)" stroke="#fff" stroke-opacity=".22" stroke-width=".35" stroke-linecap="round" stroke-linejoin="round">${raw(ballPaths(glyph))}</g>
    </svg></div>`;
}
const ballPaths = glyph => ICON_PATHS[glyph] || '';

export function relTime(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'agora há pouco';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

export const eventIcon = { goal: 'goal', foul: 'hand-heart', sub: 'refresh-cw', timeout: 'timer', tech: 'triangle-alert', start: 'play', end: 'flag', info: 'info' };

/** Player embutido da transmissão (YouTube/Twitch) com os domínios permitidos pelo CSP. */
export function streamEmbedHTML(stream) {
  if (!stream) return '';
  const src = stream.platform === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(stream.id)}?rel=0`
    : `https://player.twitch.tv/?channel=${encodeURIComponent(stream.id)}&parent=${encodeURIComponent(location.hostname)}&autoplay=false`;
  return html`<div class="stream-frame"><iframe src="${src}" title="Transmissão ao vivo (${stream.label})" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
}
