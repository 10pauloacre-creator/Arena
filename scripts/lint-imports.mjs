// Verificação simples de imports não utilizados (sem dependências). Uso: node scripts/lint-imports.mjs [--fix]
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FIX = process.argv.includes('--fix');
const roots = ['lib', 'public/assets/js', 'api', 'tests/unit', 'e2e', 'server.js'];
const skip = new Set(['node_modules', 'vendor', 'shots']);
const files = [];
(function walk(p) {
  let st; try { st = statSync(p); } catch { return; }
  if (st.isDirectory()) { for (const n of readdirSync(p)) if (!skip.has(n)) walk(join(p, n)); }
  else if (p.endsWith('.js') || p.endsWith('.mjs')) files.push(p);
})('.' === '' ? '' : '.');
let problems = 0;
for (const f of files.filter(f => roots.some(r => f === r || f.startsWith(r + '/')))) {
  let src = readFileSync(f, 'utf8'), changed = false;
  src = src.replace(/import \{([^}]*)\} from ('[^']+');?/g, (m, names, from) => {
    const list = names.split(',').map(s => s.trim()).filter(Boolean);
    const body = src.replace(m, '');
    const keep = list.filter(n => {
      const local = n.split(/\s+as\s+/).pop();
      const used = new RegExp(`(?<![\\w$])${local.replaceAll('$', '\\$')}(?![\\w$])`).test(body);
      if (!used) { console.log(`${f}: import não usado "${local}"`); problems++; }
      return used;
    });
    if (keep.length === list.length) return m;
    changed = true;
    return keep.length ? `import { ${keep.join(', ')} } from ${from};` : '';
  });
  if (FIX && changed) writeFileSync(f, src);
}
console.log(problems ? `${problems} import(s) não usado(s)${FIX ? ' (corrigidos)' : ''}` : 'imports ok');
process.exit(problems && !FIX ? 1 : 0);
