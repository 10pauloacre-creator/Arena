// Catálogo de identidades dos times do Pelada: nomes (masculinos para peladas masculinas, femininos para as femininas) e emblemas.
// O time é "Time 2 - Leões": número + nome do catálogo. O emblema é um escudo SVG gerado (forma + cores + símbolo), sem arquivos.
// O time mantém nome e emblema mesmo quando troca de jogadores; um time novo (formado pela Cerca) ganha identidade nova.

// [nome, símbolo do emblema]
export const TEAM_NAMES = {
  masculino: [
    ['Leões', 'crown'], ['Tigres', 'paw'], ['Falcões', 'wing'], ['Tubarões', 'fin'], ['Lobos', 'moon'], ['Touros', 'bolt'], ['Dragões', 'flame'],
    ['Gaviões', 'wing'], ['Corvos', 'moon'], ['Jaguares', 'paw'], ['Gladiadores', 'shield'], ['Titãs', 'mountain'], ['Vikings', 'shield'],
    ['Piratas', 'wave'], ['Trovões', 'bolt'], ['Furacões', 'wave'], ['Relâmpagos', 'bolt'], ['Cometas', 'star'], ['Guerreiros', 'shield'],
    ['Espartanos', 'shield'], ['Centuriões', 'shield'], ['Mustangs', 'paw'], ['Escorpiões', 'diamond'], ['Rinocerontes', 'mountain'],
    ['Cavaleiros', 'crown'], ['Samurais', 'sun'], ['Bravos', 'heart'], ['Raios', 'bolt'], ['Vulcões', 'flame'], ['Tsunamis', 'wave'],
    ['Meteoros', 'star'], ['Fantasmas', 'moon'], ['Reis', 'crown'], ['Imperadores', 'crown'], ['Bandeirantes', 'sun'], ['Tucanos', 'leaf'],
    ['Gigantes', 'mountain'], ['Colossos', 'mountain'], ['Foguetes', 'flame'], ['Ases', 'diamond'], ['Campeões', 'star'], ['Invictos', 'shield'],
    ['Pitbulls', 'paw'], ['Cangaceiros', 'sun'], ['Alquimistas', 'diamond'], ['Ventos', 'wave'], ['Canários', 'leaf'], ['Lutadores', 'heart'],
  ],
  feminino: [
    ['Panteras', 'paw'], ['Leoas', 'crown'], ['Águias', 'wing'], ['Tigresas', 'paw'], ['Onças', 'paw'], ['Raposas', 'flame'], ['Fênix', 'flame'],
    ['Valquírias', 'wing'], ['Amazonas', 'shield'], ['Estrelas', 'star'], ['Guerreiras', 'shield'], ['Fúrias', 'bolt'], ['Cobras', 'wave'],
    ['Gazelas', 'leaf'], ['Lobas', 'moon'], ['Corujas', 'moon'], ['Libélulas', 'wing'], ['Fadas', 'star'], ['Sereias', 'wave'], ['Rainhas', 'crown'],
    ['Imperatrizes', 'crown'], ['Flechas', 'bolt'], ['Faíscas', 'bolt'], ['Tempestades', 'wave'], ['Chamas', 'flame'], ['Ondas', 'wave'],
    ['Brisas', 'leaf'], ['Heroínas', 'heart'], ['Musas', 'heart'], ['Pérolas', 'diamond'], ['Safiras', 'diamond'], ['Esmeraldas', 'diamond'],
    ['Jaguatiricas', 'paw'], ['Araras', 'wing'], ['Borboletas', 'wing'], ['Vespas', 'bolt'], ['Tormentas', 'wave'], ['Guardiãs', 'shield'],
    ['Destemidas', 'heart'], ['Invencíveis', 'shield'], ['Imbatíveis', 'star'], ['Lendárias', 'crown'], ['Aventureiras', 'sun'], ['Ciganas', 'moon'],
    ['Constelações', 'star'], ['Estrelas-d’Alva', 'sun'], ['Montanhesas', 'mountain'], ['Campeãs', 'star'],
  ],
};

// símbolos (viewBox 24×24, brancos)
const GLYPHS = {
  star: '<path d="M12 3.500l2.600 5.600 6.100.700-4.500 4.200 1.200 6-5.400-3-5.400 3 1.200-6-4.500-4.200 6.100-.700z"/>',
  bolt: '<path d="M13.500 2L5 13.500h6L10 22l9-12h-6.300z"/>',
  crown: '<path d="M3.500 8l4.500 4 4-7 4 7 4.500-4-1.500 11h-14z"/>',
  flame: '<path d="M12 2c.8 3.500-1.400 5-3 7-1.300 1.600-2 3-2 5a5 5 0 0 0 10 0c0-2.200-1-3.600-2.200-5 .2 1.800-.6 2.800-1.600 3.200C14.200 9 13 5.500 12 2z"/>',
  wave: '<path d="M2 11c2-4 4-4 6 0s4 4 6 0 4-4 6 0v5c-2-4-4-4-6 0s-4 4-6 0-4-4-6 0z"/>',
  wing: '<path d="M3 17c4-1 7-4 9-10 1 3 3 5 9 6-3 1-4 3-5 5-2-2-5-3-13-1z"/>',
  paw: '<ellipse cx="12" cy="16" rx="4.500" ry="3.800"/><circle cx="6.500" cy="11" r="2"/><circle cx="10" cy="7.500" r="2"/><circle cx="14" cy="7.500" r="2"/><circle cx="17.500" cy="11" r="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.500v3M12 18.500v3M2.500 12h3M18.500 12h3M5.300 5.300l2.100 2.100M16.600 16.600l2.100 2.100M18.700 5.300l-2.100 2.100M7.400 16.600l-2.100 2.100" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/>',
  moon: '<path d="M20 14.500A8.500 8.500 0 1 1 9.500 4a7 7 0 0 0 10.500 10.500z"/>',
  mountain: '<path d="M2 19l7-12 4 6 2.500-4L22 19z"/>',
  leaf: '<path d="M5 19C5 10 10 5 20 4c0 9-4 15-13 15z"/>',
  diamond: '<path d="M12 2.500l8 9.500-8 9.500-8-9.500z"/>',
  heart: '<path d="M12 20.500C5 15 3 11.500 3 8.500A4.500 4.500 0 0 1 12 7a4.500 4.500 0 0 1 9 1.500c0 3-2 6.500-9 12z"/>',
  fin: '<path d="M3 19c5 0 9-3 10-14 3 4 6 9 8 14z"/>',
  shield: '<path d="M12 4l6 2.300v5.200c0 3.500-2.500 6.200-6 7.500-3.500-1.300-6-4-6-7.500V6.300z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M12 8.500v7M9 11h6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
};
export const GLYPH_KEYS = Object.keys(GLYPHS);

