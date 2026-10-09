// Configurações do jogador: quais notificações receber (por tipo e por pelada) e o aviso na tela.
// Cada chave salva sozinha, na hora.
import { html, render, ic, $ } from '../../ui/dom.js';
import { toast } from '../../ui/toast.js';
import { api } from '../../api.js';
import { S, setPlayer } from '../session.js';
import { navigate } from '../../router.js';
import { page, wireShell } from '../ui/shell.js';
import { peladaAvatar } from '../ui/img.js';
import { N, loadPrefs, savePrefs } from '../notify.js';
import { pushState, enablePush, disablePush, testPush } from '../push.js';
import { NOTIF_TYPES } from '../../shared/notifications.js';

const sw = ({ name, checked, title, desc, disabled = false, extra = '' }) => html`<label class="switch ntf-switch"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} ${extra}><span class="track"></span><span class="grow"><b>${title}</b>${desc ? html`<span class="muted small" style="display:block">${desc}</span>` : ''}</span></label>`;

export default async function (ctx) {
  if (!S.player) return navigate('/pelada/entrar?next=' + encodeURIComponent('/pelada/configuracoes'), { replace: true });
  document.title = 'Configurações · Pelada';
  render(ctx.root, page(html`
    <div><h1 style="font-size:28px">Configurações</h1><p class="muted">Escolha quais notificações você quer receber no app.</p></div>
    <div class="stack-lg" data-settings><div class="stack">${[1, 2].map(() => html`<div class="skeleton" style="height:160px;border-radius:16px"></div>`)}</div></div>`, { cls: 'narrow' }));
  wireShell(ctx.root, ctx.signal);

  let prefs, peladas;
  try {
    const [p, mine] = await Promise.all([loadPrefs(), api.get('/pelada/mine')]);
    prefs = p; peladas = [...mine.created, ...mine.joined];
  } catch (err) {
    if (!ctx.isCurrent()) return;
    if (err.status === 401) { setPlayer(null); return navigate('/pelada/entrar?next=' + encodeURIComponent('/pelada/configuracoes'), { replace: true }); }
    $('[data-settings]', ctx.root).innerHTML = html`<div class="form-error">${err.message}</div>`.s;
    return;
  }
  if (!ctx.isCurrent()) return;

  let push = await pushState();
  function paint() {
    const off = !prefs.enabled;
    render($('[data-settings]', ctx.root), html`
      <section class="card stack" aria-labelledby="st-app"><h2 class="card-title" id="st-app" style="margin:0">${ic('bell')} Notificações no app</h2>
        ${sw({ name: 'enabled', checked: prefs.enabled, title: 'Receber notificações', desc: 'Aparecem no sininho do topo, com o número de novidades.' })}
        ${sw({ name: 'popup', checked: prefs.popup, disabled: off, title: 'Aviso na tela', desc: 'Mostra um aviso rápido quando chega uma notificação com o app aberto.' })}
      </section>
      <section class="card stack" aria-labelledby="st-push"><h2 class="card-title" id="st-push" style="margin:0">${ic('smartphone')} Avisos no celular</h2>
        <p class="muted small" style="margin:0">Receba os avisos na barra de notificações do aparelho, mesmo com o app fechado. Valem as mesmas escolhas abaixo.</p>
        ${push === 'unsupported' ? html`<div class="form-note">${ic('info', { size: 16 })}<span>Este navegador não oferece notificações. No iPhone, instale o app (Compartilhar › Adicionar à Tela de Início) e abra por lá.</span></div>`
          : push === 'denied' ? html`<div class="form-note">${ic('info', { size: 16 })}<span>As notificações deste site estão bloqueadas no navegador. Libere nas configurações do site para ativar.</span></div>`
          : html`<div class="row wrap" style="gap:8px"><button type="button" class="btn ${push === 'on' ? '' : 'btn-primary'}" data-push="${push === 'on' ? 'off' : 'on'}">${ic('bell', { size: 16 })} ${push === 'on' ? 'Desativar neste aparelho' : 'Ativar neste aparelho'}</button>
            ${push === 'on' ? html`<button type="button" class="btn btn-ghost" data-push="test">Enviar teste</button>` : ''}</div>`}
      </section>
      <section class="card stack ${off ? 'is-off' : ''}" aria-labelledby="st-types"><div><h2 class="card-title" id="st-types" style="margin:0">${ic('sliders')} O que você quer receber</h2><p class="muted small" style="margin:4px 0 0">Vale para todas as suas peladas. Você não recebe aviso das suas próprias ações.</p></div>
        <div class="ntf-types">${NOTIF_TYPES.map(t => sw({ name: `type:${t.key}`, checked: prefs.types[t.key], disabled: off, title: t.label, desc: t.desc }))}</div>
      </section>
      <section class="card stack ${off ? 'is-off' : ''}" aria-labelledby="st-pel"><div><h2 class="card-title" id="st-pel" style="margin:0">${ic('soccer')} Por pelada</h2><p class="muted small" style="margin:4px 0 0">Desligue para silenciar uma pelada sem mexer nas outras.</p></div>
        ${peladas.length ? html`<ul class="ntf-peladas">${peladas.map(p => html`<li>${peladaAvatar(p, 40)}<span class="grow ellipsis"><b>${p.name}</b><span class="muted small" style="display:block">${p.role === 'owner' ? 'Você organiza' : 'Você participa'}</span></span>
          <label class="switch"><input type="checkbox" name="pel:${p.id}" ${prefs.muted.includes(p.id) ? '' : 'checked'} ${off ? 'disabled' : ''} aria-label="Receber notificações de ${p.name}"><span class="track"></span></label></li>`)}</ul>`
          : html`<div class="empty">${ic('users')}<span>Quando você criar ou entrar em uma pelada, ela aparece aqui.</span></div>`}
      </section>
      <p class="muted small" data-save-status role="status" aria-live="polite" style="margin:0;min-height:20px"></p>`);
  }
  paint();

  ctx.root.addEventListener('click', async e => {
    const b = e.target.closest('[data-push]');
    if (!b) return;
    b.disabled = true;
    try {
      if (b.dataset.push === 'on') { await enablePush(); await testPush().catch(() => {}); toast('Avisos no celular ativados.', { type: 'success' }); }
      else if (b.dataset.push === 'off') { await disablePush({ byUser: true }); toast('Avisos no celular desativados neste aparelho.'); }
      else { await testPush(); toast('Teste enviado: veja a barra de notificações.', { type: 'success' }); }
    } catch (err) { toast(err.message, { type: 'warn' }); }
    push = await pushState();
    if (ctx.isCurrent()) paint();
  });

  let saving = Promise.resolve(), stamp = 0;
  ctx.root.addEventListener('change', e => {
    const input = e.target.closest('input[type=checkbox][name]');
    if (!input || !ctx.root.querySelector('[data-settings]').contains(input)) return;
    const [kind, key] = input.name.includes(':') ? input.name.split(':') : [input.name];
    const on = input.checked;
    let patch;
    if (kind === 'type') patch = { types: { [key]: on } };
    else if (kind === 'pel') patch = { muted: on ? prefs.muted.filter(id => id !== key) : [...new Set([...prefs.muted, key])] };
    else patch = { [kind]: on };
    if (kind === 'pel') prefs.muted = patch.muted; // as próximas mudanças já partem desta
    if (kind === 'enabled') { prefs.enabled = on; paint(); $('input[name=enabled]', ctx.root)?.focus(); } // liga/desliga as outras opções na hora
    const status = $('[data-save-status]', ctx.root);
    status.textContent = 'Salvando…';
    const my = ++stamp;
    saving = saving.then(async () => {
      try {
        prefs = await savePrefs(patch);
        if (my === stamp) $('[data-save-status]', ctx.root).textContent = '✓ Preferências salvas.';
      } catch (err) {
        input.checked = !on;
        if (kind === 'pel') prefs = N.prefs || prefs;
        if (kind === 'enabled') { prefs.enabled = !on; paint(); }
        $('[data-save-status]', ctx.root).textContent = '';
        toast(err.message, { type: 'error' });
      }
    });
  });
}
