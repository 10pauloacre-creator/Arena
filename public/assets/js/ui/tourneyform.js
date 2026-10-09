// Blocos de formulário compartilhados pela criação e pelas configurações do torneio:
// inscrição gratuita/valor, checklist de regras e premiação. Cada bloco tem o mesmo ciclo:
//   *Draft(...)      estado editável (textos como o usuário digita)
//   *FieldsHTML(d)   marcação do formulário
//   read*Draft(root) lê o que está na tela de volta para o estado
//   *FromDraft(d)    valida e converte para o que a API espera → { valor } ou { error: { field, message } }
import { html, ic } from './dom.js';
import { parseMoney, centsToInput } from './forms.js';
import {
  RULE_DEFS, MAX_CUSTOM_RULES, MAX_CUSTOM_RULE_LEN, MAX_DETAILS_LEN, normalizeRules,
  PRIZE_CATEGORIES, PRIZE_CATEGORY_KEYS, MAX_PRIZES, MAX_PRIZE_AMOUNT, normalizePrizes, placeLabel,
} from '../shared/rules.js';

const val = (root, sel) => root.querySelector(sel)?.value ?? '';
const checked = (root, sel) => !!root.querySelector(sel)?.checked;

// ---------------------------------------------------------------- inscrição gratuita / valor
export const feeDraft = t => ({ free: !t.fee, fee: t.fee ? centsToInput(t.fee) : '' });

export function feeFieldsHTML(d, { disabled = false } = {}) {
  return html`<div class="stack" data-feebox>
    <label class="switch"><input type="checkbox" name="freeRegistration" ${d.free ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="track"></span><span><b>Inscrição gratuita</b><br><span class="muted small">Ativada, os times se inscrevem sem pagar e já entram na lista. Desativada, o time só entra depois de pagar por PIX ou cartão.</span></span></label>
    <div class="field" data-f="fee"><label for="f-fee">Valor da inscrição por time</label><div class="input-affix"><span class="prefix">R$</span><input id="f-fee" name="fee" inputmode="decimal" value="${d.fee}" placeholder="0,00" ${d.free || disabled ? 'disabled' : ''}></div><span class="hint">Valor mínimo cobrável: R$ 5,00.</span><span class="field-error"></span></div>
  </div>`;
}

export const readFeeDraft = root => ({ free: checked(root, '[name=freeRegistration]'), fee: val(root, '[name=fee]').trim() });

export function feeFromDraft(d) {
  if (d.free) return { freeRegistration: true, fee: 0 };
  const cents = parseMoney(d.fee);
  if (!d.fee || !Number.isFinite(cents) || cents < 500 || cents > 1_000_000) return { error: { field: 'fee', message: 'Informe o valor da inscrição (de R$ 5,00 a R$ 10.000,00) ou ative "Inscrição gratuita".' } };
  return { freeRegistration: false, fee: cents };
}

// ---------------------------------------------------------------- regras (checklist)
export function rulesDraft(rules, sport) {
  const r = normalizeRules(rules), d = {};
  for (const def of RULE_DEFS) d[def.key] = def.type === 'int' ? { on: r[def.key] != null, value: String(r[def.key] ?? def.bounds(sport).def) } : r[def.key];
  d.custom = r.custom.join('\n');
  return d;
}

function ruleRow(def, v, sport) {
  const on = def.type === 'int' ? v.on : v, b = def.type === 'int' ? def.bounds(sport) : null;
  return html`<div class="rule-row" data-rule="${def.key}">
    <label class="check"><input type="checkbox" name="rule-${def.key}" ${on ? 'checked' : ''}><span><b>${def.label}</b> <span class="rule-tag ${def.kind}">${def.kind === 'enforced' ? 'conferida pelo sistema' : 'aceite do capitão'}</span><br><span class="muted small">${def.hint}</span></span></label>
    ${def.type === 'int' ? html`<div class="field rule-param" data-f="rules.${def.key}"><label class="sr-only" for="rv-${def.key}">${def.label}</label><div class="row" style="gap:8px"><input id="rv-${def.key}" name="rule-${def.key}-value" type="number" inputmode="numeric" min="${b.min}" max="${b.max}" value="${v.value}" ${on ? '' : 'disabled'}><span class="muted small">${def.unit}</span></div><span class="field-error"></span></div>` : ''}
  </div>`;
}

