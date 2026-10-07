// Painel: hero com edição (nome, data, modalidade) + botão Salvar, link do visitante, indicadores e gráficos.
import { html, render, ic, $, $$, on, copyText, setBusy } from '../../ui/dom.js';
import { heroArt, statusBadge, relTime } from '../../ui/util.js';
import { lineChart, barChart } from '../../ui/charts.js';
import { toast } from '../../ui/toast.js';
import { setFieldError } from '../../ui/forms.js';
import { api } from '../../api.js';
import { SPORTS } from '../../shared/sports.js';
import { fmtBRL, fmtNum } from '../../shared/format.js';

export default function (app) {
  let draft = null;
  let savedFlash = false;
  const lockReason = t => t.bracket ? 'O chaveamento já foi sorteado.' : (t.teams.some(x => x.status === 'confirmed' || x.status === 'pending_payment') ? 'Já existem times inscritos.' : '');
  const resetDraft = () => { const t = app.t; draft = { name: t.name, finalDate: t.finalDate, sport: t.sport }; };
  resetDraft();
  const dirty = () => { const t = app.t; return draft.name.trim() !== t.name || draft.finalDate !== t.finalDate || draft.sport !== t.sport; };

  const doneRounds = t => t.bracket ? t.bracket.rounds.map(r => r.name.replace(' de final', '').replace('Semifinais', 'semi').replace('Quartas', 'quartas').replace('Oitavas', 'oitavas').replace('Final', 'final')).join(', ') : 'quartas, semi e final';

  function nextSteps(t) {
    const feeSet = t.fee > 0 || true;
    const steps = [
      { done: !!t.regDeadline, label: 'Definir prazo, valor e vagas das inscrições', go: 'configuracoes', cta: 'Configurar' },
      { done: t.teamsConfirmed >= 2, label: `Receber inscrições (${t.teamsConfirmed} de ${t.maxTeams} times)`, go: null, cta: 'Copiar link', copy: true },
      { done: !!t.bracket, label: 'Sortear o chaveamento', go: 'chaveamento', cta: 'Sortear' },
      { done: !!t.bracket && t.stats.matchesDone > 0, label: 'Conduzir os jogos ao vivo', go: 'ao-vivo', cta: 'Abrir' },
      { done: !!t.champion, label: 'Coroar o campeão', go: null },
    ];
    void feeSet;
    return steps;
  }

  function view() {
    const t = app.t, locked = lockReason(t), d = draft;
    const s = t.stats;
    const regData = t.regSeries.map(p => ({ label: p.label, value: p.value }));
    return html`
    <section class="hero" aria-label="Resumo do torneio">
      ${heroArt(t.sport)}
      <div>
        <p class="eyebrow">Organizador</p>
        <h2>${t.name}</h2>
        <p class="lead">Inscrições com pagamento, jogos ao vivo, chaveamento justo e divulgação automática — tudo em um único painel.</p>
        <div class="hero-actions">
          <div class="idchip"><small>ID único do torneio</small><strong class="num">#${t.id}</strong></div>
          <button class="btn" data-act="copy-id" style="min-height:54px">${ic('copy', { size: 18 })} Copiar ID</button>
          <span class="btn btn-primary" style="cursor:default" aria-label="Situação do torneio">${ic(t.status === 'inscricoes' ? 'users' : 'zap', { size: 18 })} ${t.statusLabel}</span>
        </div>
      </div>
      <form class="hero-edit" data-form novalidate>
        <div class="field" data-f="name"><label for="p-name">Nome do torneio</label><div class="input-icon"><span class="ico">${ic('trophy', { size: 18 })}</span><input id="p-name" name="name" maxlength="60" value="${d.name}" autocomplete="off"></div><span class="hint">Usado automaticamente no flyer e nas divulgações.</span><span class="field-error"></span></div>
        <div class="field" data-f="finalDate"><label for="p-date">Data da grande final</label><input id="p-date" type="date" name="finalDate" value="${d.finalDate}"><span class="field-error"></span></div>
        <div class="savebar">
          <button class="btn btn-primary" type="submit" data-save ${dirty() ? '' : 'disabled'}>${ic('save', { size: 18 })} Salvar alterações</button>
          <button class="btn btn-ghost" type="button" data-act="discard" ${dirty() ? '' : 'hidden'}>Descartar</button>
          <span class="dirty" data-dirty ${dirty() ? '' : 'hidden'}>${ic('circle-alert', { size: 15 })} Alterações não salvas</span>
          <span class="saved" data-saved ${savedFlash && !dirty() ? '' : 'hidden'}>${ic('circle-check', { size: 15 })} Tudo salvo</span>
        </div>
      </form>
    </section>

    <div class="linkbar"><div class="grow"><span class="lbl">Link para os visitantes (inscrição, jogos e chaveamento)</span><a class="url" href="/t/${t.id}" target="_blank" rel="noopener" data-external>${app.visitorUrl()}</a></div>
      <button class="btn btn-sm" data-act="copy-link">${ic('copy', { size: 16 })} Copiar link</button><a class="btn btn-sm" href="/t/${t.id}" target="_blank" rel="noopener" data-external>${ic('external-link', { size: 16 })} Abrir página do visitante</a></div>

    <h3 class="section-title">Modalidade do torneio</h3>
    <div>
      <div class="tiles c4" role="radiogroup" aria-label="Modalidade">${Object.values(SPORTS).map(sp => html`<div class="tile"><input type="radio" name="sport" id="sp-${sp.key}" value="${sp.key}" ${d.sport === sp.key ? 'checked' : ''} ${locked ? 'disabled' : ''}><label for="sp-${sp.key}"><span class="t-ico">${ic(sp.icon, { size: 24 })}</span><span><span class="t-title">${sp.label}</span><span class="t-sub">${sp.sub}</span></span></label></div>`)}</div>
      ${locked ? html`<p class="hint" style="margin-top:8px">${ic('lock', { size: 13 })} Modalidade travada: ${locked}</p>` : ''}
    </div>

    <div class="kpis" aria-label="Indicadores do torneio">
      <div class="kpi"><div class="kpi-top">${ic('users')}Times confirmados</div><div class="kpi-v">${s.teamsConfirmed}</div><div class="kpi-s">${t.maxTeams - s.teamsConfirmed > 0 ? `${t.maxTeams - s.teamsConfirmed} vagas restantes de ${t.maxTeams}` : 'vagas da chave principal'}</div></div>
      <div class="kpi"><div class="kpi-top">${ic('clipboard-check')}Partidas concluídas</div><div class="kpi-v">${s.matchesDone}/${s.matchesTotal || (t.maxTeams - 1)}</div><div class="kpi-s">${doneRounds(t)}</div></div>
      <div class="kpi"><div class="kpi-top">${ic('user-check')}Atletas validados</div><div class="kpi-v">${fmtNum(s.athletes)}</div><div class="kpi-s">${t.type === 'oficial' ? 'CPF, RG e documento conferidos' : 'elencos completos inscritos'}</div></div>
      <div class="kpi"><div class="kpi-top">${ic('flag')}Fraudes barradas</div><div class="kpi-v">${fmtNum(s.blocked)}</div><div class="kpi-s">atletas duplicados entre times</div></div>
      <div class="kpi"><div class="kpi-top">${ic('heart')}Repescagem solidária</div><div class="kpi-v">${fmtBRL(t.donations.total)}</div><div class="kpi-s">${t.donations.count ? `${t.donations.count} re-inscrição(ões)` : 'nenhuma doação ainda'}</div></div>
    </div>

    <div class="charts">
      <div class="card chart-card"><h3>${ic('bar-chart')} Inscrições acumuladas (7 dias)</h3>${lineChart(regData, { label: 'Inscrições acumuladas nos últimos 7 dias' })}</div>
      <div class="card chart-card"><h3>${ic('line-chart')} Média projetada por fase</h3>${barChart(t.perf, { label: 'Média projetada de ' + (t.sport === 'volei' ? 'pontos' : t.sport === 'basquete' ? 'pontos' : 'gols') + ' por fase' })}<p class="hint" style="margin-top:4px">${t.sport === 'volei' ? 'Pontos por set' : t.sport === 'basquete' ? 'Pontos por equipe' : 'Gols por jogo'} · barras claras são projeções; as escuras, resultados reais.</p></div>
    </div>

    <div class="two">
      <div class="card"><h3 class="card-title">${ic('list-checks')} Próximos passos</h3>
        <ul class="feed" style="max-height:none">${nextSteps(t).map(st => html`<li><span class="f-ico ${st.done ? 'green' : ''}">${ic(st.done ? 'check' : 'clock', { size: 16 })}</span><div class="grow"><div style="${st.done ? 'text-decoration:line-through;color:var(--muted)' : 'font-weight:600'}">${st.label}</div></div>${!st.done && st.cta ? (st.copy ? html`<button class="btn btn-sm" data-act="copy-link">${st.cta}</button>` : html`<a class="btn btn-sm" href="/admin/${t.id}/${st.go}">${st.cta}</a>`) : ''}</li>`)}</ul></div>
      <div class="card"><h3 class="card-title">${ic('activity')} Atividade recente</h3>
        ${t.activity.length ? html`<ul class="feed">${t.activity.slice(0, 8).map(a => html`<li><span class="f-ico ${a.type === 'refund' ? 'red' : a.type === 'donation' ? 'gold' : a.type === 'champion' ? 'green' : ''}">${ic({ team: 'users', reserve: 'clock', refund: 'banknote', donation: 'heart', draw: 'network', match: 'flag', champion: 'trophy', admin: 'user-plus', reset: 'rotate-ccw' }[a.type] || 'info', { size: 16 })}</span><div><div>${a.text}</div><time>${relTime(a.at, app.now)}</time></div></li>`)}</ul>` : html`<div class="empty">${ic('activity')}<span>As inscrições, pagamentos e resultados aparecem aqui.</span></div>`}</div>
    </div>`;
  }

  function paint(root) { render(root, view()); }

  return {
    mount(root) {
      paint(root);
      const form = () => $('[data-form]', root);
      const refreshSave = () => {
        const d = dirty(), f = form();
        $('[data-save]', f).disabled = !d; $('[data-act=discard]', f).hidden = !d; $('[data-dirty]', f).hidden = !d;
        if (d) { savedFlash = false; $('[data-saved]', f).hidden = true; }
      };
      root.addEventListener('input', e => {
        if (e.target.name === 'name') draft.name = e.target.value;
        if (e.target.name === 'finalDate') draft.finalDate = e.target.value;
        refreshSave();
      });
      root.addEventListener('change', e => { if (e.target.name === 'sport') { draft.sport = e.target.value; refreshSave(); } });
      on(root, 'click', '[data-act]', async (e, el) => {
        const act = el.dataset.act;
        if (act === 'copy-id') toast((await copyText('#' + app.t.id)) ? 'ID do torneio copiado.' : 'Copie manualmente: #' + app.t.id, { type: 'success', ms: 2200 });
        if (act === 'copy-link') toast((await copyText(app.visitorUrl())) ? 'Link do visitante copiado!' : 'Copie manualmente: ' + app.visitorUrl(), { type: 'success', ms: 2500 });
        if (act === 'discard') { resetDraft(); paint(root); }
      });
      root.addEventListener('submit', async e => {
        e.preventDefault();
        const f = form(); const name = draft.name.trim();
        setFieldError($('[data-f=name]', f), ''); setFieldError($('[data-f=finalDate]', f), '');
        if (name.length < 3) { setFieldError($('[data-f=name]', f), 'Informe o nome do torneio (mínimo 3 letras).'); $('[name=name]', f).focus(); return; }
        if (!draft.finalDate) { setFieldError($('[data-f=finalDate]', f), 'Escolha a data da final.'); return; }
        const body = {};
        if (name !== app.t.name) body.name = name;
        if (draft.finalDate !== app.t.finalDate) body.finalDate = draft.finalDate;
        if (draft.sport !== app.t.sport) body.sport = draft.sport;
        const btn = $('[data-save]', f); setBusy(btn, true);
        try {
          const r = await api.patch(`/tournaments/${app.t.id}`, body);
          resetDraft(); savedFlash = true;
          app.set(r.tournament);
          toast('Alterações salvas.', { type: 'success', ms: 2500 });
        } catch (err) {
          setBusy(btn, false);
          toast(err.message, { type: 'error', ms: 6000 });
          if (err.details?.field === 'sport') { draft.sport = app.t.sport; paint(root); }
        }
      });
    },
    dirty,
    discard: () => resetDraft(),
    update(t, { fromPoll } = {}) {
      const root = app.main; if (!root) return;
      if (dirty() && fromPoll) { /* mantém edição em andamento */ return; }
      if (!dirty()) resetDraft();
      if (root.contains(document.activeElement) && document.activeElement.matches('input') && fromPoll) return;
      paint(root);
    },
  };
}
