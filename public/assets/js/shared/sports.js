// Configuração das modalidades — módulo isomórfico (servidor + navegador).

export const SPORTS = {
  futebol: {
    key: 'futebol', label: 'Futebol', icon: 'soccer', sub: '11 jogadores', unit: 'Gol', unitPl: 'gols',
    mode: 'clock', length: 90, half: 45, min: 11, max: 23,
    rosterHint: 'Mínimo de 11 atletas (titulares + reservas), máximo de 23.',
    events: ['goal', 'yellow', 'red', 'foul', 'sub'], tiebreak: 'pênaltis',
    perfBaseline: [2.6, 2.4, 2.1, 1.8, 1.6], flyerGlyph: 'soccer',
  },
  futsal: {
    key: 'futsal', label: 'Futsal', icon: 'soccer', sub: '5 jogadores · quadra', unit: 'Gol', unitPl: 'gols',
    mode: 'clock', length: 40, half: 20, min: 5, max: 12,
    rosterHint: 'Mínimo de 5 atletas, máximo de 12.',
    events: ['goal', 'yellow', 'red', 'foul', 'timeout'], tiebreak: 'pênaltis',
    perfBaseline: [5.2, 4.8, 4.4, 3.9, 3.6], flyerGlyph: 'soccer',
  },
  volei: {
    key: 'volei', label: 'Vôlei', icon: 'volleyball', sub: '6 jogadores · sets', unit: 'Ponto', unitPl: 'pontos',
    mode: 'sets', setsToWin: 3, min: 6, max: 14,
    rosterHint: 'Mínimo de 6 atletas, máximo de 14.',
    events: ['goal', 'timeout', 'sub', 'yellow', 'red'], tiebreak: null,
    perfBaseline: [22.4, 22, 21.7, 23.1, 23.4], flyerGlyph: 'volleyball',
  },
  basquete: {
    key: 'basquete', label: 'Basquete', icon: 'basketball', sub: '5 jogadores · 4 quartos', unit: 'Ponto', unitPl: 'pontos',
    mode: 'clock', length: 40, half: 10, min: 5, max: 12,
    rosterHint: 'Mínimo de 5 atletas, máximo de 12.',
    events: ['goal', 'foul', 'tech', 'timeout', 'sub'], tiebreak: 'prorrogação',
    perfBaseline: [78, 76, 74, 79, 81], flyerGlyph: 'basketball',
  },
};

export const SPORT_KEYS = Object.keys(SPORTS);

export const EVENT_LABELS = {
  goal: 'Gol / Ponto', yellow: 'Cartão amarelo', red: 'Cartão vermelho', foul: 'Falta', sub: 'Substituição',
  timeout: 'Tempo técnico', tech: 'Falta técnica', start: 'Início', end: 'Fim', info: 'Informação', setend: 'Fim do set',
};

export const BRACKET_SIZES = [4, 8, 16, 32];
export const TOURNAMENT_TYPES = { amador: 'Amador / Comunitário', oficial: 'Oficial / Profissional' };

export const DEFAULT_CAUSES = ['Campanha do Agasalho do bairro', 'Banco de Alimentos local', 'Escolinha de esporte social'];

export const nextPow2 = n => { let p = 1; while (p < n) p *= 2; return p; };
export const log2 = n => Math.round(Math.log2(n));

/** Nome da fase a partir da quantidade total de fases e do índice (0 = primeira). */
export function roundName(totalRounds, r) {
  const left = totalRounds - r; // 1 = final
  if (left === 1) return 'Final';
  if (left === 2) return 'Semifinais';
  if (left === 3) return 'Quartas de final';
  if (left === 4) return 'Oitavas de final';
  return '16-avos de final';
}
export function roundShort(totalRounds, r) {
  const left = totalRounds - r;
  return left === 1 ? 'F' : left === 2 ? 'SF' : left === 3 ? 'QF' : left === 4 ? 'OF' : 'R' + (r + 1);
}
export function matchLabel(totalRounds, r, m) {
  return r === totalRounds - 1 ? 'Grande Final' : `${roundShort(totalRounds, r)}${m + 1}`;
}
