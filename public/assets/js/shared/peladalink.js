// Link simples de um dia de pelada: /pelada/PL-ABC234/12-10-2026 (o ID identifica a pelada; a data, o dia de jogo).

/** "2026-10-12" → "12-10-2026" */
export const dayToSlug = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : null;

/** "12-10-2026" → "2026-10-12" (ou null se não for uma data real) */
export function slugToDay(slug) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(slug || ''));
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(iso + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

export const dayPath = (peladaId, iso) => { const s = dayToSlug(iso); return s ? `/pelada/${peladaId}/${s}` : null; };
