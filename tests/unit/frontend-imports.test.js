// Garante que todos os módulos do front-end carregam (imports e exports válidos), sem precisar de navegador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../public/assets/js', import.meta.url)));
function walk(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'vendor' ? [] : walk(p);
    return p.endsWith('.js') && n !== 'main.js' ? [p] : [];
  });
}

test('todos os módulos do front-end importam sem erro', async () => {
  const files = walk(ROOT);
  assert.ok(files.length > 20);
  const failures = [];
  for (const f of files) {
    try { await import(pathToFileURL(f).href); } catch (e) { failures.push(`${f.replace(ROOT, '')}: ${e.message}`); }
  }
  assert.deepEqual(failures, []);
});

test('páginas exportam uma função default', async () => {
  const pages = walk(join(ROOT, 'pages'));
  for (const f of pages) {
    const m = await import(pathToFileURL(f).href);
    assert.equal(typeof m.default, 'function', f);
  }
});
