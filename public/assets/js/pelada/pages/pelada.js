// Página da pelada: capa, participar, convite (só o criador), datas de jogo, histórico público, artilharia e jogadores.
import { html, render, ic, $, copyText } from '../../ui/dom.js';
import { confirmDialog, openDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { api } from '../../api.js';
import { S } from '../session.js';
import { navigate } from '../../router.js';
import { page, wireShell, ensurePlayer, dayShort, dayLong } from '../ui/shell.js';
import { avatar, peladaAvatar, peladaImg } from '../ui/img.js';
import { qrSvg } from '../../ui/qr.js';
import { podiumPanel } from '../ui/podium.js';
import { matchLine } from '../ui/match.js';
import { resultsData, runShare } from '../ui/share.js';
import { composePreview } from '../ui/preview.js';
import { fetchPelada } from '../data.js';
import { poll } from '../ui/poll.js';
import { GENDERS, autoDrawLabel } from '../../shared/pelada.js';
import { gx, cap } from '../../shared/gender.js';
import { N, onNotif, savePrefs } from '../notify.js';

const TABS = [['jogos', 'Jogos', 'calendar'], ['historico', 'Histórico', 'clipboard-check'], ['artilharia', 'Artilharia', 'trophy'], ['jogadores', 'Jogadores', 'users']];
const DOW = new Intl.DateTimeFormat('pt-BR', { month: 'short' });
const dayParts = iso => { const [y, m, d] = iso.split('-').map(Number); return { d: String(d).padStart(2, '0'), mon: DOW.format(new Date(y, m - 1, d, 12)).replace('.', '').toUpperCase() }; };

export default async function (ctx) {
  const id = ctx.params.id;
  let tab = TABS.some(t => t[0] === ctx.params.tab) ? ctx.params.tab : 'jogos';
  const st = { pel: null, etag: null, offset: 0 };
  const ui = { podScope: 'day', podDay: null, novo: ctx.query.novo === '1', hist: null };
  document.title = 'Pelada';
  render(ctx.root, page(html`<div class="page-loading"><div class="spinner" role="status" aria-label="Carregando"></div></div>`));
  wireShell(ctx.root, ctx.signal);

  async function load(first) {
    const r = await fetchPelada(id, { etag: st.etag, signal: ctx.signal });
    if (!ctx.isCurrent() || r.notModified) return false;
    st.pel = r.pelada; st.etag = r.etag; st.offset = r.offset;
    if (first) {
      const today = st.pel.days.find(d => d.isToday) || st.pel.days.find(d => !d.isPast) || st.pel.days.at(-1);
      ui.podDay = today?.id || null;
      // abre direto na artilharia do dia mais recente com gols, se houver
    }
    return true;
  }
  try { await load(true); } catch (err) {
    if (!ctx.isCurrent()) return;
    return render(ctx.root, page(html`<div class="empty" style="margin-top:40px">${ic('search')}<strong>${err.status === 404 ? 'Pelada não encontrada' : 'Não foi possível abrir a pelada'}</strong><span>${err.message}</span><a class="btn btn-primary" href="/pelada/">Voltar ao início</a></div>`));
  }
  document.title = st.pel.name + ' · Pelada';

  const pel = () => st.pel;
  const isOwner = () => !!pel().viewer?.isOwner;
  const isMember = () => !!pel().viewer?.isMember;
  const G = () => gx(pel().gender); // textos no gênero da pelada (jogadora, organizadora, convidada…)

  // ------------------------------------------------------------ partes
  function header() {
    const p = pel(), g = GENDERS[p.gender], ownerP = p.people[p.owner];
    const cover = peladaImg(p.id, 'cover', p.img.cover);
    return html`<header class="pel-head ${cover ? 'has-cover' : ''} ${p.gender}">
      ${isMember() && !isOwner() ? html`<button type="button" class="leave-btn" data-leave aria-label="Sair da pelada" title="Sair da pelada">${ic('log-out', { size: 20 })}</button>` : ''}
      <div class="pel-cover">${cover ? html`<img src="${cover}" alt="" decoding="async">` : ''}</div>
      <div class="pel-id">${peladaAvatar(p, 84)}<div class="grow" style="min-width:0"><h1>${p.name}</h1>
        <div class="row wrap" style="gap:8px;margin-top:8px"><span class="badge ${p.gender === 'feminino' ? 'pink' : 'info'}">${g.emoji} ${g.label}</span><span class="badge">${ic('users', { size: 13 })} ${p.members.length} ${p.members.length === 1 ? 'participante' : 'participantes'}</span>
          <span class="badge">mín. ${p.minPerTeam} por time</span>${p.noTeams ? html`<span class="badge warn">Sem formação de times</span>` : p.autoDraw || p.generalDraw ? html`<span class="badge" title="Sorteios automáticos">${ic('shuffle', { size: 13 })} ${autoDrawLabel(p)}</span>` : ''}${p.demo ? html`<span class="badge warn">Demonstração</span>` : ''}
          <button type="button" class="badge idchip" data-copy="${p.id}" title="Copiar ID" aria-label="Copiar ID ${p.id}">ID ${p.id} ${ic('copy', { size: 13 })}</button></div>
        <p class="muted-on-dark small" style="margin:8px 0 0">Organizada por <b>${ownerP?.name || '—'}</b></p></div></div>
    </header>`;
  }

  /** Silenciar/ativar as notificações só desta pelada (atalho para Configurações). */
  function muteBtn() {
    if (!N.prefs || !N.prefs.enabled) return '';
    const muted = N.prefs.muted.includes(pel().id);
    return html`<button type="button" class="btn btn-sm ${muted ? '' : 'btn-ghost'}" data-mute aria-pressed="${String(muted)}" title="${muted ? 'Você não recebe notificações desta pelada' : 'Você recebe notificações desta pelada'}">${ic('bell', { size: 16 })} ${muted ? 'Notificações silenciadas' : 'Notificações ativadas'}</button>`;
  }

  function actions() {
    const p = pel();
    if (isOwner()) return html`<div class="pel-actions"><a class="btn btn-primary" href="/pelada/p/${p.id}/editar">${ic('pencil', { size: 16 })} Editar pelada</a><button type="button" class="btn" data-add-day>${ic('plus', { size: 16 })} Adicionar data</button><button type="button" class="btn btn-gold" data-invite aria-haspopup="dialog">${ic('qr-code', { size: 16 })} Convite</button><span class="badge gold">Você é ${G().o} ${G().owner}</span>${muteBtn()}</div>`;
    if (isMember()) return html`<div class="pel-actions"><span class="badge ok">${ic('circle-check', { size: 14 })} Você participa desta pelada</span>${muteBtn()}</div>`;
    return html`<div class="pel-actions"><button type="button" class="btn btn-lg btn-primary" data-join>${ic('user-plus', { size: 20 })} Participar da pelada</button><span class="muted small">${S.player ? 'Entre com um toque.' : 'Sem conta? Crie em 10 segundos.'}</span></div>`;
  }

  /** Convite (QR, link, ID e WhatsApp): fica num modal para não ocupar a tela da pelada. */
  function openInvite() {
    const inv = pel().invite;
    if (!inv) return;
    const msg = `⚽ Bora jogar? Entra na pelada "${pel().name}":\n${inv.url}\n\nID: ${inv.id}`;
    const d = openDialog({
      title: 'Convide a galera',
      body: html`<div class="stack-sm invite-modal"><div class="qr-box" aria-label="QR Code do link de convite" style="margin:0 auto">${qrSvg(inv.url, { margin: 1 })}</div>
        <span class="badge gold" style="align-self:center">só ${G().o} ${G().owner} vê</span>
        <span class="label">Link de convite</span><div class="copy-field"><input readonly value="${inv.url}" aria-label="Link de convite"><button class="btn btn-sm" data-copy="${inv.url}">${ic('copy', { size: 15 })} Copiar link</button></div>
        <span class="label">ID da pelada</span><div class="copy-field"><input readonly value="${inv.id}" aria-label="ID da pelada"><button class="btn btn-sm" data-copy="${inv.id}">${ic('copy', { size: 15 })} Copiar ID</button></div>
        <a class="btn btn-primary" target="_blank" rel="noopener" data-external href="https://wa.me/?text=${encodeURIComponent(msg)}">${ic('message-circle', { size: 16 })} Enviar no WhatsApp</a>
        <p class="hint" style="margin:0">Quem abrir o link entra na pelada; ou cole o ID no campo "ID da pelada" do app.</p></div>`,
      foot: html`<button class="btn" data-close>Fechar</button>`,
    });
    d.el.addEventListener('click', async e => {
      const copy = e.target.closest('[data-copy]');
      if (copy) toast((await copyText(copy.dataset.copy)) ? 'Copiado!' : 'Não foi possível copiar.', { type: 'success', ms: 1800 });
    });
  }

  const tabsBar = () => html`<div class="seg tabs" role="group" aria-label="Seções da pelada">${TABS.map(([k, label, icon]) => html`<button type="button" data-tab="${k}" aria-pressed="${String(tab === k)}">${ic(icon, { size: 16 })} ${label}</button>`)}</div>`;

  function daysTab() {
    const p = pel();
    if (!p.days.length) return html`<div class="empty">${ic('calendar')}<strong>Nenhuma data de jogo ainda</strong><span>${isOwner() ? 'Use "Adicionar data" para marcar o primeiro jogo.' : `${cap(G().o)} ${G().owner} ainda não marcou os jogos.`}</span></div>`;
    const upcoming = p.days.filter(d => !d.isPast), past = p.days.filter(d => d.isPast).reverse();
    const item = d => {
      const { d: dd, mon } = dayParts(d.date), jogos = d.matches.filter(m => m.status === 'finished').length;
      const first = d.attendance.slice(0, 6);
      return html`<article class="day-item ${d.isToday ? 'today' : ''}"><div class="di-date" aria-hidden="true"><b>${dd}</b><span>${mon}</span></div>
        <div class="grow" style="min-width:0"><strong>${dayLong(d.date)} ${d.isToday ? html`<span class="badge ok">Hoje</span>` : ''}${d.custom ? html` <span class="badge info" title="Organização personalizada">personalizada</span>` : ''}</strong>
          <span class="muted small" style="display:block">${d.attendance.length} ${d.attendance.length === 1 ? G().confirmed : G().confirmeds}${d.org.noTeams ? ' · sem formação de times' : ` · mín. ${d.org.minPerTeam} por time`}${jogos ? ` · ${jogos} ${jogos === 1 ? 'partida' : 'partidas'}` : ''}</span>
          ${first.length ? html`<span class="av-stack">${first.map(a => avatar(p.people[a.pid], a.pid, { size: 26 }))}${d.attendance.length > 6 ? html`<span class="av-more">+${d.attendance.length - 6}</span>` : ''}</span>` : ''}</div>
        <div class="di-act">${!d.isPast ? html`<button type="button" class="btn btn-sm ${d.present ? '' : 'btn-primary'}" data-presence="${d.id}">${d.present ? 'Retirar presença' : 'Marcar presença'}</button>` : ''}<a class="btn btn-sm" href="/pelada/p/${p.id}/d/${d.id}">Abrir dia ${ic('arrow-right', { size: 14 })}</a></div></article>`;
    };
    return html`${upcoming.length ? html`<h2 class="section-title">Próximos jogos</h2><div class="day-items">${upcoming.map(item)}</div>` : ''}
      ${past.length ? html`<h2 class="section-title">Jogos anteriores</h2><div class="day-items">${past.map(item)}</div>` : ''}`;
  }

  function historyTab() {
    const p = pel();
    const days = [...p.days].reverse().filter(d => d.matches.some(m => m.status === 'finished') || d.ranking.length);
    if (!days.length) return html`<div class="empty">${ic('clipboard-check')}<strong>O histórico ainda está vazio</strong><span>Os resultados e quem fez os gols aparecem aqui assim que ${G().o} ${G().owner} encerrar as partidas.</span></div>`;
    return html`<p class="muted small" style="margin:0 0 12px">Histórico público: qualquer ${G().player} pode consultar os resultados a qualquer momento.</p>
      <div class="hist">${days.map((d, i) => {
        const fin = d.matches.filter(m => m.status === 'finished' && m.a && m.b);
        const goals = d.ranking.reduce((s, r) => s + r.goals, 0);
        return html`<details class="hist-day" data-hd="${d.id}" ${(ui.hist ? ui.hist.has(d.id) : i === 0) ? 'open' : ''}><summary><span><b>${dayShort(d.date)}</b> <span class="muted small">${fin.length} ${fin.length === 1 ? 'partida' : 'partidas'} · ${goals} ${goals === 1 ? 'gol' : 'gols'}</span></span>${ic('chevron-down', { size: 18, cls: 'chev' })}</summary>
          ${fin.length ? html`<ul class="hist-list">${fin.map(m => matchLine(p, d, m))}</ul>` : ''}
          ${d.ranking.length ? html`<div class="hist-scorers"><b>Artilheiros do dia:</b> ${d.ranking.map(r => `${r.medal ? { gold: '🥇', silver: '🥈', bronze: '🥉' }[r.medal] + ' ' : ''}${p.people[r.pid]?.name || '?'} (${r.goals})`).join(' · ')}</div>` : ''}
          <a class="btn btn-sm" href="/pelada/p/${p.id}/d/${d.id}">Abrir o dia ${ic('arrow-right', { size: 14 })}</a></details>`;
      })}</div>`;
  }

  const scorersTab = () => podiumPanel(pel(), { scope: ui.podScope, dayId: ui.podDay, selectDay: true });

  function playersTab() {
    const p = pel(), goals = Object.fromEntries(p.ranking.map(r => [r.pid, r.goals]));
    const presences = pid => p.days.filter(d => d.attendance.some(a => a.pid === pid)).length;
    return html`<ul class="player-list card flush">${p.members.map(pid => html`<li>${avatar(p.people[pid], pid, { size: 40 })}<div class="grow" style="min-width:0"><strong class="ellipsis" style="display:block">${p.people[pid]?.name || '?'}</strong><span class="muted small">${presences(pid)} ${presences(pid) === 1 ? 'presença' : 'presenças'}</span></div>${pid === p.owner ? html`<span class="badge gold">${cap(G().owner)}</span>` : ''}<span class="badge">${goals[pid] || 0} ${(goals[pid] || 0) === 1 ? 'gol' : 'gols'}</span>${isOwner() && pid !== p.owner ? html`<button type="button" class="icon-btn danger" data-rm-member="${pid}" aria-label="Excluir ${p.people[pid]?.name || G().player} da pelada" title="Excluir da pelada">${ic('trash', { size: 18 })}</button>` : ''}</li>`)}</ul>`;
  }

  const dangerZone = () => isOwner() ? html`<div class="danger-zone"><button type="button" class="btn btn-sm btn-outline-danger" data-delete>${ic('trash', { size: 15 })} Excluir esta pelada</button></div>` : '';

  const body = () => ({ jogos: daysTab, historico: historyTab, artilharia: scorersTab, jogadores: playersTab })[tab]();

  function paint() {
    const y = window.scrollY;
    render(ctx.root, page(html`${header()}${actions()}${tabsBar()}<section class="tab-body" data-body>${body()}</section>${dangerZone()}`));
    wireShell(ctx.root, ctx.signal);
    window.scrollTo({ top: y });
    ui.novo = false;
  }
  const paintBody = () => { const el = $('[data-body]', ctx.root); if (el) el.innerHTML = body().s; $$tabs(); };
  const $$tabs = () => ctx.root.querySelectorAll('[data-tab]').forEach(b => { const on = b.dataset.tab === tab; b.setAttribute('aria-pressed', String(on)); });

  async function mutate(fn) {
    try {
      const r = await fn();
      st.pel = r.pelada; st.etag = null; if (r.now) st.offset = r.now - Date.now();
      paint();
      return r;
    } catch (err) {
      if (err.status === 401) { toast('Sua sessão expirou. Entre de novo para continuar.', { type: 'warn' }); await ensurePlayer({ mode: 'login', title: 'Entrar na sua conta' }); location.reload(); return null; }
      toast(err.message, { type: 'error' }); return null;
    }
  }
  const join = async () => {
    const me = await ensurePlayer({ title: 'Crie sua conta para participar', intro: 'Nome e data de nascimento: é só isso. Depois você marca presença e participa dos jogos.' });
    if (!me) return false;
    const r = await mutate(() => api.post(`/pelada/peladas/${id}/join`));
    if (r) toast('Você entrou na pelada!', { type: 'success' });
    return !!r;
  };

  ctx.root.addEventListener('click', async e => {
    const t = e.target;
    const copy = t.closest('[data-copy]');
    if (copy) { toast((await copyText(copy.dataset.copy)) ? 'Copiado!' : 'Não foi possível copiar.', { type: 'success', ms: 1800 }); return; }
    if (t.closest('[data-join]')) { await join(); return; }
    const tb = t.closest('[data-tab]');
    if (tb) { tab = tb.dataset.tab; history.replaceState({}, '', `/pelada/p/${id}${tab === 'jogos' ? '' : '/' + tab}`); paintBody(); return; }
    const pr = t.closest('[data-presence]');
    if (pr) {
      const me = await ensurePlayer({ title: 'Crie sua conta para marcar presença' });
      if (!me) return;
      const day = pel().days.find(d => d.id === pr.dataset.presence);
      await mutate(() => api.post(`/pelada/peladas/${id}/days/${day.id}/presence`, { present: !day.present }));
      return;
    }
    if (t.closest('[data-add-day]')) { addDayDialog(); return; }
    if (t.closest('[data-invite]')) { openInvite(); return; }
    if (t.closest('[data-leave]')) {
      if (!(await confirmDialog({ title: 'Sair da pelada?', text: `Você deixa de participar de "${pel().name}": ela some das suas peladas e você sai das listas de hoje e das próximas datas. Os gols que você já marcou continuam na artilharia. Para voltar, é só abrir o link de convite de novo.`, ok: 'Sair da pelada', danger: true }))) return;
      try { await api.post(`/pelada/peladas/${id}/leave`); toast('Você saiu da pelada.'); navigate('/pelada/painel'); } catch (err) { toast(err.message, { type: 'error' }); }
      return;
    }
    const rmm = t.closest('[data-rm-member]');
    if (rmm) {
      const pid = rmm.dataset.rmMember, name = pel().people[pid]?.name || 'esta pessoa';
      if (!(await confirmDialog({ title: `Excluir ${name} da pelada?`, text: `${name} deixa de participar e sai das listas de hoje e das próximas datas. Os gols que já marcou continuam somando na artilharia.`, ok: `Excluir ${G().player}`, danger: true }))) return;
      if (await mutate(() => api.del(`/pelada/peladas/${id}/members/${encodeURIComponent(pid)}`))) toast(`${name} foi ${G().excluded} da pelada.`, { type: 'success' });
      return;
    }
    const mb = t.closest('[data-mute]');
    if (mb) {
      const muted = N.prefs.muted.includes(id);
      mb.disabled = true;
      try {
        await savePrefs({ muted: muted ? N.prefs.muted.filter(x => x !== id) : [...N.prefs.muted, id] });
        toast(muted ? 'Você voltou a receber as notificações desta pelada.' : 'Notificações desta pelada silenciadas. Dá para reativar aqui ou em Configurações.', { type: 'success' });
      } catch (err) { toast(err.message, { type: 'error' }); }
      paint();
      return;
    }
    if (t.closest('[data-delete]')) {
      if (!(await confirmDialog({ title: 'Excluir a pelada?', text: 'Todas as datas, listas de presença, partidas e gols serão apagados para todos. Isso não pode ser desfeito.', ok: 'Excluir pelada', danger: true }))) return;
      try { await api.del(`/pelada/peladas/${id}`); toast('Pelada excluída.'); navigate('/pelada/painel'); } catch (err) { toast(err.message, { type: 'error' }); }
      return;
    }
    const pt = t.closest('[data-pod-tab]');
    if (pt) { ui.podScope = pt.dataset.podTab; paintBody(); return; }
    const sh = t.closest('[data-share]');
    if (sh) { sh.disabled = true; await runShare(resultsData(pel(), { scope: ui.podScope, dayId: ui.podDay }), sh.dataset.share); sh.disabled = false; }
  });
  ctx.root.addEventListener('toggle', e => {
    if (!e.target.matches?.('[data-hd]')) return;
    ui.hist = new Set([...ctx.root.querySelectorAll('[data-hd][open]')].map(x => x.dataset.hd));
  }, true);
  ctx.root.addEventListener('change', e => { if (e.target.matches('[data-pod-day]')) { ui.podDay = e.target.value; paintBody(); } });

  function addDayDialog() {
    const d = openDialog({
      title: 'Adicionar data de jogo',
      body: html`<div class="field"><label for="nd">Data do jogo</label><input id="nd" type="date" required><span class="hint">Para organização personalizada ou várias datas de uma vez, use "Editar pelada".</span></div><div class="form-error" hidden role="alert"></div>`,
      foot: html`<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" id="nd-go">${ic('plus', { size: 16 })} Adicionar</button>`,
    });
    $('#nd-go', d.el).addEventListener('click', async () => {
      const date = $('#nd', d.el).value;
      if (!date) { const b = $('.form-error', d.el); b.hidden = false; b.textContent = 'Escolha uma data.'; return; }
      try { const r = await api.post(`/pelada/peladas/${id}/days`, { date }); st.pel = r.pelada; st.etag = null; d.close('ok'); paint(); toast('Data adicionada.', { type: 'success' }); }
      catch (err) { const b = $('.form-error', d.el); b.hidden = false; b.textContent = err.message; }
    });
  }

  // peladas criadas antes da prévia do link: o organizador gera a imagem (capa + foto + nome) uma vez, ao abrir a pelada
  async function ensurePreview() {
    const p = pel();
    if (!isOwner() || p.img.preview || (!p.img.cover && !p.img.avatar)) return;
    const key = 'pelada.preview.' + p.id;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* sem armazenamento */ }
    const preview = await composePreview({ name: p.name, gender: p.gender, coverUrl: peladaImg(p.id, 'cover', p.img.cover), avatarUrl: peladaImg(p.id, 'avatar', p.img.avatar) });
    if (!preview || !ctx.isCurrent()) return;
    try { await api.patch(`/pelada/peladas/${id}`, { preview }); st.etag = null; } catch { /* tenta de novo na próxima visita */ }
  }

  paint();
  ensurePreview();
  // o botão de silenciar depende das preferências, que chegam junto com as notificações
  let prefsKey = JSON.stringify(N.prefs?.muted || null) + N.prefs?.enabled;
  ctx.onLeave(onNotif(() => {
    const k = JSON.stringify(N.prefs?.muted || null) + N.prefs?.enabled;
    if (k !== prefsKey && !document.querySelector('dialog[open]')) { prefsKey = k; paint(); }
  }));
  if (ctx.query.novo === '1' && isOwner()) openInvite(); // pelada recém-criada: já mostra o convite

  poll(ctx, async () => {
    if (document.querySelector('dialog[open]')) return;
    if (await load(false)) paint();
  }, { ms: 6000 });
}
