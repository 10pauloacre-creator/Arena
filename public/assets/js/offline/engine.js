// Motor do modo offline.
//
//  • Leituras: o que o servidor responde é guardado no aparelho; sem internet, a tela abre com a última cópia.
//  • Escritas: quando a internet cai, a ação é aplicada na cópia local (com as MESMAS regras do servidor), entra numa
//    fila e a tela segue funcionando. Ao voltar, a fila é enviada em ordem, cada operação com um id (o servidor ignora
//    repetições) e com a hora em que foi feita. O servidor tem a palavra final: a cópia local é substituída pela dele
//    e as operações que ainda faltam são reaplicadas por cima ("rebase").
//
// Este arquivo não conhece HTTP nem DOM: recebe um `transport` e `plugins` (regras de cada tipo de documento).

import { randomBytes, b64url } from '../shared/rand.js';

export class NetworkError extends Error {
  constructor(message = 'Sem conexão com o servidor.') { super(message); this.name = 'NetworkError'; this.network = true; this.code = 'NETWORK'; this.status = 0; }
}
export const isNetwork = err => !!err && (err.network === true || err.code === 'NETWORK' || err.name === 'NetworkError');

const WRITE_TIMEOUT = 10_000;
const READ_TIMEOUT = 15_000;
const MAX_CACHE = 80;
const RETRY_MIN = 3000, RETRY_MAX = 30_000;

