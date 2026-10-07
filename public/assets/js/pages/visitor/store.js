// Guarda no aparelho o time inscrito (id + código do capitão) para retomar pagamento e consultar status.
const key = tid => `am_team_${tid}`;
export function getMyTeam(tid) {
  try { const v = JSON.parse(localStorage.getItem(key(tid)) || 'null'); return v && v.teamId && v.code ? v : null; } catch { return null; }
}
export function saveMyTeam(tid, teamId, code) { try { localStorage.setItem(key(tid), JSON.stringify({ teamId, code })); } catch { /* ignora */ } }
export function clearMyTeam(tid) { try { localStorage.removeItem(key(tid)); } catch { /* ignora */ } }
