// Plugin do modo offline para o app Pelada: aplica no aparelho as mesmas ações que o servidor (shared/domain/pelada-actions.js)
// e monta a mesma visão (shared/domain/pelada-views.js) a partir da cópia do documento.
import { unauthorized, notFound } from '../../shared/errors.js';
import { compileRoute, matchRoute } from '../../shared/route.js';
import { normalizePeladaId } from '../../shared/pelada.js';
import { matchPeladaAction, labelOf, runPeladaAction, rememberOp, hasOp } from '../../shared/domain/pelada-actions.js';
import { peladaView } from '../../shared/domain/pelada-views.js';
import { referencedUserIds } from '../../shared/domain/pelada-views.js';

const VIEW = compileRoute('/pelada/peladas/:id');
const resourceOf = id => `pelada:${normalizePeladaId(id)}`;
const readPathOf = id => `/pelada/peladas/${encodeURIComponent(normalizePeladaId(id))}`;

function viewOf(draft, env) {
  const refs = new Set(referencedUserIds(draft.doc));
  const users = new Map(Object.entries(draft.users).filter(([id]) => refs.has(id)));
  const me = env.me;
  const viewer = me ? { id: me.id, name: draft.users[me.id]?.name || me.name, av: draft.users[me.id]?.av ?? me.av ?? 0 } : null;
  return peladaView(draft.doc, { users, viewer, now: env.now, base: env.base });
}

export default {
  id: 'pelada',

  match(method, path) {
    if (method === 'GET') {
      const p = matchRoute(VIEW, path);
      return p ? { resource: resourceOf(p.id), readPath: readPathOf(p.id) } : null;
    }
    const m = matchPeladaAction(method, path);
    return m ? { resource: resourceOf(m.params.id), readPath: readPathOf(m.params.id) } : null;
  },

  canQueue(method, path, body) {
    const m = matchPeladaAction(method, path);
    return !!m && (!m.action.queueable || m.action.queueable(body));
  },
  label(method, path, body) { const m = matchPeladaAction(method, path); return m ? labelOf(m.action, body) : 'Alteração'; },

  /** { doc, users, version, now } a partir de uma resposta do servidor (ou null se ela não trouxe a cópia). */
  replicaFrom(data) {
    const r = data?.replica;
    if (!r?.doc) return null;
    return { doc: r.doc, users: r.users || {}, version: r.doc.version, now: data.now };
  },
  hasOp: (x, opId) => hasOp(x.doc, opId),
  draft: rep => structuredClone({ doc: rep.doc, users: rep.users }),

  /** Aplica a operação no rascunho (muda `draft`). Lança HttpError como o servidor faria. */
  apply(draft, op, env) {
    const m = matchPeladaAction(op.method, op.path);
    if (!m) throw notFound('Ação não encontrada.');
    const me = env.me;
    if (!me) throw unauthorized('Crie sua conta ou entre para continuar.');
    const { doc, users } = draft;
    if (!users[me.id]) users[me.id] = { name: me.name, av: me.av || 0 };
    const nameOf = pid => pid.startsWith('g:') ? (doc.guests.find(g => `g:${g.id}` === pid)?.name || '') : (users[pid.slice(2)]?.name || '');
    const extra = runPeladaAction(doc, m.action, { params: m.params, body: op.body, now: op.at, me: { id: me.id, name: me.name }, nameOf }, op.id);
    rememberOp(doc, op.id);
    doc.version++; doc.updatedAt = op.at;
    return extra;
  },

  /** Resposta de GET /pelada/peladas/:id. `basis` é o que identifica a versão (etag). */
  readResponse(path, draft, env) {
    if (!matchRoute(VIEW, path)) return null;
    const view = viewOf(draft, env);
    return { data: { pelada: view, now: env.now }, basis: view };
  },
  writeResponse(draft, op, extra, env) {
    return { pelada: viewOf(draft, env), now: env.now, ...(extra && typeof extra === 'object' ? extra : {}) };
  },
};
