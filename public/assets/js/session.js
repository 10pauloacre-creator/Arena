import { api, offlineEngine } from './api.js';
import { confirmDialog } from './ui/dialog.js';
import { toast } from './ui/toast.js';

export const session = { user: null, config: null, ready: false, offline: false };

// O perfil do organizador também fica salvo neste aparelho: sem internet o painel abre já "logado"
// (a sessão em si continua valendo no servidor; ele só é conferido quando a internet volta).
const KEY = 'arena.user.v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const write = u => { try { if (u) localStorage.setItem(KEY, JSON.stringify({ id: u.id, name: u.name, email: u.email })); else localStorage.removeItem(KEY); } catch { /* armazenamento indisponível */ } };

export async function loadSession() {
  session.user = read();
  offlineEngine()?.setUser(session.user);
  const [me, cfg] = await Promise.allSettled([api.get('/auth/me'), api.get('/config')]);
  if (me.status === 'fulfilled') { session.user = me.value.user; session.offline = false; }
  else if (me.reason?.status === 0) session.offline = true; // sem rede: mantém o perfil salvo
  else session.user = null;
  write(session.user);
  offlineEngine()?.setUser(session.user);
  session.config = cfg.status === 'fulfilled' ? cfg.value : { payments: { mock: true, methods: ['pix', 'card'] }, storage: { persistent: true } };
  session.ready = true;
  return session;
}
export const setUser = u => { session.user = u; write(u); offlineEngine()?.setUser(u); };
export const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

/** Sai da conta. Retorna false se a pessoa desistiu ou se está sem internet (o servidor precisa encerrar a sessão). */
export async function logout() {
  const engine = offlineEngine();
  const pending = engine?.status().pending || 0;
  if (pending && !(await confirmDialog({ title: 'Sair mesmo assim?', text: `Há ${pending === 1 ? '1 alteração feita' : `${pending} alterações feitas`} sem internet que ainda não ${pending === 1 ? 'foi enviada' : 'foram enviadas'}. Se você sair agora, ${pending === 1 ? 'ela será perdida' : 'elas serão perdidas'}.`, ok: 'Sair e perder', cancel: 'Continuar logado', danger: true }))) return false;
  try { await api.post('/auth/logout'); }
  catch (err) {
    if (err.status === 0) { toast('Sem internet: para sair da conta é preciso estar conectado.', { type: 'warn' }); return false; }
  }
  await engine?.purgeUser();
  setUser(null);
  return true;
}
