// Jogos ao vivo: placar, relógio, lances, encerramento e transmissão.
import { html, render, ic, $, on, setBusy } from '../../ui/dom.js';
import { scoreboardHTML, timelineHTML, startClockTicker, minuteOf, teamMap } from '../../ui/match.js';
import { streamEmbedHTML } from '../../ui/util.js';
import { openDialog, confirmDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { api } from '../../api.js';
import { SPORTS, EVENT_LABELS } from '../../shared/sports.js';

export default function (app, ctx) {
  let key = ctx.query.m || null;

  const allMatches = t => t.bracket ? [...t.bracket.rounds.flatMap(r => r.matches), ...t.bracket.playins] : [];
  const playable = t => allMatches(t).filter(m => m.a && m.b && !m.bye && m.phase !== 'finished');
  const find = (t, k) => allMatches(t).find(m => m.key === k);
  function pick(t) {
    const list = playable(t);
    if (key && list.some(m => m.key === key && m.phase !== 'blocked')) return find(t, key);
    const next = list.find(m => m.phase === 'live') || list.find(m => m.phase === 'paused') || list.find(m => m.phase === 'scheduled');
    key = next?.key || null;
    return next || null;
  }

  // ações em fila: toques rápidos (ex.: várias cestas seguidas) não se perdem nem se atropelam
  let chain = Promise.resolve();
  function run(body, { silent = false, ok = null } = {}) {
    const k = key;
    const p = chain.then(() => app.act(() => api.post(`/tournaments/${app.t.id}/matches/${encodeURIComponent(k)}`, body), { silent, ok }));
    chain = p.catch(() => {});
    return p;
  }

  function controls(t, m) {
    const sp = SPORTS[t.sport], A = teamMap(t).get(m.a), B = teamMap(t).get(m.b);
    const over = m.phase === 'finished' || !!m.decided;
    const incs = t.sport === 'basquete' ? [1, 2, 3] : [1];
    const side = (s, X) => html`<div class="ctl"><button class="btn-score" data-act="minus" data-side="${s}" aria-label="Remover último ${sp.unit.toLowerCase()} de ${X.name}" ${over ? 'disabled' : ''}>${ic('minus', { size: 18 })}</button>${incs.map(n => html`<button class="btn-score plus" data-act="plus" data-side="${s}" data-pts="${n}" aria-label="Adicionar ${n} ${n > 1 ? sp.unitPl : sp.unit.toLowerCase()} para ${X.name}" ${over ? 'disabled' : ''}>+${n}</button>`)}</div>`;
    const running = m.phase === 'live';
    const started = m.clock && (m.clock.elapsedMs > 0 || m.clock.status !== 'idle');
    return html`<div class="sb-controls">${side('a', A)}${side('b', B)}</div>
      <div class="clock-row">
        ${sp.mode === 'clock' ? html`<button class="btn btn-primary" data-act="${running ? 'pause' : 'start'}" ${over ? 'disabled' : ''}>${ic(running ? 'pause' : 'play', { size: 18 })} ${running ? 'Pausar' : (started ? 'Retomar' : 'Iniciar jogo')}</button>
          <button class="btn" data-act="adjust" data-min="1" ${over ? 'disabled' : ''}>+1'</button><button class="btn" data-act="adjust" data-min="5" ${over ? 'disabled' : ''}>+5'</button><button class="btn" data-act="adjust" data-min="-1" ${over ? 'disabled' : ''}>−1'</button>` : ''}
        <button class="btn" data-act="undo" ${over || !m.events.length ? 'disabled' : ''}>${ic('undo', { size: 16 })} Desfazer lance</button>
        <button class="btn btn-gold" data-act="finalize">${ic('flag', { size: 16 })} Encerrar partida</button>
      </div>
      ${m.decided ? html`<p class="sb-sub" style="margin-top:10px">${ic('circle-check', { size: 14 })} Partida decidida em ${m.score.a} × ${m.score.b} sets. Encerre para lançar o resultado no chaveamento.</p>` : ''}`;
  }

  function evForm(t, m) {
    const sp = SPORTS[t.sport], A = teamMap(t).get(m.a), B = teamMap(t).get(m.b);
    return html`<form class="evform" data-evform novalidate>
      <div class="field"><label for="ev-type">Lance</label><select id="ev-type" name="type">${sp.events.map(k => html`<option value="${k}">${k === 'goal' ? (t.sport === 'basquete' ? 'Cesta' : sp.unit) : EVENT_LABELS[k]}</option>`)}</select></div>
      <div class="field"><label for="ev-team">Equipe</label><select id="ev-team" name="team"><option value="a">${A.name}</option><option value="b">${B.name}</option></select></div>
      <div class="field" data-ptswrap hidden><label for="ev-pts">Pontos da cesta</label><select id="ev-pts" name="pts"><option value="1">1 ponto (lance livre)</option><option value="2" selected>2 pontos</option><option value="3">3 pontos</option></select></div>
      <div class="field"><label for="ev-num">Camisa (opcional)</label><input id="ev-num" name="num" type="number" min="0" max="99" inputmode="numeric"></div>
      <div class="full"><button class="btn btn-primary btn-block" type="submit">${ic('plus', { size: 16 })} Registrar lance</button></div></form>`;
  }

  function streamCard(t) {
    return html`<div class="card"><h3 class="card-title">${ic('radio')} Transmissão ao vivo</h3>
      <p class="card-sub">Cole o link do YouTube ou da Twitch. O player aparece para os visitantes.</p>
      <form data-streamform class="row wrap" novalidate><div class="field grow" style="min-width:220px"><label class="sr-only" for="st-url">Link da transmissão</label><input id="st-url" name="url" type="url" inputmode="url" placeholder="https://www.youtube.com/watch?v=…" value="${t.stream?.url || ''}" autocomplete="off"><span class="field-error"></span></div><button class="btn btn-primary" type="submit">${ic('link', { size: 16 })} ${t.stream ? 'Atualizar' : 'Conectar'}</button>${t.stream ? html`<button type="button" class="btn" data-act="stream-off">Remover</button>` : ''}</form>
      ${t.stream ? html`<div style="margin-top:14px">${streamEmbedHTML(t.stream)}</div>` : ''}</div>`;
  }

  function view() {
    const t = app.t, m = pick(t);
    if (!t.bracket) return html`<div class="page-head"><div><h2>Jogos ao vivo</h2></div></div><div class="empty" style="padding:56px 16px">${ic('network', { size: 36 })}<strong style="font-size:18px">O chaveamento ainda não foi sorteado</strong><span>Confirme os times e sorteie as partidas para começar a registrar os jogos.</span><a class="btn btn-primary" href="/admin/${t.id}/chaveamento">Ir para o chaveamento</a></div>${streamCard(t)}`;
    const list = playable(t);
    return html`
      <div class="page-head"><div><h2>Jogos ao vivo</h2><p>Atualize o placar em tempo real. Ao encerrar, o resultado vai direto para o chaveamento.</p></div>
        ${list.length ? html`<div class="field" style="min-width:min(100%,340px)"><label for="matchSel" class="sr-only">Partida</label><select id="matchSel" data-matchsel>${list.map(x => html`<option value="${x.key}" ${x.key === key ? 'selected' : ''} ${x.phase === 'blocked' ? 'disabled' : ''}>${x.phase === 'live' ? '● ' : ''}${x.roundName} · ${x.label}: ${teamMap(t).get(x.a)?.name} × ${teamMap(t).get(x.b)?.name}${x.phase === 'blocked' ? ' (aguardando revanche)' : ''}</option>`)}</select></div>` : ''}</div>
      ${m ? html`
        <div class="live-grid">
          <div class="stack">${scoreboardHTML(t, m, { now: app.now, controls: controls(t, m) })}
            <div class="row wrap"><button class="btn btn-sm" data-act="result">${ic('pencil', { size: 15 })} Lançar resultado direto</button>${m.note ? html`<span class="muted small">${m.note}</span>` : ''}</div></div>
          <div class="stack"><div class="card"><h3 class="card-title">${ic('list-checks')} Linha do tempo</h3>${evForm(t, m)}${timelineHTML(t, m)}</div></div>
        </div>`
        : html`<div class="empty" style="padding:48px 16px">${ic(t.champion ? 'trophy' : 'clock', { size: 34 })}<strong style="font-size:18px">${t.champion ? 'Torneio finalizado!' : 'Nenhuma partida disponível agora'}</strong><span>${t.champion ? 'Todas as partidas foram encerradas.' : 'As próximas partidas aparecem quando os dois times estiverem definidos.'}</span><a class="btn" href="/admin/${t.id}/chaveamento">Ver chaveamento</a></div>`}
      ${streamCard(t)}`;
  }

  async function finalize(m) {
    const t = app.t, A = teamMap(t).get(m.a), B = teamMap(t).get(m.b), sp = SPORTS[t.sport];
    const v = sp.mode === 'sets' ? { a: m.score.a, b: m.score.b } : { a: m.score.a, b: m.score.b };
    if (sp.mode === 'sets' && !m.decided) { toast(`No vôlei, a partida só termina quando uma equipe vence ${sp.setsToWin} sets.`, { type: 'warn' }); return; }
    if (!await confirmDialog({ title: 'Encerrar partida?', text: `${A.name} ${v.a} × ${v.b} ${B.name}. O resultado será lançado no chaveamento e não poderá ser editado sem reabrir a partida.`, ok: 'Encerrar e lançar' })) return;
    try { await run({ action: 'finalize' }, { silent: true }); announce(m); }
    catch (err) {
      if (err.code === 'TIE' && err.details?.tiebreak === 'pênaltis') {
        const pens = await penaltyDialog(A, B);
        if (!pens) return;
        try { await run({ action: 'finalize', pa: pens.pa, pb: pens.pb }, { silent: true }); announce(m); } catch (e2) { toast(e2.message, { type: 'error', ms: 6000 }); }
      } else toast(err.message, { type: 'error', ms: 6500 });
    }
  }
  function announce(m) {
    const f = find(app.t, m.key);
    const w = f && teamMap(app.t).get(f.win === 'a' ? f.a : f.b);
    toast(w ? `Resultado lançado: ${w.name} avança.` : 'Resultado lançado.', { type: 'success' });
    if (app.t.champion) toast('Temos um campeão! 🏆', { type: 'success', ms: 6000 });
  }

  function penaltyDialog(A, B) {
    return new Promise(resolve => {
      const d = openDialog({
        title: 'Empate: pênaltis',
        body: html`<p>O jogo terminou empatado. Informe o resultado da disputa de pênaltis para definir quem avança.</p>
          <form id="penForm" class="cols-2" novalidate><div class="field"><label for="pa">${A.name}</label><input id="pa" name="pa" type="number" min="0" max="50" inputmode="numeric" required></div><div class="field"><label for="pb">${B.name}</label><input id="pb" name="pb" type="number" min="0" max="50" inputmode="numeric" required></div></form><div class="form-error" hidden></div>`,
        foot: html`<button class="btn" data-close="cancel">Cancelar</button><button class="btn btn-primary" type="submit" form="penForm">Confirmar</button>`,
      });
      const form = $('#penForm', d.el);
      form.addEventListener('submit', e => {
        e.preventDefault();
        const pa = Number(form.pa.value), pb = Number(form.pb.value);
        const box = $('.form-error', d.el);
        if (form.pa.value === '' || form.pb.value === '' || pa === pb) { box.hidden = false; box.textContent = 'Informe os dois placares; os pênaltis não podem terminar empatados.'; return; }
        d.close('ok'); resolve({ pa, pb });
      });
      d.closed.then(v => { if (v !== 'ok') resolve(null); });
    });
  }

  function resultDialog(m) {
    const t = app.t, A = teamMap(t).get(m.a), B = teamMap(t).get(m.b), sp = SPORTS[t.sport];
    const d = openDialog({
      title: 'Lançar resultado direto',
      body: html`<p class="muted small">Use quando a partida foi jogada sem acompanhamento ao vivo. ${sp.mode === 'sets' ? 'Informe o resultado em sets (o vencedor precisa de 3).' : ''}</p>
        <form id="resForm" class="stack" novalidate><div class="cols-2"><div class="field"><label for="ra">${A.name} ${sp.mode === 'sets' ? '(sets)' : ''}</label><input id="ra" name="sa" type="number" min="0" max="300" inputmode="numeric" required></div><div class="field"><label for="rb">${B.name} ${sp.mode === 'sets' ? '(sets)' : ''}</label><input id="rb" name="sb" type="number" min="0" max="300" inputmode="numeric" required></div></div>
        <div class="cols-2" data-pens hidden><div class="field"><label for="rpa">Pênaltis ${A.name}</label><input id="rpa" name="pa" type="number" min="0" max="50" inputmode="numeric"></div><div class="field"><label for="rpb">Pênaltis ${B.name}</label><input id="rpb" name="pb" type="number" min="0" max="50" inputmode="numeric"></div></div></form><div class="form-error" hidden></div>`,
      foot: html`<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" type="submit" form="resForm" id="resGo">Lançar resultado</button>`,
    });
    const form = $('#resForm', d.el), box = $('.form-error', d.el);
    const tied = () => sp.tiebreak === 'pênaltis' && form.sa.value !== '' && form.sa.value === form.sb.value;
    form.addEventListener('input', () => { $('[data-pens]', d.el).hidden = !tied(); });
    form.addEventListener('submit', async e => {
      e.preventDefault(); box.hidden = true;
      const body = { action: 'result', sa: Number(form.sa.value), sb: Number(form.sb.value) };
      if (form.sa.value === '' || form.sb.value === '') { box.hidden = false; box.textContent = 'Informe os dois placares.'; return; }
      if (tied()) { if (form.pa.value === '' || form.pb.value === '') { box.hidden = false; box.textContent = 'Empate: informe os pênaltis.'; return; } body.pa = Number(form.pa.value); body.pb = Number(form.pb.value); }
      const btn = $('#resGo', d.el); setBusy(btn, true);
      try { await run(body, { silent: true }); d.close('ok'); announce(m); render(app.main, view()); }
      catch (err) { setBusy(btn, false); box.hidden = false; box.textContent = err.message; }
    });
  }

  let stopTicker = null;
  return {
    mount(root) {
      render(root, view());
      stopTicker = startClockTicker(() => app.t, () => app.now, root);
      root.addEventListener('change', e => {
        if (e.target.matches('[data-matchsel]')) { key = e.target.value; render(root, view()); }
        if (e.target.name === 'type') { const f = e.target.closest('form'); $('[data-ptswrap]', f).hidden = !(app.t.sport === 'basquete' && e.target.value === 'goal'); }
      });
      on(root, 'click', '[data-act]', async (e, el) => {
        const act = el.dataset.act, m = find(app.t, key);
        if (act === 'plus' && m) await run({ action: 'event', type: 'goal', team: el.dataset.side, pts: Number(el.dataset.pts) || 1 }).catch(() => {});
        if (act === 'minus' && m) await run({ action: 'score-minus', team: el.dataset.side }).catch(() => {});
        if (act === 'start' && m) await run({ action: 'start' }).catch(() => {});
        if (act === 'pause' && m) await run({ action: 'pause' }).catch(() => {});
        if (act === 'adjust' && m) await run({ action: 'adjust', minutes: Number(el.dataset.min) }).catch(() => {});
        if (act === 'undo' && m) await run({ action: 'undo' }).catch(() => {});
        if (act === 'finalize' && m) await finalize(m);
        if (act === 'result' && m) resultDialog(m);
        if (act === 'stream-off') await app.act(() => api.del(`/tournaments/${app.t.id}/stream`), { ok: 'Transmissão removida.' }).catch(() => {});
      });
      root.addEventListener('submit', async e => {
        const f = e.target;
        if (f.matches('[data-evform]')) {
          e.preventDefault();
          const body = { action: 'event', type: f.type.value, team: f.team.value, num: f.num.value.trim() };
          if (f.type.value === 'goal' && app.t.sport === 'basquete') body.pts = Number(f.pts.value);
          await run(body).catch(() => {});
        }
        if (f.matches('[data-streamform]')) {
          e.preventDefault();
          const url = f.url.value.trim();
          if (!url) { toast('Cole o link da transmissão.', { type: 'warn' }); return; }
          await app.act(() => api.put(`/tournaments/${app.t.id}/stream`, { url }), { ok: 'Transmissão conectada.' }).catch(() => {});
        }
      });
    },
    update(t, { fromPoll } = {}) {
      const root = app.main; if (!root || document.querySelector('dialog[open]')) return;
      if (fromPoll && root.contains(document.activeElement) && document.activeElement.matches('input,select')) return;
      render(root, view());
    },
    destroy() { stopTicker?.(); },
  };
}
export { minuteOf };
