// Times sorteados: "Time 2 - Valéria" (clique para ver as jogadoras), avisos do assistente e avulsos.
import { html, ic } from '../../ui/dom.js';
import { avatar } from './img.js';
import { GENDERS } from '../../shared/pelada.js';

const plural = (n, g) => `${n} ${n === 1 ? GENDERS[g].player : GENDERS[g].players}`;

export function teamsHTML(pel, day, { expanded = new Set(), isOwner = false, fresh = false } = {}) {
  const dr = day.draw;
  if (!dr) return '';
  const g = pel.gender;
  const people = pel.people;
  const free = day.free;
  return html`
    <div class="draw-notes" role="note"><span class="ai-ico">${ic('sparkles', { size: 18 })}</span><div><strong>Assistente do sorteio</strong>${dr.notes.map(n => html`<p>${n}</p>`)}</div></div>
    <div class="teams-grid">${dr.teams.map((t, i) => {
      const open = expanded.has(t.id);
      return html`<article class="team-card${t.incomplete ? ' incomplete' : ''}${fresh ? ' reveal' : ''}" style="--i:${i}" data-team="${t.id}">
        <button type="button" class="team-head" data-team-toggle="${t.id}" aria-expanded="${String(open)}" aria-controls="tp-${t.id}">
          <span class="team-num" aria-hidden="true">${t.number}</span>
          <span class="team-title">${t.label}</span>
          <span class="team-count">${plural(t.players.length, g)}</span>
          ${ic('chevron-down', { size: 18, cls: 'chev' })}
        </button>
        ${t.incomplete ? html`<div class="team-warn">${ic('sparkles', { size: 15 })} Time incompleto: ${t.missing > 0 ? `faltam ${t.missing}` : 'completo agora'}. Pode pegar ${GENDERS[g].players} que estiverem de fora de outros times para equilibrar.</div>` : ''}
        <div class="team-body" id="tp-${t.id}" ${open ? '' : 'hidden'}>
          <ul class="team-players">${t.players.map(pid => html`<li>${avatar(people[pid], pid, { size: 32 })}<span class="grow ellipsis">${people[pid]?.name || '?'}</span>${pid === t.captain ? html`<span class="badge gold" title="Capitão">C</span>` : ''}${people[pid]?.guest ? html`<span class="badge">Convidado</span>` : ''}</li>`)}</ul>
        </div>
      </article>`;
    })}</div>
    ${free.length ? html`<div class="free-box"><h4>${ic('user-plus', { size: 18 })} Avulsos (${free.length})</h4>
      <p class="muted small" style="margin:0 0 8px">${isOwner ? 'Chegaram depois do sorteio. Encaixe em um time para inteirar, ou deixe avulsos: qualquer time pode chamar na hora da partida.' : 'Chegaram depois do sorteio e podem ser chamados por qualquer time.'}</p>
      <ul class="team-players">${free.map(pid => html`<li>${avatar(people[pid], pid, { size: 32 })}<span class="grow ellipsis">${people[pid]?.name || '?'}</span>${people[pid]?.guest ? html`<span class="badge">Convidado</span>` : ''}
        ${isOwner ? html`<select data-assign="${pid}" aria-label="Encaixar ${people[pid]?.name || ''} em um time"><option value="">Encaixar em…</option>${dr.teams.map(t => html`<option value="${t.id}">${t.label} (${t.players.length})</option>`)}</select>` : ''}</li>`)}</ul></div>` : ''}`;
}
