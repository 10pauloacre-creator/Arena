// Regras puras do módulo Pelada (servidor + navegador): nomes, senha por data de nascimento, ID,
// sorteio de times, fila de partidas, placar e artilharia.

export const GENDERS = {
  masculino: { label: 'Masculino', adj: 'masculina', player: 'jogador', players: 'jogadores', article: 'os', emoji: '👨' },
  feminino: { label: 'Feminino', adj: 'feminina', player: 'jogadora', players: 'jogadoras', article: 'as', emoji: '👩' },
};

// ---------------------------------------------------------------- nomes / senha / ID
const strip = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
export const cleanName = s => String(s ?? '').replace(/\s+/g, ' ').trim();
/** Chave única do nome de usuário: sem acentos, minúsculas, espaços únicos. */
export const nameKey = s => strip(cleanName(s)).toLowerCase();
export const firstName = s => cleanName(s).split(' ')[0] || '';

const pad2 = n => String(n).padStart(2, '0');

/** Aceita 25/03/1990, 25-03-1990, 25.03.1990, 25031990 ou 1990-03-25. Retorna { d, m, y } ou null (data de calendário válida). */
export function parseDateParts(raw) {
  const s = String(raw ?? '').trim();
  let d, m, y, mt;
  if ((mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else if ((mt = /^(\d{2})[/.\-\s]?(\d{2})[/.\-\s]?(\d{4})$/.exec(s))) { d = +mt[1]; m = +mt[2]; y = +mt[3]; }
  else return null;
  if (y < 1900 || m < 1 || m > 12 || d < 1) return null;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > dim) return null;
  return { d, m, y };
}
/** Data de nascimento válida (não futura). Retorna { iso, label } ou null. */
export function parseBirth(raw, now = Date.now()) {
  const p = parseDateParts(raw);
  if (!p) return null;
  const t = Date.UTC(p.y, p.m - 1, p.d);
  if (t > now) return null;
  return { iso: `${p.y}-${pad2(p.m)}-${pad2(p.d)}`, label: `${pad2(p.d)}/${pad2(p.m)}/${p.y}` };
}
/** Senha normalizada: se parece uma data → "DDMMAAAA"; senão, o texto digitado (senha personalizada). */
export function normalizeSecret(raw) {
  const s = String(raw ?? '');
  const p = parseDateParts(s);
  if (p) return `${pad2(p.d)}${pad2(p.m)}${p.y}`;
  return s.trim();
}
/** Máscara DD/MM/AAAA enquanto digita. */
export function maskDate(v) {
  const d = String(v ?? '').replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

export const PELADA_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PELADA_ID_RE = /^PL-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/;
/** "#pl-7k3m9q", "7K3M9Q" ou um link completo de convite → "PL-7K3M9Q" (ou o texto limpo se não der). */
export function normalizePeladaId(raw) {
  let s = String(raw ?? '').trim();
  const fromUrl = /\/p\/([A-Za-z0-9-]+)/.exec(s);
  if (fromUrl) s = fromUrl[1];
  s = s.replace(/^#/, '').replace(/[\s_]+/g, '').toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(s)) s = 'PL-' + s;
  return s;
}

// ---------------------------------------------------------------- sorteio
export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Quantidade mínima de presentes para formar ao menos 2 times completos com o mínimo `m`. */
export const minPlayersForDraw = m => 2 * m;

/**
 * Plano do sorteio (sem "time incompleto"):
 *  - k = floor(n / m) times completos, de exatamente `m` jogadores;
 *  - r = n mod m jogadores sobram e formam a CERCA: aguardam a próxima partida e entram no time que perder.
 * Retorna { ok, sizes, fence, k, r, error }.
 */
export function planTeams(n, m) {
  n = Math.floor(n); m = Math.floor(m);
  if (!(m >= 2)) return { ok: false, error: 'O mínimo por time precisa ser de ao menos 2 jogadores.' };
  const k = Math.floor(n / m), r = n % m;
  const sizes = Array(k).fill(m);
  if (k < 2) return { ok: false, sizes, fence: r, k, r, error: `Faltam jogadores: para sortear ao menos 2 times com mínimo de ${m} é preciso ter ${minPlayersForDraw(m)} presentes (há ${n}).` };
  return { ok: true, sizes, fence: r, k, r };
}

/** Capitão: sorteado entre os "integrantes principais" do time (`core`), de preferência quem tem conta; senão entre todos. */
export function pickCaptain(list, core, rnd) {
  const real = p => !p.guest;
  const pools = [list.filter(p => core.has(p.pid) && real(p)), list.filter(real), core.size ? list.filter(p => core.has(p.pid)) : [], list];
  const pool = pools.find(x => x.length) || list;
  return pool[Math.floor(rnd() * pool.length)].pid;
}

/**
 * Forma floor(n / min) times de exatamente `min` jogadores; quem sobra vai para a Cerca.
 * `must` = pids que não podem ficar de fora (a Cerca anterior): entram nos primeiros `mustTeams` times, repartidos entre eles
 * (os demais lugares dos times são completados por sorteio). O capitão do time é um dos integrantes de `must`, se houver.
 * Retorna { teams: [{ players: [pid], captain }], fence: [pid] }.
 */
export function formTeams(players, min, rnd = Math.random, { must = [], mustTeams = 1 } = {}) {
  const k = Math.floor(players.length / min);
  const mustSet = new Set(must);
  const mustList = shuffle(players.filter(p => mustSet.has(p.pid)), rnd);
  const rest = shuffle(players.filter(p => !mustSet.has(p.pid)), rnd);
  const lists = Array.from({ length: k }, () => []);
  const lead = Math.min(Math.max(1, mustTeams), k);
  const left = [];
  for (const p of mustList) {
    // primeiro os times da frente (o que tem menos gente); se lotarem, os seguintes
    let at = -1;
    for (let i = 0; i < lead; i++) if (lists[i].length < min && (at < 0 || lists[i].length < lists[at].length)) at = i;
    if (at < 0) at = lists.findIndex(l => l.length < min);
    if (at < 0) left.push(p); else lists[at].push(p);
  }
  const core = lists.map(l => new Set(l.map(p => p.pid)));
  for (const l of lists) while (l.length < min && rest.length) l.push(rest.shift());
  const fence = [...left, ...rest].map(p => p.pid);
  const teams = lists.map((l, i) => ({ players: l.map(p => p.pid), captain: pickCaptain(l, core[i], rnd) }));
  return { teams, fence };
}

export const joinNames = (pids, nameOf) => pids.map(nameOf).join(', ');
const nPlayers = n => `${n} ${n === 1 ? 'jogador' : 'jogadores'}`;

/**
 * Frases do "Assistente do sorteio". `total` = jogadores sorteados, `teams` = quantos times saíram, `fence` = nova Cerca,
 * `must` = Cerca anterior (entrada garantida) e `keptLabels` = times que se mantêm em quadra (sorteio com partida em andamento).
 */
export function drawNotes({ total, min, teams, fence, must = [], keptLabels = [], nameOf }) {
  const notes = [];
  if (keptLabels.length) notes.push(`${keptLabels.join(' e ')} ${keptLabels.length === 1 ? 'se mantém' : 'se mantêm'} com seus jogadores. Os outros ${total} (times de fora e Cerca) foram sorteados em ${teams} ${teams === 1 ? 'time' : 'times'}.`);
  else notes.push(`${total} confirmados ÷ mínimo de ${min} → ${teams} ${teams === 1 ? 'time completo' : 'times completos'}.`);
  if (fence.length) notes.push(`Sobraram ${nPlayers(fence.length)} (${joinNames(fence, nameOf)}): ficam na Cerca, aguardando a próxima partida, e entram no time que perder.`);
  if (must.length) notes.push(`A Cerca anterior (${joinNames(must, nameOf)}) tem entrada garantida na ${keptLabels.length ? 'próxima' : 'primeira'} partida.`);
  return notes;
}

/**
 * Sorteia os times. `players` = [{ pid, name, guest? }]. Retorna { ok, teams, fence, notes, plan } ou { ok:false, error }.
 * Time = { id, number, captain, players:[pid] }; `fence` = pids que sobraram (a Cerca).
 * `must` = Cerca anterior, com entrada garantida nos dois primeiros times (os da primeira partida).
 */
export function drawTeams(players, min, rnd = Math.random, { must = [] } = {}) {
  const plan = planTeams(players.length, min);
  if (!plan.ok) return plan;
  const names = new Map(players.map(p => [p.pid, p.name]));
  const nameOf = pid => names.get(pid) || '?';
  const res = formTeams(players, min, rnd, { must, mustTeams: 2 });
  const notes = drawNotes({ total: players.length, min, teams: plan.k, fence: res.fence, must: must.filter(pid => names.has(pid)), nameOf });
  const teams = res.teams.map((t, i) => ({ id: `t${i + 1}`, number: i + 1, captain: t.captain, players: t.players }));
  return { ok: true, teams, fence: res.fence, notes, plan };
}

/** "Time 2 - Leões": número + nome do catálogo (não leva mais o nome do capitão, que pode sair numa derrota). */
export { teamLabel } from './team-catalog.js';

// ---------------------------------------------------------------- partidas
export const DEFAULT_MATCH_MIN = 10;

/** Sorteio automático geral: de quantas em quantas partidas todos os times são refeitos (1 a 10). */
export const GENERAL_EVERY_OPTIONS = Array.from({ length: 10 }, (_, i) => [i + 1, i === 0 ? 'A cada partida' : `A cada ${i + 1} partidas`]);
export const DEFAULT_GENERAL_EVERY = 3;
export const FENCE_DRAW_TITLE = 'Sorteio automático da Cerca';
export const FENCE_DRAW_TEXT = 'Ao ativar esse modo os jogadores que estão na cerca, serão embaralhados com os jogadores do time que perdeu, e já jogaram na próxima partida, os jogadores que sairam farão a próxima cerca.';
export const GENERAL_DRAW_TITLE = 'Sorteio automático geral';
export const GENERAL_DRAW_TEXT = 'Refaz todos os times de tempos em tempos, repetindo o mínimo possível as mesmas duplas. A Cerca tem prioridade: quem sai é quem mais jogou e mais fez gols no dia.';
export const autoDrawLabel = org => {
  const parts = [];
  if (org?.autoDraw) parts.push('Sorteio da Cerca automático');
  if (org?.generalDraw) parts.push(`Sorteio geral ${org.generalEvery === 1 ? 'a cada partida' : `a cada ${org.generalEvery} partidas`}`);
  return parts.length ? parts.join(' · ') : 'Sorteios automáticos desligados';
};

/** Placar a partir dos gols da partida: { [teamId]: n }. */
export function matchScore(match) {
  const s = {};
  if (match.a) s[match.a] = 0;
  if (match.b) s[match.b] = 0;
  for (const g of match.goals || []) s[g.teamId] = (s[g.teamId] || 0) + 1;
  return s;
}
export const scoreOf = (match, side) => matchScore(match)[match[side]] || 0;

/** Tempo restante (ms) do cronômetro regressivo. */
export function timerRemaining(timer, now = Date.now()) {
  if (!timer) return 0;
  const run = timer.startedAt ? Math.max(0, now - timer.startedAt) : 0;
  return Math.max(0, timer.durationMs - timer.elapsedMs - run);
}
export function fmtClock(ms) {
  const t = Math.ceil(Math.max(0, ms) / 1000);
  return `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;
}

/**
 * Próximo confronto após uma partida encerrada (lógica "quem ganha fica"):
 *  - vencedor continua como time A; perdedor vai para o fim da fila;
 *  - empate: sai o time com mais partidas seguidas na quadra (empate de sequência → sai o A);
 *  - o desafiante é o primeiro da fila.
 * `queue` = times de fora, em ordem (sem os dois do jogo); `streaks` = partidas seguidas já incluindo este jogo.
 * Retorna { a, b, queue, leaver, reason }.
 */
export function nextPairing({ a, b, scoreA, scoreB, queue, streaks }) {
  let stay, leave, reason;
  if (scoreA > scoreB) { stay = a; leave = b; reason = 'venceu'; }
  else if (scoreB > scoreA) { stay = b; leave = a; reason = 'venceu'; }
  else {
    const sa = streaks[a] || 0, sb = streaks[b] || 0;
    if (sb > sa) { stay = a; leave = b; } else { stay = b; leave = a; }
    reason = 'empate';
  }
  const q = queue.slice();
  q.push(leave);
  const challenger = q.shift();
  return { a: stay, b: challenger, queue: q, leaver: leave, stayer: stay, reason };
}

// ---------------------------------------------------------------- artilharia
/**
 * Ranking de gols. `goals` = Map|objeto pid→gols. Retorna [{ pid, goals, rank, medal }] ordenado
 * (empates dividem a colocação e a medalha). `nameOf` desempata alfabeticamente.
 */
export function rankGoals(goals, nameOf = x => x) {
  const entries = Object.entries(goals instanceof Map ? Object.fromEntries(goals) : goals)
    .filter(([, n]) => n > 0)
    .map(([pid, n]) => ({ pid, goals: n }));
  entries.sort((x, y) => y.goals - x.goals || String(nameOf(x.pid)).localeCompare(String(nameOf(y.pid)), 'pt-BR'));
  let rank = 0, prev = null;
  entries.forEach((e, i) => {
    if (e.goals !== prev) { rank = i + 1; prev = e.goals; }
    e.rank = rank;
    e.medal = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : null;
  });
  return entries;
}
export const MEDALS = { gold: { emoji: '🥇', label: 'Ouro' }, silver: { emoji: '🥈', label: 'Prata' }, bronze: { emoji: '🥉', label: 'Bronze' } };

// ---------------------------------------------------------------- período exibido na imagem de compartilhamento
const dm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const dmy = iso => `${dm(iso)}/${iso.slice(0, 4)}`;

/** "07/09 - 20/10" (mesmo ano), "07/09/2025 - 20/10/2026" (anos diferentes) ou "07/10/2026" (um dia só). */
export function rangeLabel(from, to) {
  if (!from || !to || from === to) return dmy(to || from);
  return from.slice(0, 4) === to.slice(0, 4) ? `${dm(from)} - ${dm(to)}` : `${dmy(from)} - ${dmy(to)}`;
}

/**
 * Período do compartilhamento. Geral: do início da pelada (primeira data de jogo) até o dia da emissão (hoje);
 * se a pelada ainda não começou, mostra só o dia da emissão. Do dia: a data do jogo.
 */
export function sharePeriod({ general, firstDay, dayDate, today }) {
  if (!general && dayDate) return { from: dayDate, to: dayDate, label: rangeLabel(dayDate, dayDate) };
  const from = firstDay && firstDay < today ? firstDay : today;
  return { from, to: today, label: rangeLabel(from, today) };
}
