import { Store } from './base.js';

export class MemoryStore extends Store {
  constructor() { super(); this.map = new Map(); }
  describe() { return { kind: 'memory', persistent: false }; }
  _live(key) {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.exp && e.exp <= Date.now()) { this.map.delete(key); return null; }
    return e;
  }
  async get(key) { const e = this._live(key); return e ? structuredClone(e.v) : null; }
  async set(key, value, { ttlMs } = {}) { this.map.set(key, { v: structuredClone(value), exp: ttlMs ? Date.now() + ttlMs : 0 }); }
  async del(key) { this.map.delete(key); }
  async setNX(key, value, ttlMs) {
    if (this._live(key)) return false;
    await this.set(key, value, { ttlMs });
    return true;
  }
  async keys(prefix = '') { return [...this.map.keys()].filter(k => k.startsWith(prefix) && this._live(k)); }
}
