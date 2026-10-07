// Uso: node shots.mjs <saida> <caminho> [desktop|mobile] ...   (apenas para inspeção visual)
import { startApp, launch, DESKTOP, MOBILE, apiSignup, apiCall, loginContext } from './lib.mjs';
const [, , outDir, ...specs] = process.argv;
const app = await startApp();
const browser = await launch();
try {
  const acc = await apiSignup(app.base, 'Paulo Acre');
  const t = (await apiCall(app.base, acc.cookie, 'POST', '/tournaments', { name: 'COFAV - Copa de futsal Amigos da Vila 2026', sport: 'futsal', finalDate: '2026-11-14', demo: process.env.DEMO === '1' })).data.tournament;
  for (const spec of specs) {
    const [path, mode = 'desktop', auth = 'auth', wait = '600'] = spec.split('|');
    const url = app.base + path.replace('{id}', t.id);
    const ctx = auth === 'auth' ? await loginContext(browser, app.base, acc, mode === 'mobile' ? MOBILE : DESKTOP) : await browser.newContext(mode === 'mobile' ? MOBILE : DESKTOP);
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
    page.on('pageerror', e => console.log('[pageerror]', e.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(Number(wait));
    const name = path.replace(/[^a-z0-9]+/gi, '_').replace('{id}', 'T').slice(0, 40) + '_' + mode + '_' + auth;
    await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
    console.log('ok', name);
    await ctx.close();
  }
} finally { await browser.close(); app.stop(); }