export function rulesFieldsHTML(d, sport) {
  return html`<div class="rules-editor stack-sm" data-rules>
    ${RULE_DEFS.map(def => ruleRow(def, d[def.key], sport))}
    <div class="field" data-f="rules.custom"><label for="r-custom">Outras regras <span class="muted" style="font-weight:500">(uma por linha, até ${MAX_CUSTOM_RULES})</span></label><textarea id="r-custom" name="ruleCustom" rows="3" placeholder="Ex.: Proibido chuteira de trava de alumínio">${d.custom}</textarea><span class="hint">O capitão precisa aceitar estas regras para inscrever o time.</span><span class="field-error"></span></div>
  </div>`;
}

export function readRulesDraft(root) {
  const d = {};
  for (const def of RULE_DEFS) {
    const on = checked(root, `[name="rule-${def.key}"]`);
    d[def.key] = def.type === 'int' ? { on, value: val(root, `[name="rule-${def.key}-value"]`).trim() } : on;
  }
  d.custom = val(root, '[name=ruleCustom]');
  return d;
}

export function rulesFromDraft(d, sport) {
  const rules = {}, err = (field, message) => ({ error: { field, message } });
  for (const def of RULE_DEFS) {
    if (def.type === 'bool') { rules[def.key] = !!d[def.key]; continue; }
    if (!d[def.key].on) { rules[def.key] = null; continue; }
    const { min, max } = def.bounds(sport), n = Number(d[def.key].value);
    if (d[def.key].value === '' || !Number.isInteger(n) || n < min || n > max) return err(`rules.${def.key}`, `${def.label}: use um número de ${min} a ${max} ${def.unit}.`);
    rules[def.key] = n;
  }
  const lines = [...new Set(d.custom.split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean))];
  if (lines.length > MAX_CUSTOM_RULES) return err('rules.custom', `Use no máximo ${MAX_CUSTOM_RULES} regras adicionais.`);
  const bad = lines.find(l => l.length < 3 || l.length > MAX_CUSTOM_RULE_LEN);
  if (bad) return err('rules.custom', bad.length < 3 ? 'Cada regra adicional precisa de ao menos 3 caracteres.' : `Cada regra adicional pode ter até ${MAX_CUSTOM_RULE_LEN} caracteres.`);
  rules.custom = lines;
  return { rules };
}

/** Ajusta limites/valor dos campos numéricos quando a modalidade muda (criação). */
export function setRulesSport(root, sport) {
  for (const def of RULE_DEFS.filter(x => x.type === 'int')) {
    const input = root.querySelector(`[name="rule-${def.key}-value"]`); if (!input) continue;
    const { min, max, def: dflt } = def.bounds(sport);
    input.min = min; input.max = max;
    if (!(Number(input.value) >= min && Number(input.value) <= max)) input.value = dflt;
  }
}

// ---------------------------------------------------------------- premiação
export function prizesDraft(prizes) {
  const p = normalizePrizes(prizes);
  return Object.fromEntries(PRIZE_CATEGORY_KEYS.map(k => [k, p[k].map(x => ({ description: x.description, amount: x.amount ? centsToInput(x.amount) : '' }))]));
}

const CAT_HINT = { geral: 'Vale para todos os times', masculino: 'Para as equipes masculinas', feminino: 'Para as equipes femininas' };

export function prizesFieldsHTML(d) {
  return html`<div class="prize-editor stack" data-prizes>${PRIZE_CATEGORY_KEYS.map(cat => html`
    <section class="prize-block" data-cat="${cat}" aria-labelledby="pz-h-${cat}">
      <div class="row between wrap" style="gap:8px"><div><h4 id="pz-h-${cat}">${PRIZE_CATEGORIES[cat]}</h4><span class="muted small">${CAT_HINT[cat]}</span></div>
        <button type="button" class="btn btn-sm" data-act="prize-add" data-cat="${cat}" ${d[cat].length >= MAX_PRIZES ? 'disabled' : ''}>${ic('plus', { size: 15 })} Adicionar colocação</button></div>
      ${d[cat].length ? html`<ol class="prize-rows">${d[cat].map((p, i) => html`<li class="prize-row" data-i="${i}">
        <span class="place">${ic('medal', { size: 16 })} ${placeLabel(i)}</span>
        <div class="field" data-f="prize-${cat}-${i}"><label class="sr-only" for="pz-${cat}-${i}-d">Prêmio do ${placeLabel(i)} (${PRIZE_CATEGORIES[cat]})</label><input id="pz-${cat}-${i}-d" name="prize-${cat}-${i}-description" maxlength="80" autocomplete="off" value="${p.description}" placeholder="Ex.: Troféu + medalhas"><span class="field-error"></span></div>
        <div class="field"><label class="sr-only" for="pz-${cat}-${i}-a">Valor em dinheiro do ${placeLabel(i)} (${PRIZE_CATEGORIES[cat]})</label><div class="input-affix"><span class="prefix">R$</span><input id="pz-${cat}-${i}-a" name="prize-${cat}-${i}-amount" inputmode="decimal" autocomplete="off" value="${p.amount}" placeholder="Opcional"></div></div>
        <button type="button" class="icon-btn" data-act="prize-del" data-cat="${cat}" data-i="${i}" aria-label="Remover ${placeLabel(i)} (${PRIZE_CATEGORIES[cat]})">${ic('trash', { size: 16 })}</button></li>`)}</ol>` : html`<p class="hint" style="margin-top:8px">Sem premiação nesta categoria.</p>`}
    </section>`)}
  </div>`;
}

