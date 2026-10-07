// Cliente da API REST (cookies de sessão; JSON) com o modo offline: leituras guardadas no aparelho e, nos documentos
// que sabem funcionar sem internet (pelada, torneio do organizador, inscrição gratuita), escritas que entram numa fila
// e são enviadas sozinhas quando a conexão volta (ver offline/engine.js).
import { getEngine } from './offline/index.js';
import { NetworkError } from './offline/engine.js';

export class ApiError extends Error {
  constructor(status, message, code, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

/** Uma chamada HTTP "crua": devolve { status, data, headers } para qualquer status; lança NetworkError se a rede falhar. */
async function transport(method, path, body, opts = {}) {
  const headers = { Accept: 'application/json', ...(opts.headers || {}) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let signal = opts.signal;
  if (opts.timeoutMs && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    const t = AbortSignal.timeout(opts.timeoutMs);
    signal = signal && AbortSignal.any ? AbortSignal.any([signal, t]) : (signal || t);
  }
  let res;
  try {
    res = await fetch('/api' + path, { method, headers, credentials: 'same-origin', body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store', signal });
  } catch (err) {
    if (err.name === 'AbortError' && opts.signal?.aborted) throw err; // o chamador cancelou (saiu da tela)
    throw new NetworkError(); // sem rede ou tempo esgotado
  }
  let data = null;
  if (res.status !== 304) { try { data = await res.json(); } catch { /* corpo vazio */ } }
  return { status: res.status, data, headers: res.headers, res };
}

async function request(method, path, body, opts = {}) {
  const engine = getEngine(transport);
  let r;
  try {
    r = engine ? await engine.request(method, path, body, opts) : await transport(method, path, body, opts);
  } catch (err) {
    if (err instanceof NetworkError) {
      throw new ApiError(0, method === 'GET'
        ? 'Sem conexão com o servidor. Verifique sua internet e tente de novo.'
        : 'Sem internet. Esta ação precisa de conexão: tente de novo quando a internet voltar.', 'NETWORK');
    }
    throw err;
  }
  const res = r.res || { status: r.status, ok: r.status >= 200 && r.status < 300, headers: r.headers };
  if (r.status === 304) return { notModified: true, res };
  if (r.status < 200 || r.status >= 300) {
    const e = r.data?.error || {};
    throw new ApiError(r.status, e.message || 'Algo deu errado. Tente novamente.', e.code, e.details);
  }
  if (opts.withResponse) return { data: r.data, res };
  return r.data;
}

export const api = {
  get: (p, o) => request('GET', p, undefined, o),
  post: (p, b = {}, o) => request('POST', p, b, o),
  patch: (p, b = {}, o) => request('PATCH', p, b, o),
  put: (p, b = {}, o) => request('PUT', p, b, o),
  del: (p, b, o) => request('DELETE', p, b, o),
  request,
};

/** Motor offline (null fora do navegador) — usado pelas telas para mostrar o estado e prever o que será enviado. */
export const offlineEngine = () => getEngine(transport);

/** Lê o torneio público com ETag manual (304 = nada mudou) e devolve também o relógio do servidor. */
export async function fetchPublicTournament(id, etag, signal) {
  const r = await request('GET', `/public/${encodeURIComponent(id)}`, undefined, { headers: etag ? { 'If-None-Match': etag } : {}, withResponse: true, signal });
  const res = r.res;
  const serverDate = Date.parse(res.headers.get('date') || '');
  const offset = isNaN(serverDate) ? 0 : serverDate - Date.now();
  if (res.status === 304) return { notModified: true, offset };
  return { tournament: r.data.tournament, etag: res.headers.get('etag'), offset };
}
