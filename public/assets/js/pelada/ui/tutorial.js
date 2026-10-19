// Tutorial do organizador: como escolher co-organizadores para ajudar na gestão da pelada.
// Aparece sozinho uma vez por aparelho (para quem organiza uma pelada ou acaba de criar uma) e pode ser reaberto pelo botão "Co-organização".
import { html, ic } from '../../ui/dom.js';
import { openDialog } from '../../ui/dialog.js';
import { gx, cap } from '../../shared/gender.js';

const SEEN_KEY = 'pelada.tutorial.coorg';
const TEST_KEY = 'pelada.tutorial.coorgTest'; // navegadores automatizados (testes) só veem o tutorial sozinho com esta chave

const read = k => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };

/** O tutorial sai sozinho só para quem ainda não viu (e nunca em navegadores automatizados, que travariam nos testes). */
export const shouldAutoShow = () => !(navigator.webdriver && !read(TEST_KEY)) && !read(SEEN_KEY);

/**
 * Abre o tutorial. `onPlayers` é chamado se a pessoa tocar em "Ver os jogadores" (leva à aba Jogadores).
 * Retorna o modal ({ el, close, closed }).
 */
export function openCoOrgTutorial({ gender, onPlayers = null } = {}) {
  const G = gx(gender);
  write(SEEN_KEY, '1');
  const d = openDialog({
    title: 'Peça ajuda na organização',
    body: html`<div class="tutorial">
      <p style="margin:0">Organizar ${G.alone} dá trabalho. Escolha pessoas de confiança da pelada para ajudar ${G.o} ${G.owner}.</p>
      <ol class="tut-steps">
        <li><span class="tut-n" aria-hidden="true">1</span><div><strong>Abra a aba Jogadores</strong><span class="muted small">Ela lista todo mundo que já entrou na pelada.</span></div></li>
        <li><span class="tut-n" aria-hidden="true">2</span><div><strong>Toque no nome da pessoa</strong><span class="muted small">Quem tem a seta ao lado do nome abre um menu com as opções.</span></div></li>
        <li><span class="tut-n" aria-hidden="true">3</span><div><strong>Escolha "Tornar ${G.coOrganizer}"</strong><span class="muted small">Pronto: a pessoa recebe um aviso e já pode ajudar.</span></div></li>
      </ol>
      <div class="tut-box">
        <p style="margin:0"><strong>${cap(G.coOrganizer)} pode:</strong> criar datas e partidas, sortear os times, escolher quem joga, marcar gols, editar a pelada e convidar a galera.</p>
        <p style="margin:0"><strong>Só ${G.o} ${G.owner} pode:</strong> excluir a pelada e escolher ou remover co-organizadores.</p>
      </div>
      <p class="hint" style="margin:0">Dá para remover a co-organização a qualquer momento, pelo mesmo menu. Para rever esta explicação, use o botão ${ic('shield-check', { size: 13 })} Co-organização.</p></div>`,
    foot: html`<button class="btn" data-close>Entendi</button>${onPlayers ? html`<button class="btn btn-primary" data-close="players">${ic('users', { size: 16 })} Ver os jogadores</button>` : ''}`,
  });
  d.closed.then(v => { if (v === 'players' && onPlayers) onPlayers(); });
  return d;
}
