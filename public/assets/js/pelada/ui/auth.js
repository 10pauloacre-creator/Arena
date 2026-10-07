// Conta ultra-rápida: Nome (usuário) + Data de nascimento (senha inicial) e foto opcional com recorte.
import { html, ic, $, setBusy } from '../../ui/dom.js';
import { openDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { setFieldError, clearErrors, applyApiError } from '../../ui/forms.js';
import { api } from '../../api.js';
import { setPlayer } from '../session.js';
import { maskDate, parseBirth } from '../../shared/pelada.js';
import { pickAndCrop } from './cropper.js';

/** Monta o formulário (abas Criar conta / Entrar) dentro de `root`. `onDone(player)` é chamado após o sucesso. */
export function mountAuth(root, { mode = 'signup', onDone, intro = '' } = {}) {
  let current = mode, avatar = null, name = '';

  function render() {
    const signup = current === 'signup';
    root.innerHTML = html`
      <div class="auth-tabs seg" role="group" aria-label="Acesso">
        <button type="button" data-mode="signup" aria-pressed="${String(signup)}">Criar conta</button>
        <button type="button" data-mode="login" aria-pressed="${String(!signup)}">Já tenho conta</button>
      </div>
      ${intro ? html`<p class="muted small" style="margin:0">${intro}</p>` : ''}
      <form class="stack" data-auth novalidate>
        ${signup ? html`<div class="av-pick"><button type="button" class="av-btn" data-photo aria-label="${avatar ? 'Trocar foto de perfil' : 'Adicionar foto de perfil'}">${avatar ? html`<img src="${avatar}" alt="Sua foto">` : html`${ic('camera', { size: 26 })}`}</button>
          <div><strong>${avatar ? 'Foto adicionada' : 'Foto de perfil (opcional)'}</strong><span class="muted small" style="display:block">Escolha uma imagem, recorte e ajuste o zoom.</span>
          ${avatar ? html`<button type="button" class="btn btn-sm btn-ghost" data-photo-remove>Remover foto</button>` : ''}</div></div>` : ''}
        <div class="field" data-f="name"><label for="au-name">Nome</label><input id="au-name" name="name" autocomplete="username" maxlength="40" placeholder="Seu nome e sobrenome" value="${name}"><span class="field-error"></span>
          <span class="hint">${signup ? 'Seu nome é o seu usuário. Use nome e sobrenome para não repetir com outra pessoa.' : 'O mesmo nome que você usou ao criar a conta.'}</span></div>
        ${signup
          ? html`<div class="field" data-f="birth"><label for="au-birth">Data de nascimento</label><input id="au-birth" name="birth" inputmode="numeric" autocomplete="bday" placeholder="DD/MM/AAAA" maxlength="10"><span class="field-error"></span>
              <span class="hint">É a sua senha. Você pode trocá-la depois, no seu perfil.</span></div>`
          : html`<div class="field" data-f="secret"><label for="au-secret">Data de nascimento (ou a senha que você criou)</label><div style="position:relative"><input id="au-secret" name="secret" type="password" autocomplete="current-password" placeholder="DD/MM/AAAA" maxlength="100" style="padding-right:46px"><button type="button" class="icon-btn" data-eye aria-label="Mostrar senha" style="position:absolute;right:2px;top:2px">${ic('eye', { size: 18 })}</button></div><span class="field-error"></span></div>`}
        <div class="form-error" hidden role="alert"></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit" data-go>${signup ? 'Criar conta e entrar' : 'Entrar'}</button>
      </form>`.s;
    const form = $('form', root);
    if (!name) form.name.focus({ preventScroll: true });
  }

  root.addEventListener('click', async e => {
    const tab = e.target.closest('[data-mode]');
    if (tab && tab.dataset.mode !== current) { name = $('input[name=name]', root)?.value || name; current = tab.dataset.mode; render(); return; }
    if (e.target.closest('[data-eye]')) {
      const inp = $('input[name=secret]', root), show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      e.target.closest('[data-eye]').innerHTML = ic(show ? 'eye-off' : 'eye', { size: 18 }).s;
      return;
    }
    if (e.target.closest('[data-photo-remove]')) { name = $('input[name=name]', root).value; avatar = null; render(); return; }
    if (e.target.closest('[data-photo]')) {
      try {
        const url = await pickAndCrop({ aspect: 1, outW: 256, circle: true, title: 'Foto de perfil', maxBytes: 70_000 });
        if (url) { name = $('input[name=name]', root).value; avatar = url; render(); }
      } catch (err) { toast(err.message, { type: 'error' }); }
    }
    if (e.target.closest('[data-switch-login]')) { name = $('input[name=name]', root).value; current = 'login'; render(); }
  });
  root.addEventListener('input', e => {
    if (e.target.name === 'birth') e.target.value = maskDate(e.target.value);
  });
  root.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    clearErrors(form);
    const box = $('.form-error', form); box.hidden = true;
    const signup = current === 'signup';
    const body = { name: form.name.value.trim() };
    let bad = false;
    if (body.name.length < 2) { setFieldError($('[data-f=name]', form), 'Informe seu nome.'); bad = true; }
    if (signup) {
      body.birth = form.birth.value.trim();
      if (!parseBirth(body.birth)) { setFieldError($('[data-f=birth]', form), 'Informe uma data de nascimento válida, como 25/03/1990.'); bad = true; }
      if (avatar) body.avatar = avatar;
    } else {
      body.secret = form.secret.value;
      if (!body.secret) { setFieldError($('[data-f=secret]', form), 'Informe a data de nascimento ou a senha.'); bad = true; }
    }
    if (bad) { form.querySelector('.has-error input')?.focus(); return; }
    const btn = $('[data-go]', form); setBusy(btn, true);
    try {
      const r = await api.post(signup ? '/pelada/auth/signup' : '/pelada/auth/login', body);
      setPlayer(r.player);
      onDone?.(r.player);
    } catch (err) {
      setBusy(btn, false);
      if (err.code === 'NAME_TAKEN') {
        box.hidden = false;
        box.innerHTML = html`${err.message} <button type="button" class="btn btn-sm" data-switch-login style="margin-top:8px">Já sou eu: entrar</button>`.s;
      } else if (!applyApiError(form, err)) { box.hidden = false; box.textContent = err.message; }
    }
  });
  render();
}

/** Abre o modal de conta. Resolve com o jogador (após criar/entrar) ou null (fechou). */
export function openAuthDialog({ title = 'Crie sua conta em 10 segundos', intro = '', mode = 'signup' } = {}) {
  let player = null;
  const d = openDialog({ title, body: html`<div class="stack" data-auth-root></div>` });
  mountAuth($('[data-auth-root]', d.el), { mode, intro, onDone: p => { player = p; d.close('ok'); } });
  return d.closed.then(() => player);
}
