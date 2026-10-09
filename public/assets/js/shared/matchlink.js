// Link simples de uma partida: /AM-2026-9843/flamengo-x-vasco (rodando no navegador e no servidor, para a pré-visualização).
// O slug sai dos nomes dos times; nunca é "desmontado": para achar a partida, calculamos o slug de todas e comparamos.

/** "Atlético Mineiro FC!" → "atletico-mineiro-fc" */
export function slugify(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' e ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}

export const allMatches = t => t?.bracket ? [...t.bracket.rounds.flatMap(r => r.matches), ...t.bracket.playins] : [];

/** Endereço fixo da partida, que não muda quando os times são definidos: jogo-1-0, jogo-p-abc12 */
export const fixedSlug = m => 'jogo-' + String(m.key).replace(':', '-');

/**
 * Slug de cada partida compartilhável: Map(key → slug). Times definidos → "a-x-b" (repetições ganham -2, -3…);
 * partidas ainda sem os dois times (e byes, que não aparecem) usam o endereço fixo.
 */
export function matchSlugs(t) {
  const names = new Map((t?.teams || []).map(x => [x.id, x.name]));
  const seen = new Map(), out = new Map();
  for (const m of allMatches(t)) {
    if (m.bye) continue;
    const a = slugify(names.get(m.a)), b = slugify(names.get(m.b));
    if (!a || !b) { out.set(m.key, fixedSlug(m)); continue; }
    const base = `${a}-x-${b}`, n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    out.set(m.key, n > 1 ? `${base}-${n}` : base);
  }
  return out;
}

export const matchSlug = (t, key) => matchSlugs(t).get(key) || null;

/** Acha a partida pelo slug (o de times ou o fixo). */
export function findMatchBySlug(t, slug) {
  const want = String(slug || '').toLowerCase();
  if (!want) return null;
  const slugs = matchSlugs(t);
  return allMatches(t).find(m => !m.bye && (slugs.get(m.key) === want || fixedSlug(m) === want)) || null;
}

export const matchPath = (t, key) => { const s = matchSlug(t, key); return s ? `/${t.id}/${s}` : null; };

/** Imagem (flyer) do confronto: formato "og" (link), "feed" (4:5) ou "story" (9:16); só existe com os dois times definidos. */
export function matchFlyerPath(t, m, { f = 'og', dl = false } = {}) {
  const s = m?.a && m?.b && matchSlug(t, m.key);
  return s ? `/api/public/${t.id}/match-flyer/${s}?f=${f}${dl ? '&dl=1' : ''}` : null;
}

/** Opção `image` do diálogo de compartilhar: prévia (og), arquivo para baixar/enviar (feed 4:5) e nome; null se faltar time. */
export function flyerImage(t, m) {
  const src = matchFlyerPath(t, m);
  return src ? { src, feed: matchFlyerPath(t, m, { f: 'feed', dl: true }), name: matchSlug(t, m.key) } : null;
}

/** Título da partida para textos e pré-visualização: "Flamengo × Vasco". */
export function matchTitle(t, m) {
  const names = new Map((t.teams || []).map(x => [x.id, x.name]));
  const a = names.get(m.a), b = names.get(m.b);
  return a && b ? `${a} × ${b}` : (m.label || m.roundName || 'Partida');
}
