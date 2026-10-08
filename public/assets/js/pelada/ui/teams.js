// Times sorteados: "Time 2 - Leões" com emblema (clique para ver as jogadoras), avisos do assistente e a Cerca.
import { html, ic } from '../../ui/dom.js';
import { avatar } from './img.js';
import { emblem } from './emblem.js';
import { GENDERS } from '../../shared/pelada.js';
import { gx, cap } from '../../shared/gender.js';

const plural = (n, g) => `${n} ${n === 1 ? GENDERS[g].player : GENDERS[g].players}`;
/** Partidas jogadas hoje (contador automático): aparece ao lado do nome. */
const gamesTag = (day, pid) => { const n = day.games?.[pid] || 0; return html`<span class="games-tag" title="Partidas jogadas hoje">${n} ${n === 1 ? 'jogo' : 'jogos'}</span>`; };

export function teamsHTML(pel, day, { expanded = new Set(), isOwner = false, fresh = false } = {}) {
  const dr = day.draw;
  if (!dr) return '';
  const g = pel.gender;
  const people = pel.people;
  const fence = day.fence;
  const live = new Set(day.matches.filter(m => m.status === 'live').flatMap(m => [m.a, m.b]));
  return html`
    <div class="draw-notes" role="note"><span class="ai-ico">${ic('sparkles', { size: 18 })}</span><div><strong>Assistente do sorteio</strong>${dr.notes.map(n => html`<p>${n}</p>`)}
      ${dr.log?.length ? html`<details class="draw-log"><summary>Últimos sorteios (${dr.log.length})</summary>${dr.log.map(n => html`<p>${n}</p>`)}</details>` : ''}</div></div>
    <div class="teams-grid">${dr.teams.map((t, i) => {
      const open = expanded.has(t.id);
      return html`<article class="team-card${fresh ? ' reveal' : ''}" style="--i:${i}" data-team="${t.id}">
        <button type="button" class="team-head" data-team-toggle="${t.id}" aria-expanded="${String(open)}" aria-controls="tp-${t.id}">
          <span class="team-emb" aria-hidden="true">${emblem(t, 40)}</span>
          <span class="team-title">${t.label}</span>
          ${live.has(t.id) ? html`<span class="badge live" title="Em quadra agora">em quadra</span>` : ''}
          <span class="team-count">${plural(t.players.length, g)}</span>
          ${ic('chevron-down', { size: 18, cls: 'chev' })}
        </button>
        <div class="team-body" id="tp-${t.id}" ${open ? '' : 'hidden'}>
          <ul class="team-players">${t.players.map(pid => html`<li>${avatar(people[pid], pid, { size: 32 })}<span class="grow ellipsis">${people[pid]?.name || '?'}</span>${gamesTag(day, pid)}${pid === t.captain ? html`<span class="badge gold" title="Capitão">C</span>` : isOwner ? html`<button type="button" class="btn ghost sm" data-captain="${pid}" data-captain-team="${t.id}" title="Tornar capitão" aria-label="Tornar ${people[pid]?.name || ''} capitão">C</button>` : ''}${people[pid]?.guest ? html`<span class="badge">Convidado</span>` : ''}
            ${isOwner ? html`<select data-assign="${pid}" aria-label="Mover ${people[pid]?.name || ''}"><option value="">Mover para…</option>${dr.teams.filter(x => x.id !== t.id).map(x => html`<option value="${x.id}">${x.label} (${x.players.length})</option>`)}<option value="__fence">Cerca</option></select>` : ''}</li>`)}</ul>
        </div>
      </article>`;
    })}</div>
    <div class="fence-box"><h4>${ic('users', { size: 18 })} Cerca (${fence.length})</h4>
      <p class="muted small" style="margin:0 0 8px">${fence.length
        ? `${cap(gx(g).os)} ${gx(g).players} que ficaram de fora aguardam a próxima partida${day.org?.autoDraw ? ' e entram no time que perder (a Cerca completa forma um time novo)' : ''}.${isOwner ? ' Se preferir, encaixe alguém em um time agora.' : ''}`
        : 'Ninguém ficou de fora do sorteio. Quem chegar depois entra aqui e aguarda a próxima partida.'}</p>
      ${fence.length ? html`<ul class="team-players">${fence.map(pid => html`<li>${avatar(people[pid], pid, { size: 32 })}<span class="grow ellipsis">${people[pid]?.name || '?'}</span>${gamesTag(day, pid)}${people[pid]?.guest ? html`<span class="badge">${cap(gx(g).guest)}</span>` : ''}
        ${isOwner ? html`<select data-assign="${pid}" aria-label="Encaixar ${people[pid]?.name || ''} em um time"><option value="">Encaixar em…</option>${dr.teams.map(t => html`<option value="${t.id}">${t.label} (${t.players.length})</option>`)}</select>` : ''}</li>`)}</ul>` : ''}</div>`;
}
