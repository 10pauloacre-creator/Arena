// Pelada de demonstração: um dia de jogo (hoje) com 17 jogadores já confirmados, cada um com nome (2 palavras) e foto de perfil.
//
// O elenco é gerado em código: os jogadores "demo" não são gravados no banco e não conseguem entrar (não têm senha nem
// reservam nome). `getPlayer` e a rota de imagem os resolvem pelo ID (`pl_demoNN`), então apagar a pelada não deixa lixo.

import { randomInt } from 'node:crypto';
import { mulberry32, shuffle } from '../../public/assets/js/shared/pelada.js';
import { newPelada, setPresence } from '../../public/assets/js/shared/domain/pelada.js';

export const DEMO_SIZE = 17;
export const DEMO_NAME = 'Pelada Demo';
/** Versão da arte dos avatares: vai na URL (?v=) das imagens, que ficam em cache por 1 ano — suba ao mudar o desenho. */
export const DEMO_ART_VERSION = 1;

// Nome e sobrenome apenas (2 palavras). Os IDs derivam da posição: pl_demo01 … pl_demo40.
const PEOPLE = [
  'Lucas Silva', 'Mateus Souza', 'Gabriel Oliveira', 'Rafael Santos', 'Bruno Pereira', 'Thiago Lima', 'Felipe Costa', 'Diego Ribeiro',
  'André Almeida', 'Caio Carvalho', 'Vitor Gomes', 'Igor Martins', 'Renan Rocha', 'Pedro Barros', 'Nathan Moreira', 'Otávio Ferreira',
  'Leandro Araújo', 'Murilo Cardoso', 'Davi Teixeira', 'Enzo Nascimento', 'Heitor Correia', 'Samuel Batista', 'Danilo Freitas', 'Rodrigo Mendes',
  'Henrique Dias', 'João Ramos', 'Marcelo Pinto', 'Fábio Cunha', 'Anderson Lopes', 'Guilherme Castro', 'Paulo Nunes', 'Ricardo Melo',
  'Eduardo Vieira', 'Vinícius Campos', 'Alan Monteiro', 'Wesley Duarte', 'Jonas Farias', 'Kleber Moura', 'Tiago Azevedo', 'Sérgio Machado',
];

const ID_RE = /^pl_demo(\d{2})$/;
const demoId = i => `pl_demo${String(i + 1).padStart(2, '0')}`;
const indexOf = id => { const m = ID_RE.exec(String(id)); return m && +m[1] >= 1 && +m[1] <= PEOPLE.length ? +m[1] - 1 : -1; };

export const isDemoPlayerId = id => indexOf(id) >= 0;

/** Registro de jogador do elenco demo (mesmo formato de uma conta, sem senha). */
export function demoPlayer(id) {
  const i = indexOf(id);
  if (i < 0) return null;
  return { id: demoId(i), name: PEOPLE[i], av: DEMO_ART_VERSION, demo: true, createdAt: 0 };
}

// ---------------------------------------------------------------- avatares (SVG ilustrado, sem arquivos nem rede)
const SKIN = ['#fbdcc4', '#f3c9a1', '#e3a77a', '#c98a5c', '#9a6339', '#6b4226'];
const HAIR = ['#15110e', '#2b1d12', '#47301c', '#6b4a2b', '#a35f2a', '#c9a24a', '#8c8c8c'];
const JERSEY = [['#0a8f4a', '#ffffff'], ['#f6c21b', '#0a3d91'], ['#1d4ed8', '#ffffff'], ['#d62839', '#ffffff'], ['#1f2937', '#f6c21b'],
  ['#ff7a1a', '#ffffff'], ['#7c3aed', '#ffffff'], ['#f8fafc', '#0a8f4a'], ['#0ea5e9', '#ffffff'], ['#16a34a', '#fde047']];

const shade = (hex, k) => { // k < 0 escurece, k > 0 clareia
  const n = parseInt(hex.slice(1), 16);
  const ch = s => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * (1 + k))));
  return '#' + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join('');
};

