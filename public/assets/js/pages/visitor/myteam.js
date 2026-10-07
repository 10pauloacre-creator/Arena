// Meu time: status da inscrição, retomada de pagamento, elenco e repescagem beneficente (acesso pelo código do capitão).
import { html, render, ic, $, on, setBusy, copyText } from '../../ui/dom.js';
import { emblem } from '../../ui/util.js';
import { toast } from '../../ui/toast.js';
import { parseMoney, centsToInput } from '../../ui/forms.js';
import { api } from '../../api.js';
import { mountPayment } from './payment.js';
import { getMyTeam, saveMyTeam, clearMyTeam } from './store.js';
import { fmtBRL, fmtDateTime } from '../../shared/format.js';
import { teamMap } from '../../ui/match.js';

export default function (v) {
  let creds = getMyTeam(v.id), info = null, tourn = null, payCtl = null, repCtl = null, loadingAt = 0, holdUntil = 0, lastErr = '';
  let donate = { amount: null, cause: null, agree: false, paying: false };

  async function load(root, { quiet = false } = {}) {
    if (!creds) return paint(root);
    try {
      const r = await api.get(`/public/${encodeURIComponent(v.id)}/teams/${encodeURIComponent(creds.teamId)}`, { headers: { 'X-Team-Code': creds.code } });
      info = r.team; tourn = r.tournament; lastErr = '';
    } catch (err) {
      if (err.status === 403 || err.status === 404) { clearMyTeam(v.id); creds = null; info = null; lastErr = 'Não encontramos mais esse time. Digite o código novamente.'; }
      else if (!quiet) lastErr = err.message;
    }
    loadingAt = Date.now();
    paint(root);
  }

  function lookup(root) {
    render(root, html`<div class="card stack" style="max-width:560px">
      <div><h2 style="font-size:20px">Acessar meu time</h2><p class="muted small">Digite o código do capitão que você recebeu ao se inscrever para ver o status, retomar o pagamento ou usar a repescagem.</p></div>
      ${lastErr ? html`<div class="form-error">${lastErr}</div>` : ''}
      <form id="lookupForm" class="stack" novalidate><div class="field" data-f="code"><label for="mt-code">Código do capitão</label><input id="mt-code" name="code" maxlength="12" autocomplete="off" placeholder="Ex.: K7M2QX9A" style="text-transform:uppercase;letter-spacing:.12em;font-weight:700"><span class="field-error"></span></div>
        <button class="btn btn-primary btn-lg" type="submit">Acessar</button></form>
      <p class="hint">Ainda não se inscreveu? <a href="/t/${v.id}/inscricao">Inscrever meu time</a></p></div>`);
    const f = $('#lookupForm', root);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const code = f.code.value.trim().toUpperCase();
      const field = $('[data-f=code]', f);
      field.classList.remove('has-error');
      if (code.length < 6) { field.classList.add('has-error'); $('.field-error', field).textContent = 'Digite o código completo.'; return; }
      const btn = $('button', f); setBusy(btn, true);
      try {
        const r = await api.post(`/public/${encodeURIComponent(v.id)}/my-team`, { code });
        saveMyTeam(v.id, r.team.id, code); creds = { teamId: r.team.id, code }; info = r.team; tourn = r.tournament; lastErr = ''; loadingAt = Date.now();
        paint(root);
      } catch (err) { setBusy(btn, false); field.classList.add('has-error'); $('.field-error', field).textContent = err.message; }
    });
  }

  const nextMatch = t => {
    if (!t.bracket || !info) return null;
    const all = [...t.bracket.rounds.flatMap(r => r.matches), ...t.bracket.playins];
    return all.find(m => (m.a === info.id || m.b === info.id) && m.phase !== 'finished' && m.phase !== 'bye' && m.a && m.b) || null;
  };

  function repescSection(t) {
    if (!tourn?.donationEnabled || !info.eliminated && !info.repescada) return '';
    const pend = info.repescPayment && info.repescPayment.status === 'pending';
    if (info.repescada) return html`<div class="card"><h3 class="card-title">${ic('heart')} Repescagem beneficente</h3><div class="form-note ok">${ic('circle-check')}<span>Sua equipe usou a repescagem beneficente. ${info.eliminated ? 'A revanche já foi decidida.' : 'Acompanhe a revanche em Jogos.'}</span></div></div>`;
    if (!info.repesc?.ok) return html`<div class="card"><h3 class="card-title">${ic('heart')} Repescagem beneficente</h3><p class="muted">${info.repesc?.reason || ''}</p></div>`;
    const min = tourn.minDonation, opts = [...new Set([min, 5000, 10000, 20000].filter(x => x >= min))].slice(0, 3);
    if (donate.amount == null) donate.amount = opts[0];
    if (!donate.cause) donate.cause = tourn.causes[0];
    return html`<div class="card stack"><h3 class="card-title" style="margin:0">${ic('heart')} Repescagem beneficente</h3>
      <div class="form-note warn">${ic('heart')}<span>Sua equipe foi eliminada, mas pode voltar: faça uma doação a uma causa social e dispute uma <b>revanche contra quem a eliminou</b>. Vencendo, retoma a vaga com a tag <span class="tag-benef">Equipe Repescada · Benfeitora</span>. Perdendo, está fora de vez. ${info.repesc.reason}</span></div>
      ${donate.paying ? html`<div id="donPay"></div>` : html`<form id="donForm" class="stack" novalidate>
        <div class="field"><span class="label">Valor da doação</span><div class="chips-row">${opts.map(a => html`<div class="amount-chip"><input type="radio" name="amt" id="amt-${a}" value="${a}" ${donate.amount === a ? 'checked' : ''}><label for="amt-${a}">${fmtBRL(a).replace(',00', '')}</label></div>`)}<div class="amount-chip"><input type="radio" name="amt" id="amt-x" value="custom" ${!opts.includes(donate.amount) ? 'checked' : ''}><label for="amt-x">Outro valor</label></div></div></div>
        <div class="field" data-f="custom" ${opts.includes(donate.amount) ? 'hidden' : ''}><label for="amt-custom">Valor (mínimo ${fmtBRL(min)})</label><div class="input-affix"><span class="prefix">R$</span><input id="amt-custom" name="custom" inputmode="decimal" value="${opts.includes(donate.amount) ? '' : centsToInput(donate.amount)}"></div><span class="field-error"></span></div>
        <div class="field"><label for="don-cause">Causa beneficiada</label><select id="don-cause" name="cause">${tourn.causes.map(c => html`<option ${c === donate.cause ? 'selected' : ''}>${c}</option>`)}</select></div>
        <label class="check"><input type="checkbox" name="agree" ${donate.agree ? 'checked' : ''}><span>Entendo que a doação é voluntária, vai para a causa escolhida e que a repescagem garante apenas o direito à revanche.</span></label>
        <div class="form-error" data-err hidden></div>
        <button class="btn btn-gold btn-lg" type="submit">${ic('heart', { size: 18 })} Continuar para o pagamento</button></form>`}
      ${pend && !donate.paying ? html`<p class="hint">Você tem um PIX de doação pendente. <a href="#" data-act="resume-don">Retomar pagamento</a></p>` : ''}</div>`;
  }

  function paint(root) {
    payCtl?.destroy(); payCtl = null; repCtl?.destroy(); repCtl = null;
    if (!creds || !info) return lookup(root);
    const t = v.t, st = info.status, mt = nextMatch(t);
    const badge = st === 'confirmed' ? ['Confirmado', 'ok'] : st === 'pending_payment' ? ['Aguardando pagamento', 'warn'] : st === 'expired' ? ['Reserva expirada', 'bad'] : ['Cancelado', 'bad'];
    render(root, html`<div class="stack">
      <div class="card"><div class="row wrap">${emblem(info, 'lg')}<div class="grow"><h2 style="font-size:22px">${info.name}</h2><div class="row wrap" style="gap:8px;margin-top:4px"><span class="badge ${badge[1]}">${badge[0]}</span>${info.repescada ? html`<span class="tag-benef">${ic('heart', { size: 11 })} Equipe Repescada · Benfeitora</span>` : ''}${info.eliminated ? html`<span class="badge">Eliminada</span>` : ''}${t.champion === info.id ? html`<span class="badge gold">${ic('trophy', { size: 13 })} Campeã</span>` : ''}</div>
          <p class="muted small" style="margin-top:6px">${info.origin || ''}${info.confirmedAt ? ` · confirmada em ${fmtDateTime(info.confirmedAt)}` : ''}</p></div>
          <button class="btn btn-sm btn-ghost" data-act="leave">Trocar de time</button></div></div>
      ${lastErr ? html`<div class="form-error">${lastErr}</div>` : ''}
      ${st === 'pending_payment' ? html`<div class="card stack"><h3 class="card-title" style="margin:0">${ic('wallet')} Pagamento da inscrição</h3><div class="form-note warn">${ic('clock')}<span>Sua vaga está reservada até <b>${new Date(info.reservedUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</b>. Depois disso ela é liberada.</span></div><div id="payBox"></div></div>` : ''}
      ${st === 'expired' || st === 'cancelled' ? html`<div class="card"><div class="empty">${ic('circle-alert')}<strong>${st === 'expired' ? 'A reserva da vaga expirou' : 'Inscrição cancelada'}</strong><span>${t.registration.open ? 'Você pode refazer a inscrição agora.' : 'As inscrições não estão mais abertas.'}</span>${t.registration.open ? html`<a class="btn btn-primary" href="/t/${t.id}/inscricao">Refazer inscrição</a>` : ''}</div></div>` : ''}
      ${st === 'confirmed' && mt ? html`<div class="card"><h3 class="card-title">${ic('calendar-clock')} Próximo jogo</h3><p><b>${mt.roundName}</b>${mt.id ? '' : ` · ${mt.label}`} contra <b>${teamMap(t).get(mt.a === info.id ? mt.b : mt.a)?.name || 'a definir'}</b></p><a class="btn btn-sm" href="/t/${t.id}/jogos" style="margin-top:8px">Ver jogos</a></div>` : ''}
      ${st === 'confirmed' ? repescSection(t) : ''}
      <div class="card"><h3 class="card-title">${ic('users')} Elenco (${info.players.length})</h3><ul class="player-grid">${info.players.map(p => html`<li class="player"><span class="jersey">${p.number}</span><div class="p-n">${p.name}</div></li>`)}</ul></div>
      <div class="card"><h3 class="card-title">${ic('key-round')} Código do capitão</h3><div class="row wrap"><div class="code-box">${creds.code}</div><button class="btn" data-act="copy-code">${ic('copy', { size: 16 })} Copiar</button></div><p class="hint" style="margin-top:8px">Use este código para acessar seu time em outro aparelho.</p></div></div>`);

    if (st === 'pending_payment') {
      payCtl = mountPayment($('#payBox', root), { tid: v.id, teamId: info.id, code: creds.code, amount: t.fee, endpoint: '/pay', offset: () => v.offset, resume: info.payment, onApproved: () => { holdUntil = Date.now() + 2500; toast('Time confirmado! 🎉', { type: 'success' }); v.refresh(); setTimeout(() => load(root), 1400); } });
    }
    if (donate.paying && $('#donPay', root)) mountDonation(root);
  }

  function mountDonation(root) {
    repCtl = mountPayment($('#donPay', root), {
      tid: v.id, teamId: info.id, code: creds.code, amount: donate.amount, endpoint: '/repescagem', offset: () => v.offset,
      extra: { amount: donate.amount, cause: donate.cause, agree: true }, resume: info.repescPayment?.amount === donate.amount ? info.repescPayment : null,
      onApproved: () => { holdUntil = Date.now() + 2500; toast('Doação confirmada! A revanche foi liberada. 💛', { type: 'success', ms: 6000 }); donate = { amount: null, cause: null, agree: false, paying: false }; v.refresh(); setTimeout(() => load(root), 1500); },
    });
  }

  return {
    mount(root) {
      load(root);
      on(root, 'click', '[data-act]', async (e, el) => {
        const act = el.dataset.act;
        if (act === 'leave') { clearMyTeam(v.id); creds = null; info = null; lastErr = ''; paint(root); }
        if (act === 'copy-code') toast((await copyText(creds.code)) ? 'Código copiado!' : 'Anote o código.', { type: 'success', ms: 2000 });
        if (act === 'resume-don') { e.preventDefault(); donate.amount = info.repescPayment.amount; donate.paying = true; paint(root); }
      });
      root.addEventListener('change', e => {
        if (e.target.name === 'amt') { const custom = e.target.value === 'custom'; $('[data-f=custom]', root).hidden = !custom; if (!custom) donate.amount = Number(e.target.value); }
        if (e.target.name === 'cause') donate.cause = e.target.value;
        if (e.target.name === 'agree') donate.agree = e.target.checked;
      });
      root.addEventListener('submit', e => {
        const f = e.target.closest('#donForm'); if (!f) return;
        e.preventDefault();
        const box = $('[data-err]', f); box.hidden = true;
        const choice = f.querySelector('[name=amt]:checked')?.value;
        const cents = choice === 'custom' ? parseMoney(f.custom.value) : Number(choice);
        if (!Number.isFinite(cents) || cents < tourn.minDonation) { box.hidden = false; box.textContent = `Informe um valor de pelo menos ${fmtBRL(tourn.minDonation)}.`; return; }
        if (!f.agree.checked) { box.hidden = false; box.textContent = 'Marque a confirmação para continuar.'; return; }
        donate = { amount: cents, cause: f.cause.value, agree: true, paying: true };
        paint(root);
      });
    },
    update() {
      const root = v.main; if (!root || !creds) return;
      if (donate.paying || $('#payBox', root) || Date.now() < holdUntil) return; // não interrompe um pagamento em andamento
      if (Date.now() - loadingAt > 6000 && !root.contains(document.activeElement.closest('form'))) load(root, { quiet: true });
    },
    destroy() { payCtl?.destroy(); repCtl?.destroy(); },
  };
}
