// Fatos e textos prontos do Jarvis para o Pelada. A IA (lib/ai.js) só reescreve estes dados; sem IA, valem os textos daqui.

import { teamLabel, matchScore, firstName } from '../../public/assets/js/shared/pelada.js';
import { gx, cap } from '../../public/assets/js/shared/gender.js';
import { orgOf, freePids, dayGoals, hasLiveMatch } from './pelada.js';
import { dayStats } from './pelada-engine.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Fatos do dia: times, resultados, artilheiros, Cerca e jogos por pessoa. */
export function dayFacts(p, day, nameOf) {
  const label = id => {
    const t = day.matches.map(m => m.rosters?.[id]).find(Boolean) || day.draw?.teams.find(x => x.id === id);
    return t ? teamLabel(t, day.id, p.gender) : '?';
  };
  const first = pid => firstName(nameOf(pid));
  const finished = day.matches.filter(m => m.status === 'finished');
  const scorers = Object.entries(dayGoals(day)).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([pid, n]) => ({ nome: first(pid), gols: n }));
  const stats = dayStats(day);
  return {
    confirmados: day.attendance.length,
    times: (day.draw?.teams || []).map(t => ({ time: teamLabel(t, day.id, p.gender), jogadores: t.players.map(first) })),
    cerca: freePids(day).map(first),
    partidas: finished.map(m => { const s = matchScore(m); return { n: m.n, a: label(m.a), b: label(m.b), placar: `${s[m.a] || 0}x${s[m.b] || 0}` }; }),
    emAndamento: hasLiveMatch(day),
    artilheiros: scorers,
    maisJogos: Object.entries(stats.games).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([pid, n]) => ({ nome: first(pid), jogos: n })),
    timesFixos: !!day.fixed,
  };
}

export function summaryFallback(p, day, nameOf) {
  const f = dayFacts(p, day, nameOf), G = gx(p.gender);
  if (!f.partidas.length) return `Até agora: ${f.confirmados} ${f.confirmados === 1 ? G.confirmed : G.confirmeds}, nenhuma partida encerrada.`;
  const last = f.partidas.at(-1), top = f.artilheiros[0];
  return `Hoje foram ${plural(f.partidas.length, 'partida', 'partidas')} com ${f.confirmados} ${G.players}. Última: ${last.a} ${last.placar.replace('x', ' × ')} ${last.b}.`
    + (top ? ` ${cap(G.o)} ${G.scorer} do dia: ${top.nome} (${plural(top.gols, 'gol', 'gols')}).` : '');
}

/** Última mudança de times (sorteio da Cerca/geral): o texto que o sistema já gravou. */
export const changesFallback = day => day.draw?.log?.at(-1) || 'Ainda não houve mudanças nos times neste dia.';

/** Sugestão de qual sorteio fazer agora, por regras simples. { mode: 'fence'|'general'|null, reason }. */
export function suggestDraw(p, day) {
  const org = orgOf(p, day), G = gx(p.gender), min = org.minPerTeam;
  if (org.noTeams) return { mode: null, reason: 'Esta data não forma times.' };
  if (!day.draw) return { mode: null, reason: day.attendance.length >= 2 * min ? 'Já dá para fazer o primeiro sorteio.' : `Faltam ${G.players} para o primeiro sorteio (precisa de ${2 * min}).` };
  if (day.fixed) return { mode: null, reason: 'Os times estão fixos: libere os times se quiser sortear.' };
  if (day.pending) return { mode: null, reason: 'Já há um sorteio geral combinado: ele vale quando a partida terminar.' };
  const fence = freePids(day).length, live = hasLiveMatch(day);
  if (fence >= min) return { mode: 'fence', reason: `A Cerca tem ${fence} ${G.players}: dá para formar um time novo${live ? ' já para a próxima partida' : ''}.` };
  if (!live && fence > 0 && day.lastLeaver) return { mode: 'fence', reason: `Há ${plural(fence, 'pessoa', 'pessoas')} na Cerca para entrar no time derrotado.` };
  if ((day.sinceDraw || 0) >= 3 && day.attendance.length >= 2 * min) return { mode: 'general', reason: `Já foram ${day.sinceDraw} partidas desde o último sorteio geral: vale misturar todo mundo de novo.` };
  return { mode: null, reason: 'Nada a mudar por enquanto: o vencedor continua e a fila segue.' };
}