export const PALETTES = [
  ['#0a8f4a', '#065f46'], ['#1d4ed8', '#1e3a8a'], ['#d62839', '#8f1d2c'], ['#d97706', '#92400e'], ['#7c3aed', '#4c1d95'], ['#0284c7', '#0c4a6e'],
  ['#1f2937', '#0b1220'], ['#db2777', '#831843'], ['#16a34a', '#14532d'], ['#ea580c', '#9a3412'], ['#0d9488', '#115e59'], ['#4d7c0f', '#365314'],
];
const SHAPES = ['shield', 'round', 'hex', 'diamond'];
const SHAPE_PATH = {
  shield: 'M12 1.500L21.500 5v7.500c0 5-4 8.500-9.500 10C6.500 21 2.500 17.500 2.500 12.500V5z',
  round: 'M12 1.500a10.500 10.500 0 1 0 0 21 10.500 10.500 0 0 0 0-21z',
  hex: 'M12 1.500l9 5.250v10.500L12 22.500l-9-5.250V6.750z',
  diamond: 'M12 1l10 11-10 11L2 12z',
};

const hashStr = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const listOf = gender => TEAM_NAMES[gender === 'feminino' ? 'feminino' : 'masculino'];

/**
 * Identidade de um time novo: nome do catálogo ainda não usado e emblema (símbolo do nome + paleta/forma ainda não usadas).
 * `used` = times já existentes ({ name, emb }). Retorna { name, emb: { g, p, s } }.
 */
export function newIdentity(used, gender, rnd = Math.random) {
  const list = listOf(gender);
  const names = new Set(used.map(t => t.name).filter(Boolean));
  const free = list.filter(([n]) => !names.has(n));
  const pool = free.length ? free : list;
  const [name, g] = pool[Math.floor(rnd() * pool.length)];
  const pals = new Set(used.map(t => t.emb?.p).filter(x => x != null));
  const freePal = PALETTES.map((_, i) => i).filter(i => !pals.has(i));
  const palPool = freePal.length ? freePal : PALETTES.map((_, i) => i);
  const p = palPool[Math.floor(rnd() * palPool.length)];
  const s = Math.floor(rnd() * SHAPES.length);
  return { name: free.length ? name : `${name} ${used.length + 1}`, emb: { g, p, s } };
}

/** Identidade estável para times antigos (criados antes do catálogo): sempre a mesma para o mesmo `seed`. */
export function fallbackIdentity(seed, gender, skip = []) {
  const list = listOf(gender);
  let i = hashStr(seed) % list.length;
  for (let k = 0; k < list.length && skip.includes(list[i][0]); k++) i = (i + 1) % list.length;
  const h = hashStr(seed + ':emb');
  return { name: list[i][0], emb: { g: list[i][1], p: h % PALETTES.length, s: (h >>> 8) % SHAPES.length } };
}

/** Identidade do time (a salva, ou a estável de reserva). */
export const identityOf = (team, seed, gender) => (team?.name && team.emb ? { name: team.name, emb: team.emb } : fallbackIdentity(`${seed}:${team?.id}`, gender));

/** "Time 2 - Leões". */
export const teamLabel = (team, seed = '', gender = 'masculino') => `Time ${team.number} - ${identityOf(team, seed, gender).name}`;

/** Escudo em SVG (string pronta para inserir na página). */
export function emblemSvg(emb, size = 40) {
  const e = emb || { g: 'star', p: 0, s: 0 };
  const [c1, c2] = PALETTES[e.p % PALETTES.length];
  const id = `em${e.p}${e.s}`;
  return `<svg class="emblem" width="${size}" height="${size}" viewBox="0 0 24 24" role="img" aria-label="Emblema" focusable="false"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>`
    + `<path d="${SHAPE_PATH[SHAPES[e.s % SHAPES.length]]}" fill="url(#${id})" stroke="#fff" stroke-width="1.100" stroke-linejoin="round"/><g fill="#fff" transform="translate(5.700 5.700) scale(.525)">${GLYPHS[e.g] || GLYPHS.star}</g></svg>`;
}
