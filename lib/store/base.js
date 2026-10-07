// Interface de armazenamento chave→JSON usada por toda a aplicação.
//   get(key) · set(key, value, { ttlMs }) · del(key) · setNX(key, value, ttlMs) · describe()
// Implementações: MemoryStore (testes), FileStore (dev/local), RedisStore (Upstash/Vercel KV via REST).

import { randomBytes } from 'node:crypto';

export class Store {
  /** Adquire um lock por chave. Retorna uma função `release`. Lança erro se não conseguir. */
  async lock(key, { ttlMs = 10_000, waitMs = 8_000 } = {}) {
    const token = randomBytes(8).toString('hex');
    const lockKey = 'lock:' + key;
    const deadline = Date.now() + waitMs;
    let delay = 15;
    for (;;) {
      if (await this.setNX(lockKey, token, ttlMs)) {
        return async () => {
          try { if ((await this.get(lockKey)) === token) await this.del(lockKey); } catch { /* lock expira sozinho */ }
        };
      }
      if (Date.now() > deadline) throw new Error('LOCK_TIMEOUT');
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 1.6, 200);
    }
  }
}
