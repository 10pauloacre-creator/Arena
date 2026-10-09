// Flyer do confronto em PNG (pré-visualização do link da partida e imagem para baixar/compartilhar).
// O modelo é um SVG puro (public/assets/js/shared/matchflyer.js); aqui ele ganha os emblemas do armazenamento, a marca e vira PNG com o resvg.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { K } from '../repo.js';
import { FLYER_FORMATS, matchFlyerSvg, matchInfo } from '../../public/assets/js/shared/matchflyer.js';

const asset = p => fileURLToPath(new URL(`../assets/${p}`, import.meta.url));
const FONT_FILES = ['fonts/PlusJakartaSans-Bold.ttf', 'fonts/PlusJakartaSans-ExtraBold.ttf'].map(asset);

let resvgP = null;
/** Carrega o resvg uma vez; null se o módulo nativo não estiver disponível (aí o link usa a imagem simples). */
const loadResvg = () => resvgP ??= import('@resvg/resvg-js').then(m => m.Resvg || m.default?.Resvg).catch(() => null);
export async function flyerAvailable() { return !!(await loadResvg()); }

let logoP = null;
const logoUri = () => logoP ??= readFile(asset('logo.png')).then(b => `data:image/png;base64,${b.toString('base64')}`).catch(() => null);

const STATE = { live: 'live', paused: 'live', finished: 'done' };

/** Dados do modelo a partir da partida (visão pública `t`/`m`); busca os emblemas no armazenamento. */
export async function flyerData(store, t, m) {
  const teams = new Map((t.teams || []).map(x => [x.id, x]));
  const side = async id => {
    const x = id && teams.get(id);
    if (!x) return null;
    const rec = x.emblemUrl ? await store.get(K.emblem(t.id, x.id)).catch(() => null) : null;
    return { name: x.name, hue: x.hue, emblem: rec ? `data:${rec.mime};base64,${rec.b64}` : null, ver: rec ? x.emblemUrl.split('v=')[1] || '' : '' };
  };
  const [a, b] = await Promise.all([side(m.a), side(m.b)]);
  const info = matchInfo(t, m);
  return {
    tournament: t.name, sport: t.sportLabel, round: m.roundName, a, b,
    score: m.score && m.a && m.b && m.phase !== 'scheduled' ? { a: m.score.a, b: m.score.b } : null,
    state: STATE[m.phase] || null, when: info.when, venue: info.venue,
  };
}

/** Muda quando o flyer muda (placar, horário, nomes, emblemas): serve de versão do endereço da imagem. */
export const flyerVersion = d => createHash('sha1').update(JSON.stringify({ ...d, a: d.a && { ...d.a, emblem: !!d.a.emblem }, b: d.b && { ...d.b, emblem: !!d.b.emblem } })).digest('hex').slice(0, 10);

export async function renderFlyerPng(data, format = 'og') {
  const Resvg = await loadResvg();
  if (!Resvg) return null;
  const f = FLYER_FORMATS[format] ? format : 'og';
  const svg = matchFlyerSvg({ ...data, logo: await logoUri() }, f);
  const img = new Resvg(svg, {
    fitTo: { mode: 'width', value: FLYER_FORMATS[f].w },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Plus Jakarta Sans' },
  });
  return Buffer.from(img.render().asPng());
}
