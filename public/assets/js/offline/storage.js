// Armazenamento local do modo offline: pequenos "bancos" chave → valor (cache de telas, cópias dos documentos,
// fila de operações pendentes). Usa IndexedDB; se o navegador não permitir (aba privada, política do aparelho),
// cai para localStorage e, em último caso, para a memória (avisando que não é durável).

export const STORES = ['cache', 'replicas', 'outbox', 'dead', 'meta'];
const DB_NAME = 'arena-offline';
const DB_VERSION = 1;

const clone = v => (v === undefined ? undefined : structuredClone(v));

/** Driver em memória (testes e último recurso). */
export function memoryDriver() {
  const maps = Object.fromEntries(STORES.map(s => [s, new Map()]));
  return {
    kind: 'memory', durable: false,
    async get(store, key) { return clone(maps[store].get(key)); },
    async put(store, key, value) { maps[store].set(key, clone(value)); },
    async del(store, key) { maps[store].delete(key); },
    async all(store) { return [...maps[store]].map(([key, value]) => ({ key, value: clone(value) })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)); },
    async clear(store) { maps[store].clear(); },
  };
}

/** Driver em localStorage (JSON). Só para quando o IndexedDB não está disponível. */
export function localStorageDriver(ls = globalThis.localStorage, prefix = 'arena-offline:') {
  const k = (store, key) => `${prefix}${store}:${key}`;
  const keysOf = store => { const out = []; for (let i = 0; i < ls.length; i++) { const x = ls.key(i); if (x && x.startsWith(`${prefix}${store}:`)) out.push(x); } return out; };
  return {
    kind: 'localStorage', durable: true,
    async get(store, key) { const v = ls.getItem(k(store, key)); return v == null ? undefined : JSON.parse(v); },
    async put(store, key, value) { ls.setItem(k(store, key), JSON.stringify(value)); },
    async del(store, key) { ls.removeItem(k(store, key)); },
    async all(store) { return keysOf(store).map(x => ({ key: x.slice(`${prefix}${store}:`.length), value: JSON.parse(ls.getItem(x)) })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)); },
    async clear(store) { keysOf(store).forEach(x => ls.removeItem(x)); },
  };
}

/** Driver em IndexedDB. */
export async function idbDriver(idb = globalThis.indexedDB) {
  if (!idb) throw new Error('IndexedDB indisponível');
  const db = await new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Falha ao abrir o IndexedDB'));
    req.onblocked = () => reject(new Error('IndexedDB bloqueado'));
  });
  const run = (store, mode, fn) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const os = tx.objectStore(store);
    let out;
    const r = fn(os);
    if (r) r.onsuccess = () => { out = r.result; };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transação cancelada'));
  });
  return {
    kind: 'indexedDB', durable: true,
    get: (store, key) => run(store, 'readonly', os => os.get(key)),
    put: (store, key, value) => run(store, 'readwrite', os => os.put(value, key)),
    del: (store, key) => run(store, 'readwrite', os => os.delete(key)),
    async all(store) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const rows = [];
        const req = tx.objectStore(store).openCursor();
        req.onsuccess = () => { const c = req.result; if (c) { rows.push({ key: c.key, value: c.value }); c.continue(); } };
        tx.oncomplete = () => resolve(rows);
        tx.onerror = () => reject(tx.error);
      });
    },
    clear: store => run(store, 'readwrite', os => os.clear()),
  };
}

/** Abre o melhor driver disponível. */
export async function openStorage() {
  try {
    const d = await idbDriver();
    await d.put('meta', 'probe', 1); // alguns navegadores só falham na primeira escrita
    return d;
  } catch { /* tenta o próximo */ }
  try {
    const ls = globalThis.localStorage;
    ls.setItem('arena-offline:probe', '1'); ls.removeItem('arena-offline:probe');
    return localStorageDriver(ls);
  } catch { /* último recurso */ }
  return memoryDriver();
}
