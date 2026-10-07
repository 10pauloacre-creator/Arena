// Times e inscrições: lista, filtros, detalhes, confirmação manual, edição, remoção e cadastro manual.
import { html, render, ic, $, on, setBusy } from '../../ui/dom.js';
import { emblem, TEAM_STATUS, PAY_METHOD } from '../../ui/util.js';
import { openDialog, confirmDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { teamFieldsHTML, wireTeamFields } from '../../ui/teamform.js';
import { createRosterEditor } from '../../ui/roster.js';
import { api } from '../../api.js';
import { fmtBRL, fmtDateTime } from '../../shared/format.js';
import { SPORTS } from '../../shared/sports.js';

export default function (app) {
  let filter = 'confirmed';
  const FILTERS = [['confirmed', 'Confirmados'], ['pending', 'Aguardando pagamento'], ['all', 'Todos']];

  const visible = t => t.teams.filter(x => filter === 'all' ? true : filter === 'pending' ? x.status === 'pending_payment' : x.status === 'confirmed')
    .sort((a, b) => (a.confirmedAt || a.createdAt) - (b.confirmedAt || b.createdAt));

  function row(t, x) {
    const [label, cls] = TEAM_STATUS[x.status] || [x.status, ''];
    const pend = x.status === 'pending_payment';
    return html`<li class="team-row" data-tid="${x.id}">
      ${emblem(x, 'md')}
      <div class="grow"><div class="t-name ellipsis">${x.name} ${x.repescada ? html`<span class="tag-benef">${ic('heart', { size: 11 })} Repescada</span>` : ''}</div>
        <div class="t-meta"><span>${x.origin || 'Sem bairro/clube'}</span><span>${ic('users', { size: 13 })} ${x.players.length} atletas</span><span>${x.captain.name}</span>${x.paidVia ? html`<span>${ic('wallet', { size: 13 })} ${PAY_METHOD[x.paidVia] || x.paidVia}</span>` : ''}${pend && x.reservationActive ? html`<span>${ic('clock', { size: 13 })} reserva até ${new Date(x.reservedUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>` : ''}</div></div>
      <div class="t-act"><span class="badge ${cls}">${label}</span>
        <button class="btn btn-sm" data-act="view">Detalhes</button>
        ${pend ? html`<button class="btn btn-sm btn-primary" data-act="confirm">${ic('check', { size: 15 })} Confirmar</button>` : ''}
      </div></li>`;
  }

  function paymentsCard(t) {
    const pending = t.payments.filter(p => p.needsRefund);
    if (!pending.length && !t.fee) return '';
    return html`<div class="card"><h3 class="card-title">${ic('wallet')} Pagamentos</h3>
      <div class="metrics" style="margin-bottom:${pending.length ? 14 : 0}px"><div class="metric"><b>${fmtBRL(t.stats.revenue)}</b><span>Inscrições recebidas</span></div><div class="metric"><b>${t.teams.filter(x => x.status === 'pending_payment' && x.reservationActive).length}</b><span>Aguardando pagamento</span></div><div class="metric"><b>${fmtBRL(t.fee)}</b><span>Valor por time</span></div><div class="metric"><b>${t.stats.refundsPending}</b><span>Reembolsos pendentes</span></div></div>
      ${pending.length ? html`<div class="form-note warn" style="margin-bottom:10px">${ic('triangle-alert')}<span>Pagamentos aprovados que precisam de reembolso (sem vaga ou time removido). Faça o estorno no seu provedor de pagamento e marque abaixo.</span></div>
        <ul>${pending.map(p => html`<li class="admin-row"><div class="grow"><b>${p.teamName}</b><div class="muted small">${PAY_METHOD[p.method] || p.method} · ${fmtBRL(p.amount)} · ${fmtDateTime(p.paidAt)}</div></div><button class="btn btn-sm" data-act="refunded" data-pid="${p.id}">Marcar como reembolsado</button></li>`)}</ul>` : ''}</div>`;
  }

  function view() {
    const t = app.t, list = visible(t);
    const reg = t.registration;
    return html`
      <div class="page-head"><div><h2>Times e inscrições</h2><p>${t.teamsConfirmed} de ${t.maxTeams} vagas preenchidas · ${reg.open ? 'inscrições abertas' : (reg.reason || 'inscrições encerradas')}</p></div>
        <button class="btn btn-primary" data-act="add" ${t.bracket ? 'disabled title="O chaveamento já foi sorteado"' : ''}>${ic('user-plus', { size: 18 })} Adicionar time</button></div>
      ${paymentsCard(t)}
      <div class="card flush">
        <div style="padding:14px 18px;border-bottom:1px solid var(--line)"><div class="seg" role="group" aria-label="Filtrar times">${FILTERS.map(([k, l]) => html`<button type="button" data-filter="${k}" aria-pressed="${filter === k}">${l}${k === 'pending' ? html` <span class="badge warn" style="padding:0 7px">${t.teams.filter(x => x.status === 'pending_payment').length}</span>` : ''}</button>`)}</div></div>
        ${list.length ? html`<ul>${list.map(x => row(t, x))}</ul>` : html`<div class="empty" style="margin:18px">${ic('users', { size: 30 })}<strong>${filter === 'pending' ? 'Ninguém aguardando pagamento' : 'Nenhum time por aqui ainda'}</strong><span>${filter === 'confirmed' ? 'Compartilhe o link do torneio para os capitães se inscreverem.' : 'Tudo em dia.'}</span>${filter === 'confirmed' ? html`<button class="btn btn-primary" data-act="copy-link">${ic('copy', { size: 16 })} Copiar link de inscrição</button>` : ''}</div>`}
      </div>`;
  }

  // ---------------------------------------------------------------- detalhes
  function openTeamDialog(id) {
    const t = app.t, x = t.teams.find(y => y.id === id); if (!x) return;
    const [label, cls] = TEAM_STATUS[x.status] || [x.status, ''];
    const official = t.type === 'oficial';
    const d = openDialog({
      title: x.name, wide: true,
      body: html`
        <div class="row"><span>${emblem(x, 'lg')}</span><div class="grow"><span class="badge ${cls}">${label}</span> ${x.repescada ? html`<span class="tag-benef">${ic('heart', { size: 11 })} Repescada</span>` : ''}
          <div class="muted small" style="margin-top:6px">Inscrito em ${fmtDateTime(x.createdAt)}${x.confirmedAt ? ` · confirmado em ${fmtDateTime(x.confirmedAt)}` : ''}${x.paidVia ? ` · ${PAY_METHOD[x.paidVia] || x.paidVia}` : ''}</div></div></div>
        <div class="cols-2"><div class="card" style="box-shadow:none;padding:14px"><div class="label">Responsável</div><div>${x.captain.name}</div>
            <a class="small" href="https://wa.me/55${x.captain.phone}" target="_blank" rel="noopener" data-external>${ic('message-circle', { size: 14 })} WhatsApp ${x.captain.phone}</a><br><a class="small" href="mailto:${x.captain.email}">${x.captain.email}</a></div>
          <div class="card" style="box-shadow:none;padding:14px"><div class="label">Clube / bairro</div><div>${x.origin || '—'}</div><div class="label" style="margin-top:8px">Código do capitão</div><div class="strong num">${x.accessCode}</div></div></div>
        <div><div class="label" style="margin-bottom:8px">Elenco (${x.players.length})</div><ul class="player-grid">${x.players.map(p => html`<li class="player"><span class="jersey">${p.number}</span><div class="grow" style="min-width:0"><div class="p-n ellipsis">${p.name}</div>${official ? html`<div class="p-s">CPF ${p.cpf} · RG ${p.rg}${p.doc ? ` · ${p.doc.name}` : ''}</div>` : ''}</div></li>`)}</ul></div>`,
      foot: html`${t.bracket ? '' : html`<button class="btn btn-outline-danger" data-act="remove">${ic('trash', { size: 16 })} Remover</button>`}<span class="grow"></span><button class="btn" data-act="edit">${ic('pencil', { size: 16 })} Editar</button>${x.status === 'pending_payment' ? html`<button class="btn btn-primary" data-act="confirm">${ic('check', { size: 16 })} Confirmar pagamento</button>` : ''}`,
    });
    d.el.addEventListener('click', async e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'edit') { d.close(); openEditDialog(id); }
      if (b.dataset.act === 'confirm') { d.close(); await confirmTeam(id); }
      if (b.dataset.act === 'remove') { d.close(); await removeTeam(id); }
    });
  }

  async function confirmTeam(id) {
    const x = app.t.teams.find(y => y.id === id);
    if (!await confirmDialog({ title: 'Confirmar o time?', text: `${x.name} entrará na lista de times confirmados sem passar pelo pagamento (por exemplo, pago em dinheiro).`, ok: 'Confirmar time' })) return;
    await app.act(() => api.post(`/tournaments/${app.t.id}/teams/${id}/confirm`), { ok: `${x.name} confirmado.` }).catch(() => {});
  }
  async function removeTeam(id) {
    const x = app.t.teams.find(y => y.id === id);
    const paid = app.t.payments.some(p => p.teamId === id && p.kind === 'registration' && p.status === 'approved');
    if (!await confirmDialog({ title: 'Remover time?', text: paid ? `${x.name} já pagou a inscrição. Ele será cancelado e o pagamento ficará marcado como reembolso pendente.` : `${x.name} será removido da lista de inscritos.`, ok: 'Remover', danger: true })) return;
    await app.act(() => api.del(`/tournaments/${app.t.id}/teams/${id}`), { ok: 'Time removido.' }).catch(() => {});
  }

  function openEditDialog(id) {
    const t = app.t, x = t.teams.find(y => y.id === id);
    const d = openDialog({
      title: `Editar ${x.name}`, wide: true,
      body: html`<form id="editTeam" class="stack" novalidate>
        <div class="cols-2"><div class="field" data-f="name"><label for="e-name">Nome do time</label><input id="e-name" name="name" maxlength="32" value="${x.name}"><span class="field-error"></span></div>
          <div class="field" data-f="origin"><label for="e-origin">Clube / bairro</label><input id="e-origin" name="origin" maxlength="32" value="${x.origin}"><span class="field-error"></span></div></div>
        <div class="field" data-f="rating"><label for="e-rating">Força (rating)</label><input id="e-rating" name="rating" type="number" min="500" max="3000" step="10" value="${x.rating}"><span class="hint">Usada pelo sorteio para equilibrar as chaves. Padrão: 1500. Times mais fortes recebem byes quando o número de times não fecha a chave.</span><span class="field-error"></span></div>
        ${t.bracket ? html`<div class="form-note warn">${ic('lock')}<span>O chaveamento já foi sorteado: o elenco não pode mais ser alterado.</span></div>` : html`<div id="rosterBox"></div>`}
        <div class="form-error" hidden></div></form>`,
      foot: html`<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" type="submit" form="editTeam" id="etGo">${ic('save', { size: 16 })} Salvar</button>`,
    });
    const form = $('#editTeam', d.el);
    const roster = t.bracket ? null : createRosterEditor($('#rosterBox', d.el), { sport: t.sport, official: t.type === 'oficial', players: x.players });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const body = { name: form.name.value.trim(), origin: form.origin.value.trim(), rating: Number(form.rating.value) };
      if (roster) { if (!roster.validate()) return; body.players = roster.getPlayers(); }
      const btn = $('#etGo', d.el); setBusy(btn, true);
      try { await app.act(() => api.patch(`/tournaments/${t.id}/teams/${id}`, body), { silent: true, ok: 'Time atualizado.' }); d.close('ok'); render(app.main, view()); }
      catch (err) { setBusy(btn, false); const box = $('.form-error', form); box.hidden = false; box.textContent = err.message; }
    });
  }

  function openAddDialog() {
    const t = app.t, sport = SPORTS[t.sport];
    const d = openDialog({
      title: 'Adicionar time', wide: true,
      body: html`<form id="addTeam" class="stack" novalidate>
        <p class="muted small">Use para times que se inscreveram fora do site (WhatsApp, dinheiro). O time entra direto na lista de confirmados.</p>
        ${teamFieldsHTML({})}<div id="rosterBox"></div>
        ${t.fee > 0 ? html`<label class="check"><input type="checkbox" name="paid" checked><span>Inscrição já paga (${fmtBRL(t.fee)}) — confirmar agora</span></label>` : ''}
        <div class="form-error" hidden></div></form>`,
      foot: html`<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" type="submit" form="addTeam" id="atGo">${ic('user-plus', { size: 16 })} Adicionar time</button>`,
    });
    const form = $('#addTeam', d.el);
    const fields = wireTeamFields(form);
    const roster = createRosterEditor($('#rosterBox', d.el), { sport: t.sport, official: t.type === 'oficial' });
    void sport;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const okF = fields.validate(), okR = roster.validate();
      if (!okF || !okR) return;
      const body = { ...fields.read(), players: roster.getPlayers(), paid: form.paid ? form.paid.checked : true };
      const btn = $('#atGo', d.el); setBusy(btn, true);
      try { await app.act(() => api.post(`/tournaments/${t.id}/teams`, body), { silent: true, ok: `${body.name} adicionado.` }); d.close('ok'); render(app.main, view()); }
      catch (err) { setBusy(btn, false); if (!fields.setServerError(err)) { const box = $('.form-error', form); box.hidden = false; box.textContent = err.message; } }
    });
  }

  return {
    mount(root) {
      render(root, view());
      on(root, 'click', '[data-filter]', (e, el) => { filter = el.dataset.filter; render(root, view()); });
      on(root, 'click', '[data-act]', async (e, el) => {
        const act = el.dataset.act, tid = el.closest('[data-tid]')?.dataset.tid;
        if (act === 'add') openAddDialog();
        if (act === 'view') openTeamDialog(tid);
        if (act === 'confirm') await confirmTeam(tid);
        if (act === 'copy-link') { await navigator.clipboard?.writeText(app.visitorUrl()).catch(() => {}); toast('Link copiado!', { type: 'success', ms: 2000 }); }
        if (act === 'refunded') await app.act(() => api.post(`/tournaments/${app.t.id}/payments/${el.dataset.pid}/refunded`), { ok: 'Reembolso registrado.' }).catch(() => {});
      });
    },
    update(t, { fromPoll } = {}) {
      const root = app.main; if (!root || document.querySelector('dialog[open]')) return;
      render(root, view());
      void fromPoll;
    },
  };
}
