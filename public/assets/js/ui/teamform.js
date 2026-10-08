// Campos de identificação do time e do responsável (reutilizados no visitante e no administrador).
import { html, ic, $ } from './dom.js';
import { setFieldError, bindPhoneMask, imageToDataUrl } from './forms.js';
import { toast } from './toast.js';
import { validEmail, validPhone, maskPhone } from '../shared/validators.js';

export function teamFieldsHTML({ withCaptain = true, values = {}, emblemRequired = false } = {}) {
  const v = values;
  return html`
  <div class="stack" data-teamfields>
    <div class="cols-2">
      <div class="field" data-f="name"><label for="tf-name">Nome do time <span class="req">*</span></label><input id="tf-name" name="name" maxlength="32" autocomplete="off" value="${v.name || ''}" placeholder="Ex.: Tigres do Bairro"><span class="field-error"></span></div>
      <div class="field" data-f="origin"><label for="tf-origin">Clube / bairro de origem</label><input id="tf-origin" name="origin" maxlength="32" autocomplete="off" value="${v.origin || ''}" placeholder="Opcional"><span class="hint">O sorteio evita colocar times do mesmo bairro frente a frente na 1ª fase.</span><span class="field-error"></span></div>
    </div>
    <div class="field" data-f="emblem"><span class="label">Emblema do time ${emblemRequired ? html`<span class="req">*</span>` : html`<span class="muted" style="font-weight:500">(opcional)</span>`}</span>
      <label class="drop" data-drop><span class="prev" data-emblemprev>${ic('shield-check', { size: 24 })}</span><span class="grow"><strong data-emblemtxt style="display:block">Enviar emblema</strong><span class="hint">PNG, JPG ou WEBP · será reduzido automaticamente</span></span><input type="file" name="emblemFile" accept="image/png,image/jpeg,image/webp"></label><span class="field-error"></span></div>
    ${withCaptain ? html`
    <div class="cols-3">
      <div class="field" data-f="captain.name"><label for="tf-cname">Responsável (capitão) <span class="req">*</span></label><input id="tf-cname" name="captainName" maxlength="60" autocomplete="name" value="${v.captain?.name || ''}" placeholder="Nome completo"><span class="field-error"></span></div>
      <div class="field" data-f="captain.phone"><label for="tf-cphone">WhatsApp <span class="req">*</span></label><input id="tf-cphone" name="captainPhone" inputmode="tel" autocomplete="tel" value="${v.captain?.phone ? maskPhone(v.captain.phone) : ''}" placeholder="(11) 98765-4321"><span class="field-error"></span></div>
      <div class="field" data-f="captain.email"><label for="tf-cmail">E-mail <span class="req">*</span></label><input id="tf-cmail" name="captainEmail" type="email" inputmode="email" autocomplete="email" value="${v.captain?.email || ''}" placeholder="capitao@exemplo.com"><span class="field-error"></span></div>
    </div>` : ''}
  </div>`;
}

/** Liga o upload de emblema e máscaras. Retorna { read(), validate(), setServerError(err) }. */
export function wireTeamFields(root, { withCaptain = true, emblemRequired = false } = {}) {
  const q = s => $(s, root);
  let emblem = null;
  const field = n => root.querySelector(`[data-f="${n}"]`);
  if (withCaptain) bindPhoneMask(q('[name=captainPhone]'));
  const drop = q('[data-drop]'), fileIn = q('[name=emblemFile]');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
  async function take(file) {
    setFieldError(field('emblem'), '');
    if (!file) return;
    try {
      emblem = await imageToDataUrl(file);
      q('[data-emblemprev]').innerHTML = `<img src="${emblem}" alt="Prévia do emblema">`;
      q('[data-emblemtxt]').textContent = file.name;
    } catch (err) { emblem = null; setFieldError(field('emblem'), err.message); toast(err.message, { type: 'warn' }); }
  }
  fileIn.addEventListener('change', () => take(fileIn.files[0]));
  drop.addEventListener('drop', e => take(e.dataTransfer.files[0]));

  return {
    setEmblem(url) {
      emblem = url || null;
      q('[data-emblemprev]').innerHTML = emblem ? `<img src="${emblem}" alt="Prévia do emblema">` : '';
      q('[data-emblemtxt]').textContent = emblem ? 'Emblema carregado' : 'Enviar emblema';
    },
    read() {
      const g = n => (q(`[name=${n}]`)?.value || '').trim();
      return {
        name: g('name').replace(/\s+/g, ' '), origin: g('origin'), emblem,
        ...(withCaptain ? { captain: { name: g('captainName'), phone: g('captainPhone'), email: g('captainEmail') } } : {}),
      };
    },
    validate() {
      const v = this.read(); let ok = true, first = null;
      const bad = (n, m, sel) => { setFieldError(field(n), m); ok = false; first = first || q(sel); };
      ['name', 'origin', 'emblem', 'captain.name', 'captain.phone', 'captain.email'].forEach(n => field(n) && setFieldError(field(n), ''));
      if (v.name.length < 3) bad('name', 'Informe o nome do time (mínimo 3 letras).', '[name=name]');
      if (emblemRequired && !v.emblem) bad('emblem', 'Este torneio exige o emblema do time. Envie uma imagem.', '[name=emblemFile]');
      if (withCaptain) {
        if (v.captain.name.length < 3) bad('captain.name', 'Informe o nome do responsável.', '[name=captainName]');
        if (!validPhone(v.captain.phone)) bad('captain.phone', 'Informe o WhatsApp com DDD.', '[name=captainPhone]');
        if (!validEmail(v.captain.email)) bad('captain.email', 'Informe um e-mail válido.', '[name=captainEmail]');
      }
      if (!ok) first?.focus();
      return ok;
    },
    setServerError(err) {
      const f = err?.details?.field && field(err.details.field);
      if (f) { setFieldError(f, err.message); $('input', f)?.focus(); return true; }
      return false;
    },
  };
}
