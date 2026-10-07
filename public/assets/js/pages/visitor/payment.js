// Pagamento (PIX ou cartão) reutilizado na inscrição do time e na doação da repescagem.
import { html, render, ic, $, on, copyText, setBusy } from '../../ui/dom.js';
import { qrSvg } from '../../ui/qr.js';
import { toast } from '../../ui/toast.js';
import { bindCardMasks, setFieldError } from '../../ui/forms.js';
import { api } from '../../api.js';
import { session } from '../../session.js';
import { fmtBRL } from '../../shared/format.js';
import { luhn, cardBrand, validCPF, maskCPF } from '../../shared/validators.js';

let mpSdk = null;
function loadMpSdk() {
  if (window.MercadoPago) return Promise.resolve();
  if (!mpSdk) mpSdk = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://sdk.mercadopago.com/js/v2'; s.onload = res; s.onerror = () => rej(new Error('Não foi possível carregar o checkout de cartão.')); document.head.append(s); });
  return mpSdk;
}

/** Converte os dados do cartão em token do Mercado Pago (somente provedor real). */
async function tokenizeCard(v) {
  await loadMpSdk();
  const mp = new window.MercadoPago(session.config.payments.publicKey, { locale: 'pt-BR' });
  const [m, y] = v.expiry.split('/');
  const tok = await mp.createCardToken({ cardNumber: v.number.replace(/\D/g, ''), cardholderName: v.name, cardExpirationMonth: m, cardExpirationYear: y.length === 2 ? '20' + y : y, securityCode: v.cvv, identificationType: 'CPF', identificationNumber: v.cpf.replace(/\D/g, '') });
  const pm = await mp.getPaymentMethods({ bin: v.number.replace(/\D/g, '').slice(0, 6) });
  return { token: tok.id, paymentMethodId: pm.results?.[0]?.id, issuerId: pm.results?.[0]?.issuer?.id, installments: 1 };
}

/**
 * Monta o pagamento em `root`.
 * opts: { tid, teamId, code, amount, endpoint, extra, onApproved, onExpired, expiresAt }
 *  - endpoint: '/pay' (inscrição) ou '/repescagem' (doação) — relativo a /public/:id/teams/:teamId
 *  - extra: corpo adicional enviado no POST (ex.: valor, causa)
 */
