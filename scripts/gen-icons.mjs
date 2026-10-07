// Gera public/assets/js/icons.js a partir do pacote lucide-static (ISC).
// Uso: node scripts/gen-icons.mjs <caminho para node_modules/lucide-static/icons>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('Informe o diretório de ícones do lucide-static'); process.exit(1); }

// nome usado no app -> arquivo lucide
const WANTED = {
  home: 'house', dashboard: 'layout-dashboard', users: 'users', radio: 'radio', network: 'network', megaphone: 'megaphone',
  trophy: 'trophy', bell: 'bell', 'chevron-left': 'chevron-left', 'chevron-right': 'chevron-right', 'chevron-down': 'chevron-down',
  copy: 'copy', 'user-plus': 'user-plus', 'shield-check': 'shield-check', 'circle-check': 'circle-check', 'clipboard-check': 'clipboard-check',
  flag: 'flag', heart: 'heart', calendar: 'calendar', 'calendar-clock': 'calendar-clock', user: 'user', 'log-out': 'log-out', settings: 'settings',
  plus: 'plus', trash: 'trash-2', pencil: 'pencil', link: 'link', share: 'share-2', 'qr-code': 'qr-code', 'credit-card': 'credit-card',
  banknote: 'banknote', clock: 'clock', play: 'play', pause: 'pause', undo: 'undo-2', x: 'x', 'circle-alert': 'circle-alert', info: 'info',
  'triangle-alert': 'triangle-alert', search: 'search', mail: 'mail', lock: 'lock', eye: 'eye', 'eye-off': 'eye-off', 'arrow-right': 'arrow-right',
  'arrow-left': 'arrow-left', save: 'save', download: 'download', 'external-link': 'external-link', upload: 'upload', image: 'image',
  volleyball: 'volleyball', goal: 'goal', shirt: 'shirt', sparkles: 'sparkles', 'wand-sparkles': 'wand-sparkles', timer: 'timer',
  whistle: 'whistle', swords: 'swords', medal: 'medal', menu: 'menu', 'scan-face': 'scan-face', 'file-text': 'file-text',
  'hand-heart': 'hand-heart', 'id-card': 'id-card', 'badge-check': 'badge-check', ticket: 'ticket', 'list-checks': 'list-checks',
  smartphone: 'smartphone', 'refresh-cw': 'refresh-cw', 'rotate-ccw': 'rotate-ccw', globe: 'globe', 'map-pin': 'map-pin', 'user-check': 'user-check',
  'door-open': 'door-open', 'door-closed': 'door-closed', 'shield-alert': 'shield-alert', 'circle-x': 'circle-x', check: 'check', minus: 'minus',
  'ellipsis': 'ellipsis', 'layout-grid': 'layout-grid', 'sliders': 'sliders-horizontal', 'user-round': 'user-round', 'key-round': 'key-round',
  'mail-plus': 'mail-plus', 'layers': 'layers', 'activity': 'activity', 'zap': 'zap', 'wallet': 'wallet', 'party-popper': 'party-popper',
  'bar-chart': 'chart-column', 'line-chart': 'chart-line', 'square': 'square', 'arrow-up-right': 'arrow-up-right', 'message-circle': 'message-circle',
  'camera': 'camera', 'filter': 'funnel', 'handshake': 'handshake', 'target': 'target', 'crown': 'crown', 'hourglass': 'hourglass',
};

const body = svg => {
  const m = svg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  return m[1].replace(/\s*\n\s*/g, '').replace(/ \/>/g, '/>').trim();
};

const map = {};
for (const [name, file] of Object.entries(WANTED)) {
  try { map[name] = body(readFileSync(join(dir, file + '.svg'), 'utf8')); }
  catch { console.error('Ícone não encontrado:', file); process.exitCode = 1; }
}

// Ícones próprios (lucide não possui bola de futebol / basquete)
map.soccer = '<circle cx="12" cy="12" r="10"/><path d="m12 7.2 3.9 2.8-1.5 4.6H9.6L8.1 10z"/><path d="M12 7.2V2.1M15.9 10l4.9-1.6M14.4 14.6l3 4.1M9.6 14.6l-3 4.1M8.1 10 3.2 8.4"/>';
map.basketball = '<circle cx="12" cy="12" r="10"/><path d="M12 2v20M2 12h20"/><path d="M4.9 4.9c3.3 3.3 3.3 10.9 0 14.2M19.1 4.9c-3.3 3.3-3.3 10.9 0 14.2"/>';

const out = `// ARQUIVO GERADO por scripts/gen-icons.mjs — não edite à mão.
// Ícones: Lucide (ISC License, veja vendor/LUCIDE-LICENSE.txt) + ícones próprios (soccer, basketball).
const PATHS = ${JSON.stringify(map, null, 1)};

export function icon(name, { size = 20, cls = '', label = '' } = {}) {
  const p = PATHS[name];
  if (!p) return '';
  const a11y = label ? \`role="img" aria-label="\${label}"\` : 'aria-hidden="true"';
  return \`<svg class="ico \${cls}" width="\${size}" height="\${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" \${a11y}>\${p}</svg>\`;
}
export const hasIcon = name => name in PATHS;
export const ICON_NAMES = Object.keys(PATHS);
`;
writeFileSync('public/assets/js/icons.js', out);
console.log('ícones gerados:', Object.keys(map).length);
