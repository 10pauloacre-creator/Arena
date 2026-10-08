// Fatos e conselho pronto do Jarvis para o ArenaMaster (a IA só reescreve; sem IA vale o texto daqui).

import { confirmedTeams, registrationState, statusOf, isLeague, isDrawn } from './tournament.js';
import { allLeagueMatches, leagueTable } from './league.js';

export function tournamentFacts(t, now) {
  const reg = registrationState(t, now);
  const facts = {
    nome: t.name, modalidade: t.sport, formato: isLeague(t) ? 'pontos corridos (campeonato)' : 'mata-mata',
    status: statusOf(t, now), timesConfirmados: confirmedTeams(t).length, vagas: t.maxTeams, vagasRestantes: reg.slotsLeft,
    inscricoesAbertas: reg.open, prazoInscricao: t.regDeadline, valorInscricaoCentavos: t.fee,
  };
  if (t.league) {
    const done = allLeagueMatches(t).filter(m => m.done).length;
    const table = leagueTable(t, id => t.teams.find(x => x.id === id)?.name || id);
    Object.assign(facts, { rodadas: t.league.rounds.length, jogosDisputados: done, jogosTotal: allLeagueMatches(t).length, lideres: table.slice(0, 3).map(r => ({ time: r.name, pontos: r.pts, jogos: r.p })) });
  } else if (t.bracket) {
    const all = t.bracket.rounds.flat().filter(m => !m.bye);
    Object.assign(facts, { jogosDisputados: all.filter(m => m.win).length, jogosTotal: all.length });
  }
  facts.campeao = t.champion ? t.teams.find(x => x.id === t.champion)?.name || null : null;
  return facts;
}

/** Próximo passo recomendado, por regras simples. */
export function adviceFallback(t, now) {
  const f = tournamentFacts(t, now), min = isLeague(t) ? 3 : 2;
  if (t.champion) return `Fim de campeonato: ${f.campeao} é ${isLeague(t) ? 'campeão com a maior pontuação' : 'o campeão'}. Compartilhe o resultado e a premiação com a galera!`;
  if (!isDrawn(t)) {
    if (f.timesConfirmados < min) return `Ainda há ${f.timesConfirmados} ${f.timesConfirmados === 1 ? 'time confirmado' : 'times confirmados'}: divulgue o link de inscrição (precisa de ao menos ${min}) usando a aba Marketing.`;
    if (f.inscricoesAbertas && f.vagasRestantes > 0) return `Já dá para ${isLeague(t) ? 'gerar a tabela' : 'sortear o chaveamento'}, mas ainda há ${f.vagasRestantes} vagas: espere o prazo ou encerre as inscrições antes de começar.`;
    return `As inscrições terminaram com ${f.timesConfirmados} times: ${isLeague(t) ? 'gere a tabela de jogos' : 'sorteie o chaveamento'} para começar.`;
  }
  if (isLeague(t)) {
    const lead = f.lideres?.[0];
    return `${f.jogosDisputados} de ${f.jogosTotal} jogos disputados.${lead ? ` ${lead.time} lidera com ${lead.pontos} pontos.` : ''} Lance os resultados na seção Campeonato para atualizar a classificação.`;
  }
  return `${f.jogosDisputados} de ${f.jogosTotal} jogos disputados. Conduza as próximas partidas na aba Ao vivo.`;
}