export function mountPayment(root, opts) {
  const cfg = session.config.payments, mock = cfg.mock, methods = cfg.methods;
  let method = 'pix', payment = null, pollTimer = null, tickTimer = null, destroyed = false, busy = false;
  const draft = { number: '', name: '', expiry: '', cpf: '' }; // mantém o que foi digitado após uma recusa (exceto o CVV)

  const base = `/public/${encodeURIComponent(opts.tid)}`;
  const body = (m, card) => ({ code: opts.code, method: m, ...(card ? { card } : {}), ...(opts.extra || {}) });

  function paintPick() {
    render(root, html`<div class="stack">
      ${mock ? html`<div class="banner-test">${ic('triangle-alert', { size: 18 })}<span><b>Modo de teste:</b> nenhum valor é cobrado. No PIX use "Simular pagamento"; no cartão use 4242 4242 4242 4242 (aprova) ou 4000 0000 0000 0002 (recusa).</span></div>` : ''}
      <div class="summary-box"><div class="line total"><span>Total a pagar</span><span>${fmtBRL(opts.amount)}</span></div></div>
      <div class="pay-options" role="radiogroup" aria-label="Forma de pagamento">
        <div class="tile sm"><input type="radio" name="pm" id="pm-pix" value="pix" ${method === 'pix' ? 'checked' : ''}><label for="pm-pix"><span class="t-ico">${ic('qr-code', { size: 20 })}</span><span><span class="t-title">PIX</span><span class="t-sub">Aprovação na hora</span></span></label></div>
        ${methods.includes('card') ? html`<div class="tile sm"><input type="radio" name="pm" id="pm-card" value="card" ${method === 'card' ? 'checked' : ''}><label for="pm-card"><span class="t-ico">${ic('credit-card', { size: 20 })}</span><span><span class="t-title">Cartão</span><span class="t-sub">Crédito ou débito</span></span></label></div>` : ''}
      </div>
      ${method === 'pix' ? html`<button class="btn btn-primary btn-lg btn-block" data-act="gen-pix">${ic('qr-code', { size: 18 })} Gerar PIX</button>` : cardForm()}
      <div class="form-error" data-err hidden></div></div>`);
    bindCardMasks(root);
  }

  const cardForm = () => html`<form class="stack" data-cardform novalidate>
    <div class="field" data-f="cardNumber"><label for="c-num">Número do cartão</label><input id="c-num" name="cardNumber" inputmode="numeric" autocomplete="cc-number" placeholder="0000 0000 0000 0000" value="${draft.number}"><span class="field-error"></span></div>
    <div class="field" data-f="cardName"><label for="c-name">Nome impresso no cartão</label><input id="c-name" name="cardName" autocomplete="cc-name" placeholder="COMO NO CARTÃO" value="${draft.name}"><span class="field-error"></span></div>
    <div class="cols-2"><div class="field" data-f="cardExpiry"><label for="c-exp">Validade</label><input id="c-exp" name="cardExpiry" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/AA" value="${draft.expiry}"><span class="field-error"></span></div>
      <div class="field" data-f="cardCvv"><label for="c-cvv">CVV</label><input id="c-cvv" name="cardCvv" inputmode="numeric" autocomplete="cc-csc" placeholder="123"><span class="field-error"></span></div></div>
    ${mock ? '' : html`<div class="field" data-f="cardCpf"><label for="c-cpf">CPF do titular</label><input id="c-cpf" name="cardCpf" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" value="${draft.cpf}"><span class="field-error"></span></div>`}
    <button class="btn btn-primary btn-lg btn-block" type="submit">${ic('lock', { size: 18 })} Pagar ${fmtBRL(opts.amount)}</button>
    <p class="hint">${ic('shield-check', { size: 14 })} ${mock ? 'Os dados do cartão de teste não são guardados.' : 'Pagamento processado com segurança pelo Mercado Pago.'}</p></form>`;

  function err(msg) { const e = $('[data-err]', root); if (e) { e.hidden = !msg; e.textContent = msg || ''; } }

  async function post(m, card) {
    const r = await api.post(`${base}/teams/${encodeURIComponent(opts.teamId)}${opts.endpoint}`, body(m, card));
    return r;
  }

  async function genPix(btn) {
    if (busy) return; busy = true; setBusy(btn, true); err('');
    try { const r = await post('pix'); handle(r); }
    catch (e) { err(e.message); } finally { busy = false; setBusy(btn, false); }
  }

  function handle(r) {
    payment = r.payment;
    if (payment.status === 'approved') return approved(r);
    if (payment.status === 'declined') { paintPick(); err(payment.failReason || 'Pagamento recusado. Tente outro cartão ou use PIX.'); return; }
    if (payment.method === 'pix') paintPix();
  }

  function paintPix() {
    const p = payment;
    render(root, html`<div class="stack"><div class="pix-box">
      <div><strong style="font-size:17px">Pague ${fmtBRL(p.amount)} com PIX</strong><p class="muted small">Abra o app do seu banco, escolha PIX → ler QR Code (ou copia e cola).</p></div>
      <div class="qr">${p.pix.qrBase64 ? html`<img alt="QR Code PIX" src="data:image/png;base64,${p.pix.qrBase64}">` : qrSvg(p.pix.code, { margin: 1 })}</div>
      <div class="pix-code"><input readonly value="${p.pix.code}" aria-label="PIX copia e cola" data-select><button class="btn btn-sm" data-act="copy-pix">${ic('copy', { size: 15 })} Copiar</button></div>
      <div class="row small muted" style="justify-content:center">${ic('clock', { size: 16 })}<span>Expira em <b data-left class="num"></b></span> · <span class="row" style="gap:6px"><span class="spinner" style="width:14px;height:14px;border-width:2px"></span> aguardando pagamento…</span></div>
      ${p.mock ? html`<div class="banner-test" style="width:100%">${ic('triangle-alert', { size: 18 })}<span>Modo de teste: nenhum valor real será cobrado.</span></div><button class="btn btn-block" data-act="simulate">${ic('check', { size: 16 })} Simular pagamento aprovado</button>` : ''}
    </div><button class="btn btn-ghost btn-block" data-act="change-method">Trocar forma de pagamento</button><div class="form-error" data-err hidden></div></div>`);
    startTimers();
  }

  function startTimers() {
    stop();
    const tick = () => {
      const left = Math.max(0, payment.expiresAt - (Date.now() + (opts.offset?.() || 0)));
      const el = $('[data-left]', root); if (el) el.textContent = `${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
      if (left <= 0) { stop(); err('O PIX expirou. Gere um novo para continuar.'); opts.onExpired?.(); }
    };
    tick(); tickTimer = setInterval(tick, 1000);
    pollTimer = setInterval(async () => {
      if (document.hidden || destroyed) return;
      try { const r = await api.get(`${base}/payments/${encodeURIComponent(payment.id)}?code=${encodeURIComponent(opts.code)}`); if (r.payment.status === 'approved') { stop(); approved(r); } else if (r.payment.status === 'expired') { stop(); err('O PIX expirou. Gere um novo.'); } } catch { /* tenta de novo */ }
    }, 3000);
  }
  function stop() { clearInterval(pollTimer); clearInterval(tickTimer); }

  function approved(r) {
    stop();
    render(root, html`<div class="success-card"><span class="ok-ico">${ic('check', { size: 34 })}</span><h3 style="font-size:20px">Pagamento confirmado!</h3><p class="muted">Recebemos ${fmtBRL(payment.amount)}${payment.card ? ` no cartão ${payment.card.brand} final ${payment.card.last4}` : ' via PIX'}.</p></div>`);
    opts.onApproved?.(r);
  }

  async function submitCard(form) {
    if (busy) return;
    ['cardNumber', 'cardName', 'cardExpiry', 'cardCvv', 'cardCpf'].forEach(n => { const f = $(`[data-f=${n}]`, form); if (f) setFieldError(f, ''); });
    const v = { number: form.cardNumber.value, name: form.cardName.value.trim(), expiry: form.cardExpiry.value, cvv: form.cardCvv.value, cpf: form.cardCpf?.value || '' };
    Object.assign(draft, { number: v.number, name: v.name, expiry: v.expiry, cpf: v.cpf });
    let bad = false;
    const flag = (n, m) => { setFieldError($(`[data-f=${n}]`, form), m); bad = true; };
    if (!luhn(v.number)) flag('cardNumber', 'Número de cartão inválido.');
    if (v.name.length < 3) flag('cardName', 'Informe o nome impresso no cartão.');
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(v.expiry)) flag('cardExpiry', 'Use MM/AA.');
    if (!/^\d{3,4}$/.test(v.cvv)) flag('cardCvv', '3 ou 4 dígitos.');
    if (!mock && !validCPF(v.cpf)) flag('cardCpf', 'CPF inválido.');
    if (bad) { form.querySelector('.has-error input')?.focus(); return; }
    const btn = $('button[type=submit]', form); busy = true; setBusy(btn, true); err('');
    try {
      const card = mock ? { number: v.number, name: v.name, expiry: v.expiry, cvv: v.cvv } : await tokenizeCard(v);
      handle(await post('card', card));
    } catch (e) { err(e.message || 'Não foi possível processar o cartão.'); } finally { busy = false; setBusy(btn, false); }
    void cardBrand;
  }

  paintPick();
  root.addEventListener('change', e => { if (e.target.name === 'pm') { method = e.target.value; paintPick(); } });
  root.addEventListener('input', e => { if (e.target.name === 'cardCpf') e.target.value = maskCPF(e.target.value); });
  root.addEventListener('submit', e => { const f = e.target.closest('[data-cardform]'); if (f) { e.preventDefault(); submitCard(f); } });
  root.addEventListener('focusin', e => { if (e.target.matches('[data-select]')) e.target.select(); });
  on(root, 'click', '[data-act]', async (e, el) => {
    const act = el.dataset.act;
    if (act === 'gen-pix') await genPix(el);
    if (act === 'copy-pix') toast((await copyText(payment.pix.code)) ? 'Código PIX copiado!' : 'Selecione e copie o código.', { type: 'success', ms: 2200 });
    if (act === 'change-method') { stop(); payment = null; paintPick(); }
    if (act === 'simulate') {
      setBusy(el, true);
      try { const r = await api.post(`${base}/payments/${encodeURIComponent(payment.id)}/simulate`, { code: opts.code }); payment = r.payment; approved(r); } catch (er) { setBusy(el, false); err(er.message); }
    }
  });

  // retomar PIX já gerado (ex.: capitão recarregou a página)
  if (opts.resume && opts.resume.status === 'pending' && opts.resume.method === 'pix' && opts.resume.pix) { payment = opts.resume; paintPix(); }

  return { destroy() { destroyed = true; stop(); } };
}