/** Cabelo: [atrás da cabeça, na frente]. */
const HAIRDO = [
  () => ['', ''], // careca
  c => ['', `<path d="M37 54C35 33 49 27 64 27S93 33 91 54C86 44 78 39 64 39S42 44 37 54Z" fill="${c}"/>`], // raspado
  c => ['', `<path d="M36 56C31 28 50 20 66 21S98 30 92 56C90 46 84 38 72 36C58 40 44 42 36 56Z" fill="${c}"/>`], // curto com franja
  c => ['', [[44, 34], [54, 28], [66, 26], [78, 29], [87, 37], [38, 44], [92, 46]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="10" fill="${c}"/>`).join('')], // cacheado
  c => [`<circle cx="64" cy="46" r="40" fill="${c}"/>`, `<path d="M38 54C38 40 48 32 64 32S90 40 90 54C84 46 76 43 64 43S44 46 38 54Z" fill="${c}"/>`], // black
  c => [`<path d="M32 58C28 28 48 18 64 18S100 28 96 58L98 92C90 98 84 92 84 86L44 86C44 92 38 98 30 92Z" fill="${c}"/>`, `<path d="M36 54C42 36 52 32 64 32S86 36 92 54C84 44 74 41 64 41S44 44 36 54Z" fill="${c}"/>`], // comprido
  c => ['', `<path d="M36 52C36 36 46 30 64 30S92 36 92 52C86 42 78 38 64 38S42 42 36 52Z" fill="${c}"/><path d="M58 30C58 14 70 14 70 30Z" fill="${c}"/>`], // topete
];

function face(rnd) {
  const pick = a => a[Math.floor(rnd() * a.length)];
  const skin = pick(SKIN), hair = pick(HAIR), [jersey, trim] = pick(JERSEY);
  const style = pick([0, 1, 1, 2, 2, 2, 3, 3, 4, 6, 5]); // comprido (5) é raro: a pelada demo é masculina
  const beard = rnd() < 0.38 && style !== 4;
  const cap = !beard && rnd() < 0.16;
  const smile = Math.floor(rnd() * 3);
  const pattern = Math.floor(rnd() * 3);
  const rx = 26 + Math.floor(rnd() * 5);
  const hue = Math.floor(rnd() * 360);
  const dark = shade(skin, -0.22);
  const [back, front] = HAIRDO[style](hair);

  const mouth = [
    `<path d="M54 82Q64 90 74 82" fill="none" stroke="#7a2d2d" stroke-width="3" stroke-linecap="round"/>`,
    `<path d="M52 80Q64 96 76 80Z" fill="#7a2d2d"/><path d="M54 81.5Q64 86 74 81.5Q64 89 54 81.5Z" fill="#fff"/>`,
    `<path d="M56 83Q64 87 72 83" fill="none" stroke="#7a2d2d" stroke-width="3" stroke-linecap="round"/>`,
  ][smile];
  const stripes = [
    '',
    `<rect x="0" y="108" width="128" height="9" fill="${trim}" opacity=".9"/>`,
    [30, 50, 70, 90].map(x => `<rect x="${x}" y="90" width="8" height="40" fill="${trim}" opacity=".35"/>`).join(''),
  ][pattern];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 62%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 65% 38%)"/></linearGradient><clipPath id="t"><path d="M6 128C10 102 38 92 64 92S118 102 122 128Z"/></clipPath></defs>
<rect width="128" height="128" fill="url(#g)"/>
${back}
<path d="M6 128C10 102 38 92 64 92S118 102 122 128Z" fill="${jersey}"/><g clip-path="url(#t)">${stripes}</g>
<path d="M52 92L64 108L76 92" fill="${dark}" stroke="${trim}" stroke-width="4.5" stroke-linejoin="round"/>
<path d="M54 76H74V96Q64 104 54 96Z" fill="${dark}"/>
<circle cx="${64 - rx - 1}" cy="62" r="6" fill="${skin}"/><circle cx="${64 + rx + 1}" cy="62" r="6" fill="${skin}"/>
<ellipse cx="64" cy="60" rx="${rx}" ry="31" fill="${skin}"/>
<circle cx="50" cy="70" r="6" fill="#e0685a" opacity=".14"/><circle cx="78" cy="70" r="6" fill="#e0685a" opacity=".14"/>
${front}
<path d="M44 52Q51 48 58 51M70 51Q77 48 84 52" fill="none" stroke="${shade(hair, -0.1)}" stroke-width="3.2" stroke-linecap="round"/>
<ellipse cx="51" cy="60" rx="3.6" ry="4.2" fill="#1c1410"/><ellipse cx="77" cy="60" rx="3.6" ry="4.2" fill="#1c1410"/>
<circle cx="52.2" cy="58.6" r="1.1" fill="#fff"/><circle cx="78.2" cy="58.6" r="1.1" fill="#fff"/>
<path d="M64 62Q60 71 64 73Q67 73 68 71" fill="none" stroke="${dark}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
${beard ? `<path d="M${64 - rx} 66C${64 - rx} 100 ${64 + rx} 100 ${64 + rx} 66C${64 + rx - 5} 80 ${64 + rx - 12} 78 64 78C${64 - rx + 12} 78 ${64 - rx + 5} 80 ${64 - rx} 66Z" fill="${hair}" opacity=".92"/>` : ''}
${mouth}
${cap ? `<path d="M34 54C34 24 94 24 94 54Z" fill="${jersey}"/><path d="M30 55Q64 46 98 55Q64 52 30 55Z" fill="${trim}" stroke="${trim}" stroke-width="5" stroke-linejoin="round"/><circle cx="64" cy="31" r="3.6" fill="${trim}"/>` : ''}
</svg>`;
}

const cache = new Map();
/** SVG do avatar de um jogador demo (em { mime, b64 }, o formato das imagens guardadas), ou null. */
export function demoAvatar(id) {
  const i = indexOf(id);
  if (i < 0) return null;
  if (!cache.has(i)) cache.set(i, { mime: 'image/svg+xml', b64: Buffer.from(face(mulberry32(1000 + i * 7919))).toString('base64') });
  return cache.get(i);
}

// ---------------------------------------------------------------- criação
/**
 * Monta a pelada demo para `owner`: masculina, mínimo de 5 por time (17 confirmados → 3 times, com 2 sobras distribuídas),
 * jogo marcado para `date` (hoje) com a lista de presença cheia e sem sorteio — quem testa faz o sorteio e as partidas.
 * `rnd` (opcional) torna o elenco e a ordem de chegada determinísticos nos testes.
 */
export function newDemoPelada({ id, owner, date, rnd }, now) {
  const draw = rnd || (() => randomInt(0, 2 ** 31) / 2 ** 31);
  const p = newPelada({ id, owner, input: { name: DEMO_NAME, gender: 'masculino', minPerTeam: 5, matchMinutes: 10, days: [{ date }] } }, now);
  p.demo = true;
  const day = p.days[0];
  const cast = shuffle(PEOPLE.map((_, i) => i), draw).slice(0, DEMO_SIZE);
  // confirmações chegando ao longo das últimas horas (a mais antiga é a primeira da lista)
  let at = now - 6 * 3600_000;
  cast.forEach(i => {
    at += Math.floor((5 + draw() * 20) * 60_000);
    setPresence(p, day, demoId(i), true, Math.min(at, now - 60_000));
  });
  return p;
}