/** Caminhos cujas respostas nunca ficam guardadas (dependem do momento, de pagamento ou da sessão). */
const NO_CACHE = [/^\/auth\//, /^\/pelada\/auth\//, /\/payments?\//, /\/pay(\/|$)/, /^\/invites\//, /\/my-team$/];
export const cacheable = path => !NO_CACHE.some(re => re.test(path.split('?')[0]));

const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const fakeHeaders = h => ({ get: k => h[String(k).toLowerCase()] ?? null });
const response = (status, data, headers = {}) => ({ status, data, headers: fakeHeaders(headers), local: true });
const errorResponse = e => response(e.status || 400, { error: { message: e.message, code: e.code || null, ...(e.extra ? { details: e.extra } : {}) } });

export class OfflineEngine {
  /**
   * @param {object} o
   * @param {object} o.storage      driver de storage.js
   * @param {Function} o.transport  (method, path, body, { headers, signal, timeoutMs }) → { status, data, headers }; lança NetworkError
   * @param {Function} [o.now]
   * @param {object} [o.env]        { navigator, window, BroadcastChannel, locks } (injetável nos testes)
   */
  constructor({ storage, transport, now = () => Date.now(), env = {} }) {
    this.storage = storage; this.transport = transport; this.now = now;
    this.env = env;
    this.specs = [];            // { id, test(method, path), load() } — plugins registrados pelo app
    this.loaded = new Map();    // id → plugin carregado
    this.uid = 'anon'; this.user = null;
    this.online = true; this.syncing = false; this.needsLogin = false;
    this.counts = { pending: 0, failed: 0 };
    this.lastSyncAt = 0;
    this.listeners = new Set();
    this._flushing = null; this._retry = null; this._retryDelay = RETRY_MIN;
    this._chain = Promise.resolve(); // serializa mudanças na fila dentro desta aba
    this.onNeedLogin = null;
    this._wire();
  }

  // ---------------------------------------------------------------- configuração
  register(spec) { this.specs = this.specs.filter(s => s.id !== spec.id); this.specs.push(spec); }

  async _plugin(method, path) {
    const spec = this.specs.find(s => s.test(method, path));
    if (!spec) return null;
    if (!this.loaded.has(spec.id)) this.loaded.set(spec.id, Promise.resolve(spec.load()).then(m => m.default || m));
    const plugin = await this.loaded.get(spec.id);
    const m = plugin.match(method, path);
    return m ? { plugin, ...m } : null;
  }
  async _pluginById(id) {
    const spec = this.specs.find(s => s.id === id);
    if (!spec) return null;
    if (!this.loaded.has(id)) this.loaded.set(id, Promise.resolve(spec.load()).then(m => m.default || m));
    return this.loaded.get(id);
  }

  /** Usuário atual ({ id, name, av? }) ou null. As cópias e a fila são separadas por usuário. */
  setUser(user) {
    const uid = user?.id || 'anon';
    this.user = user || null; this.uid = uid;
    this.needsLogin = false; // entrou (de novo): a fila pode voltar a ser enviada
    this._refreshCounts().then(() => { this._emit(); if (this.counts.pending) this.flush({ manual: true }); });
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  status() { return { online: this.online, syncing: this.syncing, needsLogin: this.needsLogin, pending: this.counts.pending, failed: this.counts.failed, lastSyncAt: this.lastSyncAt, durable: this.storage.durable !== false }; }
  _emit(type = 'status', detail = {}) {
    const s = { ...this.status(), type, ...detail };
    for (const fn of this.listeners) { try { fn(s); } catch { /* ouvinte com erro não derruba o motor */ } }
  }
  _setOnline(v) {
    if (this.online === v) return;
    this.online = v;
    this._emit(v ? 'online' : 'offline');
    if (v) { this._retryDelay = RETRY_MIN; if (this.counts.pending) this._scheduleFlush(0); }
  }

  _wire() {
    const { window: w, navigator: n } = this.env;
    if (w?.addEventListener) {
      w.addEventListener('online', () => { this._retryDelay = RETRY_MIN; this.flush({ manual: true }); });
      w.addEventListener('offline', () => this._setOnline(false));
    }
    const d = this.env.document;
    d?.addEventListener?.('visibilitychange', () => { if (!d.hidden && this.counts.pending) this.flush(); });
    if (this.env.BroadcastChannel) {
      try {
        this.channel = new this.env.BroadcastChannel('arena-offline');
        this.channel.onmessage = () => { this._refreshCounts().then(() => this._emit()); };
      } catch { /* sem canal entre abas */ }
    }
    void n;
  }
  _tell() { try { this.channel?.postMessage({ t: 'changed' }); } catch { /* ignora */ } }

  // ---------------------------------------------------------------- transporte
  _hintOffline() { return this.env.navigator?.onLine === false; }

  async _send(method, path, body, opts = {}) {
    try {
      const res = await this.transport(method, path, body, opts);
      this._setOnline(true);
      return res;
    } catch (err) {
      if (isNetwork(err)) this._setOnline(false);
      throw err;
    }
  }

  // ---------------------------------------------------------------- armazenamento (por usuário)
  _k(x) { return `${this.uid}|${x}`; }
  async _getReplica(resource) { return (await this.storage.get('replicas', this._k(resource))) || null; }
  async _putReplica(resource, rep) { await this.storage.put('replicas', this._k(resource), rep); }
  async _outbox(uid = this.uid) { return (await this.storage.all('outbox')).map(r => r.value).filter(o => o.uid === uid); }
  async _pending(resource) { return (await this._outbox()).filter(o => o.resource === resource); }
  async _dead(uid = this.uid) { return (await this.storage.all('dead')).map(r => r.value).filter(o => o.uid === uid); }
  async _refreshCounts() {
    const [o, d] = await Promise.all([this._outbox(), this._dead()]);
    this.counts = { pending: o.length, failed: d.length };
  }
  /** Muda a fila/lista de falhas uma operação por vez (dentro desta aba). */
  _locked(fn) { const p = this._chain.then(fn, fn); this._chain = p.catch(() => {}); return p; }
  async _putOp(op) {
    await this._locked(async () => { await this.storage.put('outbox', op.key, op); });
    await this._refreshCounts(); this._tell();
  }
  async _delOp(op) {
    await this._locked(async () => { await this.storage.del('outbox', op.key); });
    await this._refreshCounts(); this._tell();
  }
  async _toDead(op, res) {
    const err = res?.data?.error || {};
    const failure = { ...op, failedAt: this.now(), error: { status: res?.status ?? 0, code: err.code || null, message: err.message || res?.message || 'A operação foi recusada pelo servidor.' } };
    await this._locked(async () => { await this.storage.del('outbox', op.key); await this.storage.put('dead', op.key, failure); });
    await this._refreshCounts(); this._tell();
    this._emit('conflict', { op: failure });
  }

  async _cachePut(path, res) {
    const entries = await this.storage.all('cache');
    const mine = entries.filter(e => e.key.startsWith(this.uid + '|'));
    if (mine.length >= MAX_CACHE) {
      mine.sort((a, b) => (a.value.at || 0) - (b.value.at || 0));
      for (const e of mine.slice(0, mine.length - MAX_CACHE + 10)) await this.storage.del('cache', e.key);
    }
    await this.storage.put('cache', this._k(path), { data: res.data, etag: res.headers.get('etag'), at: this.now() });
  }

  // ---------------------------------------------------------------- API principal
  /** Mesmo contrato do transporte: devolve { status, data, headers }. Erros de rede viram NetworkError. */
  async request(method, path, body, opts = {}) {
    await this._ready();
    const hit = await this._plugin(method, path);
    if (method === 'GET') return this._read(path, opts, hit);
    if (!hit || !(await hit.plugin.canQueue(method, path, body ?? {}, this))) return this._send(method, path, body, opts);
    if (hit.plugin.blind) return this._writeBlind(hit, method, path, body ?? {}, opts);
    return this._write(hit, method, path, body ?? {}, opts);
  }

  _ready() { return this._readyP || (this._readyP = this._refreshCounts().then(() => { if (this.counts.pending) setTimeout(() => this.flush(), 0); })); }

  _serverNow(rep) { return this.now() + (rep?.offset || 0); }
  _env(rep) {
    return { me: this.user, now: this._serverNow(rep), base: this.env.origin || '' };
  }

  // ---- leitura
  async _read(path, opts, hit) {
    const headers = { ...(opts.headers || {}) };
    let rep = null;
    if (hit) { rep = await this._getReplica(hit.resource); headers['X-Replica'] = String(rep?.version ?? 0); }
    if (this._hintOffline() && (hit || await this._hasCache(path))) return this._readOffline(path, opts, hit, rep, new NetworkError());
    let res;
    try {
      res = await this._send('GET', path, undefined, { ...opts, headers, timeoutMs: opts.timeoutMs ?? READ_TIMEOUT });
    } catch (err) {
      if (!isNetwork(err)) throw err;
      return this._readOffline(path, opts, hit, rep, err);
    }
    if (res.status === 200 || res.status === 304) {
      if (hit) {
        if (res.status === 200) rep = (await this._absorb(hit, res.data)) || rep;
        const local = await this._localView(hit, path, rep, opts);
        if (local) return local;
      }
      if (res.status === 200 && cacheable(path) && !opts.noCache && !rep) await this._cachePut(path, res); // com cópia do documento, ela basta
    }
    return res;
  }
  async _hasCache(path) { return !!(await this.storage.get('cache', this._k(path))); }

  async _readOffline(path, opts, hit, rep, err) {
    if (hit && rep) {
      const local = await this._localView(hit, path, rep, opts, { force: true });
      if (local) return local;
    }
    const cached = await this.storage.get('cache', this._k(path));
    if (cached) {
      const etag = cached.etag;
      if (etag && opts.headers?.['If-None-Match'] === etag) return response(304, null, { etag });
      return response(200, cached.data, etag ? { etag } : {});
    }
    throw err;
  }

  /** Estado do servidor + operações ainda não enviadas. null quando não há nada pendente (e não é forçado). */
  async _localView(hit, path, rep, opts, { force = false } = {}) {
    if (!rep) return null;
    const pending = await this._pending(hit.resource);
    if (!pending.length && !force) return null;
    const draft = await this._rebase(hit.plugin, rep, pending);
    const out = hit.plugin.readResponse(path, draft, this._env(rep));
    if (!out) return null;
    const etag = `W/"L${hashStr(JSON.stringify(out.basis))}"`;
    if (opts.headers?.['If-None-Match'] === etag) return response(304, null, { etag });
    return response(200, out.data, { etag });
  }

  /** Cópia do servidor + operações pendentes aplicadas em ordem. Operações que já não cabem vão para as falhas. */
  async _rebase(plugin, rep, pending) {
    const draft = plugin.draft(rep);
    const env = this._env(rep);
    const dropped = [];
    for (const op of pending) {
      if (plugin.hasOp(draft, op.id)) continue; // o servidor já aplicou (a resposta é que se perdeu)
      try { plugin.apply(draft, op, env); } catch (e) { dropped.push({ op, e }); }
    }
    for (const { op, e } of dropped) await this._toDead(op, errorResponse(e));
    return draft;
  }

  /** Guarda a cópia do documento que veio do servidor (se for mais nova) e descarta operações que ela já contém. */
  async _absorb(hit, data) {
    const next = hit.plugin.replicaFrom(data);
    if (!next) return null;
    const cur = await this._getReplica(hit.resource);
    if (cur && cur.version > next.version) return cur; // resposta atrasada: a que temos é mais nova
    const rep = { ...next, readPath: hit.readPath, offset: next.now ? next.now - this.now() : (cur?.offset || 0), savedAt: this.now() };
    await this._putReplica(hit.resource, rep);
    for (const op of await this._pending(hit.resource)) if (hit.plugin.hasOp(rep, op.id)) await this._delOp(op);
    return rep;
  }

  // ---- escrita
  async _write(hit, method, path, body, opts) {
    const { plugin, resource } = hit;
    const rep = await this._getReplica(resource);
    const op = {
      key: `${String(this.now()).padStart(15, '0')}-${this._seq()}`,
      id: b64url(randomBytes(12)), uid: this.uid, plugin: plugin.id, resource, method, path, body,
      createdAt: this.now(), at: this._serverNow(rep), label: plugin.label(method, path, body), tries: 0,
    };
    let netErr = null;
    const pending = await this._pending(resource);
    if (!pending.length && !this._hintOffline()) {
      try {
        const res = await this._send(method, path, body, { ...opts, headers: { ...(opts.headers || {}), 'X-Op-Id': op.id, 'X-Replica': String(rep?.version ?? 0) }, timeoutMs: WRITE_TIMEOUT });
        if (res.status >= 200 && res.status < 300) await this._absorb(hit, res.data);
        if (![502, 503, 504].includes(res.status)) return res;
        netErr = new NetworkError('O servidor não respondeu.'); // gateway fora do ar: trata como queda e tenta de novo depois
      } catch (err) { if (!isNetwork(err)) throw err; netErr = err; }
    }
    return this._enqueue(hit, op, rep, pending, netErr || new NetworkError());
  }
  /** Plugins sem cópia local (ex.: inscrição de time): tenta enviar; se a internet cair, guarda e envia depois. */
  async _writeBlind(hit, method, path, body, opts) {
    const { plugin, resource } = hit;
    const op = {
      key: `${String(this.now()).padStart(15, '0')}-${this._seq()}`, id: b64url(randomBytes(12)), uid: this.uid, plugin: plugin.id, resource,
      method, path, body, createdAt: this.now(), at: this.now(), label: plugin.label(method, path, body), tries: 0,
    };
    if (!this._hintOffline()) {
      try {
        const res = await this._send(method, path, body, { ...opts, headers: { ...(opts.headers || {}), 'X-Op-Id': op.id }, timeoutMs: WRITE_TIMEOUT });
        if (![502, 503, 504].includes(res.status)) return res;
      } catch (err) { if (!isNetwork(err)) throw err; }
    }
    await this._putOp(op);
    this._emit('queued', { op });
    this._scheduleFlush(0);
    return response(200, { ...plugin.queuedResponse(op), queued: true });
  }
  _seq() { this._n = ((this._n || 0) + 1) % 1e6; return String(this._n).padStart(6, '0'); }

  async _enqueue(hit, op, rep, pending, netErr) {
    const { plugin } = hit;
    if (!rep) throw netErr; // nunca abriu este documento neste aparelho: não dá para prever o resultado
    const draft = await this._rebase(plugin, rep, pending);
    let extra;
    try { extra = plugin.apply(draft, op, this._env(rep)); }
    catch (e) {
      if (e && typeof e.status === 'number') return errorResponse(e); // as regras recusaram (igual ao servidor): nada entra na fila
      throw netErr; // erro inesperado ao prever: melhor avisar que precisa de internet do que guardar algo que não entendemos
    }
    await this._putOp(op);
    this._emit('queued', { op });
    this._scheduleFlush(0);
    return response(200, { ...plugin.writeResponse(draft, op, extra, this._env(rep)), queued: true });
  }

  // ---------------------------------------------------------------- envio da fila
  _scheduleFlush(ms) {
    clearTimeout(this._retry);
    this._retry = setTimeout(() => { this.flush(); }, ms);
    this._retry.unref?.(); // em Node (testes) o temporizador não segura o processo
  }
  /** Para os temporizadores (testes / troca de contexto). */
  stop() { clearTimeout(this._retry); this._retry = null; }
  _backoff() { this._scheduleFlush(this._retryDelay); this._retryDelay = Math.min(RETRY_MAX, this._retryDelay * 2); }

  /** Envia as operações pendentes do usuário atual, uma de cada vez, em ordem. */
  flush({ manual = false } = {}) {
    if (this._flushing) return this._flushing;
    const run = async () => {
      this.syncing = true; this._emit();
      let sent = 0, touched = new Set();
      try {
        for (;;) {
          const ops = await this._outbox();
          if (!ops.length) break;
          const op = ops[0];
          if (!manual && op.nextTry && op.nextTry > this.now()) { this._scheduleFlush(op.nextTry - this.now()); break; }
          const plugin = await this._pluginById(op.plugin);
          if (!plugin) { await this._toDead(op, response(0, { error: { message: 'Esta operação não é mais suportada pelo app.' } })); continue; }
          if (this._hintOffline()) { this._setOnline(false); this._backoff(); break; }
          const rep = plugin.blind ? null : await this._getReplica(op.resource);
          let res;
          try {
            res = await this._send(op.method, op.path, op.body, { headers: { 'X-Op-Id': op.id, 'X-Op-At': String(op.at), ...(plugin.blind ? {} : { 'X-Replica': String(rep?.version ?? 0) }) }, timeoutMs: WRITE_TIMEOUT });
          } catch (err) {
            if (!isNetwork(err)) throw err;
            this._backoff(); break;
          }
          const s = res.status;
          if (s >= 200 && s < 300) {
            if (!(await this._settle(op, plugin, res))) touched.add(op.resource); sent++;
            this._retryDelay = RETRY_MIN;
            continue;
          }
          if (s === 401) { this.needsLogin = true; this._emit('login'); try { this.onNeedLogin?.(); } catch { /* ignora */ } break; }
          const transient = s === 408 || s === 425 || s === 429 || s >= 500 || res.data?.error?.code === 'LOCK_TIMEOUT';
          if (transient) { op.tries = (op.tries || 0) + 1; op.nextTry = this.now() + this._retryDelay; await this._putOp(op); this._backoff(); break; }
          await this._toDead(op, res); // recusada de vez (regra do servidor): fica na lista de problemas
        }
      } finally {
        this.syncing = false;
        await this._refreshCounts();
        if (sent) this.lastSyncAt = this.now();
        this._emit(sent && !this.counts.pending ? 'synced' : 'status', { sent });
      }
      // documentos cujas respostas não trouxeram a cópia: busca de novo para alinhar com o servidor
      for (const resource of touched) this._refetch(resource).catch(() => {});
    };
    const guarded = async () => {
      const locks = this.env.locks;
      if (locks?.request) await locks.request('arena-offline-flush', { ifAvailable: true }, async lock => { if (lock) await run(); });
      else await run();
    };
    this._flushing = guarded().finally(() => { this._flushing = null; });
    return this._flushing;
  }

  /** Tira a operação da fila e guarda a cópia nova do servidor. Retorna false se a resposta não trouxe a cópia. */
  async _settle(op, plugin, res) {
    await this._delOp(op);
    if (plugin.blind) { try { await plugin.onSynced?.(op, res, this); } catch { /* o aviso é opcional */ } return true; }
    const hit = plugin.match(op.method, op.path);
    return !!(hit && await this._absorb({ plugin, ...hit }, res.data));
  }

  async _refetch(resource) {
    const rep = await this._getReplica(resource);
    if (rep?.readPath) await this.request('GET', rep.readPath, undefined, {});
  }

  // ---------------------------------------------------------------- ações do usuário sobre a fila
  async listPending() { return this._outbox(); }
  async listFailed() { return this._dead(); }
  async discard(key) {
    await this._locked(async () => { await this.storage.del('dead', key); await this.storage.del('outbox', key); });
    await this._refreshCounts(); this._tell(); this._emit();
  }
  async discardAll() {
    await this._locked(async () => { for (const o of await this._dead()) await this.storage.del('dead', o.key); });
    await this._refreshCounts(); this._tell(); this._emit();
  }
  /** Descarta tudo o que é do usuário (ao sair da conta). */
  async purgeUser(uid = this.uid) {
    await this._locked(async () => {
      for (const store of ['cache', 'replicas']) for (const e of await this.storage.all(store)) if (e.key.startsWith(uid + '|')) await this.storage.del(store, e.key);
      for (const store of ['outbox', 'dead']) for (const e of await this.storage.all(store)) if (e.value.uid === uid) await this.storage.del(store, e.key);
    });
    await this._refreshCounts(); this._tell(); this._emit();
  }
  async retryFailed() {
    const dead = await this._dead();
    await this._locked(async () => { for (const o of dead) { const { failedAt, error, ...op } = o; await this.storage.del('dead', o.key); await this.storage.put('outbox', o.key, { ...op, tries: 0, nextTry: 0 }); } });
    await this._refreshCounts(); this._tell();
    return this.flush({ manual: true });
  }

  /** Guarda de antemão (com a internet funcionando) as telas que o usuário pode precisar sem internet. */
  async prefetch(paths) {
    if (!this.online || this._hintOffline()) return;
    for (const p of paths) { try { await this.request('GET', p, undefined, { noCache: false }); } catch { /* sem problema */ } }
  }
}
