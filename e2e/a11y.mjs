// Auditoria de acessibilidade com axe-core nas principais telas (desktop e mobile).
// Uso: node a11y.mjs        (sai com código 1 se houver violações "serious" ou "critical")
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startApp, launch, DESKTOP, MOBILE, apiSignup, apiCall, loginContext } from './lib.mjs';
const require = createRequire(import.meta.url);
const axeSrc = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const app = await startApp(); const browser = await launch();
let bad = 0;
try {
  const acc = await apiSignup(app.base, 'Auditor A11y');
  const call = (m, p, b) => apiCall(app.base, acc.cookie, m, p, b);
  const t = (await call('POST', '/tournaments', { name: 'Copa Acessibilidade', sport: 'futsal', demo: true })).data.tournament;
  const v = (await call('POST', `/tournaments/${t.id}/draw`)).data.tournament;
  await call('POST', `/tournaments/${t.id}/matches/${v.bracket.rounds[0].matches[0].key}`, { action: 'start' });
  const open = (await call('POST', '/tournaments', { name: 'Copa Aberta', sport: 'futebol' })).data.tournament;
  const pages = [['/', 'anon'], ['/entrar', 'anon'], ['/cadastro', 'anon'], [`/t/${t.id}`, 'anon'], [`/t/${t.id}/jogos`, 'anon'], [`/t/${t.id}/chaveamento`, 'anon'], [`/t/${t.id}/times`, 'anon'], [`/t/${open.id}/inscricao`, 'anon'], [`/t/${open.id}/meu-time`, 'anon'],
    ['/', 'auth'], [`/admin/${t.id}`, 'auth'], [`/admin/${t.id}/times`, 'auth'], [`/admin/${t.id}/ao-vivo`, 'auth'], [`/admin/${t.id}/chaveamento`, 'auth'], [`/admin/${t.id}/marketing`, 'auth'], [`/admin/${t.id}/configuracoes`, 'auth']];
  for (const [mode, opts] of [['desktop', DESKTOP], ['mobile', MOBILE]]) {
    for (const [path, auth] of pages) {
      const ctx = auth === 'auth' ? await loginContext(browser, app.base, acc, opts) : await browser.newContext(opts);
      const page = await ctx.newPage();
      await page.goto(app.base + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
      await page.evaluate(axeSrc);
      const res = await page.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'], resultTypes: ['violations'] }));
      const serious = res.violations.filter(x => x.impact === 'serious' || x.impact === 'critical');
      const minor = res.violations.filter(x => !(x.impact === 'serious' || x.impact === 'critical'));
      if (serious.length) { bad += serious.length; console.log(`✗ [${mode}] ${path}`); serious.forEach(x => console.log(`    ${x.impact} · ${x.id}: ${x.help} (${x.nodes.length}) → ${x.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')}`)); }
      else console.log(`✓ [${mode}] ${path}${minor.length ? `  (${minor.length} avisos menores: ${minor.map(x => x.id).join(', ')})` : ''}`);
      await ctx.close();
    }
  }
} finally { await browser.close(); app.stop(); }
console.log(bad ? `\n${bad} violações sérias.` : '\nSem violações sérias de acessibilidade.');
process.exit(bad ? 1 : 0);
