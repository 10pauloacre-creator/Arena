// Calendário mensal de seleção múltipla (dias de jogo) + atalho "repetir toda semana".
import { html, ic, $, raw } from '../../ui/dom.js';
import { isoDay } from '../../shared/dates.js';
import { parseDay } from '../../shared/format.js';

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WEEK_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const fmtLong = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** `selected`: Set de "YYYY-MM-DD" (modificado aqui). `locked`: datas que não podem ser desmarcadas (já têm dados). */
export function mountCalendar(root, { selected, locked = new Set(), onChange }) {
  const first = [...selected].sort()[0];
  const start = (first && parseDay(first)) || new Date();
  const view = { y: start.getFullYear(), m: start.getMonth() };
  const todayIso = isoDay(new Date());

  function paint() {
    const first = new Date(view.y, view.m, 1), days = new Date(view.y, view.m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(html`<span class="cal-pad"></span>`);
    for (let d = 1; d <= days; d++) {
      const iso = isoDay(new Date(view.y, view.m, d));
      const on = selected.has(iso), lock = locked.has(iso);
      cells.push(html`<button type="button" class="cal-day${on ? ' on' : ''}${iso === todayIso ? ' today' : ''}" data-iso="${iso}" aria-pressed="${String(on)}" ${lock && on ? raw('aria-disabled="true"') : ''} aria-label="${fmtLong.format(new Date(view.y, view.m, d))}${on ? ', jogo marcado' : ''}">${d}</button>`);
    }
    root.innerHTML = html`<div class="cal">
      <div class="cal-head"><button type="button" class="icon-btn" data-nav="-1" aria-label="Mês anterior">${ic('chevron-left')}</button><strong aria-live="polite">${MONTHS[view.m]} ${view.y}</strong><button type="button" class="icon-btn" data-nav="1" aria-label="Próximo mês">${ic('chevron-right')}</button></div>
      <div class="cal-grid" role="group" aria-label="Dias do mês">${WEEK.map(w => html`<span class="cal-wk" aria-hidden="true">${w}</span>`)}${cells}</div>
      <div class="cal-weekly"><span class="label">Repetir toda semana</span>
        <div class="row wrap" style="gap:8px"><select aria-label="Dia da semana" data-wd>${WEEK_LONG.map((w, i) => html`<option value="${i}" ${i === 6 ? 'selected' : ''}>${w}</option>`)}</select>
          <select aria-label="Quantidade de semanas" data-weeks>${[2, 4, 8, 12, 26].map(n => html`<option value="${n}" ${n === 4 ? 'selected' : ''}>por ${n} semanas</option>`)}</select>
          <button type="button" class="btn btn-sm" data-weekly>${ic('plus', { size: 15 })} Adicionar</button></div></div>
    </div>`.s;
  }
  root.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { const d = new Date(view.y, view.m + Number(nav.dataset.nav), 1); view.y = d.getFullYear(); view.m = d.getMonth(); paint(); return; }
    const day = e.target.closest('[data-iso]');
    if (day) {
      const iso = day.dataset.iso;
      if (selected.has(iso)) { if (locked.has(iso)) return; selected.delete(iso); } else selected.add(iso);
      paint(); onChange?.(); return;
    }
    if (e.target.closest('[data-weekly]')) {
      const wd = Number($('[data-wd]', root).value), weeks = Number($('[data-weeks]', root).value);
      const d = new Date(); d.setHours(12, 0, 0, 0);
      while (d.getDay() !== wd) d.setDate(d.getDate() + 1);
      for (let i = 0; i < weeks; i++) { selected.add(isoDay(d)); d.setDate(d.getDate() + 7); }
      paint(); onChange?.();
    }
  });
  paint();
  return { repaint: paint };
}
