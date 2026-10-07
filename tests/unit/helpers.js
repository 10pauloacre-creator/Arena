// Utilitários dos testes: servidor HTTP em memória + cliente com cookies.
import { createAppServer } from '../../server.js';
import { MemoryStore } from '../../lib/store/memory.js';
import { setStore } from '../../lib/store/index.js';
import { setProvider } from '../../lib/payments/index.js';
import { mockProvider } from '../../lib/payments/mock.js';
import { setClock } from '../../lib/clock.js';

export async function startServer() {
  const store = new MemoryStore();
  setStore(store);
  setProvider(mockProvider);
  setClock(null);
  const server = createAppServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, store, close: () => new Promise(r => server.close(r)) };
}

let ipCounter = 0;
export class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.ip = `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250 + 1}`; }
  async req(method, path, body, { headers = {} } = {}) {
    const res = await fetch(this.base + '/api' + path, {
      method,
      headers: { 'X-Forwarded-For': this.ip, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) { const c = set.split(';')[0]; this.cookie = c.endsWith('=') ? '' : c; }
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  get(p, o) { return this.req('GET', p, undefined, o); }
  post(p, b = {}, o) { return this.req('POST', p, b, o); }
  patch(p, b = {}) { return this.req('PATCH', p, b); }
  put(p, b = {}) { return this.req('PUT', p, b); }
  del(p, b) { return this.req('DELETE', p, b); }
}

let n = 0;
export async function signup(base, name = 'Organizador') {
  const c = new Client(base);
  const email = `user${++n}_${Date.now()}@teste.com`;
  const r = await c.post('/auth/signup', { name, email, password: 'senha-segura-123' });
  if (r.status !== 200) throw new Error('signup falhou: ' + JSON.stringify(r.data));
  c.email = email; c.user = r.data.user;
  return c;
}

export function roster(sport = 'futebol', { official = false, offset = 0 } = {}) {
  const min = { futebol: 11, futsal: 5, volei: 6, basquete: 5 }[sport];
  const cpfs = ['529.982.247-25', '111.444.777-35', '935.411.347-80', '168.995.350-09', '453.178.287-91', '714.836.680-24', '382.431.130-04', '270.718.140-70', '090.356.750-05', '821.274.760-60', '364.827.360-38', '123.456.789-09', '987.654.321-00', '555.666.777-81'];
  return Array.from({ length: min }, (_, i) => ({
    name: `Jogador Numero ${i + 1 + offset}`, number: i + 1,
    ...(official ? { cpf: genCpf(i + offset * 20 + 1), rg: `12345${i}${offset}`, doc: { name: `rg${i}.pdf`, size: 120000 } } : {}),
  }));
}

export function genCpf(seed) {
  const base = String(100000000 + seed * 7919).slice(0, 9).split('').map(Number);
  const dv = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * (a.length + 1 - i); return (s * 10) % 11 % 10; };
  const d1 = dv(base), d2 = dv([...base, d1]);
  const d = [...base, d1, d2].join('');
  return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

export function teamInput(name, sport = 'futebol', extra = {}) {
  return {
    name, origin: extra.origin ?? '', captain: { name: 'Capitão Teste', phone: '(11) 98765-4321', email: 'capitao@teste.com' },
    players: roster(sport, { official: extra.official, offset: extra.offset || 0 }), ...extra.input,
  };
}
