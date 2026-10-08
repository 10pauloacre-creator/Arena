// Criação de torneio: básico, inscrição (gratuita ou paga), regras, detalhes e premiação.
import { html, render, ic, $, on, setBusy } from '../ui/dom.js';
import { brand, userMenuHTML, wireMenus, storageBanner } from '../ui/brand.js';
import { toast } from '../ui/toast.js';
import { setFieldError, clearErrors } from '../ui/forms.js';
import {
  feeDraft, feeFieldsHTML, readFeeDraft, feeFromDraft,
  rulesDraft, rulesFieldsHTML, readRulesDraft, rulesFromDraft, setRulesSport,
  prizesDraft, prizesFieldsHTML, readPrizesDraft, prizesFromDraft, prizeAdd, prizeDel,
  detailsFieldHTML, wireTourneyForm,
} from '../ui/tourneyform.js';
import { api } from '../api.js';
import { session } from '../session.js';
import { navigate } from '../router.js';
import { SPORTS } from '../shared/sports.js';
import { isoDay } from '../shared/dates.js';

const DEFAULT_SPORT = 'futsal';

export default function (ctx) {
  document.title = 'Novo torneio — ArenaMaster AI';
  if (!session.user) { navigate('/entrar', { replace: true }); return; }

  const draft = {
    fee: { ...feeDraft({ fee: 0 }), free: false },
    rules: rulesDraft(null, DEFAULT_SPORT),
    prizes: prizesDraft(null),
    details: '',
  };

  render(ctx.root, html`${storageBanner()}<header class="public-top">${brand()}<span class="spacer"></span>${userMenuHTML()}</header>
    <main class="home create-page">
      <div><a class="small" href="/">${ic('arrow-left', { size: 15 })} Meus torneios</a><h1 style="font-size:28px;margin-top:6px">Novo torneio</h1><p class="muted">Preencha o essencial agora. Tudo pode ser ajustado depois em <b>Configurações</b>.</p></div>
      <form id="newT" class="settings" novalidate>
        <div class="card"><h3 class="card-title">${ic('trophy')} Informações básicas</h3><div class="stack">
          <div class="field" data-f="name"><label for="nt-name">Nome do torneio <span class="req">*</span></label><input id="nt-name" name="name" maxlength="60" autocomplete="off" placeholder="Ex.: Copa de Futsal Amigos da Vila 2026"><span class="field-error"></span></div>
          <fieldset style="border:0;padding:0;margin:0"><legend class="label" style="margin-bottom:8px">Modalidade</legend>
            <div class="tiles c2">${Object.values(SPORTS).map(s => html`<div class="tile sm"><input type="radio" name="sport" id="nt-${s.key}" value="${s.key}" ${s.key === DEFAULT_SPORT ? 'checked' : ''}><label for="nt-${s.key}"><span class="t-ico">${ic(s.icon, { size: 22 })}</span><span><span class="t-title">${s.label}</span><span class="t-sub">${s.sub}</span></span></label></div>`)}</div></fieldset>
          <div class="field" data-f="finalDate"><label for="nt-date">Data da grande final</label><input id="nt-date" type="date" name="finalDate" value="${isoDay(new Date(Date.now() + 30 * 86400_000))}"><span class="field-error"></span></div>
        </div></div>

        <div class="card"><h3 class="card-title">${ic('wallet')} Inscrição</h3>${feeFieldsHTML(draft.fee)}</div>

        <div class="card"><h3 class="card-title">${ic('list-checks')} Regras do torneio</h3>
          <p class="card-sub">Marque o que vale no seu torneio. As conferidas pelo sistema barram a inscrição; nas demais, o capitão aceita as regras ao inscrever o time.</p>
          <div id="rulesBox">${rulesFieldsHTML(draft.rules, DEFAULT_SPORT)}</div></div>

        <div class="card"><h3 class="card-title">${ic('info')} Detalhes</h3>${detailsFieldHTML(draft.details)}</div>

        <div class="card"><h3 class="card-title">${ic('medal')} Premiação</h3>
          <p class="card-sub">Adicione as colocações (1º, 2º, 3º…) de cada categoria. Use o texto, o valor em dinheiro ou os dois. Deixe em branco o que não tiver premiação.</p>
          <div id="prizesBox">${prizesFieldsHTML(draft.prizes)}</div></div>

        <label class="check card" style="padding:16px"><input type="checkbox" name="demo"><span><b>Torneio de demonstração</b><br><span class="muted small">Já vem com 8 times de exemplo para você testar sorteio, jogos ao vivo e repescagem sem inscrições reais.</span></span></label>

        <div class="form-error" hidden></div>
        <div class="row between wrap"><a class="btn" href="/">Cancelar</a><button class="btn btn-primary btn-lg" type="submit" id="ntGo">${ic('plus', { size: 18 })} Criar torneio</button></div>
      </form>
    </main>`);

  wireMenus(ctx.root, ctx.signal);
  const form = $('#newT', ctx.root);
  wireTourneyForm(form, ctx.signal);
  $('#nt-name', ctx.root).focus();

  const field = name => form.querySelector(`[data-f="${name}"]`);
  const sport = () => form.sport.value;
  const showError = err => {
    const f = err?.details?.field && field(err.details.field);
    if (f) { setFieldError(f, err.message); f.querySelector('input,textarea')?.focus(); return; }
    const box = $('.form-error', form); box.hidden = false; box.textContent = err.message;
  };

  // a modalidade define os limites do "mínimo de jogadores"
  form.addEventListener('change', e => { if (e.target.name === 'sport') setRulesSport(form, sport()); }, { signal: ctx.signal });

  // premiação: adicionar/remover colocação re-desenha só o bloco, mantendo o que já foi digitado
  const repaintPrizes = focus => {
    $('#prizesBox', form).innerHTML = prizesFieldsHTML(draft.prizes).s;
    if (focus) $(focus, form)?.focus();
  };
  on(form, 'click', '[data-act]', (e, el) => {
    const { act, cat } = el.dataset, i = Number(el.dataset.i);
    if (act !== 'prize-add' && act !== 'prize-del') return;
    draft.prizes = readPrizesDraft(form);
    if (act === 'prize-add') { prizeAdd(draft.prizes, cat); repaintPrizes(`[name="prize-${cat}-${draft.prizes[cat].length - 1}-description"]`); }
    else { prizeDel(draft.prizes, cat, i); repaintPrizes(`[data-act="prize-add"][data-cat="${cat}"]`); }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault(); clearErrors(form);
    const box = $('.form-error', form); box.hidden = true;
    const body = { name: form.name.value.trim(), sport: sport(), finalDate: form.finalDate.value, demo: form.demo.checked, details: form.details.value };
    const fail = (name, message) => { setFieldError(field(name), message); (field(name)?.querySelector('input,textarea') || field(name))?.focus(); };
    if (body.name.length < 3) return fail('name', 'Informe o nome do torneio (mínimo 3 letras).');
    if (!body.finalDate) return fail('finalDate', 'Escolha a data da final.');
    const fee = feeFromDraft(readFeeDraft(form)); if (fee.error) return fail(fee.error.field, fee.error.message);
    const rules = rulesFromDraft(readRulesDraft(form), body.sport); if (rules.error) return fail(rules.error.field, rules.error.message);
    const prizes = prizesFromDraft(readPrizesDraft(form)); if (prizes.error) return fail(prizes.error.field, prizes.error.message);
    Object.assign(body, { freeRegistration: fee.freeRegistration, fee: fee.fee, rules: rules.rules, prizes: prizes.prizes });

    const btn = $('#ntGo', form); setBusy(btn, true);
    try {
      const r = await api.post('/tournaments', body);
      toast('Torneio criado! Confira as configurações e compartilhe o link com os times.', { type: 'success' });
      navigate('/admin/' + r.tournament.id);
    } catch (err) { setBusy(btn, false); showError(err); }
  });
}
