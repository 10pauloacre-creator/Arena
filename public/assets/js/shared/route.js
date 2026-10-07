// Casamento de rotas "/a/:id/b" (usado pelas ações compartilhadas e pelo motor offline do navegador).

/** Compila um padrão como "/pelada/peladas/:id/days/:dayId" → { re, keys }. */
export function compileRoute(pattern) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:([A-Za-z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
  return { re, keys, pattern };
}

/** Retorna os parâmetros (já decodificados) ou null se o caminho não casa. */
export function matchRoute(route, path) {
  const m = route.re.exec(String(path).split('?')[0]);
  if (!m) return null;
  const params = {};
  route.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } });
  return params;
}
