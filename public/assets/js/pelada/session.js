// Sessão do jogador (conta simplificada). O cookie de sessão dura 1 ano; o perfil também fica salvo neste aparelho
// (localStorage) para o app abrir já "logado", mesmo antes de a rede responder ou sem internet.
import { api } from '../api.js';

const KEY = 'pelada.player.v1';
export const S = { player: null, config: null, ready: false, offline: false };

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const write = p => { try { if (p) localStorage.setItem(KEY, JSON.stringify({ id: p.id, name: p.name, av: p.av || 0 })); else localStorage.removeItem(KEY); } catch { /* armazenamento indisponível */ } };

export function setPlayer(p) { S.player = p || null; write(S.player); }

/** Mostra o perfil salvo na hora e confirma com o servidor (sessão expirada → desloga). */
export async function loadPlayer() {
  S.player = read();
  const cfg = api.get('/config').then(c => { S.config = c; }, () => {});
  try {
    const r = await api.get('/pelada/auth/me');
    S.offline = false;
    setPlayer(r.player);
  } catch (err) {
    if (err.status === 0) S.offline = true; // sem rede: mantém o perfil salvo
    else setPlayer(null);
  }
  await cfg;
  S.ready = true;
  return S.player;
}

export async function logout() {
  try { await api.post('/pelada/auth/logout'); } catch { /* ignora */ }
  setPlayer(null);
}

export const isOwner = pel => !!pel.viewer?.isOwner;
