// Auditoria de acessibilidade (axe-core) nas telas do app Pelada (desktop e mobile).
// Uso: node pelada-a11y.mjs   (sai com código 1 se houver violações "serious" ou "critical")
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startApp, launch, DESKTOP, MOBILE } from './lib.mjs';
const require = createRequire(import.meta.url);
const axeSrc = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const app = await startApp(); const browser = await launch();
const H = { 'Content-Type': 'application/json' };
const player = async name => { const r = await fetch(app.base + '/api/pelada/auth/signup', { method: 'POST', headers: H, body: JSON.stringify({ name, birth: '15/05/1992' }) }); return { cookie: r.headers.get('set-cookie').split(';')[0], p: (await r.json()).player }; };
const call = (c, m, path, body) => fetch(app.base + '/api' + path, { method: m, headers: { ...H, Cookie: c.cookie }, body: body ? JSON.stringify(body) : undefined }).then(r => r.json());
let bad = 0;
try {
  const owner = await player('Auditora Pelada');
  const d = new Date(); const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const cr = await call(owner, 'POST', '/pelada/peladas', { name: 'Pelada Acessível', gender: 'feminino', minPerTeam: 5, matchMinutes: 10, days: [{ date: iso, matches: 1 }] });
  const id = cr.pelada.id, dayId = cr.pelada.days[0].id;
  for (let i = 0; i < 11; i++) { const p = i === 0 ? owner : await player('Jogadora Auditoria ' + i); await call(p, 'POST', `/pelada/peladas/${id}/days/${dayId}/presence`, { present: true }); }
  const dr = await call(owner, 'POST', `/pelada/peladas/${id}/days/${dayId}/draw`);
  const teams = dr.pelada.days[0].draw.teams;
  const mid = dr.pelada.days[0].matches[0].id;
  await call(owner, 'PATCH', `/pelada/peladas/${id}/days/${dayId}/matches/${mid}`, { a: teams[0].id, b: teams[1].id });
  await call(owner, 'POST', `/pelada/peladas/${id}/days/${dayId}/matches/${mid}/goals`, { teamId: teams[0].id, pid: teams[0].players[0] });
  const pages = [['/pelada/', 'anon'], ['/pelada/entrar', 'anon'], [`/pelada/p/${id}`, 'anon'], [`/pelada/p/${id}/historico`, 'anon'], [`/pelada/p/${id}/artilharia`, 'anon'], [`/pelada/p/${id}/d/${dayId}`, 'anon'],
    ['/pelada/painel', 'auth'], ['/pelada/nova', 'auth'], [`/pelada/p/${id}`, 'auth'], [`/pelada/p/${id}/d/${dayId}`, 'auth'], [`/pelada/p/${id}/editar`, 'auth']];
  for (const [mode, opts] of [['desktop', DESKTOP], ['mobile', MOBILE]]) {
    for (const [path, auth] of pages) {
      const ctx = await browser.newContext(opts);
      if (auth === 'auth') { const i = owner.cookie.indexOf('='); await ctx.addCookies([{ name: owner.cookie.slice(0, i), value: owner.cookie.slice(i + 1), url: app.base }]); }
      const page = await ctx.newPage();
      await page.goto(app.base + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
      await page.evaluate(axeSrc);
      const res = await page.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'], resultTypes: ['violations'] }));
      const serious = res.violations.filter(x => x.impact === 'serious' || x.impact === 'critical');
      const minor = res.violations.filter(x => !(x.impact === 'serious' || x.impact === 'critical'));
      if (serious.length) { bad += serious.length; console.log(`✗ [${mode}/${auth}] ${path}`); serious.forEach(x => console.log(`    ${x.impact} · ${x.id}: ${x.help} (${x.nodes.length}) → ${x.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`)); }
      else console.log(`✓ [${mode}/${auth}] ${path}${minor.length ? `  (${minor.length} avisos menores: ${minor.map(x => x.id).join(', ')})` : ''}`);
      await ctx.close();
    }
  }
} finally { await browser.close(); app.stop(); }
console.log(bad ? `\n${bad} violações sérias.` : '\nSem violações sérias de acessibilidade.');
process.exit(bad ? 1 : 0);
