// Inscrição do time (visitante): dados do time → elenco → revisão e pagamento. Sem login.
import { html, render, ic, $, on, copyText, setBusy } from '../../ui/dom.js';
import { teamFieldsHTML, wireTeamFields } from '../../ui/teamform.js';
import { createRosterEditor } from '../../ui/roster.js';
import { emblem } from '../../ui/util.js';
import { toast } from '../../ui/toast.js';
import { api } from '../../api.js';
import { mountPayment } from './payment.js';
import { saveMyTeam } from './store.js';
import { rulesChecklistHTML } from '../../ui/tourneyinfo.js';
import { ruleList, needsAcceptance } from '../../shared/rules.js';
import { fmtBRL } from '../../shared/format.js';

export default function (v) {
  let step = 1, data = null, players = [], created = null, fieldsCtl = null, rosterCtl = null, payCtl = null, accepted = false;
  const STEPS = ['Time e responsável', 'Elenco', 'Revisão e pagamento'];

  const stepper = () => html`<div class="stepper" aria-label="Etapas da inscrição">${STEPS.map((s, i) => html`<div class="st ${step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}"><i></i><span>${i + 1}. ${s}</span></div>`)}</div>`;

  function closedView(t) {
    return html`<div class="card"><div class="empty" style="padding:40px 16px">${ic('door-closed', { size: 34 })}<strong style="font-size:18px">Inscrições encerradas</strong><span>${t.registration.reason || 'Não é possível se inscrever agora.'}</span><div class="row wrap" style="justify-content:center"><a class="btn btn-primary" href="/t/${t.id}/jogos">Acompanhar jogos</a><a class="btn" href="/t/${t.id}/meu-time">Já me inscrevi</a></div></div></div>`;
  }

  function paintStep(root) {
    const t = v.t, rules = t.rules, nRules = ruleList(rules).length;
    payCtl?.destroy(); payCtl = null;
    if (step === 1) {
      render(root, html`<div class="card stack">${stepper()}<div><h2 style="font-size:20px">Dados do time e do responsável</h2><p class="muted small">${t.fee ? `Inscrição de ${fmtBRL(t.fee)} por time · a vaga fica reservada por 30 minutos enquanto você paga.` : 'Inscrição gratuita.'}</p></div>
        ${nRules ? html`<details class="rules-peek"><summary>${ic('list-checks', { size: 16 })} Regras do torneio (${nRules})</summary>${rulesChecklistHTML(t)}<p class="hint" style="margin-top:8px">${needsAcceptance(rules) ? 'Você vai aceitar estas regras no último passo.' : 'Estas regras serão conferidas na inscrição.'}</p></details>` : ''}
        <form id="step1" class="stack" novalidate>${teamFieldsHTML({ values: data || {}, emblemRequired: rules.emblemRequired })}<div class="row between wrap"><a class="btn btn-ghost" href="/t/${t.id}">Cancelar</a><button class="btn btn-primary btn-lg" type="submit">Continuar ${ic('arrow-right', { size: 18 })}</button></div></form></div>`);
      const form = $('#step1', root);
      fieldsCtl = wireTeamFields(form, { emblemRequired: rules.emblemRequired });
      if (data?.emblem) fieldsCtl.setEmblem(data.emblem);
      form.addEventListener('submit', e => { e.preventDefault(); if (!fieldsCtl.validate()) return; data = fieldsCtl.read(); step = 2; paintStep(root); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    } else if (step === 2) {
      render(root, html`<div class="card stack">${stepper()}<div><h2 style="font-size:20px">Elenco de ${data.name}</h2><p class="muted small">${t.type === 'oficial' ? 'Torneio oficial: CPF, RG e documento de identidade em PDF de cada atleta são obrigatórios.' : rules.shirtNumbers ? 'Informe o nome e o número da camisa de cada atleta.' : 'Informe o nome de cada atleta. O número da camisa é opcional.'} Mínimo de ${t.rosterRules.min} atletas.</p></div><div id="rosterBox"></div><div class="row between wrap"><button class="btn btn-ghost" data-act="back">${ic('arrow-left', { size: 18 })} Voltar</button><button class="btn btn-primary btn-lg" data-act="next2">Continuar ${ic('arrow-right', { size: 18 })}</button></div></div>`);
      rosterCtl = createRosterEditor($('#rosterBox', root), { sport: t.sport, official: t.type === 'oficial', players, min: t.rosterRules.min, numberRequired: rules.shirtNumbers });
    } else paintReview(root);
  }

  function paintReview(root) {
    const t = v.t, must = needsAcceptance(t.rules);
    render(root, html`<div class="card stack">${stepper()}<div><h2 style="font-size:20px">Revise e conclua</h2></div>
      <div class="summary-box"><div class="line"><span class="muted">Time</span><b>${data.name}</b></div><div class="line"><span class="muted">Bairro / clube</span><span>${data.origin || '—'}</span></div><div class="line"><span class="muted">Responsável</span><span>${data.captain.name}</span></div><div class="line"><span class="muted">Atletas</span><span>${players.length}</span></div>
        <div class="line total"><span>${t.fee ? 'Total a pagar' : 'Inscrição'}</span><span>${t.fee ? fmtBRL(t.fee) : 'Gratuita'}</span></div></div>
      ${ruleList(t.rules).length ? html`<div class="rules-accept"><span class="label">Regras do torneio</span>${rulesChecklistHTML(t)}${must ? html`<label class="check" style="margin-top:12px"><input type="checkbox" name="accept" ${accepted ? 'checked' : ''}><span><b>Li e aceito as regras do torneio.</b><br><span class="muted small">Declaro que o time cumprirá todas as regras acima.</span></span></label>` : ''}</div>` : ''}
      <div class="form-error" data-err hidden></div>
      <div class="row between wrap"><button class="btn btn-ghost" data-act="back">${ic('arrow-left', { size: 18 })} Voltar</button><button class="btn btn-primary btn-lg" data-act="submit">${ic(t.fee ? 'credit-card' : 'check', { size: 18 })} ${t.fee ? 'Ir para o pagamento' : 'Concluir inscrição'}</button></div></div>`);
  }

  function paintCreated(root, res) {
    const team = res.team, t = v.t;
    saveMyTeam(t.id, team.id, res.code);
    if (team.status === 'confirmed') return paintSuccess(root, team, res.code);
    render(root, html`<div class="card stack"><div class="row">${emblem(team, 'lg')}<div class="grow"><h2 style="font-size:20px">${team.name}</h2><p class="muted small">Vaga reservada — conclua o pagamento para entrar na lista de times.</p></div></div>
      <div class="form-note">${ic('clock')}<span>Guarde seu código de acesso: <b class="num">${res.code}</b>. Com ele você retoma o pagamento em <b>Meu time</b>, em qualquer aparelho.</span></div><div id="payBox"></div></div>`);
    payCtl = mountPayment($('#payBox', root), {
      tid: t.id, teamId: team.id, code: res.code, amount: t.fee, endpoint: '/pay', offset: () => v.offset, resume: team.payment,
      onApproved: () => { v.refresh(); setTimeout(() => paintSuccess(root, { ...team, status: 'confirmed' }, res.code), 1400); },
      onExpired: () => { toast('A reserva da vaga expirou. Refaça a inscrição.', { type: 'warn' }); },
    });
  }

  function paintSuccess(root, team, code) {
    const t = v.t;
    render(root, html`<div class="card success-card"><span class="ok-ico">${ic('check', { size: 34 })}</span><h2 style="font-size:22px">Inscrição confirmada!</h2>
      <p>O time <b>${team.name}</b> já está na lista de participantes de <b>${t.name}</b>.</p>
      <div><span class="label">Código do capitão</span><div class="code-box" style="margin-top:6px">${code}</div><p class="hint" style="justify-content:center;margin-top:6px">Guarde este código: ele dá acesso ao seu time em qualquer aparelho.</p></div>
      <div class="row wrap" style="justify-content:center"><button class="btn" data-act="copy-code" data-code="${code}">${ic('copy', { size: 16 })} Copiar código</button><a class="btn btn-primary" href="/t/${t.id}/meu-time">Ver minha inscrição</a><a class="btn" href="/t/${t.id}/times">Ver times</a></div></div>`);
    v.refresh();
  }

  async function submit(root, btn) {
    const t = v.t, must = needsAcceptance(t.rules);
    if (must) {
      accepted = !!$('[name=accept]', root)?.checked;
      if (!accepted) { const box = $('[data-err]', root); box.hidden = false; box.textContent = 'Aceite as regras do torneio para concluir a inscrição.'; $('[name=accept]', root)?.focus(); return; }
    }
    setBusy(btn, true);
    try {
      const r = await api.post(`/public/${encodeURIComponent(t.id)}/teams`, { ...data, players, ...(must ? { rulesAccepted: true } : {}) });
      created = { team: r.team, code: r.team.accessCode };
      paintCreated(root, created);
    } catch (err) {
      setBusy(btn, false);
      const box = $('[data-err]', root); if (box) { box.hidden = false; box.textContent = err.message; }
      if (err.code === 'DUPLICATE_NAME') { step = 1; paintStep(root); fieldsCtl.setServerError(err); }
      else if (err.code === 'FULL' || err.code === 'CLOSED') { v.refresh(); }
      else if (err.code === 'VALIDATION' || err.code === 'DUPLICATE_ATHLETE') { toast(err.message, { type: 'error', ms: 7000 }); if (err.details?.field?.startsWith('captain') || err.details?.field === 'emblem') { step = 1; paintStep(root); fieldsCtl.setServerError(err); } else if (err.details?.field === 'players') { step = 2; paintStep(root); } }
    }
  }

  return {
    mount(root) {
      const t = v.t;
      if (!t.registration.open && !created) { render(root, closedView(t)); return; }
      paintStep(root);
      on(root, 'click', '[data-act]', async (e, el) => {
        const act = el.dataset.act;
        if (act === 'back') { if (step === 2) players = rosterCtl.getPlayers(); if (step === 3) accepted = !!$('[name=accept]', root)?.checked; step--; paintStep(root); window.scrollTo({ top: 0, behavior: 'smooth' }); }
        if (act === 'next2') { if (!rosterCtl.validate()) return; players = rosterCtl.getPlayers(); step = 3; paintStep(root); window.scrollTo({ top: 0, behavior: 'smooth' }); }
        if (act === 'submit') await submit(root, el);
        if (act === 'copy-code') toast((await copyText(el.dataset.code)) ? 'Código copiado!' : 'Anote o código.', { type: 'success', ms: 2000 });
      });
    },
    update(t) {
      // se as inscrições fecharem enquanto o visitante preenche, avisa sem perder os dados
      const root = v.main; if (!root || created) return;
      if (!t.registration.open && !$('[data-closedwarn]', root)) {
        const warn = document.createElement('div'); warn.className = 'form-note warn'; warn.dataset.closedwarn = ''; warn.innerHTML = `<span>${t.registration.reason || 'As inscrições foram encerradas.'} Você ainda pode tentar concluir, mas a inscrição pode ser recusada.</span>`;
        root.prepend(warn);
      }
    },
    destroy() { payCtl?.destroy(); },
  };
}
