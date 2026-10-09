// Informações do torneio para quem acompanha (visitante): premiação, detalhes/avisos e regras.
import { html, ic } from './dom.js';
import { ruleList, hasPrizes, PRIZE_CATEGORIES, PRIZE_CATEGORY_KEYS, placeLabel, prizeTotal } from '../shared/rules.js';
import { fmtBRL } from '../shared/format.js';

export function rulesChecklistHTML(t) {
  return html`<ul class="rule-check">${ruleList(t.rules).map(r => html`<li>${ic('circle-check', { size: 18 })}<span>${r.text}</span></li>`)}</ul>`;
}

export const rulesCard = t => ruleList(t.rules).length
  ? html`<div class="card"><h3 class="card-title">${ic('list-checks')} Regras do torneio</h3>${rulesChecklistHTML(t)}</div>` : '';

export const detailsCard = t => t.details
  ? html`<div class="card"><h3 class="card-title">${ic('info')} Detalhes e avisos</h3><div class="details-text">${t.details}</div></div>` : '';

export function prizesCard(t) {
  if (!hasPrizes(t.prizes)) return '';
  const cats = PRIZE_CATEGORY_KEYS.filter(k => t.prizes[k].length);
  return html`<div class="card"><h3 class="card-title">${ic('trophy')} Premiação</h3>
    <div class="prize-view ${cats.length > 1 ? 'multi' : ''}">${cats.map(cat => html`<section aria-label="Premiação ${PRIZE_CATEGORIES[cat].toLowerCase()}">
      <h4>${PRIZE_CATEGORIES[cat]}</h4>
      <ol>${t.prizes[cat].map((p, i) => html`<li><span class="place">${ic('medal', { size: 15 })} ${placeLabel(i)}</span><span class="what">${p.description}</span>${p.amount ? html`<b class="num">${fmtBRL(p.amount)}</b>` : ''}</li>`)}</ol>
      ${prizeTotal(t.prizes[cat]) ? html`<p class="muted xs" style="margin-top:6px">Total em dinheiro: <b class="num">${fmtBRL(prizeTotal(t.prizes[cat]))}</b></p>` : ''}
    </section>`)}</div></div>`;
}

/** Os três cartões, na ordem em que aparecem na página do visitante. */
export const tourneyExtras = t => html`${prizesCard(t)}${detailsCard(t)}${rulesCard(t)}`;
