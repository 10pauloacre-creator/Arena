// Configurações: inscrições (prazo, valor, vagas), repescagem, administradores e convites, exclusão.
import { html, render, ic, $, on, copyText, setBusy } from '../../ui/dom.js';
import { openDialog, confirmDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { setFieldError, clearErrors, parseMoney, centsToInput, isoToLocalParts, localPartsToIso } from '../../ui/forms.js';
import { api } from '../../api.js';
import { session } from '../../session.js';
import { navigate } from '../../router.js';
import { BRACKET_SIZES, TOURNAMENT_TYPES } from '../../shared/sports.js';
import { fmtDateTime } from '../../shared/format.js';
import {
  feeDraft, feeFieldsHTML, readFeeDraft, feeFromDraft,
  rulesDraft, rulesFieldsHTML, readRulesDraft, rulesFromDraft,
  prizesDraft, prizesFieldsHTML, readPrizesDraft, prizesFromDraft, prizeAdd, prizeDel,
  detailsFieldHTML, wireTourneyForm,
} from '../../ui/tourneyform.js';
import { RULE_DEFS, normalizeRules, normalizePrizes } from '../../shared/rules.js';

const sameRules = (a, b) => RULE_DEFS.every(d => a[d.key] === b[d.key]) && a.custom.join('\n') === b.custom.join('\n');

export default function (app) {
  let draft = null, lastInvite = null, forceReset = false;

  function fromTournament(t) {
    const dl = isoToLocalParts(t.regDeadline);
    return {
      registrationOpen: t.registrationOpen, deadlineDate: t.regDeadline ? dl.date : '', deadlineTime: dl.time, fee: feeDraft(t), maxTeams: t.maxTeams, type: t.type,
      venue: t.venue || '', description: t.description || '', details: t.details || '', donationEnabled: t.donationEnabled, minDonation: centsToInput(t.minDonation), causes: t.causes.join('\n'),
      rules: rulesDraft(t.rules, t.sport), prizes: prizesDraft(t.prizes),
    };
  }
  const reset = () => { draft = fromTournament(app.t); };
  reset();
  const dirty = () => JSON.stringify(draft) !== JSON.stringify(fromTournament(app.t));

  const visitorLink = () => app.visitorUrl();
  const inviteUrl = code => `${location.origin}/convite/${code}`;

  function view() {
    const t = app.t, d = draft, me = t.me;
    const hasTeams = t.teams.some(x => x.status === 'confirmed' || x.status === 'pending_payment');
    const mock = session.config?.payments?.mock;
    return html`
    <div class="page-head"><div><h2>Configurações</h2><p>Defina o prazo, o valor da inscrição, convide outros organizadores e gerencie o torneio.</p></div></div>
    <form class="settings" id="settingsForm" novalidate>
      <div class="card"><h3 class="card-title">${ic('door-open')} Inscrições</h3>
        <div class="stack">
          <label class="switch"><input type="checkbox" name="registrationOpen" ${d.registrationOpen ? 'checked' : ''} ${t.bracket ? 'disabled' : ''}><span class="track"></span><span><b>Inscrições abertas</b><br><span class="muted small">Desligue para encerrar as inscrições antes do prazo.</span></span></label>
          <div class="cols-3">
            <div class="field" data-f="deadlineDate"><label for="s-dd">Prazo final — data</label><input id="s-dd" type="date" name="deadlineDate" value="${d.deadlineDate}" ${t.bracket ? 'disabled' : ''}><span class="field-error"></span></div>
            <div class="field" data-f="deadlineTime"><label for="s-dt">Prazo final — horário</label><input id="s-dt" type="time" name="deadlineTime" value="${d.deadlineTime}" ${t.bracket ? 'disabled' : ''}><span class="field-error"></span></div>
            <div class="field" data-f="maxTeams"><label for="s-mt">Vagas (times)</label><select id="s-mt" name="maxTeams" ${t.bracket ? 'disabled' : ''}>${BRACKET_SIZES.map(n => html`<option value="${n}" ${+d.maxTeams === n ? 'selected' : ''}>${n} times</option>`)}</select><span class="field-error"></span></div>
          </div>
          <p class="hint" style="margin-top:-6px">${ic('clock', { size: 14 })} Deixe a data em branco para não ter prazo (encerre manualmente). Horário no fuso do seu navegador.</p>
          ${feeFieldsHTML(d.fee)}
          <div class="field" data-f="venue"><label for="s-venue">Local dos jogos</label><input id="s-venue" name="venue" maxlength="80" value="${d.venue}" placeholder="Ex.: Ginásio Municipal"><span class="field-error"></span></div>
          <div class="field" data-f="type"><span class="label">Tipo de torneio</span><div class="tiles c2 stack-mobile">${Object.entries(TOURNAMENT_TYPES).map(([k, label]) => html`<div class="tile sm"><input type="radio" name="type" id="ty-${k}" value="${k}" ${d.type === k ? 'checked' : ''} ${hasTeams ? 'disabled' : ''}><label for="ty-${k}"><span class="t-ico">${ic(k === 'oficial' ? 'badge-check' : 'users', { size: 20 })}</span><span><span class="t-title">${label}</span><span class="t-sub">${k === 'oficial' ? 'CPF, RG e documento em PDF de cada atleta' : 'Apenas nome e número da camisa'}</span></span></label></div>`)}</div>${hasTeams ? html`<span class="hint">${ic('lock', { size: 13 })} Travado: já existem times inscritos.</span>` : ''}</div>
          <div class="field" data-f="description"><label for="s-desc">Descrição curta (aparece no topo da página do visitante)</label><textarea id="s-desc" name="description" maxlength="400" rows="2" placeholder="Uma ou duas linhas sobre o torneio.">${d.description}</textarea><span class="field-error"></span></div>
          ${mock ? html`<div class="form-note warn">${ic('triangle-alert')}<span><b>Pagamentos em modo de teste.</b> Nenhum valor é cobrado de verdade e o PIX pode ser "simulado" pelo capitão. Para cobrar de verdade, configure o Mercado Pago (veja o README).</span></div>` : html`<div class="form-note ok">${ic('shield-check')}<span>Pagamentos reais ativos via ${session.config.payments.name === 'mercadopago' ? 'Mercado Pago' : session.config.payments.name}.</span></div>`}
        </div></div>

      <div class="card"><h3 class="card-title">${ic('list-checks')} Regras do torneio</h3>
        <p class="card-sub">Marque o que vale no seu torneio. As conferidas pelo sistema barram a inscrição; nas demais, o capitão aceita as regras ao inscrever o time.${hasTeams ? ' Mudanças valem para novas inscrições: times já inscritos não são afetados.' : ''}</p>
        ${rulesFieldsHTML(d.rules, t.sport)}</div>

      <div class="card"><h3 class="card-title">${ic('info')} Detalhes e avisos</h3>${detailsFieldHTML(d.details)}</div>

      <div class="card"><h3 class="card-title">${ic('medal')} Premiação</h3>
        <p class="card-sub">Adicione as colocações (1º, 2º, 3º…) de cada categoria. Use o texto, o valor em dinheiro ou os dois.</p>
        ${prizesFieldsHTML(d.prizes)}</div>

      <div class="card"><h3 class="card-title">${ic('hand-heart')} Repescagem beneficente</h3>
        <div class="stack">
          <label class="switch"><input type="checkbox" name="donationEnabled" ${d.donationEnabled ? 'checked' : ''}><span class="track"></span><span><b>Permitir re-inscrição beneficente</b><br><span class="muted small">Equipes eliminadas podem voltar com uma doação e disputar uma revanche.</span></span></label>
          <div class="cols-2"><div class="field" data-f="minDonation"><label for="s-md">Doação mínima</label><div class="input-affix"><span class="prefix">R$</span><input id="s-md" name="minDonation" inputmode="decimal" value="${d.minDonation}"></div><span class="field-error"></span></div></div>
          <div class="field" data-f="causes"><label for="s-causes">Causas beneficiadas (uma por linha, até 6)</label><textarea id="s-causes" name="causes" rows="3">${d.causes}</textarea><span class="field-error"></span></div>
        </div></div>
    </form>

    <div class="settings">
      <div class="card"><h3 class="card-title">${ic('user-plus')} Administradores</h3>
        <p class="card-sub">Quem administra pode gerenciar times, jogos e chaveamento. Convide outros organizadores por link.</p>
        <ul>${t.admins.map(a => html`<li class="admin-row"><span class="avatar" style="width:38px;height:38px;font-size:13px">${a.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()}</span><div class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${a.name}${a.userId === me.userId ? ' (você)' : ''}</b><span class="muted small ellipsis" style="display:block">${a.email}</span></div><span class="badge ${a.role === 'owner' ? 'info' : ''}">${a.role === 'owner' ? 'Criador' : 'Administrador'}</span>${a.role !== 'owner' && (me.role === 'owner' || a.userId === me.userId) ? html`<button type="button" class="btn btn-sm btn-outline-danger" data-act="rm-admin" data-uid="${a.userId}">${a.userId === me.userId ? 'Sair' : 'Remover'}</button>` : ''}</li>`)}</ul>
        <div style="margin-top:14px" class="stack-sm">
          ${lastInvite ? html`<div class="form-note ok">${ic('circle-check')}<div class="grow"><b>Link de convite criado</b> — válido por 7 dias e de uso único.<div class="copy-field" style="margin-top:8px"><input readonly value="${lastInvite}" aria-label="Link de convite" data-select><button type="button" class="btn btn-sm" data-act="copy-invite" data-url="${lastInvite}">${ic('copy', { size: 15 })} Copiar</button></div></div></div>` : ''}
          <div><button type="button" class="btn btn-primary" data-act="new-invite">${ic('link', { size: 16 })} Gerar link de convite</button></div>
          ${t.invites.length ? html`<h4 style="font-size:14px;margin-top:8px">Convites pendentes</h4><ul>${t.invites.map(i => html`<li class="admin-row"><div class="grow" style="min-width:0"><span class="small ellipsis" style="display:block">${inviteUrl(i.code)}</span><span class="muted xs">expira em ${fmtDateTime(i.expiresAt)}</span></div><button type="button" class="btn btn-sm" data-act="copy-invite" data-url="${inviteUrl(i.code)}">Copiar</button><button type="button" class="btn btn-sm btn-ghost" data-act="revoke" data-code="${i.code}" aria-label="Revogar convite">${ic('trash', { size: 16 })}</button></li>`)}</ul>` : ''}
        </div></div>

      <div class="card"><h3 class="card-title">${ic('globe')} Link do visitante e ID</h3>
        <div class="stack-sm"><div class="copy-field"><input readonly value="${visitorLink()}" aria-label="Link do visitante"><button type="button" class="btn btn-sm" data-act="copy-link">${ic('copy', { size: 15 })} Copiar</button></div>
          <div class="copy-field"><input readonly value="#${t.id}" aria-label="ID do torneio"><button type="button" class="btn btn-sm" data-act="copy-id">${ic('copy', { size: 15 })} Copiar</button></div>
          <p class="hint">Quem acessa o link — ou digita o ID na página inicial — entra na página do visitante: inscrição de times, partidas ao vivo e chaveamento.</p></div></div>

      ${me.role === 'owner' ? html`<div class="card danger-zone"><h3 class="card-title" style="color:var(--red)">${ic('triangle-alert')} Zona de perigo</h3><p class="card-sub">Excluir o torneio apaga times, partidas e histórico de forma definitiva.</p><button class="btn btn-outline-danger" data-act="delete">${ic('trash', { size: 16 })} Excluir torneio</button></div>` : ''}
    </div>

    <div class="savebar-fixed" id="saveBar" ${dirty() ? '' : 'hidden'}><span>${ic('circle-alert', { size: 16 })} Você tem alterações não salvas.</span><span class="row"><button type="button" class="btn btn-ghost" data-act="discard" style="color:#fff">Descartar</button><button type="button" class="btn btn-primary" data-act="save" id="saveBtn">${ic('save', { size: 16 })} Salvar alterações</button></span></div>`;
  }

  function readForm(root) {
    const f = $('#settingsForm', root);
    return {
      registrationOpen: f.registrationOpen.checked, deadlineDate: f.deadlineDate.value, deadlineTime: f.deadlineTime.value, fee: readFeeDraft(f), maxTeams: Number(f.maxTeams.value),
      type: (f.type.value || draft.type), venue: f.venue.value, description: f.description.value, details: f.details.value, donationEnabled: f.donationEnabled.checked, minDonation: f.minDonation.value, causes: f.causes.value,
      rules: readRulesDraft(f), prizes: readPrizesDraft(f),
    };
  }

  async function save(root) {
    const f = $('#settingsForm', root); clearErrors(f);
    const d = readForm(root); draft = d;
    const bad = (n, m) => { const fld = $(`[data-f="${n}"]`, f); setFieldError(fld, m); $('input,textarea,select', fld)?.focus(); return true; };
    const minC = parseMoney(d.minDonation);
    const feeR = feeFromDraft(d.fee); if (feeR.error) return bad(feeR.error.field, feeR.error.message);
    const rulesR = rulesFromDraft(d.rules, app.t.sport); if (rulesR.error) return bad(rulesR.error.field, rulesR.error.message);
    const prizesR = prizesFromDraft(d.prizes); if (prizesR.error) return bad(prizesR.error.field, prizesR.error.message);
    if (!Number.isFinite(minC) || minC < 500) return bad('minDonation', 'A doação mínima é de R$ 5,00.');
    if (d.deadlineDate && !d.deadlineTime) return bad('deadlineTime', 'Informe o horário limite.');
    const causes = d.causes.split('\n').map(s => s.trim()).filter(Boolean);
    if (!causes.length || causes.length > 6) return bad('causes', 'Informe de 1 a 6 causas.');
    const t = app.t, body = {};
    const iso = d.deadlineDate ? localPartsToIso(d.deadlineDate, d.deadlineTime) : null;
    if (iso !== t.regDeadline) body.regDeadline = iso;
    if (d.registrationOpen !== t.registrationOpen) body.registrationOpen = d.registrationOpen;
    if (feeR.fee !== t.fee) Object.assign(body, feeR.freeRegistration ? { freeRegistration: true } : { freeRegistration: false, fee: feeR.fee });
    if (d.maxTeams !== t.maxTeams) body.maxTeams = d.maxTeams;
    if (d.type !== t.type) body.type = d.type;
    if (d.venue.trim() !== (t.venue || '')) body.venue = d.venue.trim();
    if (d.description.trim() !== (t.description || '')) body.description = d.description.trim();
    if (d.details.trim() !== (t.details || '')) body.details = d.details;
    if (!sameRules(rulesR.rules, normalizeRules(t.rules))) body.rules = rulesR.rules;
    if (JSON.stringify(prizesR.prizes) !== JSON.stringify(normalizePrizes(t.prizes))) body.prizes = prizesR.prizes;
    if (d.donationEnabled !== t.donationEnabled) body.donationEnabled = d.donationEnabled;
    if (minC !== t.minDonation) body.minDonation = minC;
    if (causes.join('\n') !== t.causes.join('\n')) body.causes = causes;
    if (!Object.keys(body).length) { reset(); render(root, view()); return; }
    const btn = $('#saveBtn', root); setBusy(btn, true);
    try {
      const r = await api.patch(`/tournaments/${t.id}`, body);
      forceReset = true; app.set(r.tournament); toast('Configurações salvas.', { type: 'success' });
    } catch (err) {
      setBusy(btn, false);
      if (err.details?.field && $(`[data-f=${err.details.field}]`, f)) setFieldError($(`[data-f=${err.details.field}]`, f), err.message);
      toast(err.message, { type: 'error', ms: 6500 });
    }
  }

  return {
    mount(root) {
      render(root, view());
      const refreshBar = () => { const bar = $('#saveBar', root); if (!bar) return; draft = readForm(root); bar.hidden = !dirty(); };
      root.addEventListener('input', e => { if (e.target.closest('#settingsForm')) refreshBar(); });
      root.addEventListener('change', e => { if (e.target.closest('#settingsForm')) refreshBar(); });
      root.addEventListener('submit', e => { e.preventDefault(); });
      wireTourneyForm(root);
      root.addEventListener('focusin', e => { if (e.target.matches('[data-select]')) e.target.select(); });
      on(root, 'click', '[data-act]', async (e, el) => {
        const act = el.dataset.act, t = app.t;
        if (act === 'save') await save(root);
        if (act === 'discard') { reset(); render(root, view()); }
        if (act === 'prize-add' || act === 'prize-del') {
          draft = readForm(root); const cat = el.dataset.cat;
          if (act === 'prize-add') prizeAdd(draft.prizes, cat); else prizeDel(draft.prizes, cat, Number(el.dataset.i));
          render(root, view());
          $(act === 'prize-add' ? `[name="prize-${cat}-${draft.prizes[cat].length - 1}-description"]` : `[data-act="prize-add"][data-cat="${cat}"]`, root)?.focus();
        }
        if (act === 'copy-link') toast((await copyText(visitorLink())) ? 'Link copiado!' : 'Copie manualmente.', { type: 'success', ms: 2000 });
        if (act === 'copy-id') toast((await copyText('#' + t.id)) ? 'ID copiado!' : 'Copie manualmente.', { type: 'success', ms: 2000 });
        if (act === 'copy-invite') toast((await copyText(el.dataset.url)) ? 'Link de convite copiado!' : 'Copie manualmente.', { type: 'success', ms: 2200 });
        if (act === 'new-invite') {
          setBusy(el, true);
          try { const r = await api.post(`/tournaments/${t.id}/invites`); lastInvite = r.invite.url; draftSafeSet(r.tournament); } catch (err) { toast(err.message, { type: 'error' }); } finally { setBusy(el, false); }
        }
        if (act === 'revoke') { await app.act(() => api.del(`/tournaments/${t.id}/invites/${el.dataset.code}`), { ok: 'Convite revogado.' }).catch(() => {}); lastInvite = null; }
        if (act === 'rm-admin') {
          const self = el.dataset.uid === t.me.userId, a = t.admins.find(x => x.userId === el.dataset.uid);
          if (!await confirmDialog({ title: self ? 'Sair da administração?' : 'Remover administrador?', text: self ? 'Você deixará de administrar este torneio.' : `${a.name} perderá o acesso de administrador.`, ok: self ? 'Sair' : 'Remover', danger: true })) return;
          try {
            const r = await api.del(`/tournaments/${t.id}/admins/${el.dataset.uid}`);
            if (r.left) { toast('Você saiu da administração do torneio.', { type: 'success' }); navigate('/'); } else { app.set(r.tournament); toast('Administrador removido.', { type: 'success' }); }
          } catch (err) { toast(err.message, { type: 'error' }); }
        }
        if (act === 'delete') deleteDialog();
      });
    },
    dirty, discard: reset,
    update(t, { fromPoll } = {}) {
      const root = app.main; if (!root) return;
      if (forceReset) { forceReset = false; reset(); render(root, view()); return; }
      if (dirty() && fromPoll) return;
      if (!dirty()) reset();
      if (fromPoll && root.contains(document.activeElement) && document.activeElement.matches('input,textarea,select')) return;
      render(root, view());
    },
  };

  function draftSafeSet(next) { const keep = draft; app.set(next); draft = keep; }

  function deleteDialog() {
    const t = app.t;
    const d = openDialog({
      title: 'Excluir torneio',
      body: html`<p>Esta ação é <b>definitiva</b>: times, partidas, pagamentos e histórico serão apagados. Para confirmar, digite o nome do torneio:</p><p class="strong">${t.name}</p>
        <form id="delForm" class="stack" novalidate><div class="field"><label for="del-name" class="sr-only">Nome do torneio</label><input id="del-name" name="confirm" autocomplete="off" placeholder="Digite o nome exatamente"></div><div class="form-error" hidden></div></form>`,
      foot: html`<button class="btn" data-close>Cancelar</button><button class="btn btn-danger" type="submit" form="delForm" id="delGo" disabled>Excluir definitivamente</button>`,
    });
    const form = $('#delForm', d.el), go = $('#delGo', d.el);
    form.confirm.addEventListener('input', () => { go.disabled = form.confirm.value.trim() !== t.name; });
    form.addEventListener('submit', async e => {
      e.preventDefault(); setBusy(go, true);
      try { await api.del(`/tournaments/${t.id}`, { confirm: form.confirm.value.trim() }); d.close('ok'); toast('Torneio excluído.', { type: 'success' }); navigate('/'); }
      catch (err) { setBusy(go, false); const box = $('.form-error', d.el); box.hidden = false; box.textContent = err.message; }
    });
  }
}
