// Pontos corridos: classificação e rodadas (usados pelo organizador e pelo visitante).
import { html, ic } from './dom.js';
import { emblem } from './util.js';

const teamsOf = t => new Map(t.teams.map(x => [x.id, x]));

/** Tabela de classificação (P = pontos, J = jogos, V/E/D, SG = saldo de gols). */
export function leagueTableHTML(t) {
  const L = t.league, teams = teamsOf(t);
  return html`<div class="card"><h3 class="card-title">${ic('trophy')} Classificação</h3>
    <div class="table-wrap"><table class="league-table"><thead><tr><th>#</th><th class="l">Time</th><th title="Pontos">P</th><th title="Jogos">J</th><th title="Vitórias">V</th><th title="Empates">E</th><th title="Derrotas">D</th><th title="Gols pró">GP</th><th title="Gols contra">GC</th><th title="Saldo de gols">SG</th></tr></thead>
    <tbody>${L.table.map(r => html`<tr class="${t.champion === r.id ? 'champ' : ''}"><td>${r.pos}</td><td class="l"><span class="row" style="gap:8px">${emblem(teams.get(r.id), 'sm')}<b class="ellipsis">${r.name}</b>${t.champion === r.id ? ic('trophy', { size: 14 }) : ''}</span></td><td class="pts">${r.pts}</td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf}</td><td>${r.ga}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td></tr>`)}</tbody></table></div>
    <p class="muted small" style="margin:10px 0 0">Vitória 3 pontos · empate 1 · derrota 0. Desempate: vitórias, saldo de gols, gols pró.</p></div>`;
}

/** Rodadas com os jogos. `editable` = organizador (campos de placar e botões). */
export function leagueRoundsHTML(t, { editable = false, only = null } = {}) {
  const teams = teamsOf(t);
  const rounds = only ? t.league.rounds.filter(r => only.includes(r.r)) : t.league.rounds;
  return html`<div class="stack">${rounds.map(rd => html`<div class="card"><div class="row between"><h3 class="card-title" style="margin:0">${ic('calendar')} ${rd.name}</h3><span class="muted small">${rd.matches.filter(m => m.done).length}/${rd.matches.length} jogos</span></div>
    <div class="stack-sm" style="margin-top:10px">${rd.matches.map(m => editable
      ? html`<form class="lg-match" data-lg="${m.key}"><span class="side">${emblem(teams.get(m.a), 'sm')}<b class="ellipsis">${m.aName}</b></span>
          <span class="lg-score"><input type="number" name="sa" min="0" max="99" inputmode="numeric" value="${m.sa ?? ''}" aria-label="Gols de ${m.aName}"><span>×</span><input type="number" name="sb" min="0" max="99" inputmode="numeric" value="${m.sb ?? ''}" aria-label="Gols de ${m.bName}"></span>
          <span class="side r"><b class="ellipsis">${m.bName}</b>${emblem(teams.get(m.b), 'sm')}</span>
          <span class="lg-actions"><button class="btn btn-sm ${m.done ? '' : 'btn-primary'}" type="submit">${m.done ? 'Corrigir' : 'Salvar'}</button>${m.done ? html`<button class="btn btn-sm btn-ghost" type="button" data-lg-clear="${m.key}" aria-label="Limpar resultado">${ic('rotate-ccw', { size: 14 })}</button>` : ''}</span></form>`
      : html`<div class="lg-match ro"><span class="side">${emblem(teams.get(m.a), 'sm')}<b class="${m.done && m.sa > m.sb ? 'strong' : ''} ellipsis">${m.aName}</b></span>
          <span class="lg-score sc num">${m.done ? html`${m.sa} : ${m.sb}` : html`<span class="muted">×</span>`}</span>
          <span class="side r"><b class="${m.done && m.sb > m.sa ? 'strong' : ''} ellipsis">${m.bName}</b>${emblem(teams.get(m.b), 'sm')}</span></div>`)}</div></div>`)}</div>`;
}
