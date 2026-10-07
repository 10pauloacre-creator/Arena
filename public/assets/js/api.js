// Cliente da API REST (cookies de sessão; JSON).

export class ApiError extends Error {
  constructor(status, message, code, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

async function request(method, path, body, opts = {}) {
  const headers = { Accept: 'application/json', ...(opts.headers || {}) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch('/api' + path, { method, headers, credentials: 'same-origin', body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store', signal: opts.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'Sem conexão com o servidor. Verifique sua internet e tente de novo.', 'NETWORK');
  }
  if (res.status === 304) return { notModified: true, res };
  let data = null;
  try { data = await res.json(); } catch { /* corpo vazio */ }
  if (!res.ok) {
    const e = data?.error || {};
    throw new ApiError(res.status, e.message || 'Algo deu errado. Tente novamente.', e.code, e.details);
  }
  if (opts.withResponse) return { data, res };
  return data;
}

export const api = {
  get: (p, o) => request('GET', p, undefined, o),
  post: (p, b = {}, o) => request('POST', p, b, o),
  patch: (p, b = {}, o) => request('PATCH', p, b, o),
  put: (p, b = {}, o) => request('PUT', p, b, o),
  del: (p, b, o) => request('DELETE', p, b, o),
  request,
};

/** Lê o torneio público com ETag manual (304 = nada mudou) e devolve também o relógio do servidor. */
export async function fetchPublicTournament(id, etag, signal) {
  const r = await request('GET', `/public/${encodeURIComponent(id)}`, undefined, { headers: etag ? { 'If-None-Match': etag } : {}, withResponse: true, signal });
  const res = r.res;
  const serverDate = Date.parse(res.headers.get('date') || '');
  const offset = isNaN(serverDate) ? 0 : serverDate - Date.now();
  if (res.status === 304) return { notModified: true, offset };
  return { tournament: r.data.tournament, etag: res.headers.get('etag'), offset };
}
