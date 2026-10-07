import { api } from './api.js';

export const session = { user: null, config: null, ready: false };

export async function loadSession() {
  const [me, cfg] = await Promise.allSettled([api.get('/auth/me'), api.get('/config')]);
  session.user = me.status === 'fulfilled' ? me.value.user : null;
  session.config = cfg.status === 'fulfilled' ? cfg.value : { payments: { mock: true, methods: ['pix', 'card'] }, storage: { persistent: true } };
  session.ready = true;
  return session;
}
export const setUser = u => { session.user = u; };
export const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

export async function logout() {
  try { await api.post('/auth/logout'); } catch { /* ignora */ }
  session.user = null;
}
