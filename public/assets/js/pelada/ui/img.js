// Fotos: avatar de jogador (ou iniciais coloridas), foto e capa da pelada.
import { html } from '../../ui/dom.js';
import { hash, initials } from '../../shared/format.js';

export const userImg = (userId, av) => av ? `/pelada-img/u/${encodeURIComponent(userId)}?v=${av}` : '';
export const peladaImg = (id, kind, v) => v ? `/pelada-img/p/${encodeURIComponent(id)}/${kind}?v=${v}` : '';

/** Avatar redondo: foto, ou iniciais com cor derivada do nome. `person` = { name, av, guest } e `pid` = 'u:ID' | 'g:ID'. */
export function avatar(person, pid, { size = 40, cls = '' } = {}) {
  const name = person?.name || '?';
  const url = pid?.startsWith('u:') ? userImg(pid.slice(2), person?.av) : '';
  const style = `width:${size}px;height:${size}px;font-size:${Math.max(10, Math.round(size * 0.36))}px`;
  if (url) return html`<span class="pl-av ${cls}" style="${style}"><img src="${url}" alt="" loading="lazy" decoding="async"></span>`;
  return html`<span class="pl-av ${cls}${person?.guest ? ' guest' : ''}" style="${style};--h:${hash(name) % 360}" aria-hidden="true">${initials(name)}</span>`;
}

export const playerAvatar = (p, size = 40) => avatar({ name: p?.name, av: p?.av }, p ? `u:${p.id}` : '', { size });

/** Foto da pelada (quadrada arredondada) ou bola. */
export function peladaAvatar(pel, size = 56) {
  const url = peladaImg(pel.id, 'avatar', pel.img?.avatar);
  const style = `width:${size}px;height:${size}px`;
  if (url) return html`<span class="pl-pav" style="${style}"><img src="${url}" alt="" loading="lazy" decoding="async"></span>`;
  return html`<span class="pl-pav ph" style="${style};--h:${hash(pel.name || '') % 360}" aria-hidden="true">⚽</span>`;
}
