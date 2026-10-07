// Ponto de entrada do modo offline no navegador: cria o motor (uma vez) e deixa cada app registrar seus plugins.
import { OfflineEngine } from './engine.js';
import { openStorage } from './storage.js';

const specs = [];
let engine = null;
let transportFn = null;

/** Registra um tipo de documento que sabe funcionar offline: { id, test(method, path), load() → plugin }. */
export function registerOfflinePlugin(spec) {
  specs.push(spec);
  engine?.register(spec);
}

/** Motor do navegador (null fora do navegador, ex.: testes em Node). `transport` vem de api.js. */
export function getEngine(transport) {
  if (engine) return engine;
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  transportFn = transport;
  const ready = openStorage();
  let driver = null;
  ready.then(d => { driver = d; });
  const call = name => async (...a) => (await ready)[name](...a);
  const storage = { get durable() { return driver ? driver.durable !== false : true; }, get: call('get'), put: call('put'), del: call('del'), all: call('all'), clear: call('clear') };
  engine = new OfflineEngine({
    storage,
    transport: (...a) => transportFn(...a),
    env: {
      window, document, navigator, BroadcastChannel: globalThis.BroadcastChannel, locks: navigator.locks, origin: location.origin,
    },
  });
  for (const s of specs) engine.register(s);
  try { navigator.storage?.persist?.(); } catch { /* o navegador decide */ }
  return engine;
}
