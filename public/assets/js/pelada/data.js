// Leitura da pelada com ETag (304 = nada mudou) e relógio do servidor.
import { api } from '../api.js';

/** Retorna { notModified } ou { pelada, etag, offset } (offset = relógio do servidor − relógio local, em ms). */
export async function fetchPelada(id, { etag, signal } = {}) {
  const r = await api.request('GET', `/pelada/peladas/${encodeURIComponent(id)}`, undefined, { headers: etag ? { 'If-None-Match': etag } : {}, withResponse: true, signal });
  if (r.notModified) return { notModified: true };
  return { pelada: r.data.pelada, etag: r.res.headers.get('etag'), offset: (r.data.now || Date.now()) - Date.now() };
}

export const dayStatus = (d, today) => d.isToday ? 'hoje' : d.isPast ? 'encerrado' : 'proximo';
