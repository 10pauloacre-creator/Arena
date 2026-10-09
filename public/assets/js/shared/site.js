// Endereço oficial do site: toda URL mostrada, copiada ou compartilhada usa este domínio (ver CLAUDE.md).
export const SITE_ORIGIN = 'https://partidafacil.click';

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|[^.]+\.localhost)$/i;

/** Em desenvolvimento (localhost) os links continuam apontando para a máquina local, para dar para clicar neles. */
export const isLocalHost = (host = '') => LOCAL.test(String(host).replace(/:\d+$/, ''));

/** Origem a mostrar para o usuário: o domínio oficial (ou o servidor local, só em desenvolvimento). */
export function publicOrigin(loc = globalThis.location) {
  return loc?.hostname && isLocalHost(loc.hostname) ? loc.origin : SITE_ORIGIN;
}

/** Endereço completo a partir de um caminho como "/t/AM-2026-0001". */
export const publicUrl = (path, loc) => new URL(path, publicOrigin(loc)).href;
