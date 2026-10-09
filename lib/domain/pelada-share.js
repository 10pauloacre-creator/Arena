// Pré-visualização do link de convite (WhatsApp, Telegram, Facebook…): título, descrição e imagem da pelada nas metatags Open Graph.
// Quem monta a pré-visualização é o robô da rede social, que não executa JavaScript: por isso o servidor entrega o index.html do app
// já com as metatags desta pelada (foto de perfil/capa e dados), e o app assume normalmente no navegador.

import { GENDERS } from '../../public/assets/js/shared/pelada.js';
import { orgOf } from './pelada.js';
import { todayBR } from './pelada-views.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Dados da pré-visualização: { title, description, image, url }. `ownerName` = nome do organizador. */
export function shareMeta(p, { base, ownerName, now }) {
  const g = GENDERS[p.gender] || GENDERS.masculino;
  const today = todayBR(now);
  const next = p.days.find(d => d.date >= today);
  const org = next ? orgOf(p, next) : null;
  const n = p.members.length;
  const parts = [
    `${g.emoji} Pelada ${g.adj}`,
    ownerName ? `organizada por ${ownerName}` : null,
    `${n} ${n === 1 ? 'participante' : 'participantes'}`,
    org && !org.noTeams ? `mín. ${org.minPerTeam} por time` : (!p.noTeams ? `mín. ${p.minPerTeam} por time` : 'sem formação de times'),
    next ? `próximo jogo ${dmy(next.date)}` : null,
  ].filter(Boolean);
  // a imagem do cartão: prévia montada (capa + foto de perfil + nome) > capa > foto de perfil > ícone do app
  const img = k => p.img?.[k] ? `${base}/pelada-img/p/${p.id}/${k}?v=${p.img[k]}` : null;
  const image = img('preview') || img('cover') || img('avatar') || `${base}/pelada/icons/icon-512.png`;
  return {
    title: `${p.name} · Pelada`,
    description: `${parts.join(' · ')}. Toque para entrar — ID ${p.id}`,
    image, large: !!(img('preview') || img('cover')), url: `${base}/pelada/p/${p.id}`,
  };
}

/** Pré-visualização do link de UM dia de pelada (/pelada/PL-XXXXXX/12-10-2026): o mesmo cartão, com a data e a situação do dia. */
export function dayShareMeta(p, day, { base, ownerName, now, slug }) {
  const m = shareMeta(p, { base, ownerName, now });
  const org = orgOf(p, day);
  const n = day.attendance.length;
  const parts = [
    `📅 Jogo de ${dmy(day.date)}`,
    `${n} ${n === 1 ? 'confirmado' : 'confirmados'}`,
    org && !org.noTeams ? `mín. ${org.minPerTeam} por time` : 'sem formação de times',
  ];
  return {
    ...m, title: `${p.name} · ${dmy(day.date)}`,
    description: `${parts.join(' · ')}${ownerName ? ` · organizada por ${ownerName}` : ''}. Toque para ver o dia — ID ${p.id}`,
    url: `${base}/pelada/${p.id}/${slug}`,
  };
}

/** Troca as metatags de compartilhamento do index.html pelas da pelada. */
export function injectMeta(html, meta) {
  const tags = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}">`,
    `<link rel="canonical" href="${esc(meta.url)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(meta.siteName || 'Pelada')}">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.description)}">`,
    `<meta property="og:url" content="${esc(meta.url)}">`,
    `<meta property="og:image" content="${esc(meta.image)}">`,
    `<meta property="og:locale" content="pt_BR">`,
    `<meta name="twitter:card" content="${meta.large ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(meta.title)}">`,
    `<meta name="twitter:description" content="${esc(meta.description)}">`,
    `<meta name="twitter:image" content="${esc(meta.image)}">`,
  ].join('\n');
  const out = html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+(?:name|property)="(?:description|og:[^"]*|twitter:[^"]*)"[^>]*>\s*/gi, '')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, '');
  return out.includes('</head>') ? out.replace('</head>', `${tags}\n</head>`) : tags + out;
}
