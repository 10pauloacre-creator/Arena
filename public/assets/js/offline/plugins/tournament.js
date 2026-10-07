// Plugin do modo offline para o painel do organizador (ArenaMaster): repete no aparelho as ações do torneio
// (placar ao vivo, times, sorteio, configurações) e monta a visão do administrador a partir da cópia do documento.
import { unauthorized, notFound } from '../../shared/errors.js';
import { compileRoute, matchRoute } from '../../shared/route.js';
import { matchTournamentAction, labelOf, runTournamentAction, rememberOp, hasOp } from '../../shared/domain/tournament-actions.js';
import { adminView } from '../../shared/domain/views.js';
import { expireReservations } from '../../shared/domain/teams.js';
import { expirePayments } from '../../shared/domain/payments.js';

const VIEW = compileRoute('/tournaments/:id');
const resourceOf = id => `tour:${id}`;
const readPathOf = id => `/tournaments/${encodeURIComponent(id)}`;

const viewOf = (draft, env) => adminView(draft.doc, env.now, { users: draft.users, me: env.me });

export default {
  id: 'tournament',

  match(method, path) {
    if (method === 'GET') {
      const p = matchRoute(VIEW, path);
      return p ? { resource: resourceOf(p.id), readPath: readPathOf(p.id) } : null;
    }
    const m = matchTournamentAction(method, path);
    return m ? { resource: resourceOf(m.params.id), readPath: readPathOf(m.params.id) } : null;
  },

  canQueue(method, path, body) {
    const m = matchTournamentAction(method, path);
    return !!m && (!m.action.queueable || m.action.queueable(body));
  },
  label(method, path, body) { const m = matchTournamentAction(method, path); return m ? labelOf(m.action, body) : 'Alteração'; },

  replicaFrom(data) {
    const r = data?.replica;
    if (!r?.doc) return null;
    return { doc: r.doc, users: r.users || {}, version: r.doc.version, now: data.tournament?.serverNow };
  },
  hasOp: (x, opId) => hasOp(x.doc, opId),
  draft: rep => structuredClone({ doc: rep.doc, users: rep.users }),

  apply(draft, op, env) {
    const m = matchTournamentAction(op.method, op.path);
    if (!m) throw notFound('Ação não encontrada.');
    if (!env.me) throw unauthorized();
    const t = draft.doc;
    expireReservations(t, op.at); expirePayments(t, op.at); // o servidor faz o mesmo antes de cada ação
    const extra = runTournamentAction(t, m.action, { params: m.params, body: op.body, now: op.at, me: { id: env.me.id }, effects: [] }, op.id);
    rememberOp(t, op.id);
    t.version++; t.updatedAt = op.at;
    return extra;
  },

  readResponse(path, draft, env) {
    if (!matchRoute(VIEW, path)) return null;
    const tournament = viewOf(draft, env);
    return { data: { tournament }, basis: { ...tournament, serverNow: 0 } };
  },
  writeResponse(draft, op, extra, env) {
    return { tournament: viewOf(draft, env), ...(extra && typeof extra === 'object' ? extra : {}) };
  },
};
