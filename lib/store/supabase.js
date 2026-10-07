import { Store } from './base.js';

/**
 * Armazenamento no Supabase (Postgres) pela API REST (PostgREST), tabela `arena_kv` (veja supabase/arena_kv.sql).
 * Usa a chave de servidor (service role / secret key): ela nunca vai para o navegador.
 */
export class SupabaseStore extends Store {
  constructor({ url, key, table = 'arena_kv', fetchImpl = globalThis.fetch }) {
    super();
    this.base = `${url.replace(/\/+$/, '')}/rest/v1/${table}`;
    this.fetch = fetchImpl;
    // chaves novas (sb_secret_…) vão só em `apikey`; as antigas (JWT) também em Authorization
    this.headers = { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (key.startsWith('eyJ')) this.headers.Authorization = `Bearer ${key}`;
  }
  describe() { return { kind: 'supabase', persistent: true }; }

  async req(method, query, { body, prefer } = {}) {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await this.fetch(`${this.base}?${query}`, {
          method, headers: prefer ? { ...this.headers, Prefer: prefer } : this.headers, body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) {
          let info = {}; try { info = JSON.parse(text); } catch { /* resposta sem JSON */ }
          const missing = info.code === 'PGRST205' || info.code === '42P01';
          const err = new Error(missing
            ? 'Supabase: a tabela "arena_kv" não existe. Rode o arquivo supabase/arena_kv.sql no SQL Editor do projeto.'
            : `Supabase REST ${res.status}: ${info.message || text.slice(0, 120) || 'erro'}`);
          if (missing || res.status === 401 || res.status === 403) err.fatal = true;
          throw err;
        }
        return text ? JSON.parse(text) : null;
      } catch (err) {
        lastErr = err;
        if (err.fatal) throw err;
        await new Promise(r => setTimeout(r, 80 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  async get(key) {
    const rows = await this.req('GET', `key=eq.${encodeURIComponent(key)}&select=value,expires_at`);
    const row = rows?.[0];
    if (!row) return null;
    if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return null;
    return row.value;
  }
  async set(key, value, { ttlMs } = {}) {
    await this.req('POST', 'on_conflict=key', {
      body: { key, value, expires_at: ttlMs ? new Date(Date.now() + Math.ceil(ttlMs)).toISOString() : null },
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }
  async del(key) { await this.req('DELETE', `key=eq.${encodeURIComponent(key)}`, { prefer: 'return=minimal' }); }
  async setNX(key, value, ttlMs) {
    const k = encodeURIComponent(key);
    // libera a chave se já expirou; depois INSERT ... ON CONFLICT DO NOTHING (atômico) diz quem ganhou
    await this.req('DELETE', `key=eq.${k}&expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, { prefer: 'return=minimal' });
    const rows = await this.req('POST', 'on_conflict=key', {
      body: { key, value, expires_at: ttlMs ? new Date(Date.now() + Math.ceil(ttlMs)).toISOString() : null },
      prefer: 'resolution=ignore-duplicates,return=representation',
    });
    return Array.isArray(rows) && rows.length === 1;
  }
}
