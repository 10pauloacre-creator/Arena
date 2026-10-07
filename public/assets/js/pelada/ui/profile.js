// Perfil do jogador: trocar foto, trocar senha e sair.
import { html, ic, $, setBusy } from '../../ui/dom.js';
import { openDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { setFieldError, clearErrors, applyApiError } from '../../ui/forms.js';
import { api } from '../../api.js';
import { S, setPlayer, saveToken, logout } from '../session.js';
import { pickAndCrop } from './cropper.js';
import { playerAvatar } from './img.js';
import { navigate } from '../../router.js';

export function openProfile() {
  const me = S.player;
  if (!me) return;
  const d = openDialog({
    title: 'Meu perfil',
    body: html`<div class="stack">
      <div class="row" style="gap:16px"><span data-avatar>${playerAvatar(me, 72)}</span>
        <div class="grow"><strong style="font-size:18px">${me.name}</strong><div class="row wrap" style="gap:8px;margin-top:8px"><button class="btn btn-sm" data-photo>${ic('camera', { size: 16 })} Trocar foto</button><button class="btn btn-sm btn-ghost" data-photo-remove ${me.av ? '' : 'hidden'}>Remover</button></div></div></div>
      <form class="stack" data-pass novalidate>
        <h4 style="margin:6px 0 0;font-size:15px">Trocar senha</h4>
        <p class="muted small" style="margin:0">Hoje sua senha é a sua data de nascimento. Crie uma senha própria (mínimo de 4 caracteres) se quiser.</p>
        <div class="field" data-f="current"><label for="pf-cur">Senha atual (ou data de nascimento)</label><input id="pf-cur" name="current" type="password" autocomplete="current-password" maxlength="100"><span class="field-error"></span></div>
        <div class="field" data-f="next"><label for="pf-new">Nova senha</label><input id="pf-new" name="next" type="password" autocomplete="new-password" maxlength="100"><span class="field-error"></span></div>
        <div class="form-error" hidden role="alert"></div>
        <button class="btn btn-primary" type="submit" data-go>Salvar nova senha</button>
      </form>
    </div>`,
    foot: html`<button class="btn btn-outline-danger" data-logout>${ic('log-out', { size: 16 })} Sair da conta</button><button class="btn" data-close>Fechar</button>`,
  });
  const refresh = () => { $('[data-avatar]', d.el).innerHTML = playerAvatar(S.player, 72).s; $('[data-photo-remove]', d.el).hidden = !S.player.av; };
  d.el.addEventListener('click', async e => {
    if (e.target.closest('[data-photo]')) {
      try {
        const url = await pickAndCrop({ aspect: 1, outW: 256, circle: true, title: 'Foto de perfil', maxBytes: 70_000 });
        if (!url) return;
        const r = await api.patch('/pelada/auth/me', { avatar: url });
        setPlayer(r.player); refresh(); toast('Foto atualizada.', { type: 'success' });
      } catch (err) { toast(err.message, { type: 'error' }); }
    }
    if (e.target.closest('[data-photo-remove]')) {
      try { const r = await api.patch('/pelada/auth/me', { avatar: null }); setPlayer(r.player); refresh(); } catch (err) { toast(err.message, { type: 'error' }); }
    }
    if (e.target.closest('[data-logout]')) { d.close(); await logout(); toast('Você saiu da conta.'); navigate('/pelada/'); }
  });
  $('[data-pass]', d.el).addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target; clearErrors(form);
    const box = $('.form-error', form); box.hidden = true;
    if (!form.current.value) { setFieldError($('[data-f=current]', form), 'Informe a senha atual.'); return; }
    if (form.next.value.length < 4) { setFieldError($('[data-f=next]', form), 'A nova senha precisa ter ao menos 4 caracteres.'); return; }
    const btn = $('[data-go]', form); setBusy(btn, true);
    try {
      const r = await api.post('/pelada/auth/password', { current: form.current.value, next: form.next.value });
      saveToken(r.token); // a senha nova invalida as chaves antigas: este aparelho recebe uma nova
      toast('Senha alterada. Use a nova senha no próximo acesso.', { type: 'success' });
      form.reset(); setBusy(btn, false);
    } catch (err) {
      setBusy(btn, false);
      if (!applyApiError(form, err)) {
        if (err.status === 401) setFieldError($('[data-f=current]', form), err.message); else { box.hidden = false; box.textContent = err.message; }
      }
    }
  });
}
