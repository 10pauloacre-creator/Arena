// Campeonato de pontos corridos (organizador): gerar a tabela de jogos, lançar resultados e acompanhar a classificação.
import { html, render, ic, $, on } from '../../ui/dom.js';
import { confirmDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { api } from '../../api.js';
import { leagueTableHTML, leagueRoundsHTML } from '../../ui/league.js';

export default function (app) {
  const rerender = () => { const root = app.main; if (root) render(root, view()); };

  function drawCard(t) {
    const n = t.teamsConfirmed, started = t.league && t.stats.matchesDone > 0;
    return html`<div class="card"><h3 class="card-title">${ic('trophy')} Campeonato de pontos corridos</h3>
      <ul class="stack-sm small" style="margin-bottom:16px">
        <li class="row" style="align-items:flex-start">${ic('swords', { size: 18 })}<span>Todos os times se enfrentam em rodadas, como um campeonato nacional. Vitória vale <b>3 pontos</b>, empate <b>1</b>.</span></li>
        <li class="row" style="align-items:flex-start">${ic('sliders', { size: 18 })}<span>Máximo de partidas por time: <b>${t.leagueMax || 'todos contra todos uma vez'}</b>${t.league ? ` (${t.league.rounds.length} rodadas geradas)` : ''}. Altere em Configurações antes de gerar a tabela.</span></li>
        <li class="row" style="align-items:flex-start">${ic('crown', { size: 18 })}<span>No fim das rodadas, o time com <b>mais pontos</b> é o campeão.</span></li></ul>
      <div class="row wrap">
        <button class="btn btn-primary btn-lg" data-act="draw" ${n >= 3 && !started ? '' : 'disabled'}>${ic('wand-sparkles', { size: 18 })} ${t.league ? 'Refazer a tabela' : 'Gerar tabela de jogos'}</button>
        ${t.demo && t.league && !t.champion ? html`<button class="btn" data-act="simulate">${ic('zap', { size: 16 })} Simular próxima rodada</button>` : ''}
        ${t.league ? html`<button class="btn btn-outline-danger" data-act="reset">${ic('rotate-ccw', { size: 16 })} Reiniciar campeonato</button>` : ''}
      </div>
      ${n < 3 ? html`<p class="hint" style="margin-top:10px">${ic('info', { size: 14 })} Confirme ao menos 3 times para gerar a tabela (hoje: ${n}).</p>` : ''}
      ${started ? html`<p class="hint" style="margin-top:10px">${ic('lock', { size: 14 })} O campeonato já começou: a tabela não pode ser refeita (apenas reiniciada).</p>` : ''}
      ${t.registration.open && !t.league && n >= 3 ? html`<div class="form-note warn" style="margin-top:12px">${ic('triangle-alert')}<span>As inscrições ainda estão abertas. Ao gerar a tabela, elas serão encerradas e reservas pendentes de pagamento serão canceladas.</span></div>` : ''}
    </div>`;
  }

  function view() {
    const t = app.t;
    return html`<div class="page-head"><div><h2>Campeonato</h2><p>${t.league ? `${t.league.rounds.length} rodadas · ${t.stats.matchesDone}/${t.stats.matchesTotal} jogos disputados` : 'Gere a tabela de jogos quando as inscrições terminarem.'}</p></div></div>
      ${drawCard(t)}
      ${t.league ? html`${t.champion ? html`<div class="champion-banner">${ic('trophy')}<div><span class="label">CAMPEÃO</span><div style="font-size:24px;font-weight:800;line-height:1.2">${t.league.table[0].name}</div><span class="small">${t.league.table[0].pts} pontos</span></div></div>` : ''}
        ${leagueTableHTML(t)}${leagueRoundsHTML(t, { editable: true })}`
        : html`<div class="empty" style="padding:48px 16px">${ic('trophy', { size: 34 })}<strong style="font-size:18px">A tabela aparece aqui</strong><span>Depois de gerar a tabela, você lança os resultados rodada a rodada e a classificação se atualiza sozinha.</span></div>`}`;
  }

  return {
    mount(root) {
      render(root, view());
      on(root, 'click', '[data-act]', async (e, el) => {
        const act = el.dataset.act, t = app.t;
        if (act === 'draw') {
          if (t.league && !await confirmDialog({ title: 'Refazer a tabela?', text: 'A tabela atual será substituída por uma nova, com os confrontos sorteados de novo. Nenhum resultado foi lançado ainda.', ok: 'Refazer' })) return;
          await app.act(() => api.post(`/tournaments/${t.id}/draw`), { ok: 'Tabela de jogos gerada.' }).catch(() => {});
        }
        if (act === 'simulate') await app.act(() => api.post(`/tournaments/${t.id}/demo/simulate`), { ok: 'Rodada simulada.' }).catch(() => {});
        if (act === 'reset' && await confirmDialog({ title: 'Reiniciar o campeonato?', text: 'Todas as rodadas e resultados serão apagados e as inscrições continuarão encerradas.', ok: 'Reiniciar', danger: true })) {
          await app.act(() => api.post(`/tournaments/${t.id}/reset-bracket`, { confirm: true }), { ok: 'Campeonato reiniciado.' }).catch(() => {});
        }
      });
      root.addEventListener('submit', async e => {
        const f = e.target.closest('[data-lg]');
        if (!f) return;
        e.preventDefault();
        if (f.sa.value === '' || f.sb.value === '') { toast('Informe os gols dos dois times.', { type: 'warn' }); return; }
        await app.act(() => api.post(`/tournaments/${app.t.id}/league/${f.dataset.lg}`, { sa: Number(f.sa.value), sb: Number(f.sb.value) }), { ok: 'Resultado salvo.' }).catch(() => {});
      });
      root.addEventListener('click', async e => {
        const b = e.target.closest('[data-lg-clear]');
        if (b) await app.act(() => api.post(`/tournaments/${app.t.id}/league/${b.dataset.lgClear}`, { clear: true }), { ok: 'Resultado removido.' }).catch(() => {});
      });
    },
    update() {
      const root = app.main; if (!root) return;
      if (document.querySelector('dialog[open]') || root.contains(document.activeElement) && document.activeElement?.matches('input')) return; // não atrapalha quem está digitando
      rerender();
    },
    destroy() {},
  };
}
