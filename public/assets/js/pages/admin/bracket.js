// Chaveamento: sorteio, visualização, ranking de força e repescagem beneficente.
import { html, render, ic, $, on, setBusy, sleep } from '../../ui/dom.js';
import { mountBracket, openMatchDialog, startClockTicker } from '../../ui/match.js';
import { emblem } from '../../ui/util.js';
import { openDialog, confirmDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { parseMoney, centsToInput } from '../../ui/forms.js';
import { api } from '../../api.js';
import { fmtBRL, fmtNum } from '../../shared/format.js';

export default function (app) {
  let bracketCtl = null, ticker = null, matchDlg = null, drawing = false;
  const rerender = () => { const root = app.main; if (!root) return; render(root, view()); mountBracketView(root); };

  const started = t => t.bracket && t.bracket.rounds.flat().some(m => m.phase !== 'scheduled' && m.phase !== 'tbd' && m.phase !== 'bye');
  const roundNameOf = (t, r) => t.bracket?.rounds[r]?.name || '';

  function drawCard(t) {
    const n = t.teamsConfirmed, can = n >= 2 && !drawing && !started(t) && !t.champion;
    const info = t.bracket?.info;
    return html`<div class="card"><h3 class="card-title">${ic('wand-sparkles')} Sorteio inteligente</h3>
      <ul class="stack-sm small" style="margin-bottom:16px">
        <li class="row" style="align-items:flex-start">${ic('shield-check', { size: 18 })}<span><b>Auditor</b> — bloqueia confrontos entre times do mesmo clube/bairro na 1ª fase.</span></li>
        <li class="row" style="align-items:flex-start">${ic('sliders', { size: 18 })}<span><b>Balanceador</b> — equilibra a força (rating) entre as duas metades da chave e dá byes aos mais fortes se o número de times não fechar.</span></li>
        <li class="row" style="align-items:flex-start">${ic('qr-code', { size: 18 })}<span><b>Sorteador</b> — testa milhares de combinações e registra uma semente verificável.</span></li></ul>
      <div class="row wrap">
        <button class="btn btn-primary btn-lg" data-act="draw" ${can ? '' : 'disabled'}>${ic('wand-sparkles', { size: 18 })} ${t.bracket ? 'Refazer sorteio' : 'Sortear chaveamento'}</button>
        ${t.demo && t.bracket && !t.champion ? html`<button class="btn" data-act="simulate">${ic('zap', { size: 16 })} Simular próxima fase</button>` : ''}
        ${t.bracket ? html`<button class="btn btn-outline-danger" data-act="reset">${ic('rotate-ccw', { size: 16 })} Reiniciar chaveamento</button>` : ''}
      </div>
      ${n < 2 ? html`<p class="hint" style="margin-top:10px">${ic('info', { size: 14 })} Confirme ao menos 2 times para sortear (hoje: ${n}).</p>` : ''}
      ${started(t) && !t.champion ? html`<p class="hint" style="margin-top:10px">${ic('lock', { size: 14 })} O torneio já começou: o sorteio não pode ser refeito (apenas reiniciado).</p>` : ''}
      ${t.registration.open && !t.bracket && n >= 2 ? html`<div class="form-note warn" style="margin-top:12px">${ic('triangle-alert')}<span>As inscrições ainda estão abertas. Ao sortear, elas serão encerradas e reservas pendentes de pagamento serão canceladas.</span></div>` : ''}
      ${info ? html`<div class="metrics" style="margin-top:16px"><div class="metric"><b>${String(info.balance).replace('.', ',')}%</b><span>Índice de equilíbrio</span></div><div class="metric"><b>${info.conflicts}</b><span>Conflitos de bairro</span></div><div class="metric"><b>${fmtNum(info.tried)}</b><span>Combinações avaliadas</span></div><div class="metric"><b>#${(t.bracket.seed >>> 0).toString(16).toUpperCase().padStart(8, '0')}</b><span>Semente auditável</span></div></div>` : ''}
    </div>`;
  }

  function rankingCard(t) {
    const ts = t.teams.filter(x => x.status === 'confirmed').sort((a, b) => b.rating - a.rating);
    if (!ts.length) return html`<div class="card"><h3 class="card-title">${ic('bar-chart')} Equipes e força (rating)</h3><div class="empty">${ic('users')}<span>Nenhum time confirmado ainda.</span></div></div>`;
    const lo = Math.min(...ts.map(x => x.rating)) - 100, hi = Math.max(...ts.map(x => x.rating));
    return html`<div class="card"><h3 class="card-title">${ic('bar-chart')} Equipes e força (rating)</h3><p class="card-sub">Edite a força de cada time em Times → Detalhes → Editar.</p>
      ${ts.map((x, i) => html`<div class="rank-row">${emblem(x, 'md')}<div class="row between wrap" style="gap:6px"><b class="ellipsis">${i + 1}. ${x.name}</b><span class="row" style="gap:6px"><span class="badge">${x.origin || 'Sem bairro'}</span><span class="num strong">${x.rating}</span></span></div><span></span><div class="bar" role="img" aria-label="Rating ${x.rating}"><i style="width:${hi === lo ? 60 : (x.rating - lo) / (hi - lo) * 100}%"></i></div></div>`)}</div>`;
  }

  function repescCard(t) {
    const out = t.teams.filter(x => x.status === 'confirmed' && (x.elim || x.repescada));
    return html`<div class="card"><h3 class="card-title">${ic('hand-heart')} Re-inscrição beneficente</h3>
      <div class="form-note warn" style="margin-bottom:12px">${ic('heart')}<span>Equipe eliminada pode voltar doando a uma causa social: disputa uma <b>revanche contra quem a eliminou</b> e, vencendo, retoma a vaga com a tag <span class="tag-benef">Equipe Repescada · Benfeitora</span>. Uma repescagem por equipe. ${t.donationEnabled ? 'O capitão paga pela página do time; você também pode registrar uma doação recebida por fora.' : html`<b>Desativada nas configurações.</b>`}</span></div>
      <div class="row between" style="padding:12px 16px;border-radius:12px;background:var(--gold-50);margin-bottom:12px"><span>Total arrecadado</span><b style="font-size:22px;color:#8a5f00">${fmtBRL(t.donations.total)}</b></div>
      ${!t.bracket ? html`<div class="empty">${ic('network')}<span>Sorteie o chaveamento para habilitar a repescagem.</span></div>`
        : !out.length ? html`<div class="empty">${ic('trophy')}<span>Nenhuma equipe eliminada ainda.</span></div>`
        : html`<div class="stack-sm">${out.map(x => {
          if (!x.elim && x.repescada) return html`<div class="out-row"><div class="row">${emblem(x, 'md')}<div class="grow"><b>${x.name}</b><div><span class="tag-benef">${ic('heart', { size: 11 })} Repescada</span></div></div><span class="badge ok">De volta ao jogo</span></div></div>`;
          const by = t.teams.find(y => y.id === x.elim.by), c = x.repesc || { ok: false, reason: '' };
          return html`<div class="out-row"><div class="row">${emblem(x, 'md')}<div class="grow"><b>${x.name}</b><div class="muted small">Eliminada ${x.elim.playin ? 'na revanche de repescagem' : 'em ' + roundNameOf(t, x.elim.r).toLowerCase()} por ${by?.name || '—'}</div></div>
            <button class="btn btn-sm btn-gold" data-act="donate" data-tid="${x.id}" ${c.ok ? '' : 'disabled'}>${ic('heart', { size: 14 })} Registrar doação</button></div>
            <div class="muted small row" style="gap:6px;align-items:flex-start">${ic(c.ok ? 'circle-check' : 'info', { size: 14 })}<span>${c.reason}</span></div></div>`;
        })}</div>`}
      ${t.donationItems.length ? html`<h4 style="margin:16px 0 8px;font-size:14px">Doações recebidas</h4><ul>${t.donationItems.slice().reverse().map(d => html`<li class="admin-row"><div class="grow"><b>${d.teamName}</b><div class="muted small">${d.cause || 'Causa não informada'} · ${d.method === 'pix' ? 'PIX' : d.method === 'card' ? 'Cartão' : 'Registrada pelo organizador'}</div></div><b>${fmtBRL(d.amount)}</b></li>`)}</ul>` : ''}
    </div>`;
  }

  function view() {
    const t = app.t;
    return html`<div class="page-head"><div><h2>Chaveamento</h2><p>${t.bracket ? `${t.bracket.size} vagas · ${t.bracket.rounds.length} fases${t.bracket.info?.byes ? ` · ${t.bracket.info.byes} bye(s)` : ''}` : 'Sorteie as partidas quando as inscrições terminarem.'}</p></div></div>
      ${drawCard(t)}
      ${t.bracket ? html`<div class="card flush" id="bracketCard"></div>` : html`<div class="empty" style="padding:48px 16px">${ic('network', { size: 34 })}<strong style="font-size:18px">O chaveamento aparece aqui</strong><span>Depois do sorteio, as partidas, os avanços e o campeão são exibidos nesta tela.</span></div>`}
      <div class="two">${rankingCard(t)}${repescCard(t)}</div>`;
  }

  function mountBracketView(root) {
    bracketCtl?.destroy(); ticker?.(); bracketCtl = null; ticker = null;
    const card = $('#bracketCard', root);
    if (!card) return;
    bracketCtl = mountBracket(card, () => app.t, {
      onOpen: key => {
        matchDlg = openMatchDialog(() => app.t, () => app.now, key);
        const foot = document.createElement('div'); foot.className = 'dlg-foot';
        const m = [...app.t.bracket.rounds.flatMap(r => r.matches), ...app.t.bracket.playins].find(x => x.key === key);
        if (m && m.phase !== 'finished' && m.phase !== 'blocked') { foot.innerHTML = `<a class="btn btn-primary" href="/admin/${app.t.id}/ao-vivo?m=${encodeURIComponent(key)}" data-gotolive>Gerenciar ao vivo</a>`; matchDlg.el.append(foot); }
        matchDlg.el.addEventListener('click', e => { if (e.target.closest('[data-gotolive]')) matchDlg.close(); });
      },
    });
    ticker = startClockTicker(() => app.t, () => app.now, card);
  }

  async function draw() {
    if (drawing) return;
    const t = app.t;
    if (t.bracket && !await confirmDialog({ title: 'Refazer o sorteio?', text: 'O chaveamento atual será substituído por um novo sorteio. Nenhum jogo foi encerrado ainda.', ok: 'Refazer sorteio' })) return;
    drawing = true;
    const steps = ['Auditor · mapeando clube/bairro de origem dos times…', 'Balanceador · calculando a força de cada time…', 'Sorteador · avaliando 6.000 combinações com semente auditável…', 'Publicando o chaveamento…'];
    const d = openDialog({ title: 'Sorteio inteligente', dismissible: false, body: html`<ol class="stack-sm" id="drawSteps">${steps.map((s, i) => html`<li class="row" data-step="${i}" style="opacity:.4">${ic('clock', { size: 18 })}<span>${s}</span></li>`)}</ol>` });
    const mark = (i, done) => {
      const li = $(`[data-step="${i}"]`, d.el); if (!li) return;
      li.style.opacity = '1'; li.style.color = done ? 'var(--green)' : '';
      li.innerHTML = `${ic(done ? 'circle-check' : 'refresh-cw', { size: 18 }).s}<span>${steps[i]}</span>`;
    };
    const req = api.post(`/tournaments/${t.id}/draw`).then(r => ({ r }), e => ({ e }));
    for (let i = 0; i < 3; i++) { mark(i, false); await sleep(520); mark(i, true); }
    mark(3, false);
    const out = await req; await sleep(380);
    d.close('ok'); drawing = false;
    if (out.e) { toast(out.e.message, { type: 'error', ms: 6500 }); rerender(); return; }
    app.set(out.r.tournament);
    toast(`Sorteio concluído · equilíbrio de ${String(out.r.draw.balance).replace('.', ',')}% e ${out.r.draw.conflicts ? out.r.draw.conflicts + ' conflito(s)' : 'zero conflitos'}.`, { type: 'success', ms: 5000 });
  }

  function donateDialog(tid) {
    const t = app.t, x = t.teams.find(y => y.id === tid);
    const d = openDialog({
      title: 'Registrar doação',
      body: html`<p><b>${x.name}</b> disputará a revanche contra quem a eliminou. Use esta opção para doações recebidas fora do site (dinheiro, PIX direto, etc.).</p>
        <form id="donForm" class="stack" novalidate>
          <div class="field" data-f="amount"><label for="d-amt">Valor da doação (mínimo ${fmtBRL(t.minDonation)})</label><div class="input-affix"><span class="prefix">R$</span><input id="d-amt" name="amount" inputmode="decimal" value="${centsToInput(Math.max(t.minDonation, 10000))}"></div><span class="field-error"></span></div>
          <div class="field"><label for="d-cause">Causa beneficiada</label><select id="d-cause" name="cause">${t.causes.map(c => html`<option>${c}</option>`)}</select></div>
          <div class="form-error" hidden></div></form>`,
      foot: html`<button class="btn" data-close>Cancelar</button><button class="btn btn-gold" type="submit" form="donForm" id="donGo">${ic('heart', { size: 16 })} Registrar e liberar revanche</button>`,
    });
    const form = $('#donForm', d.el);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const cents = parseMoney(form.amount.value), box = $('.form-error', d.el); box.hidden = true;
      if (!Number.isFinite(cents) || cents < t.minDonation) { box.hidden = false; box.textContent = `Informe um valor de pelo menos ${fmtBRL(t.minDonation)}.`; return; }
      const btn = $('#donGo', d.el); setBusy(btn, true);
      try { await app.act(() => api.post(`/tournaments/${t.id}/donations`, { teamId: tid, amount: cents, cause: form.cause.value }), { silent: true, ok: `${x.name} re-inscrita! Revanche liberada.` }); d.close('ok'); rerender(); }
      catch (err) { setBusy(btn, false); box.hidden = false; box.textContent = err.message; }
    });
  }

  return {
    mount(root) {
      render(root, view()); mountBracketView(root);
      on(root, 'click', '[data-act]', async (e, el) => {
        const act = el.dataset.act;
        if (act === 'draw') await draw();
        if (act === 'donate') donateDialog(el.dataset.tid);
        if (act === 'simulate') await app.act(() => api.post(`/tournaments/${app.t.id}/demo/simulate`), { ok: 'Fase simulada.' }).catch(() => {});
        if (act === 'reset') {
          if (await confirmDialog({ title: 'Reiniciar o chaveamento?', text: 'Todas as partidas, resultados e revanches serão apagados e as inscrições continuarão encerradas. As doações já registradas permanecem no histórico.', ok: 'Reiniciar', danger: true }))
            await app.act(() => api.post(`/tournaments/${app.t.id}/reset-bracket`, { confirm: true }), { ok: 'Chaveamento reiniciado.' }).catch(() => {});
        }
      });
    },
    update() {
      const root = app.main; if (!root || drawing) return;
      if (document.querySelector('dialog[open]')) { matchDlg?.refresh?.(); return; }
      rerender();
    },
    destroy() { bracketCtl?.destroy(); ticker?.(); },
  };
}
