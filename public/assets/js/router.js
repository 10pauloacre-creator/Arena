// Roteador por History API.
const routes = [];
let current = null;
let rootEl = null;
let leaveFns = [];
let token = 0;
let abort = null;

export function addRoute(pattern, loader) {
  const keys = [];
  const re = pattern === '*' ? /^.*$/ : new RegExp('^' + pattern.replace(/\/:([A-Za-z]+)(\?)?/g, (_, k, opt) => { keys.push(k); return opt ? '(?:/([^/]+))?' : '/([^/]+)'; }) + '/?$');
  routes.push({ pattern, re, keys, loader });
}

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path);
  return resolve();
}
export const currentPath = () => location.pathname + location.search;

async function resolve() {
  const my = ++token;
  const url = new URL(location.href);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  let hit = null;
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) { hit = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1] ? decodeURIComponent(m[i + 1]) : undefined])) }; break; }
  }
  leaveFns.forEach(fn => { try { fn(); } catch { /* ignora */ } });
  leaveFns = [];
  // modais ficam no <body>, fora do container da rota: fecham (e saem do DOM na hora) junto com a navegação.
  // O evento "close" ainda dispara, então quem aguarda `closed` é liberado normalmente.
  document.querySelectorAll('dialog').forEach(d => { try { d.close(); } catch { /* já fechado */ } d.remove(); });
  abort?.abort();
  abort = new AbortController();
  if (!hit) hit = { r: routes.find(r => r.pattern === '*'), params: {} };
  // cada rota ganha um container novo: listeners da página anterior desaparecem junto com o elemento antigo
  const page = document.createElement('div');
  page.className = 'route-root';
  rootEl.replaceChildren(page);
  const ctx = {
    root: page, params: hit.params, query: Object.fromEntries(url.searchParams), path, navigate,
    onLeave: fn => leaveFns.push(fn), isCurrent: () => my === token, signal: abort.signal,
  };
  current = ctx;
  window.scrollTo({ top: 0 });
  try {
    const mod = await hit.r.loader();
    if (my !== token) return;
    await mod.default(ctx);
  } catch (err) {
    if (my !== token) return;
    console.error(err);
    ctx.root.innerHTML = `<div class="page-loading"><div class="empty"><strong>Não foi possível carregar esta página.</strong><span>${String(err.message || err).replace(/[<>&]/g, '')}</span><a class="btn btn-primary" href="/">Voltar ao início</a></div></div>`;
  }
}

export function start(root) {
  rootEl = root;
  window.addEventListener('popstate', resolve);
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.dataset.external !== undefined) return;
    const href = a.getAttribute('href');
    if (!href.startsWith('/') || href.startsWith('//')) return;
    e.preventDefault();
    navigate(href);
  });
  return resolve();
}
export const getCurrent = () => current;
