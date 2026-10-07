import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { MemoryStore } from './memory.js';

/** Armazenamento em um único arquivo JSON (escrita atômica). Bom para desenvolvimento local e testes manuais. */
export class FileStore extends MemoryStore {
  constructor(file, { persistent = true } = {}) {
    super();
    this.file = file;
    this.persistent = persistent;
    this._chain = Promise.resolve();
    this._load();
  }
  describe() { return { kind: 'file', persistent: this.persistent, file: this.file }; }
  _load() {
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8'));
        for (const [k, e] of Object.entries(raw)) this.map.set(k, e);
      }
    } catch (err) {
      console.error('[store] não foi possível ler', this.file, err.message);
    }
  }
  _flush() {
    const snapshot = {};
    const now = Date.now();
    for (const [k, e] of this.map) {
      if (k.startsWith('lock:')) continue;
      if (e.exp && e.exp <= now) continue;
      snapshot[k] = e;
    }
    this._chain = this._chain.then(() => {
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        const tmp = this.file + '.tmp';
        writeFileSync(tmp, JSON.stringify(snapshot));
        renameSync(tmp, this.file);
      } catch (err) { console.error('[store] falha ao gravar', err.message); }
    });
    return this._chain;
  }
  async set(key, value, opts) { await super.set(key, value, opts); if (!key.startsWith('lock:')) await this._flush(); }
  async del(key) { await super.del(key); if (!key.startsWith('lock:')) await this._flush(); }
}
