// Painel de criação (e edição) da pelada: identidade, regras, calendário de datas e organização por data.
import { html, render, ic, $, $$, setBusy } from '../../ui/dom.js';
import { confirmDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { setFieldError, clearErrors } from '../../ui/forms.js';
import { api } from '../../api.js';
import { S } from '../session.js';
import { navigate } from '../../router.js';
import { page, wireShell, dayLong } from '../ui/shell.js';
import { mountCalendar } from '../ui/calendar.js';
import { pickAndCrop } from '../ui/cropper.js';
import { peladaImg } from '../ui/img.js';
import { fetchPelada } from '../data.js';
import { GENDERS, DEFAULT_MATCH_MIN } from '../../shared/pelada.js';

const NO_TEAMS_TEXT = 'Esta opção desativa o sorteio automático de equipes. O sistema gerará apenas a lista de presença e permitirá a anotação individual de gols para o ranking de artilharia';
const MAX_NEW_MATCHES = 20;

const stepper = (name, value, { min, max, label, id }) => html`<div class="stepper" role="group" aria-label="${label}"><button type="button" class="icon-btn" data-step="${name}" data-d="-1" aria-label="Diminuir">${ic('minus')}</button><input id="${id}" type="number" name="${name}" inputmode="numeric" min="${min}" max="${max}" value="${value}" aria-label="${label}"><button type="button" class="icon-btn" data-step="${name}" data-d="1" aria-label="Aumentar">${ic('plus')}</button></div>`;

const demoCard = () => html`<section class="card demo-card form-wide" aria-label="Pelada demo">
  <span class="demo-ico" aria-hidden="true">${ic('sparkles', { size: 26 })}</span>
  <div class="demo-txt"><h2 class="card-title" style="margin:0 0 4px">Quer ver como funciona antes de criar a sua?</h2>
    <p class="muted small" style="margin:0">Crie uma <b>pelada demo</b>: o jogo de hoje com <b>17 jogadores já confirmados</b>, cada um com nome e foto de perfil. É só sortear os times, montar as partidas e anotar os gols.</p></div>
  <button type="button" class="btn btn-gold" data-demo>${ic('users', { size: 18 })} Criar pelada demo</button></section>`;

export default async function (ctx) {
  const editId = ctx.params.id || null;
  if (!S.player) return navigate('/pelada/entrar?next=' + encodeURIComponent(ctx.path), { replace: true });

  const st = { name: '', gender: '', minPerTeam: 5, matchMinutes: DEFAULT_MATCH_MIN, noTeams: false, avatar: undefined, cover: undefined, avatarUrl: '', coverUrl: '', days: [] };
  const selected = new Set();
  let original = null;

  if (editId) {
    render(ctx.root, page(html`<div class="page-loading"><div class="spinner" role="status" aria-label="Carregando"></div></div>`));
    try {
      const r = await fetchPelada(editId, { signal: ctx.signal });
      if (!ctx.isCurrent()) return;
      original = r.pelada;
    } catch (err) { return render(ctx.root, page(html`<div class="form-error" style="margin-top:24px">${err.message}</div>`)); }
    if (!original.viewer?.isOwner) { toast('Só quem criou a pelada pode editar.', { type: 'warn' }); return navigate('/pelada/p/' + editId, { replace: true }); }
    Object.assign(st, { name: original.name, gender: original.gender, minPerTeam: original.minPerTeam, matchMinutes: original.matchMinutes, noTeams: original.noTeams });
    st.avatarUrl = peladaImg(original.id, 'avatar', original.img.avatar);
    st.coverUrl = peladaImg(original.id, 'cover', original.img.cover);
    st.days = original.days.map(d => ({ key: d.id, id: d.id, date: d.date, custom: d.custom, org: { ...d.org }, matches: d.matches.length, locked: !!(d.attendance.length || d.matches.length || d.draw) }));
    st.days.forEach(d => selected.add(d.date));
  }
  const locked = () => new Set(st.days.filter(d => d.locked).map(d => d.date));

  document.title = (editId ? 'Editar pelada' : 'Criar pelada') + ' · Pelada';
  const effective = d => d.custom ? d.org : { minPerTeam: st.minPerTeam, matchMinutes: st.matchMinutes, noTeams: st.noTeams };

  function syncDays() {
    const keep = new Map(st.days.map(d => [d.date, d]));
    st.days = [...selected].sort().map(date => keep.get(date) || { key: 'n' + date, id: null, date, custom: false, org: { minPerTeam: st.minPerTeam, matchMinutes: st.matchMinutes, noTeams: st.noTeams }, matches: 0, locked: false });
  }

  const imgPicker = (kind, url, label, hint) => html`<div class="img-pick ${kind}"><div class="img-prev" data-prev="${kind}">${url ? html`<img src="${url}" alt="">` : html`<span>${ic('image', { size: 28 })}</span>`}</div>
    <div><strong>${label}</strong><span class="muted small" style="display:block">${hint}</span><div class="row wrap" style="gap:8px;margin-top:8px"><button type="button" class="btn btn-sm" data-pick="${kind}">${ic('camera', { size: 15 })} ${url ? 'Trocar' : 'Escolher'} imagem</button>${url ? html`<button type="button" class="btn btn-sm btn-ghost" data-clear="${kind}">Remover</button>` : ''}</div></div></div>`;

  function dayCard(d) {
    const eff = effective(d);
    const matchesBlock = eff.noTeams
      ? html`<p class="muted small" style="margin:0">${ic('info', { size: 14 })} Sem formação de times: esta data terá lista de presença e gols individuais.</p>`
      : editId && d.id
        ? html`<p class="muted small" style="margin:0">${ic('info', { size: 14 })} Adicione ou exclua partidas na <a href="/pelada/p/${editId}/d/${d.id}">página desta data</a>.</p>`
        : html`<div class="match-mgr"><div class="row between wrap"><strong class="small">Partidas desta data</strong><button type="button" class="btn btn-sm" data-add-match="${d.date}" ${d.matches >= MAX_NEW_MATCHES ? 'disabled' : ''}>${ic('plus', { size: 15 })} Adicionar partida</button></div>
          ${d.matches ? html`<ul class="mm-list">${Array.from({ length: d.matches }, (_, i) => html`<li><span>Partida ${i + 1} <span class="muted small">(times definidos depois do sorteio)</span></span><button type="button" class="btn btn-sm btn-outline-danger" data-del-match="${d.date}" aria-label="Excluir partida ${i + 1}">${ic('trash', { size: 14 })} Excluir partida</button></li>`)}</ul>` : html`<p class="muted small" style="margin:6px 0 0">Nenhuma partida criada. Você pode criar todas durante o jogo.</p>`}</div>`;
    return html`<div class="day-card" data-day="${d.date}">
      <div class="day-head"><strong>${ic('calendar', { size: 16 })} ${dayLong(d.date)}</strong><span class="muted small">${d.date.split('-').reverse().join('/')}</span><span class="spacer"></span>
        ${d.locked ? html`<span class="badge" title="Esta data já tem presenças ou partidas">com dados</span>` : html`<button type="button" class="icon-btn" data-rm-day="${d.date}" aria-label="Remover data">${ic('x')}</button>`}</div>
      <div class="seg" role="group" aria-label="Organização desta data"><button type="button" data-org="inherit" data-date="${d.date}" aria-pressed="${String(!d.custom)}">Igual ao padrão</button><button type="button" data-org="custom" data-date="${d.date}" aria-pressed="${String(d.custom)}">Personalizada</button></div>
      ${d.custom
        ? html`<div class="day-org cols-3"><div class="field"><label>Mínimo por time</label>${stepper('d-min:' + d.date, d.org.minPerTeam, { min: 2, max: 15, label: 'Mínimo de jogadores por time nesta data', id: 'dm-' + d.date })}</div>
            <div class="field"><label>Minutos por partida</label>${stepper('d-mins:' + d.date, d.org.matchMinutes, { min: 1, max: 90, label: 'Duração da partida nesta data', id: 'dt-' + d.date })}</div>
            <label class="switch field" style="align-self:end;min-height:44px"><input type="checkbox" data-d-noteams="${d.date}" ${d.org.noTeams ? 'checked' : ''}><span class="track"></span><span>Sem formação de times</span></label></div>
            ${d.org.noTeams ? html`<div class="form-note">${ic('info', { size: 16 })}<span>${NO_TEAMS_TEXT}.</span></div>` : ''}`
        : html`<p class="muted small" style="margin:0">Segue o padrão: <b>${st.minPerTeam}</b> por time · <b>${st.matchMinutes}</b> min por partida${st.noTeams ? ' · sem formação de times' : ''}.</p>`}
      ${matchesBlock}
    </div>`;
  }

  function view() {
    return page(html`
      <div class="row between wrap"><div><h1 style="font-size:28px">${editId ? 'Editar pelada' : 'Criar pelada'}</h1><p class="muted">${editId ? 'Ajuste as regras, a imagem e as datas.' : 'Defina a identidade, as regras e os dias de jogo. Leva menos de um minuto.'}</p></div>
        <a class="btn btn-ghost" href="${editId ? '/pelada/p/' + editId : '/pelada/painel'}">${ic('arrow-left', { size: 18 })} Voltar</a></div>
      ${editId ? '' : demoCard()}
      <form id="pf" class="stack form-wide" novalidate>
        <section class="card stack"><h2 class="card-title">${ic('shirt')} Identidade</h2>
          <div class="field" data-f="name"><label for="pf-name">Nome da pelada <span class="req">*</span></label><input id="pf-name" name="name" maxlength="50" autocomplete="off" placeholder="Ex.: Pelada das Quintas" value="${st.name}"><span class="field-error"></span></div>
          <fieldset class="gender-fs" data-f="gender"><legend class="label">Categoria <span class="req">*</span></legend>
            <div class="tiles c2">${Object.entries(GENDERS).map(([k, g]) => html`<div class="tile sm"><input type="radio" name="gender" id="pf-g-${k}" value="${k}" ${st.gender === k ? 'checked' : ''}><label for="pf-g-${k}"><span class="t-ico" aria-hidden="true">${g.emoji}</span><span><span class="t-title">${g.label}</span><span class="t-sub">${g.players}</span></span></label></div>`)}</div><span class="field-error" style="display:block"></span></fieldset>
          <div class="img-row">${imgPicker('avatar', st.avatarUrl, 'Foto de perfil da pelada', 'Quadrada, aparece na lista e no compartilhamento.')}${imgPicker('cover', st.coverUrl, 'Imagem de capa', 'Faixa larga no topo da página da pelada.')}</div></section>
        <section class="card stack"><h2 class="card-title">${ic('sliders')} Regras</h2>
          <div class="cols-2"><div class="field" data-f="min"><label for="pf-min">Quantidade mínima de jogadores por time</label>${stepper('minPerTeam', st.minPerTeam, { min: 2, max: 15, label: 'Mínimo de jogadores por time', id: 'pf-min' })}<span class="hint">Ex.: 5 para futsal, 7 para society, 11 para campo.</span><span class="field-error"></span></div>
            <div class="field"><label for="pf-mins">Minutos por partida</label>${stepper('matchMinutes', st.matchMinutes, { min: 1, max: 90, label: 'Duração padrão da partida em minutos', id: 'pf-mins' })}<span class="hint">Valor inicial do cronômetro (você pode mudar em cada partida).</span></div></div>
          <label class="switch"><input type="checkbox" name="noTeams" ${st.noTeams ? 'checked' : ''}><span class="track"></span><span><b>Sem formação de times</b></span></label>
          ${st.noTeams ? html`<div class="form-note" id="nt-note">${ic('info', { size: 16 })}<span>${NO_TEAMS_TEXT}.</span></div>` : ''}</section>
        <section class="card stack"><h2 class="card-title">${ic('calendar')} Dias de jogos</h2>
          <p class="muted small" style="margin:-6px 0 0">Toque nos dias do calendário para marcar os jogos. Cada data pode seguir a organização padrão ou ter uma própria.</p>
          <div class="field" data-f="days"><div data-cal></div><span class="field-error"></span></div>
          <div data-days class="day-list">${st.days.length ? st.days.map(dayCard) : html`<div class="empty">${ic('calendar')}<strong>Nenhuma data escolhida</strong><span>Marque ao menos um dia no calendário.</span></div>`}</div></section>
        <div class="form-error" hidden role="alert"></div>
        <div class="row wrap" style="justify-content:flex-end"><a class="btn" href="${editId ? '/pelada/p/' + editId : '/pelada/painel'}">Cancelar</a><button class="btn btn-gold btn-lg" type="submit" id="pf-go">${ic(editId ? 'save' : 'trophy', { size: 20 })} ${editId ? 'Salvar alterações' : 'Criar pelada'}</button></div>
      </form>`);
  }

  let cal = null;
  function paint(keepScroll = true) {
    const y = window.scrollY;
    // guarda o que foi digitado antes de redesenhar
    const f = $('#pf', ctx.root);
    if (f) { st.name = f.name.value; st.gender = f.gender.value || st.gender; }
    render(ctx.root, view());
    wireShell(ctx.root, ctx.signal);
    cal = mountCalendar($('[data-cal]', ctx.root), { selected, locked: locked(), onChange: () => { syncDays(); paintDays(); } });
    if (keepScroll) window.scrollTo({ top: y });
  }
  function paintDays() {
    const box = $('[data-days]', ctx.root);
    box.innerHTML = html`${st.days.length ? st.days.map(dayCard) : html`<div class="empty">${ic('calendar')}<strong>Nenhuma data escolhida</strong><span>Marque ao menos um dia no calendário.</span></div>`}`.s;
    $('[data-f=days]', ctx.root)?.classList.remove('has-error');
  }
  const day = date => st.days.find(d => d.date === date);

  ctx.root.addEventListener('click', async e => {
    const demo = e.target.closest('[data-demo]');
    if (demo) {
      setBusy(demo, true);
      try {
        const r = await api.post('/pelada/peladas/demo');
        toast('Pelada demo criada! 17 jogadores já confirmaram presença: é só sortear os times.', { type: 'success' });
        navigate(`/pelada/p/${r.pelada.id}/d/${r.dayId}`);
      } catch (err) { setBusy(demo, false); toast(err.message, { type: 'error' }); }
      return;
    }
    const step = e.target.closest('[data-step]');
    if (step) {
      const inp = $(`[name="${step.dataset.step}"]`, ctx.root);
      const next = Math.min(Number(inp.max), Math.max(Number(inp.min), Number(inp.value || inp.min) + Number(step.dataset.d)));
      inp.value = String(next); inp.dispatchEvent(new Event('input', { bubbles: true })); return;
    }
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const kind = pick.dataset.pick;
      try {
        const url = await pickAndCrop(kind === 'avatar' ? { aspect: 1, outW: 256, title: 'Foto de perfil da pelada', maxBytes: 80_000 } : { aspect: 16 / 7, outW: 960, title: 'Imagem de capa', maxBytes: 240_000 });
        if (url) { st[kind] = url; st[kind + 'Url'] = url; paint(); }
      } catch (err) { toast(err.message, { type: 'error' }); }
      return;
    }
    const clear = e.target.closest('[data-clear]');
    if (clear) { st[clear.dataset.clear] = null; st[clear.dataset.clear + 'Url'] = ''; paint(); return; }
    const rm = e.target.closest('[data-rm-day]');
    if (rm) { selected.delete(rm.dataset.rmDay); syncDays(); cal.repaint(); paintDays(); return; }
    const org = e.target.closest('[data-org]');
    if (org) {
      const d = day(org.dataset.date);
      d.custom = org.dataset.org === 'custom';
      if (d.custom && !d.org) d.org = { minPerTeam: st.minPerTeam, matchMinutes: st.matchMinutes, noTeams: st.noTeams };
      paintDays(); return;
    }
    const add = e.target.closest('[data-add-match]');
    if (add) { const d = day(add.dataset.addMatch); d.matches = Math.min(MAX_NEW_MATCHES, d.matches + 1); paintDays(); return; }
    const del = e.target.closest('[data-del-match]');
    if (del) { const d = day(del.dataset.delMatch); d.matches = Math.max(0, d.matches - 1); paintDays(); }
  });

  ctx.root.addEventListener('input', e => {
    const t = e.target;
    if (t.name === 'minPerTeam' || t.name === 'matchMinutes') { st[t.name] = Number(t.value) || 0; if (!t.closest('.day-org')) $$('.day-card', ctx.root).forEach(c => { const d = day(c.dataset.day); if (d && !d.custom) { const p = c.querySelector('p.muted'); if (p) p.innerHTML = `Segue o padrão: <b>${st.minPerTeam}</b> por time · <b>${st.matchMinutes}</b> min por partida${st.noTeams ? ' · sem formação de times' : ''}.`; } }); return; }
    const m = /^d-(min|mins):(.+)$/.exec(t.name || '');
    if (m) { const d = day(m[2]); d.org[m[1] === 'min' ? 'minPerTeam' : 'matchMinutes'] = Number(t.value) || 0; }
  });
  ctx.root.addEventListener('change', e => {
    const t = e.target;
    if (t.name === 'noTeams') { st.noTeams = t.checked; st.days.forEach(d => { if (!d.custom) d.org.noTeams = st.noTeams; }); paint(); return; }
    if (t.dataset.dNoteams) { const d = day(t.dataset.dNoteams); d.org.noTeams = t.checked; paintDays(); }
    if (t.name === 'gender') st.gender = t.value;
  });

  const bad = (sel, msg) => { setFieldError($(sel, ctx.root), msg); };
  ctx.root.addEventListener('submit', async e => {
    if (e.target.id !== 'pf') return;
    e.preventDefault();
    const form = e.target;
    clearErrors(form);
    const box = $('.form-error', form); box.hidden = true;
    st.name = form.name.value.trim(); st.gender = form.gender.value;
    let invalid = false;
    if (st.name.length < 3) { bad('[data-f=name]', 'Informe o nome da pelada (mínimo 3 letras).'); invalid = true; }
    if (!st.gender) { $('[data-f=gender] .field-error', form).textContent = 'Escolha se a pelada é feminina ou masculina.'; $('[data-f=gender] .field-error', form).style.color = 'var(--red)'; invalid = true; }
    if (!(st.minPerTeam >= 2 && st.minPerTeam <= 15)) { bad('[data-f=min]', 'Informe um número de 2 a 15.'); invalid = true; }
    if (!editId && !st.days.length) { bad('[data-f=days]', 'Escolha ao menos uma data de jogo.'); invalid = true; }
    if (invalid) { form.querySelector('.has-error input, .has-error select')?.focus(); $('.has-error', form)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }

    const orgOf = d => d.custom ? { minPerTeam: d.org.minPerTeam, matchMinutes: d.org.matchMinutes, noTeams: !!d.org.noTeams } : null;
    const btn = $('#pf-go', form); setBusy(btn, true);
    try {
      if (!editId) {
        const body = { name: st.name, gender: st.gender, minPerTeam: st.minPerTeam, matchMinutes: st.matchMinutes, noTeams: st.noTeams, days: st.days.map(d => ({ date: d.date, org: orgOf(d), matches: d.matches })) };
        if (st.avatar) body.avatar = st.avatar;
        if (st.cover) body.cover = st.cover;
        const r = await api.post('/pelada/peladas', body);
        toast('Pelada criada! Compartilhe o link de convite com a galera.', { type: 'success' });
        navigate(`/pelada/p/${r.pelada.id}?novo=1`);
        return;
      }
      const patch = { name: st.name, gender: st.gender, minPerTeam: st.minPerTeam, matchMinutes: st.matchMinutes, noTeams: st.noTeams };
      if (st.avatar !== undefined) patch.avatar = st.avatar;
      if (st.cover !== undefined) patch.cover = st.cover;
      await api.patch(`/pelada/peladas/${editId}`, patch);
      const keep = new Set(st.days.map(d => d.date));
      const removed = original.days.filter(d => !keep.has(d.date));
      if (removed.length && !(await confirmDialog({ title: 'Remover datas?', text: `${removed.length === 1 ? 'Uma data será removida' : removed.length + ' datas serão removidas'} da pelada.`, ok: 'Remover', danger: true }))) { setBusy(btn, false); return; }
      for (const d of removed) await api.del(`/pelada/peladas/${editId}/days/${d.id}`);
      for (const d of st.days) {
        if (!d.id) await api.post(`/pelada/peladas/${editId}/days`, { date: d.date, org: orgOf(d), matches: d.matches });
        else {
          const prev = original.days.find(x => x.id === d.id);
          const same = prev.custom === d.custom && (!d.custom || (prev.org.minPerTeam === d.org.minPerTeam && prev.org.matchMinutes === d.org.matchMinutes && prev.org.noTeams === d.org.noTeams));
          if (!same) await api.patch(`/pelada/peladas/${editId}/days/${d.id}`, { org: orgOf(d) });
        }
      }
      toast('Alterações salvas.', { type: 'success' });
      navigate('/pelada/p/' + editId);
    } catch (err) {
      setBusy(btn, false);
      box.hidden = false; box.textContent = err.message;
      box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });

  paint(false);
}
