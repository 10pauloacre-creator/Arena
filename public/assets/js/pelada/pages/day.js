// Página do dia de jogo: presença, convidados, sorteio com animação, times, partidas (súmula + cronômetro) e artilharia.
import { html, render, ic, $ } from '../../ui/dom.js';
import { confirmDialog, openDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { api } from '../../api.js';
import { S } from '../session.js';
import { page, wireShell, ensurePlayer, dayLong } from '../ui/shell.js';
import { avatar } from '../ui/img.js';
import { emblem } from '../ui/emblem.js';
import { teamsHTML } from '../ui/teams.js';
import { matchCard, teamOf, matchTeam, isRunning } from '../ui/match.js';
import { podiumPanel } from '../ui/podium.js';
import { resultsData, runShare } from '../ui/share.js';
import { playShuffle } from '../ui/shuffle.js';
import { fetchPelada } from '../data.js';
import { armSound, playWhistle } from '../ui/sound.js';
import { poll } from '../ui/poll.js';
import { fmtClock, timerRemaining, planTeams, autoDrawLabel, GENDERS } from '../../shared/pelada.js';

const NO_TEAMS_TEXT = 'Esta opção desativa o sorteio automático de equipes. O sistema gerará apenas a lista de presença e permitirá a anotação individual de gols para o ranking de artilharia';

/** Atualiza o conteúdo de `el` só se mudou, preservando o foco e o que o usuário está digitando (data-keep / data-fid). */
function patch(el, markup) {
  if (el._h === markup) return;
  const act = document.activeElement;
  const inside = act && el.contains(act);
  const keepKey = inside && act.dataset?.keep, fid = inside && act.dataset?.fid;
  const sel = keepKey && act.selectionStart != null ? [act.selectionStart, act.selectionEnd] : null;
  const saved = [...el.querySelectorAll('[data-keep]')].map(i => [i.dataset.keep, i.value]);
  el.innerHTML = markup; el._h = markup;
  for (const [k, v] of saved) { const n = el.querySelector(`[data-keep="${k}"]`); if (n && v) n.value = v; }
  if (keepKey) { const n = el.querySelector(`[data-keep="${keepKey}"]`); if (n) { n.focus({ preventScroll: true }); if (sel) try { n.setSelectionRange(...sel); } catch { /* tipo sem seleção */ } } }
  else if (fid) el.querySelector(`[data-fid="${fid}"]`)?.focus({ preventScroll: true });
}

export default async function (ctx) {
  const { id, day: dayId } = ctx.params;
  const st = { pel: null, etag: null, offset: 0 };
  const ui = { expanded: new Set(), fixOpen: new Set(), flash: new Map(), prevStatus: new Map(), podScope: 'day', seenDraw: undefined, fresh: null, ended: new Set(), pending: 0, drawing: false, chain: Promise.resolve() };
  document.title = 'Dia de jogo · Pelada';
  render(ctx.root, page(html`<div class="page-loading"><div class="spinner" role="status" aria-label="Carregando"></div></div>`));
  wireShell(ctx.root, ctx.signal);

  async function load() {
    const r = await fetchPelada(id, { etag: st.etag, signal: ctx.signal });
    if (!ctx.isCurrent() || r.notModified) return false;
    st.pel = r.pelada; st.etag = r.etag; st.offset = r.offset;
    return true;
  }
  const notFound = (title, msg) => render(ctx.root, page(html`<div class="empty" style="margin-top:40px">${ic('search')}<strong>${title}</strong><span>${msg}</span><a class="btn btn-primary" href="${id ? '/pelada/p/' + id : '/pelada/'}">Voltar</a></div>`));
  try { await load(); } catch (err) { if (!ctx.isCurrent()) return; return notFound(err.status === 404 ? 'Pelada não encontrada' : 'Não foi possível abrir', err.message); }
  if (!st.pel.days.some(d => d.id === dayId)) return notFound('Data não encontrada', 'Esta data de jogo não existe (ou foi removida).');

  const pel = () => st.pel;
  const day = () => st.pel.days.find(d => d.id === dayId);
  const isOwner = () => !!pel().viewer?.isOwner;
  const base = `/pelada/peladas/${id}/days/${dayId}`;
  const serverNow = () => Date.now() + st.offset;
  ui.seenDraw = day().draw?.id ?? null;
  document.title = `${dayLong(day().date)} · ${pel().name}`;

  // ------------------------------------------------------------ esqueleto
  render(ctx.root, page(html`<div data-sec="head"></div><div class="day-grid"><div class="stack-lg"><div data-sec="presence"></div><div data-sec="draw"></div><div data-sec="matches"></div></div><div class="stack-lg"><div data-sec="podium"></div></div></div>`, { cls: 'day' }));
  wireShell(ctx.root, ctx.signal);
  armSound(ctx.signal); // libera o áudio no primeiro toque (o apito só toca depois de uma interação)
  const sec = n => $(`[data-sec=${n}]`, ctx.root);

  // ------------------------------------------------------------ seções
  function headSec() {
    const p = pel(), d = day();
    const label = d.isToday ? 'Jogo de hoje' : d.isPast ? 'Jogo encerrado' : 'Próximo jogo';
    return html`<a class="btn btn-ghost btn-sm" href="/pelada/p/${p.id}">${ic('arrow-left', { size: 16 })} ${p.name}</a>
      <header class="day-hero ${p.gender}"><div><span class="eyebrow">${ic('calendar', { size: 15 })} ${label}</span><h1>${dayLong(d.date)}</h1>
        <div class="row wrap" style="gap:8px;margin-top:10px"><span class="badge dark-on">${GENDERS[p.gender].emoji} ${GENDERS[p.gender].label}</span>${d.org.noTeams ? html`<span class="badge warn">Sem formação de times</span>` : html`<span class="badge dark-on">mín. ${d.org.minPerTeam} por time</span><span class="badge dark-on">${ic('timer', { size: 13 })} ${d.org.matchMinutes} min por partida</span>${d.org.autoDraw ? html`<span class="badge dark-on" title="Sorteio automático de jogadores">${ic('shuffle', { size: 13 })} ${autoDrawLabel(d.org).replace('Sorteio automático ', 'Auto ')}</span>` : ''}`}${d.custom ? html`<span class="badge info">Organização personalizada</span>` : ''}${p.demo ? html`<span class="badge warn">Demonstração</span>` : ''}</div></div>
        <div class="hero-count"><b>${d.attendance.length}</b><span>${d.attendance.length === 1 ? 'confirmado' : 'confirmados'}</span></div></header>`;
  }

  function presenceSec() {
    const p = pel(), d = day(), v = p.viewer, owner = isOwner();
    const nameOf = pid => p.people[pid]?.name || '?';
    const g = GENDERS[p.gender];
    return html`<section class="card presence" aria-label="Lista de presença">
      <div class="row between wrap" style="gap:14px"><div><h2 class="card-title" style="margin:0">${ic('list-checks')} Lista de presença</h2><p class="muted small" style="margin:4px 0 0">${d.present ? 'Você está confirmado neste dia.' : v ? 'Confirme sua presença para entrar na lista e no sorteio.' : 'Crie sua conta rapidinho para participar e marcar presença.'}</p></div>
        ${v ? html`<button type="button" class="btn btn-lg ${d.present ? 'btn-outline-danger' : 'btn-primary'}" data-act="presence" data-fid="presence">${ic(d.present ? 'x' : 'circle-check', { size: 20 })} ${d.present ? 'Retirar Presença' : 'Marcar Presença'}</button>`
          : html`<button type="button" class="btn btn-lg btn-primary" data-act="presence" data-fid="presence">${ic('user-plus', { size: 20 })} Participar da pelada</button>`}</div>
      <h3 class="list-title">Lista de Confirmados <span class="badge">${d.attendance.length}</span></h3>
      ${d.attendance.length ? html`<ul class="confirmed">${d.attendance.map((a, i) => html`<li class="${a.pid === v?.pid ? 'me' : ''}"><span class="n">${i + 1}</span>${avatar(p.people[a.pid], a.pid, { size: 38 })}<span class="grow ellipsis"><b>${nameOf(a.pid)}</b>${a.pid === v?.pid ? html` <span class="badge ok">Você</span>` : ''}${a.guest ? html` <span class="badge">Convidado</span>` : ''}${a.pid === p.owner ? html` <span class="badge gold">Organizador</span>` : ''}</span>
          ${owner ? html`<button type="button" class="icon-btn" data-rm-att="${a.pid}" aria-label="Remover ${nameOf(a.pid)} da lista">${ic('x', { size: 18 })}</button>` : ''}</li>`)}</ul>`
        : html`<div class="empty">${ic('users')}<strong>Ninguém confirmou ainda</strong><span>Seja ${g.article === 'as' ? 'a primeira' : 'o primeiro'}: toque em ${v ? '"Marcar Presença"' : '"Participar da pelada"'}.</span></div>`}
      ${owner ? html`<form class="guest-form" data-guest-form novalidate><div class="field"><label for="g-name">Adicionar convidado</label><input id="g-name" name="name" data-keep="g-name" maxlength="40" autocomplete="off" placeholder="Nome de quem chegou"></div>
        ${d.draw ? html`<div class="field"><label for="g-team">Entra em</label><select id="g-team" name="teamId" data-keep="g-team"><option value="free" selected>Cerca (aguarda a próxima partida)</option>${d.draw.teams.map(t => html`<option value="${t.id}">${t.label} (${t.players.length})</option>`)}</select></div>` : ''}
        <button class="btn" type="submit">${ic('user-plus', { size: 16 })} Adicionar</button>
        <p class="hint" style="grid-column:1/-1;margin:0">${d.draw ? 'O convidado chegou depois do sorteio: ele entra na Cerca e aguarda a próxima partida, ou você o encaixa em um time agora.' : 'O convidado entra na lista e no sorteio de times.'} Os gols dele contam na artilharia.</p></form>` : ''}
    </section>`;
  }

  function drawSec() {
    const p = pel(), d = day(), owner = isOwner();
    if (d.org.noTeams) {
      return html`<section class="card" aria-label="Gols do dia"><h2 class="card-title">${ic('target')} Sem formação de times</h2>
        <div class="form-note">${ic('info', { size: 16 })}<span>${NO_TEAMS_TEXT}.</span></div>
        <h3 class="list-title">Gols do dia</h3>
        ${d.attendance.length ? html`<ul class="loose-list">${d.attendance.map(a => html`<li>${avatar(p.people[a.pid], a.pid, { size: 36 })}<span class="grow ellipsis"><b>${p.people[a.pid]?.name || '?'}</b>${a.guest ? html` <span class="badge">Convidado</span>` : ''}</span>
          ${owner ? html`<button type="button" class="icon-btn" data-loose="${a.pid}" data-delta="-1" aria-label="Menos um gol de ${p.people[a.pid]?.name || ''}" ${(d.looseGoals[a.pid] || 0) ? '' : 'disabled'}>${ic('minus')}</button>` : ''}<output class="loose-n" aria-label="gols">${d.looseGoals[a.pid] || 0}</output>
          ${owner ? html`<button type="button" class="icon-btn plus" data-loose="${a.pid}" data-delta="1" aria-label="Mais um gol de ${p.people[a.pid]?.name || ''}">${ic('plus')}</button>` : ''}</li>`)}</ul>` : html`<div class="empty">${ic('users')}<span>Quando houver confirmados, anote os gols deles aqui.</span></div>`}</section>`;
    }
    const started = d.matches.some(m => m.status !== 'scheduled');
    const how = autoDrawLabel(d.org);
    if (!d.draw) {
      const n = d.attendance.length, plan = planTeams(n, d.org.minPerTeam);
      const preview = plan.ok
        ? `Com ${n} confirmados: ${plan.k} ${plan.k === 1 ? 'time' : 'times'} de ${d.org.minPerTeam}${plan.r ? `; ${plan.r === 1 ? 'a sobra de 1 jogador vai' : `as ${plan.r} sobras vão`} para a Cerca` : ''}.`
        : plan.error;
      return html`<section class="card draw-card" aria-label="Sorteio"><h2 class="card-title">${ic('shuffle')} Sorteio de times</h2>
        <p class="muted" style="margin:0">Times de <b>${d.org.minPerTeam}</b> jogadores. Quem sobra fica na <b>Cerca</b>: aguarda a próxima partida e entra no time que perder. ${how}.</p>
        ${owner ? html`<p class="small" style="margin:10px 0 0">${ic('sparkles', { size: 14 })} ${preview}</p>
          <div style="margin-top:16px"><button type="button" class="btn btn-xl btn-gold" data-act="draw" data-fid="draw" ${plan.ok ? '' : 'disabled'}>${ic('shuffle', { size: 22 })} Sortear Times</button></div>`
          : html`<p class="hint" style="margin-top:10px">${ic('hourglass', { size: 14 })} O organizador faz o sorteio. Assim que ele sortear, os times aparecem aqui.</p>`}
      </section>`;
    }
    return html`<section class="card" aria-label="Times sorteados"><div class="row between wrap"><h2 class="card-title" style="margin:0">${ic('shuffle')} Times sorteados</h2>
        ${owner ? html`<button type="button" class="btn btn-gold" data-act="draw" data-fid="draw">${ic('shuffle', { size: 18 })} Sortear Times</button>` : ''}</div>
      <p class="muted small" style="margin:6px 0 ${owner ? '4px' : '14px'}">Toque no nome do time para ver ${GENDERS[p.gender].players === 'jogadoras' ? 'as jogadoras' : 'os jogadores'}. ${how}.</p>
      ${owner ? html`<p class="muted small" style="margin:0 0 14px">${started ? 'O sorteio fica sempre ativo: com a partida em andamento, os times em quadra se mantêm e os demais jogadores e a Cerca são sorteados para a próxima partida.' : 'Dá para refazer o sorteio enquanto nenhuma partida começou.'}</p>` : ''}
      ${teamsHTML(p, d, { expanded: ui.expanded, isOwner: owner, fresh: ui.fresh === d.draw.id })}</section>`;
  }

  function matchesSec() {
    const p = pel(), d = day(), owner = isOwner();
    if (d.org.noTeams) return '';
    if (!d.draw && !d.matches.length) return '';
    const queue = (d.queue || []).map(tid => teamOf(d, tid)?.label).filter(Boolean);
    const now = serverNow();
    return html`<section class="card matches" aria-label="Partidas"><div class="row between wrap"><h2 class="card-title" style="margin:0">${ic('swords')} Partidas</h2>
        ${owner ? html`<button type="button" class="btn btn-primary" data-act="add-match" data-fid="add-match" ${d.draw ? '' : 'disabled'} title="${d.draw ? '' : 'Faça o sorteio primeiro'}">${ic('plus', { size: 18 })} Adicionar partida</button>` : ''}</div>
      ${d.draw && queue.length ? html`<p class="queue small"><b>Fila (de fora):</b> ${queue.join(' → ')}</p>` : ''}
      ${d.matches.length ? html`<div class="match-list">${d.matches.map((m, i) => matchCard(p, d, m, { isOwner: owner, now, index: i, fixOpen: ui.fixOpen, flash: ui.flash }))}</div>`
        : html`<div class="empty">${ic('swords')}<strong>Nenhuma partida ainda</strong><span>${owner ? 'Toque em "Adicionar partida", escolha os dois times e inicie o cronômetro. Ao encerrar, a próxima partida é criada sozinha.' : 'O organizador ainda não criou as partidas.'}</span></div>`}</section>`;
  }

  const podiumSec = () => podiumPanel(pel(), { scope: ui.podScope, dayId });

  /** Fim do tempo: apito de árbitro bem alto, vibração e o relógio pisca em vermelho por alguns segundos (em todos os aparelhos). */
  function timeUp(mid) {
    playWhistle();
    ui.flash.set(mid, serverNow() + 6000);
    paint();
    setTimeout(() => { ui.flash.delete(mid); if (ctx.isCurrent()) paint(); }, 6100);
  }

  function paint() {
    for (const m of day().matches) { // partida que acabou por tempo esgotado (visto por quem só acompanha)
      const was = ui.prevStatus.get(m.id);
      ui.prevStatus.set(m.id, m.status);
      if (was === 'live' && m.status === 'finished' && timerRemaining(m.timer, serverNow()) <= 0 && !ui.ended.has(m.id)) { ui.ended.add(m.id); queueMicrotask(() => timeUp(m.id)); }
    }
    patch(sec('head'), headSec().s);
    patch(sec('presence'), presenceSec().s);
    patch(sec('draw'), drawSec().s);
    patch(sec('matches'), matchesSec().s);
    patch(sec('podium'), podiumSec().s);
    tick();
  }

  // ------------------------------------------------------------ ações
  function apply(r) {
    if (r?.pelada) { st.pel = r.pelada; st.etag = null; }
    if (r?.now) st.offset = r.now - Date.now();
    paint();
  }
  async function onError(err, quiet = []) {
    if (quiet.includes(err.code)) return;
    if (err.status === 401) {
      toast('Sua sessão expirou. Entre de novo para continuar.', { type: 'warn' });
      const p = await ensurePlayer({ mode: 'login', title: 'Entrar na sua conta' });
      if (p) location.reload();
      return;
    }
    toast(err.message, { type: 'error' });
    try { st.etag = null; if (await load()) paint(); } catch { /* ignora */ }
  }
  /** Ações do organizador em fila (ordem garantida). */
  function enqueue(fn, { quiet = [] } = {}) {
    ui.pending++;
    const job = ui.chain.then(async () => { try { const r = await fn(); apply(r); return r; } catch (err) { await onError(err, quiet); return null; } finally { ui.pending--; } });
    ui.chain = job.catch(() => null);
    return job;
  }
  const post = (path, body = {}) => api.post(`${base}${path}`, body);

  async function togglePresence() {
    let me = S.player;
    if (!me) {
      me = await ensurePlayer({ title: 'Crie sua conta para participar', intro: 'Nome e data de nascimento: só isso. Sua presença é marcada em seguida.' });
      if (!me) return;
    }
    const want = !(pel().viewer?.id === me.id && day().present);
    // atualização imediata (otimista): nome e foto aparecem na hora para quem clicou
    const d = day(), pid = `u:${me.id}`;
    if (pel().viewer?.id === me.id) {
      if (want && !d.attendance.some(a => a.pid === pid)) { d.attendance.push({ pid, at: Date.now(), guest: false }); pel().people[pid] = { name: me.name, av: me.av || 0 }; }
      if (!want) d.attendance = d.attendance.filter(a => a.pid !== pid);
      d.present = want; paint();
    }
    await enqueue(() => post('/presence', { present: want }));
    if (want) toast('Presença confirmada! Seu nome já está na lista.', { type: 'success', ms: 2500 });
  }

  async function doDraw() {
    if (ui.drawing) return;
    ui.drawing = true; // a atualização automática espera: a animação é desta pessoa
    try {
      const d = day();
      const locked = new Set(d.matches.filter(m => m.status === 'live').flatMap(m => [m.a, m.b]).flatMap(id => teamOf(d, id)?.players || []));
      const names = d.attendance.filter(a => !locked.has(a.pid)).map(a => pel().people[a.pid]?.name || '?');
      const req = post('/draw').then(r => ({ r }), e => ({ e }));
      const anim = playShuffle(names, { ms: 5000 });
      const out = await Promise.race([req, anim.then(() => null)]);
      if (out?.e) { anim.cancel(); await onError(out.e); return; } // falhou na hora: não faz o usuário esperar
      const res = await req;
      if (res.r) ui.seenDraw = res.r.drawId;
      await anim;
      if (res.e) { await onError(res.e); return; }
      ui.fresh = res.r.drawId; ui.expanded.clear();
      apply(res.r);
      setTimeout(() => { ui.fresh = null; }, 2500);
      toast('Times sorteados!', { type: 'success' });
    } finally { ui.drawing = false; }
  }

  function pickTeam(m, side) {
    const d = day();
    const busy = new Set(d.matches.filter(x => x.id !== m.id && x.status !== 'finished').flatMap(x => [x.a, x.b]).filter(Boolean));
    return new Promise(resolve => {
      let chosen;
      const dlg = openDialog({
        title: `Escolher o time ${side === 'a' ? 'A' : 'B'}`,
        body: html`<p class="muted small" style="margin:0">Escolha entre os times sorteados.${d.queue.length ? ` Próximos da fila: ${d.queue.map(t => teamOf(d, t).label).join(' → ')}.` : ''}</p>
          <div class="pick-list">${d.draw.teams.map(t => html`<button type="button" class="pick ${m[side] === t.id ? 'cur' : ''}" data-pick="${t.id}" ${busy.has(t.id) || (m[side === 'a' ? 'b' : 'a'] === t.id) ? 'disabled' : ''}><span class="team-emb">${emblem(t, 28)}</span><span class="grow" style="text-align:left">${t.label}</span><span class="muted small">${t.players.length} ${busy.has(t.id) ? '· em outra partida' : m[side === 'a' ? 'b' : 'a'] === t.id ? '· já escolhido' : ''}</span></button>`)}</div>`,
        foot: html`${m[side] ? html`<button class="btn btn-outline-danger" data-pick="">Limpar vaga</button>` : ''}<button class="btn" data-close>Cancelar</button>`,
      });
      dlg.el.addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b && !b.disabled) { chosen = b.dataset.pick; dlg.close('ok'); } });
      dlg.closed.then(() => resolve(chosen));
    });
  }

  function pickLoan(m, teamId) {
    const d = day(), p = pel();
    const inMatch = new Set([...(matchTeam(d, m, 'a')?.players || []), ...(matchTeam(d, m, 'b')?.players || []), ...Object.values(m.loans).flat()]);
    const groups = [];
    if (d.fence.length) groups.push({ title: 'Cerca', pids: d.fence.filter(x => !inMatch.has(x)) });
    for (const t of d.draw.teams) if (t.id !== m.a && t.id !== m.b) groups.push({ title: `${t.label}${d.queue.includes(t.id) ? ' · de fora' : ''}`, pids: t.players.filter(x => !inMatch.has(x)) });
    const list = groups.filter(g => g.pids.length);
    const team = m.a === teamId ? matchTeam(d, m, 'a') : matchTeam(d, m, 'b');
    return new Promise(resolve => {
      let chosen;
      const dlg = openDialog({
        title: `Jogador de fora para o ${team.label}`,
        body: list.length ? html`<p class="muted small" style="margin:0">O jogador escolhido atua só nesta partida e pode marcar gols para o ${team.label}.</p>${list.map(g => html`<div><h4 class="list-title" style="margin:8px 0 6px">${g.title}</h4><div class="pick-list">${g.pids.map(pid => html`<button type="button" class="pick" data-pick="${pid}">${avatar(p.people[pid], pid, { size: 30 })}<span class="grow" style="text-align:left">${p.people[pid]?.name || '?'}</span></button>`)}</div></div>`)}`
          : html`<div class="empty">${ic('users')}<span>Não há jogadores de fora disponíveis agora.</span></div>`,
        foot: html`<button class="btn" data-close>Fechar</button>`,
      });
      dlg.el.addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) { chosen = b.dataset.pick; dlg.close('ok'); } });
      dlg.closed.then(() => resolve(chosen));
    });
  }

  const goalParts = el => { const [teamId, pid] = (el.dataset.goal || el.dataset.ungoal || el.dataset.unloan || '').split('|'); return { teamId, pid: pid || null }; };

  ctx.root.addEventListener('click', async e => {
    const t = e.target;
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'presence') return togglePresence();
    if (act === 'draw' && day().draw) {
      const started = day().matches.some(m => m.status !== 'scheduled');
      const auto = day().org.autoDraw;
      if (!(await confirmDialog({
        title: started ? 'Sortear a próxima composição?' : 'Refazer o sorteio?',
        text: started
          ? `Os times que estão em quadra e o vencedor que continua se mantêm. Os outros jogadores e a Cerca serão sorteados para a próxima partida${auto ? ' (quem está na Cerca entra obrigatoriamente)' : ''}.`
          : 'Os times atuais serão descartados e um novo sorteio será feito com a lista de presença de agora.',
        ok: 'Sortear Times' }))) return;
      return doDraw();
    }
    if (act === 'draw') return doDraw();
    if (act === 'add-match') { await enqueue(() => post('/matches')); return; }
    const tg = t.closest('[data-team-toggle]');
    if (tg) { const k = tg.dataset.teamToggle; ui.expanded.has(k) ? ui.expanded.delete(k) : ui.expanded.add(k); patch(sec('draw'), drawSec().s); return; }
    const rm = t.closest('[data-rm-att]');
    if (rm) {
      const pid = rm.dataset.rmAtt, name = pel().people[pid]?.name || 'esta pessoa';
      if (await confirmDialog({ title: 'Remover da lista?', text: `${name} sai da lista de presença deste dia (e do time, se já houver sorteio).`, ok: 'Remover', danger: true })) await enqueue(() => api.del(`${base}/attendance/${encodeURIComponent(pid)}`));
      return;
    }
    const loose = t.closest('[data-loose]');
    if (loose) { await enqueue(() => post('/goals', { pid: loose.dataset.loose, delta: Number(loose.dataset.delta) })); return; }

    // partidas
    const slot = t.closest('[data-slot]');
    if (slot && isOwner() && !slot.disabled) {
      const m = day().matches.find(x => x.id === slot.dataset.match);
      if (!day().draw) { toast('Faça o sorteio dos times primeiro.', { type: 'warn' }); return; }
      const chosen = await pickTeam(m, slot.dataset.slot);
      if (chosen === undefined) return;
      await enqueue(() => api.patch(`${base}/matches/${m.id}`, { [slot.dataset.slot]: chosen || null }));
      return;
    }
    const tm = t.closest('[data-timer]');
    if (tm) {
      const mid = tm.dataset.match, a = tm.dataset.timer;
      const body = { action: a };
      if (a === 'set') body.minutes = Number($(`[data-mins="${mid}"]`, ctx.root).value);
      await enqueue(() => post(`/matches/${mid}/timer`, body));
      return;
    }
    const goal = t.closest('[data-goal]');
    if (goal) {
      const { teamId, pid } = goalParts(goal), mid = goal.dataset.match;
      // placar imediato (otimista)
      const m = day().matches.find(x => x.id === mid);
      m.goals.push({ id: 'tmp' + Date.now(), teamId, pid, at: Date.now() }); m.score[m.a === teamId ? 'a' : 'b']++; paint();
      await enqueue(() => post(`/matches/${mid}/goals`, { teamId, pid }));
      return;
    }
    const ug = t.closest('[data-ungoal]');
    if (ug) {
      const { teamId, pid } = goalParts(ug), m = day().matches.find(x => x.id === ug.dataset.match);
      const last = [...m.goals].reverse().find(g => g.teamId === teamId && (g.pid || null) === pid);
      if (last && !String(last.id).startsWith('tmp')) await enqueue(() => api.del(`${base}/matches/${m.id}/goals/${last.id}`));
      return;
    }
    const loan = t.closest('[data-loan]');
    if (loan) {
      const m = day().matches.find(x => x.id === loan.dataset.match);
      const pid = await pickLoan(m, loan.dataset.loan);
      if (pid) await enqueue(() => post(`/matches/${m.id}/loans`, { teamId: loan.dataset.loan, pid }));
      return;
    }
    const unloan = t.closest('[data-unloan]');
    if (unloan) { const { teamId, pid } = goalParts(unloan); await enqueue(() => post(`/matches/${unloan.dataset.match}/loans`, { teamId, pid, remove: true })); return; }
    const fin = t.closest('[data-finish]');
    if (fin) {
      const m = day().matches.find(x => x.id === fin.dataset.finish);
      const r = await enqueue(() => post(`/matches/${m.id}/finish`));
      if (r) toast(r.next ? (r.info?.rotation ? 'Partida encerrada! Sorteio automático feito e a próxima partida já foi criada.' : 'Partida encerrada! A próxima partida já foi criada.') : 'Partida encerrada.', { type: 'success' });
      return;
    }
    const dm = t.closest('[data-del-match]');
    if (dm) {
      const idx = day().matches.findIndex(x => x.id === dm.dataset.delMatch);
      if (await confirmDialog({ title: `Excluir a partida ${idx + 1}?`, text: 'Os gols dela deixam de contar na artilharia. Os times voltam para a fila.', ok: 'Excluir partida', danger: true })) await enqueue(() => api.del(`${base}/matches/${dm.dataset.delMatch}`));
      return;
    }

    // artilharia / compartilhar
    const pt = t.closest('[data-pod-tab]');
    if (pt) { ui.podScope = pt.dataset.podTab; patch(sec('podium'), podiumSec().s); return; }
    const sh = t.closest('[data-share]');
    if (sh) { sh.disabled = true; await runShare(resultsData(pel(), { scope: ui.podScope, dayId }), sh.dataset.share); sh.disabled = false; }
  });

  ctx.root.addEventListener('toggle', e => {
    const f = e.target.matches?.('[data-fix]') ? e.target : null;
    if (f) f.open ? ui.fixOpen.add(f.dataset.fix) : ui.fixOpen.delete(f.dataset.fix);
  }, true);

  ctx.root.addEventListener('change', async e => {
    const a = e.target.closest('[data-assign]');
    if (a && a.value) await enqueue(() => post('/assign', { pid: a.dataset.assign, teamId: a.value === '__fence' ? null : a.value }));
  });
  ctx.root.addEventListener('click', async e => {
    const c = e.target.closest('[data-captain]');
    if (c) await enqueue(() => post('/captain', { pid: c.dataset.captain, teamId: c.dataset.captainTeam }));
  });

  ctx.root.addEventListener('submit', async e => {
    if (!e.target.matches('[data-guest-form]')) return;
    e.preventDefault();
    const f = e.target, name = f.name.value.trim();
    if (name.length < 2) { toast('Digite o nome do convidado.', { type: 'warn' }); f.name.focus(); return; }
    const r = await enqueue(() => post('/guests', { name, teamId: f.teamId?.value }));
    if (r) { toast(`${name} foi adicionado${day().draw ? '' : ' à lista e entra no sorteio'}.`, { type: 'success' }); const n = $('#g-name', ctx.root); if (n) { n.value = ''; n.focus(); } }
  });

  // ------------------------------------------------------------ relógio, fim de tempo e atualização
  function tick() {
    const d = day();
    if (!d) return;
    const now = serverNow();
    for (const m of d.matches) {
      const rem = timerRemaining(m.timer, now);
      const el = ctx.root.querySelector(`[data-clock="${m.id}"]`);
      if (el && isRunning(m)) { const txt = fmtClock(rem); if (el.textContent !== txt) el.textContent = txt; } // só o que está rodando muda na tela
      if (rem > 0) { ui.ended.delete(m.id); continue; }
      if (isRunning(m) && !ui.ended.has(m.id)) {
        ui.ended.add(m.id); timeUp(m.id);
        if (isOwner()) {
          enqueue(() => post(`/matches/${m.id}/finish`, { auto: true }), { quiet: ['TIMER_RUNNING', 'MATCH_FINISHED'] }).then(r => {
            if (r) toast(r.next ? (r.info?.rotation ? 'Tempo esgotado! Partida encerrada, sorteio automático feito e a próxima já foi criada.' : 'Tempo esgotado! Partida encerrada e a próxima já foi criada.') : 'Tempo esgotado! Partida encerrada.', { type: 'success', ms: 5000 });
            else setTimeout(() => ui.ended.delete(m.id), 1200);
          });
        } else paint();
      }
    }
  }
  const clock = setInterval(tick, 250);
  ctx.onLeave(() => clearInterval(clock));

  async function refresh() {
    if (ui.pending > 0 || ui.drawing) return;
    if (!(await load())) return;
    const d = day();
    if (!d) return;
    const dr = d.draw;
    if (dr && dr.id !== ui.seenDraw) {
      const fresh = ui.seenDraw !== undefined && serverNow() - dr.at < 25_000;
      ui.seenDraw = dr.id;
      if (fresh) { await playShuffle(d.attendance.map(a => pel().people[a.pid]?.name || '?')); ui.fresh = dr.id; ui.expanded.clear(); setTimeout(() => { ui.fresh = null; }, 2500); }
    } else if (!dr) ui.seenDraw = null;
    paint();
  }
  poll(ctx, refresh, { ms: 3500 });
  paint();
}
