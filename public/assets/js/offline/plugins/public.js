// Plugin do modo offline para o visitante: a inscrição GRATUITA de um time feita sem internet fica guardada no aparelho
// e é enviada sozinha quando a conexão volta (o servidor ignora o reenvio da mesma operação).
// Torneios com taxa não entram aqui: o pagamento precisa de internet (a vaga só é reservada ao concluir).
import { compileRoute, matchRoute } from '../../shared/route.js';
import { normalizeTournamentId } from '../../shared/format.js';

const REG = compileRoute('/public/:id/teams');

/** Torneio público guardado no aparelho (qualquer caminho de cache que o tenha). */
async function cachedTournament(engine, id) {
  const want = normalizeTournamentId(id);
  for (const e of await engine.storage.all('cache')) {
    if (!e.key.startsWith(engine.uid + '|/public/')) continue;
    const t = e.value?.data?.tournament;
    if (t && normalizeTournamentId(t.id) === want) return t;
  }
  return null;
}

export default {
  id: 'public',
  blind: true, // não há cópia local para prever o resultado: só guarda e envia depois

  match(method, path) {
    if (method !== 'POST') return null;
    const p = matchRoute(REG, path);
    return p ? { resource: `public:${normalizeTournamentId(p.id)}`, readPath: `/public/${encodeURIComponent(p.id)}` } : null;
  },
  async canQueue(method, path, body, engine) {
    const p = matchRoute(REG, path);
    const t = p && await cachedTournament(engine, p.id);
    return !!t && t.fee === 0 && t.registration?.open === true;
  },
  label: (method, path, body) => `Inscrição do time "${String(body?.name || '').slice(0, 32)}"`,
  queuedResponse: () => ({ team: null }),

  /** Chamado quando a inscrição guardada é aceita pelo servidor. */
  async onSynced(op, res) {
    const team = res.data?.team;
    const tid = normalizeTournamentId(matchRoute(REG, op.path)?.id || '');
    if (!team || !tid) return;
    const { saveMyTeam } = await import('../../pages/visitor/store.js');
    saveMyTeam(tid, team.id, team.accessCode);
    const { toast } = await import('../../ui/toast.js');
    toast(`Inscrição do time "${team.name}" enviada! Seu código do capitão: ${team.accessCode}`, { type: 'success', ms: 9000 });
  },
};
