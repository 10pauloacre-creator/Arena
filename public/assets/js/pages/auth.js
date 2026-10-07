import { html, render, ic, $, setBusy } from '../ui/dom.js';
import { brandMark, storageBanner } from '../ui/brand.js';
import { setFieldError, clearErrors, applyApiError } from '../ui/forms.js';
import { api } from '../api.js';
import { session, setUser } from '../session.js';
import { navigate } from '../router.js';
import { validEmail } from '../shared/validators.js';

const safeNext = n => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//')) ? n : '/';

export default function (ctx) {
  const signup = ctx.path === '/cadastro';
  const next = safeNext(ctx.query.next);
  if (session.user) return navigate(next, { replace: true });
  const q = ctx.query.next ? `?next=${encodeURIComponent(next)}` : '';
  document.title = (signup ? 'Criar conta' : 'Entrar') + ' · ArenaMaster AI';
  render(ctx.root, html`${storageBanner()}<div class="auth">
    <aside class="auth-side"><a class="brand" href="/" style="color:#fff">${brandMark(44)}<span><span class="brand-name">Arena<b>Master</b> AI</span><span class="brand-sub">TOURNAMENT OS</span></span></a>
      <div><h2>Organize torneios como um profissional.</h2><p>Inscrições com pagamento, sorteio justo, jogos ao vivo e divulgação — sem planilhas e sem confusão na mesa.</p></div>
      <span class="muted small" style="color:#8a97b1">© ArenaMaster AI</span></aside>
    <main class="auth-main"><div class="auth-card">
      <a class="brand" href="/" style="color:var(--ink);justify-self:start;display:none" id="mobBrand"></a>
      <div><h1>${signup ? 'Criar conta' : 'Entrar'}</h1><p class="muted">${signup ? 'Crie sua conta para criar e administrar torneios.' : 'Acesse para gerenciar seus torneios.'}</p></div>
      <form id="authForm" class="stack" novalidate>
        ${signup ? html`<div class="field" data-f="name"><label for="a-name">Nome</label><input id="a-name" name="name" autocomplete="name" maxlength="60" placeholder="Seu nome completo"><span class="field-error"></span></div>` : ''}
        <div class="field" data-f="email"><label for="a-email">E-mail</label><input id="a-email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="voce@exemplo.com"><span class="field-error"></span></div>
        <div class="field" data-f="password"><label for="a-pass">Senha</label><div class="input-icon" style="position:relative"><input id="a-pass" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="${signup ? 'Mínimo de 8 caracteres' : 'Sua senha'}" maxlength="200" style="padding-right:46px"><button type="button" class="icon-btn" id="togglePass" aria-label="Mostrar senha" style="position:absolute;right:2px;top:2px">${ic('eye', { size: 18 })}</button></div><span class="field-error"></span></div>
        <div class="form-error" hidden role="alert"></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit" id="authGo">${signup ? 'Criar conta' : 'Entrar'}</button>
      </form>
      <p class="center muted">${signup ? html`Já tem conta? <a href="/entrar${q}">Entrar</a>` : html`Ainda não tem conta? <a href="/cadastro${q}">Criar conta</a>`}</p>
      <p class="center small"><a href="/">← Voltar ao início</a></p>
    </div></main></div>`);
  const form = $('#authForm', ctx.root);
  $('#togglePass', ctx.root).addEventListener('click', e => {
    const inp = form.password, show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    e.currentTarget.innerHTML = ic(show ? 'eye-off' : 'eye', { size: 18 }).s;
    e.currentTarget.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  });
  const mobBrand = $('#mobBrand', ctx.root);
  if (matchMedia('(max-width: 959px)').matches) { mobBrand.style.display = 'flex'; mobBrand.innerHTML = html`${brandMark(36)}<span><span class="brand-name" style="font-size:18px">Arena<b style="color:var(--blue)">Master</b> AI</span></span>`.s; }
  form.email.focus();
  form.addEventListener('submit', async e => {
    e.preventDefault(); clearErrors(form);
    const box = $('.form-error', form); box.hidden = true;
    const body = { email: form.email.value.trim(), password: form.password.value };
    let bad = false;
    if (signup) { body.name = form.name.value.trim(); if (body.name.length < 2) { setFieldError($('[data-f=name]', form), 'Informe seu nome.'); bad = true; } }
    if (!validEmail(body.email)) { setFieldError($('[data-f=email]', form), 'Informe um e-mail válido.'); bad = true; }
    if (!body.password) { setFieldError($('[data-f=password]', form), 'Informe a senha.'); bad = true; }
    else if (signup && body.password.length < 8) { setFieldError($('[data-f=password]', form), 'A senha precisa ter ao menos 8 caracteres.'); bad = true; }
    if (bad) { form.querySelector('.has-error input')?.focus(); return; }
    const btn = $('#authGo', form); setBusy(btn, true);
    try {
      const r = await api.post(signup ? '/auth/signup' : '/auth/login', body);
      setUser(r.user);
      navigate(next, { replace: true });
    } catch (err) {
      setBusy(btn, false);
      if (!applyApiError(form, err)) { box.hidden = false; box.textContent = err.message; }
    }
  });
}
