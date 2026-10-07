// Sessão do jogador (conta simplificada). O cookie de sessão dura 1 ano; o perfil também fica salvo neste aparelho
// (localStorage) para o app abrir já "logado", mesmo antes de a rede responder ou sem internet.
import { api, offlineEngine } from '../api.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';

const KEY = 'pelada.player.v1';
export const S = { player: null, config: null, ready: false, offline: false };

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const write = p => { try { if (p) localStorage.setItem(KEY, JSON.stringify({ id: p.id, name: p.name, av: p.av || 0 })); else localStorage.removeItem(KEY); } catch { /* armazenamento indisponível */ } };

export function setPlayer(p) { S.player = p || null; write(S.player); offlineEngine()?.setUser(S.player); }

/** Mostra o perfil salvo na hora e confirma com o servidor (sessão expirada → desloga). */
export async function loadPlayer() {
  S.player = read();
  offlineEngine()?.setUser(S.player); // a fila e as cópias offline são desta conta
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

/** Sai da conta. Retorna false se a pessoa desistiu ou se está sem internet (o servidor precisa encerrar a sessão). */
export async function logout() {
  const engine = offlineEngine();
  const pending = engine?.status().pending || 0;
  if (pending && !(await confirmDialog({ title: 'Sair mesmo assim?', text: `Há ${pending === 1 ? '1 alteração feita' : `${pending} alterações feitas`} sem internet que ainda não ${pending === 1 ? 'foi enviada' : 'foram enviadas'}. Se você sair agora, ${pending === 1 ? 'ela será perdida' : 'elas serão perdidas'}.`, ok: 'Sair e perder', cancel: 'Continuar logado', danger: true }))) return false;
  try { await api.post('/pelada/auth/logout'); }
  catch (err) {
    if (err.status === 0) { toast('Sem internet: para sair da conta é preciso estar conectado.', { type: 'warn' }); return false; }
  }
  await engine?.purgeUser();
  setPlayer(null);
  return true;
}

export const isOwner = pel => !!pel.viewer?.isOwner;
