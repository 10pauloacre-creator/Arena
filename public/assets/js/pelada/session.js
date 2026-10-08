// Sessão do jogador (conta simplificada). O cookie de sessão dura 1 ano e é renovado a cada abertura do app; o perfil e uma
// chave de acesso ficam salvos neste aparelho (localStorage): o app abre já "logado", mesmo antes de a rede responder ou sem
// internet, e se o navegador apagar o cookie a chave refaz a sessão sozinha, sem pedir nome e data de novo.
import { api } from '../api.js';

const KEY = 'pelada.player.v1';
const TOKEN_KEY = 'pelada.token.v1';
export const S = { player: null, config: null, ready: false, offline: false };

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const write = p => { try { if (p) localStorage.setItem(KEY, JSON.stringify({ id: p.id, name: p.name, av: p.av || 0 })); else localStorage.removeItem(KEY); } catch { /* armazenamento indisponível */ } };
const readToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
export const saveToken = t => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* armazenamento indisponível */ } };

export function setPlayer(p) { S.player = p || null; write(S.player); }

/** Entrou (cadastro/login): guarda o perfil e a chave deste aparelho e pede ao navegador para não apagar esses dados. */
export function rememberLogin(r) {
  setPlayer(r.player); saveToken(r.token);
  try { navigator.storage?.persist?.(); } catch { /* sem suporte */ }
}

/** Mostra o perfil salvo na hora e confirma com o servidor. Só desloga se o servidor disser que a conta/sessão não vale mais. */
export async function loadPlayer() {
  S.player = read();
  const cfg = api.get('/config').then(c => { S.config = c; }, () => {});
  try {
    const r = await api.get('/pelada/auth/me');
    S.offline = false;
    if (r.player) rememberLogin(r);
    else await resume();
  } catch {
    S.offline = true; // sem rede ou servidor instável: mantém o perfil salvo em vez de deslogar
  }
  await cfg;
  S.ready = true;
  return S.player;
}

/** Sem cookie de sessão: tenta refazê-la com a chave guardada neste aparelho. */
async function resume() {
  const token = readToken();
  if (!token) { setPlayer(null); return; }
  try {
    rememberLogin(await api.post('/pelada/auth/resume', { token }));
  } catch (err) {
    if (err.status === 401) { saveToken(''); setPlayer(null); } else S.offline = true; // rede/servidor: tenta de novo na próxima abertura
  }
}

export async function logout() {
  try { await (await import('./push.js')).disablePush(); } catch { /* ignora */ } // este aparelho deixa de receber os avisos desta conta
  try { await api.post('/pelada/auth/logout'); } catch { /* ignora */ }
  saveToken(''); setPlayer(null);
}

export const isOwner = pel => !!pel.viewer?.isOwner;
