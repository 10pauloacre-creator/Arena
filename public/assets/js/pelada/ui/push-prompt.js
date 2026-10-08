// Convite para ativar os avisos no celular: aparece logo no primeiro acesso (e, para quem já usava, no próximo), sem precisar
// abrir as configurações. O navegador só libera o pedido de permissão depois de um toque, por isso o pedido sai do botão do modal.
// "Agora não" volta a perguntar só depois de alguns dias; permissão bloqueada no navegador nunca é perguntada de novo.
import { html, ic } from '../../ui/dom.js';
import { openDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { pushSupported, enablePush, testPush } from '../push.js';
import { isIOS, isStandalone } from '../pwa.js';

const ASKED_KEY = 'pelada.pushAsk';
const TEST_KEY = 'pelada.pushAskTest'; // navegadores automatizados (testes) só veem o convite com esta chave
const WAIT_MS = 7 * 86_400_000;

const read = k => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };

/** Espera a tela ficar livre de outros modais (ex.: o convite da pelada recém-criada) antes de perguntar. */
async function whenFree() {
  for (let i = 0; i < 20; i++) {
    if (!document.hidden && !document.querySelector('dialog[open]')) return true;
    await new Promise(r => setTimeout(r, 700));
  }
  return false;
}

export async function maybeAskPush() {
  try {
    if (navigator.webdriver && !read(TEST_KEY)) return;
    const last = Number(read(ASKED_KEY) || 0);
    if (last && Date.now() - last < WAIT_MS) return;
    const needsInstall = isIOS() && !isStandalone() && !pushSupported(); // iPhone no Safari: o push só existe no app instalado
    if (!needsInstall && !(pushSupported() && Notification.permission === 'default')) return;
    await new Promise(r => setTimeout(r, 1200));
    if (!(await whenFree())) return;
    write(ASKED_KEY, String(Date.now()));
    needsInstall ? askInstall() : askPermission();
  } catch { /* o convite nunca atrapalha o app */ }
}

const benefits = html`<ul class="push-benefits">
  <li>${ic('shuffle', { size: 16 })} Saiba na hora em qual time você ficou</li>
  <li>${ic('radio', { size: 16 })} Aviso quando a bola rolar e o resultado de cada partida</li>
  <li>${ic('calendar', { size: 16 })} Lembrete do jogo do dia, mesmo com o app fechado</li></ul>`;

function askPermission() {
  const dlg = openDialog({
    title: 'Receber os avisos da pelada?',
    body: html`<div class="push-ask"><span class="push-ico" aria-hidden="true">${ic('bell', { size: 30 })}</span>
      <p style="margin:0">Ative as notificações para não perder nada. Elas aparecem na barra do celular, mesmo com o app fechado.</p>${benefits}
      <p class="hint" style="margin:0">Você pode mudar isso quando quiser em Configurações.</p></div>`,
    foot: html`<button class="btn" data-close="later">Agora não</button><button class="btn btn-primary" data-push-yes>${ic('bell', { size: 16 })} Ativar avisos</button>`,
  });
  const yes = dlg.el.querySelector('[data-push-yes]');
  yes.addEventListener('click', async () => {
    yes.disabled = true;
    try {
      await enablePush(); // o pedido de permissão sai deste toque
      testPush().catch(() => {});
      dlg.close('ok');
      toast('Avisos ativados! Você vai receber as novidades na barra de notificações.', { type: 'success' });
    } catch (err) {
      dlg.close('error');
      toast(err.message, { type: 'warn', ms: 6000 });
    }
  });
}

function askInstall() {
  openDialog({
    title: 'Receba os avisos no iPhone',
    body: html`<div class="push-ask"><span class="push-ico" aria-hidden="true">${ic('smartphone', { size: 30 })}</span>
      <p style="margin:0">No iPhone, os avisos funcionam no app instalado. Toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>; abra a Pelada por lá e ative os avisos.</p>${benefits}</div>`,
    foot: html`<button class="btn btn-primary" data-close>Entendi</button>`,
  });
}
