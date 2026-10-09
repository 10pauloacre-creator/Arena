// Emblema do time (escudo SVG do catálogo): ao lado do nome "Time 2 - Leões".
import { raw } from '../../ui/dom.js';
import { emblemSvg } from '../../shared/team-catalog.js';

export const emblem = (team, size = 32) => raw(emblemSvg(team?.emb, size));
