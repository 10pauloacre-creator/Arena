// Núcleo dos service workers (ArenaMaster e Pelada), carregado por importScripts(). Script clássico (sem import/export).
//
//   arenaSW.setup({ prefix, version, shell, fallback, assetPrefixes, ignorePrefixes, swr })
//
// • Instalação: guarda toda a interface (`shell`) para abrir sem internet.
// • Telas (navegação) e arquivos do app: "rede primeiro", mas com tempo limite — internet fraca ou caída usa a cópia guardada.
// • Imagens de pessoas/times (`swr`): usa a cópia e atualiza em segundo plano.
// • Dados da API (/api) nunca passam por aqui: quem guarda os dados é o motor offline (IndexedDB), por usuário.
(function (self) {
  'use strict';
  var NETWORK_TIMEOUT = 4000;

  function timeout(ms) {
    return new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, ms); });
  }

  function setup(cfg) {
    var CACHE = cfg.prefix + cfg.version;
    var assetPrefixes = cfg.assetPrefixes || [];
    var ignorePrefixes = cfg.ignorePrefixes || [];
    var swr = cfg.swr || [];

    self.addEventListener('install', function (event) {
      event.waitUntil(
        caches.open(CACHE)
          .then(function (cache) { return Promise.all(cfg.shell.map(function (url) { return cache.add(url).catch(function () { return null; }); })); })
          .then(function () { return self.skipWaiting(); })
      );
    });

    self.addEventListener('activate', function (event) {
      event.waitUntil(
        caches.keys()
          .then(function (keys) { return Promise.all(keys.filter(function (k) { return k.indexOf(cfg.prefix) === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
          .then(function () { return self.clients.claim(); })
      );
    });

    // rede primeiro (com tempo limite) e a cópia guardada como reserva; `key` permite que várias rotas usem a mesma cópia (SPA)
    async function networkFirst(request, key) {
      var cache = await caches.open(CACHE);
      var cached = await cache.match(key || request);
      var net = fetch(request).then(function (res) {
        if (res && res.ok) cache.put(key || request, res.clone());
        return res;
      });
      if (!cached) return net;
      try { return await Promise.race([net, timeout(NETWORK_TIMEOUT)]); }
      catch (err) { net.catch(function () {}); return cached; }
    }

    async function staleWhileRevalidate(request) {
      var cache = await caches.open(CACHE);
      var hit = await cache.match(request);
      var refresh = fetch(request).then(function (res) { if (res && res.ok) cache.put(request, res.clone()); return res; }).catch(function () { return hit; });
      return hit || refresh;
    }

    var startsWithAny = function (path, list) { return list.some(function (p) { return path.indexOf(p) === 0; }); };

    self.addEventListener('fetch', function (event) {
      var request = event.request;
      if (request.method !== 'GET') return;
      var url = new URL(request.url);
      if (url.origin !== self.location.origin) return;
      var path = url.pathname;
      if (startsWithAny(path, ignorePrefixes)) return; // pertence a outro service worker
      if (swr.some(function (re) { return re.test(path); })) { event.respondWith(staleWhileRevalidate(request)); return; }
      if (path.indexOf('/api/') === 0) return; // dados: o motor offline cuida deles
      if (request.mode === 'navigate') {
        // qualquer rota do app abre o mesmo index.html (SPA)
        event.respondWith(networkFirst(request, cfg.fallback));
        return;
      }
      if (startsWithAny(path, assetPrefixes)) event.respondWith(networkFirst(request));
    });
  }

  self.arenaSW = { setup: setup, networkTimeout: NETWORK_TIMEOUT };
})(self);
