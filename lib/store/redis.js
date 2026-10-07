import { Store } from './base.js';

/**
 * Cliente mínimo para a API REST do Upstash Redis / Vercel KV.
 * Cada comando é um POST com o array de argumentos: ["SET", "k", "v", "NX", "PX", 1000].
 */
export class RedisStore extends Store {
  constructor({ url, token, fetchImpl = globalThis.fetch }) {
    super();
    this.url = url.replace(/\/+$/, '');
    this.token = token;
    this.fetch = fetchImpl;
  }
  describe() { return { kind: 'redis', persistent: true }; }

  async cmd(args) {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await this.fetch(this.url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(`Redis REST ${res.status}: ${data.error || 'erro'}`);
        return data.result;
      } catch (err) {
        lastErr = err;
        await new Promise(r => setTimeout(r, 80 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  async get(key) {
    const raw = await this.cmd(['GET', key]);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  }
  async set(key, value, { ttlMs } = {}) {
    const args = ['SET', key, JSON.stringify(value)];
    if (ttlMs) args.push('PX', Math.ceil(ttlMs));
    await this.cmd(args);
  }
  async del(key) { await this.cmd(['DEL', key]); }
  async setNX(key, value, ttlMs) {
    const args = ['SET', key, JSON.stringify(value), 'NX'];
    if (ttlMs) args.push('PX', Math.ceil(ttlMs));
    return (await this.cmd(args)) === 'OK';
  }
}
