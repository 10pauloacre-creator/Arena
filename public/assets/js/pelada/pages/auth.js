// Tela de autenticação rápida (conta simplificada) em página inteira.
import { html, render, ic } from '../../ui/dom.js';
import { S } from '../session.js';
import { navigate } from '../../router.js';
import { brand, wireShell } from '../ui/shell.js';
import { mountAuth } from '../ui/auth.js';

const safeNext = n => (typeof n === 'string' && n.startsWith('/pelada') && !n.startsWith('//')) ? n : '/pelada/painel';

export default function (ctx) {
  const next = safeNext(ctx.query.next);
  if (S.player) return navigate(next, { replace: true });
  document.title = 'Criar conta ou entrar · Pelada';
  render(ctx.root, html`<div class="pl-auth">
    <aside class="pl-auth-side"><div>${brand()}</div>
      <div><h2>Conta ultra-rápida.</h2><p>Só o seu nome e a data de nascimento. Depois disso você cria peladas, participa das dos amigos e nunca mais precisa entrar de novo neste aparelho.</p>
        <ul class="ticks"><li>${ic('check', { size: 18 })} Sem e-mail, sem confirmação</li><li>${ic('check', { size: 18 })} Foto de perfil com recorte</li><li>${ic('check', { size: 18 })} Crie ou entre em peladas com um toque</li></ul></div>
      <span class="small" style="opacity:.7">© Pelada · ArenaMaster</span></aside>
    <main class="pl-auth-main" id="main"><div class="auth-card">
      <div><h1>Entrar na Pelada</h1><p class="muted">Crie sua conta agora ou entre com a que você já tem.</p></div>
      <div class="stack" data-auth-root></div>
      <p class="center small"><a href="/pelada/?inicio=1">← Voltar ao início</a></p>
    </div></main></div>`);
  wireShell(ctx.root, ctx.signal);
  mountAuth(ctx.root.querySelector('[data-auth-root]'), { mode: ctx.query.modo === 'login' ? 'login' : 'signup', onDone: () => navigate(next, { replace: true }) });
}
