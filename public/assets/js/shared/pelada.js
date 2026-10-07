// Regras puras do módulo Pelada (servidor + navegador): nomes, senha por data de nascimento, ID,
// sorteio de times, fila de partidas, placar e artilharia.

export const GENDERS = {
  masculino: { label: 'Masculino', player: 'jogador', players: 'jogadores', article: 'os', emoji: '👨' },
  feminino: { label: 'Feminino', player: 'jogadora', players: 'jogadoras', article: 'as', emoji: '👩' },
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

/** Quantidade mínima de presentes para conseguir formar ao menos 2 times com o mínimo `m`. */
export const minPlayersForDraw = m => (m > 3 ? Math.min(2 * m, m + 3) : 2 * m);

/**
 * Plano de tamanhos dos times (regras estritas):
 *  - k = floor(n / m) times completos; r = n mod m.
 *  - Regra A: se r ≥ 3 (e < m), o time incompleto se mantém (pode pegar jogadores de fora).
 *  - Regra B: se 0 < r < 3, o time incompleto é dissolvido e os r jogadores vão, um a um, para times diferentes.
 * Retorna { ok, sizes, extras, incomplete, error }.
 */
export function planTeams(n, m) {
  n = Math.floor(n); m = Math.floor(m);
  if (!(m >= 2)) return { ok: false, error: 'O mínimo por time precisa ser de ao menos 2 jogadores.' };
  const k = Math.floor(n / m), r = n % m;
  let sizes, extras = 0, incomplete = null;
  if (r === 0) sizes = Array(k).fill(m);
  else if (r >= 3) { sizes = [...Array(k).fill(m), r]; incomplete = { index: k, size: r, missing: m - r }; }
  else { sizes = Array(k).fill(m); extras = r; }
  if (sizes.length < 2) {
    const need = minPlayersForDraw(m);
    return { ok: false, sizes, extras, incomplete, error: `Faltam jogadores: para sortear ao menos 2 times com mínimo de ${m} é preciso ter ${need} presentes (há ${n}).` };
  }
  return { ok: true, sizes, extras, incomplete, k, r };
}

/**
 * Sorteia os times. `players` = [{ pid, name, guest? }]. Retorna { ok, teams, notes, plan } ou { ok:false, error }.
 * Time = { id, number, captain, players:[pid], incomplete, missing }.
 */
export function drawTeams(players, min, rnd = Math.random) {
  const plan = planTeams(players.length, min);
  if (!plan.ok) return plan;
  const order = shuffle(players, rnd);
  const teams = [];
  let at = 0;
  for (const size of plan.sizes) { teams.push(order.slice(at, at + size)); at += size; }
  const notes = [];
  const label = [`${players.length} confirmados ÷ mínimo de ${min}`];
  const full = plan.sizes.filter(s => s === min).length;
  label.push(`${full} ${full === 1 ? 'time completo' : 'times completos'}`);

  if (plan.extras) {
    // Regra B: sobra < 3 → distribui um a um em times diferentes, sorteados
    const leftovers = order.slice(at);
    const targets = shuffle(teams.map((_, i) => i), rnd).slice(0, leftovers.length);
    leftovers.forEach((p, i) => teams[targets[i]].push(p));
    const names = leftovers.map(p => p.name).join(', ');
    notes.push(`Sobraram ${leftovers.length} ${leftovers.length === 1 ? 'jogador' : 'jogadores'} (${names}): o time incompleto foi desfeito e ${leftovers.length === 1 ? 'ele foi' : 'eles foram'} distribuído${leftovers.length === 1 ? '' : 's'} nos times ${targets.map(i => i + 1).sort((a, b) => a - b).join(' e ')}, que ficam temporariamente com ${min + 1}.`);
  } else if (plan.incomplete) {
    notes.push(`Sobraram ${plan.incomplete.size} jogadores: o Time ${plan.incomplete.index + 1} fica com ${plan.incomplete.size} (faltam ${plan.incomplete.missing}) e pode pegar jogadores que estiverem de fora de outros times para equilibrar.`);
  }
  notes.unshift(`${label.join(' → ')}.`);

  const out = teams.map((list, i) => {
    const pool = list.filter(p => !p.guest);
    const cap = (pool.length ? pool : list)[Math.floor(rnd() * (pool.length || list.length))];
    const incomplete = !!plan.incomplete && i === plan.incomplete.index;
    return { id: `t${i + 1}`, number: i + 1, captain: cap.pid, players: list.map(p => p.pid), incomplete, missing: incomplete ? min - list.length : 0 };
  });
  return { ok: true, teams: out, notes, plan };
}

/** "Time 2 - Valéria" */
export const teamLabel = (team, nameOf) => `Time ${team.number} - ${firstName(nameOf(team.captain))}`;

// ---------------------------------------------------------------- partidas
export const DEFAULT_MATCH_MIN = 10;

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
