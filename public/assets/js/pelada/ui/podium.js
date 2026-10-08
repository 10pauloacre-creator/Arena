// Pódio de artilharia: top 3 com medalhas ouro/prata/bronze, demais colocados e abas Dia × Geral.
import { html, ic } from '../../ui/dom.js';
import { avatar } from './img.js';
import { dayShort } from './shell.js';
import { MEDALS } from '../../shared/pelada.js';
import { gx } from '../../shared/gender.js';

const GRAD = { gold: ['#ffe27a', '#d89a00'], silver: ['#f4f6fa', '#9aa5b5'], bronze: ['#f0b283', '#9d5a26'] };

/** Medalha em SVG (fita + disco com o número). */
export function medalSvg(kind, rank, size = 44) {
  const [a, b] = GRAD[kind] || GRAD.bronze;
  const id = `m${kind}${size}`;
  return html`<svg class="medal" width="${size}" height="${size}" viewBox="0 0 48 48" role="img" aria-label="Medalha de ${MEDALS[kind]?.label || ''}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <path d="M14 2h8l4 14-8 4z" fill="#d92d4a"/><path d="M34 2h-8l-4 14 8 4z" fill="#1a66f0"/>
    <circle cx="24" cy="30" r="15" fill="url(#${id})" stroke="rgb(0 0 0 / .18)" stroke-width="1.5"/><circle cx="24" cy="30" r="10.5" fill="none" stroke="rgb(255 255 255 / .55)" stroke-width="1.5"/>
    <text x="24" y="35.500" text-anchor="middle" font-size="15" font-weight="800" fill="rgb(40 28 0 / .78)" font-family="Plus Jakarta Sans, system-ui, sans-serif">${rank}</text></svg>`;
}

const goalsLabel = n => `${n} ${n === 1 ? 'gol' : 'gols'}`;

/** Conteúdo do pódio para uma lista já ranqueada [{ pid, goals, rank, medal }]. */
export function podiumList(ranking, people, G = gx()) {
  if (!ranking.length) return html`<div class="empty">${ic('goal')}<strong>Nenhum gol anotado ainda</strong><span>Quando ${G.o} ${G.owner} marcar os gols, a artilharia aparece aqui automaticamente.</span></div>`;
  const top = ranking.filter(r => r.medal), rest = ranking.filter(r => !r.medal);
  return html`<div class="podium" data-n="${Math.min(top.length, 3)}">${top.map(r => {
    const p = people[r.pid] || { name: '?' };
    return html`<div class="pod ${r.medal}" data-rank="${r.rank}"><span class="pod-medal">${medalSvg(r.medal, r.rank, r.rank === 1 ? 52 : 44)}</span>${avatar(p, r.pid, { size: r.rank === 1 ? 68 : 56 })}<strong class="pod-name">${p.name}</strong><span class="pod-goals"><b>${r.goals}</b> ${r.goals === 1 ? 'gol' : 'gols'}</span><span class="pod-step" aria-hidden="true">${r.rank}º</span></div>`;
  })}</div>
  ${rest.length ? html`<ol class="rank-rest" start="${rest[0].rank}">${rest.map(r => {
    const p = people[r.pid] || { name: '?' };
    return html`<li><span class="rk">${r.rank}º</span>${avatar(p, r.pid, { size: 32 })}<span class="grow ellipsis">${p.name}</span><b class="num">${goalsLabel(r.goals)}</b></li>`;
  })}</ol>` : ''}`;
}

/**
 * Painel completo com abas "Artilharia do Dia" × "Artilharia Geral" e botões de compartilhar.
 * `scope` = 'day' | 'general'. `selectDay` mostra um seletor de data (usado na página da pelada).
 */
export function podiumPanel(pel, { scope, dayId, selectDay = false }) {
  const day = pel.days.find(d => d.id === dayId) || null;
  const ranking = scope === 'general' || !day ? pel.ranking : day.ranking;
  return html`<section class="card podium-card" aria-label="Artilharia">
    <div class="row between wrap"><h3 class="card-title" style="margin:0">${ic('trophy')} Artilharia</h3>
      <div class="seg" role="group" aria-label="Tipo de artilharia"><button type="button" data-pod-tab="day" aria-pressed="${String(scope === 'day')}">Artilharia do Dia</button><button type="button" data-pod-tab="general" aria-pressed="${String(scope === 'general')}">Artilharia Geral</button></div></div>
    ${scope === 'day' && selectDay ? html`<div class="field" style="max-width:280px;margin-top:12px"><label for="pod-day" class="sr-only">Data</label><select id="pod-day" data-pod-day>${pel.days.map(d => html`<option value="${d.id}" ${d.id === dayId ? 'selected' : ''}>${dayShort(d.date)}</option>`)}</select></div>` : ''}
    <p class="muted small" style="margin:10px 0 14px">${scope === 'general' ? 'Soma de todos os gols de todas as partidas desta pelada.' : day ? `Gols marcados em ${dayShort(day.date)}.` : 'Escolha uma data.'}</p>
    ${podiumList(ranking, pel.people, gx(pel.gender))}
    <div class="share-row"><button type="button" class="btn btn-gold" data-share="copy">${ic('share', { size: 18 })} Compartilhar Resultados</button>
      <button type="button" class="btn" data-share="download">${ic('download', { size: 18 })} Baixar imagem</button>
      <button type="button" class="btn btn-ghost" data-share="text">${ic('copy', { size: 18 })} Copiar texto</button></div>
    <p class="hint" style="margin-top:8px">A imagem é copiada para a área de transferência: é só colar no grupo do WhatsApp.</p>
  </section>`;
}
