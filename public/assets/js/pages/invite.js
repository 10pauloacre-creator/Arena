import { html, render, ic, $, setBusy } from '../ui/dom.js';
import { brandMark } from '../ui/brand.js';
import { api } from '../api.js';
import { session } from '../session.js';
import { navigate } from '../router.js';
import { toast } from '../ui/toast.js';

export default async function (ctx) {
  document.title = 'Convite · ArenaMaster AI';
  const code = ctx.params.code;
  render(ctx.root, html`<div class="auth"><main class="auth-main" style="grid-column:1/-1"><div class="auth-card"><div class="page-loading"><div class="spinner"></div></div></div></main></div>`);
  let info;
  try { info = await api.get(`/invites/${encodeURIComponent(code)}`); } catch (err) { info = { valid: false, reason: err.message }; }
  if (!ctx.isCurrent()) return;
  const next = '/convite/' + code;
  const card = info.valid
    ? html`<div class="center" style="display:grid;gap:10px;justify-items:center"><span class="avatar" style="background:var(--blue);width:56px;height:56px">${ic('users', { size: 26 })}</span>
        <h1 style="font-size:24px">Convite para administrar</h1>
        <p><b>${info.inviter}</b> convidou você para administrar o torneio</p>
        <div class="card" style="padding:12px 18px"><b>${info.tournament.name}</b><br><span class="muted small">#${info.tournament.id}</span></div>
        <p class="muted small">Como administrador, você poderá gerenciar inscrições, jogos e chaveamento.</p></div>
      ${session.user
        ? html`<button class="btn btn-primary btn-lg btn-block" id="accept">${ic('check', { size: 18 })} Aceitar convite</button><p class="center muted small">Logado como ${session.user.email}</p>`
        : html`<a class="btn btn-primary btn-lg btn-block" href="/cadastro?next=${encodeURIComponent(next)}">Criar conta e aceitar</a><a class="btn btn-block" href="/entrar?next=${encodeURIComponent(next)}">Já tenho conta</a>`}`
    : html`<div class="empty">${ic('circle-alert', { size: 30 })}<strong>Convite indisponível</strong><span>${info.reason}</span><a class="btn btn-primary" href="/">Ir para o início</a></div>`;
  render(ctx.root, html`<div class="auth"><main class="auth-main" style="grid-column:1/-1"><div class="auth-card"><a class="brand" href="/" style="color:var(--ink);justify-self:center">${brandMark(36)}<span><span class="brand-name" style="font-size:18px">Arena<b style="color:var(--blue)">Master</b> AI</span></span></a>${card}</div></main></div>`);
  const btn = $('#accept', ctx.root);
  if (btn) btn.addEventListener('click', async () => {
    setBusy(btn, true);
    try {
      const r = await api.post(`/invites/${encodeURIComponent(code)}/accept`);
      toast('Convite aceito! Você agora administra este torneio.', { type: 'success' });
      navigate('/admin/' + r.tournamentId, { replace: true });
    } catch (err) { setBusy(btn, false); toast(err.message, { type: 'error' }); }
  });
}
