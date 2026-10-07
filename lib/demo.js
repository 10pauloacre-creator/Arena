// Dados de demonstração: 8 times prontos para testar sorteio, jogos e repescagem sem pagamentos.

import { SPORTS } from '../public/assets/js/shared/sports.js';
import { hash, mulberry32 } from '../public/assets/js/shared/format.js';

const DEMO_TEAMS = [
  ['Raio FC', 'Vila Nova', 1860], ['Trovão EC', 'Centro', 1790], ['Fênix Esporte', 'Vila Nova', 1735], ['Dragões do Norte', 'Zona Norte', 1820],
  ['Lobos United', 'Centro', 1680], ['Titãs da Várzea', 'Zona Sul', 1710], ['Atlético Cometa', 'Zona Norte', 1650], ['Real Aurora', 'Zona Sul', 1775],
];
const FIRST = ['Lucas', 'Mateus', 'Gabriel', 'Rafael', 'Bruno', 'Thiago', 'Felipe', 'Diego', 'André', 'Caio', 'Vitor', 'Igor', 'Renan', 'Pedro', 'Nathan', 'Otávio', 'Leandro', 'Murilo', 'Davi', 'Enzo', 'Heitor', 'Samuel', 'Danilo'];
const LAST = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Pereira', 'Lima', 'Costa', 'Ribeiro', 'Almeida', 'Carvalho', 'Gomes', 'Martins', 'Rocha', 'Barros', 'Moreira'];

export function demoTeams(t, now) {
  const sport = SPORTS[t.sport];
  return DEMO_TEAMS.map(([name, origin, rating], i) => {
    const rnd = mulberry32(hash(name));
    const nums = new Set();
    const players = Array.from({ length: sport.min }, (_, k) => {
      let n; do { n = 1 + Math.floor(rnd() * 30); } while (nums.has(n));
      nums.add(n);
      return { id: 'p' + (k + 1), name: `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`, number: n };
    }).sort((a, b) => a.number - b.number);
    return {
      id: 'tm_demo' + (i + 1), name, origin, hue: hash(name) % 360, rating,
      captain: { name: `Capitão ${name}`, phone: '11999990000', email: `demo${i + 1}@arenamaster.example` },
      players, accessCode: 'DEMO' + (1000 + i), status: 'confirmed',
      createdAt: now - (8 - i) * 86400_000 * 0.8, confirmedAt: now - (8 - i) * 86400_000 * 0.8, reservedUntil: null, paidVia: 'demo', paymentId: null,
      hasEmblem: false, emblemVer: 0, elim: null, repescada: false, noRepesc: false, source: 'demo',
    };
  });
}