export function readPrizesDraft(root) {
  const d = {};
  for (const cat of PRIZE_CATEGORY_KEYS) {
    d[cat] = [...root.querySelectorAll(`[data-cat="${cat}"] .prize-row`)].map(row => ({
      description: row.querySelector('[name$="-description"]').value,
      amount: row.querySelector('[name$="-amount"]').value,
    }));
  }
  return d;
}

export function prizeAdd(d, cat) { if (d[cat].length < MAX_PRIZES) d[cat].push({ description: '', amount: '' }); }
export function prizeDel(d, cat, i) { d[cat].splice(i, 1); }

export function prizesFromDraft(d) {
  const prizes = {};
  for (const cat of PRIZE_CATEGORY_KEYS) {
    const out = [];
    for (let i = 0; i < d[cat].length; i++) {
      const where = `Premiação ${PRIZE_CATEGORIES[cat].toLowerCase()}, ${placeLabel(i)}`, fail = message => ({ error: { field: `prize-${cat}-${i}`, message: `${where}: ${message}` } });
      const description = d[cat][i].description.replace(/\s+/g, ' ').trim(), raw = d[cat][i].amount.trim();
      const cents = raw ? parseMoney(raw) : 0;
      if (!Number.isFinite(cents) || cents < 0) return fail('valor inválido.');
      if (cents && (cents < 100 || cents > MAX_PRIZE_AMOUNT)) return fail('use um valor de R$ 1,00 a R$ 100.000,00.');
      if (description.length > 80) return fail('o texto pode ter até 80 caracteres.');
      if (!description && !cents) return fail('informe o prêmio (texto ou valor) ou remova a colocação.');
      out.push({ description, amount: cents || null });
    }
    prizes[cat] = out;
  }
  return { prizes };
}

// ---------------------------------------------------------------- detalhes
export const detailsFieldHTML = value => html`<div class="field" data-f="details"><label for="t-details">Detalhes, avisos e regras gerais</label><textarea id="t-details" name="details" rows="6" maxlength="${MAX_DETAILS_LEN}" placeholder="Ex.: Os portões abrem às 8h. Haverá cantina no local. Em caso de chuva, os jogos serão remarcados e avisados pelo WhatsApp.">${value}</textarea><span class="hint">Aparece para os visitantes na página do torneio. As quebras de linha são mantidas.</span><span class="field-error"></span></div>`;

// ---------------------------------------------------------------- ligações de eventos (delegadas na raiz)
/**
 * Liga o comportamento dos blocos: o interruptor de inscrição gratuita desativa o valor e a caixa de cada regra
 * numérica ativa/desativa seu número. Os listeners ficam na raiz e sobrevivem a re-renderizações.
 */
export function wireTourneyForm(root, signal) {
  root.addEventListener('change', e => {
    const t = e.target;
    if (t.matches?.('[name=freeRegistration]')) {
      const fee = root.querySelector('[name=fee]');
      if (fee) { fee.disabled = t.checked; if (!t.checked) fee.focus(); }
    }
    const m = /^rule-(.+)$/.exec(t.name || '');
    if (m && t.type === 'checkbox') {
      const num = root.querySelector(`[name="rule-${m[1]}-value"]`);
      if (num) { num.disabled = !t.checked; if (t.checked) num.focus(); }
    }
  }, { signal });
}
