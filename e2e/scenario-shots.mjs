// Cria um torneio de demonstração em andamento e tira screenshots para inspeção visual.
// Uso: node scenario-shots.mjs <saida> [mobile|desktop|both]
import { startApp, launch, DESKTOP, MOBILE, apiSignup, apiCall, loginContext } from './lib.mjs';
const [, , out, which = 'both'] = process.argv;
const app = await startApp();
const browser = await launch();
const log = [];
try {
  const acc = await apiSignup(app.base, 'Paulo Acre');
  const call = (m, p, b) => apiCall(app.base, acc.cookie, m, p, b);
  const t = (await call('POST', '/tournaments', { name: 'COFAV - Copa de futsal Amigos da Vila 2026', sport: 'futsal', finalDate: '2026-11-14', demo: true })).data.tournament;
  await call('PATCH', `/tournaments/${t.id}`, { fee: 5000, venue: 'Ginásio Municipal da Vila', description: 'Torneio beneficente com 8 times. Premiação em troféus e medalhas.' });
  let v = (await call('POST', `/tournaments/${t.id}/draw`)).data.tournament;
  const qf = v.bracket.rounds[0].matches;
  await call('POST', `/tournaments/${t.id}/matches/${qf[0].key}`, { action: 'result', sa: 3, sb: 1 });
  await call('POST', `/tournaments/${t.id}/matches/${qf[1].key}`, { action: 'result', sa: 2, sb: 0 });
  await call('POST', `/tournaments/${t.id}/donations`, { teamId: qf[0].b, amount: 5000, cause: 'Banco de Alimentos local' });
  await call('POST', `/tournaments/${t.id}/matches/${qf[2].key}`, { action: 'start' });
  for (const [team, num] of [['a', 9], ['b', 10], ['a', 7]]) await call('POST', `/tournaments/${t.id}/matches/${qf[2].key}`, { action: 'event', type: 'goal', team, num });
  await call('POST', `/tournaments/${t.id}/matches/${qf[2].key}`, { action: 'event', type: 'yellow', team: 'b', num: 5 });
  const pages = [
    ['admin_painel', `/admin/${t.id}`, 'auth'], ['admin_times', `/admin/${t.id}/times`, 'auth'], ['admin_aovivo', `/admin/${t.id}/ao-vivo`, 'auth'],
    ['admin_chave', `/admin/${t.id}/chaveamento`, 'auth'], ['admin_marketing', `/admin/${t.id}/marketing`, 'auth'], ['admin_config', `/admin/${t.id}/configuracoes`, 'auth'],
    ['visit_home', `/t/${t.id}`, 'anon'], ['visit_jogos', `/t/${t.id}/jogos`, 'anon'], ['visit_chave', `/t/${t.id}/chaveamento`, 'anon'], ['visit_times', `/t/${t.id}/times`, 'anon'],
    ['visit_inscricao', `/t/${t.id}/inscricao`, 'anon'], ['visit_meutime', `/t/${t.id}/meu-time`, 'anon'],
  ];
  for (const mode of which === 'both' ? ['desktop', 'mobile'] : [which]) {
    for (const [name, path, auth] of pages) {
      const opts = mode === 'mobile' ? MOBILE : DESKTOP;
      const ctx = auth === 'auth' ? await loginContext(browser, app.base, acc, opts) : await browser.newContext(opts);
      const page = await ctx.newPage();
      page.on('console', m => { if (m.type() === 'error') log.push(`[${name}/${mode}] console.error: ${m.text()}`); });
      page.on('pageerror', e => log.push(`[${name}/${mode}] pageerror: ${e.message}`));
      await page.goto(app.base + path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(700);
      const ov = await page.evaluate(() => {
        const vw = window.innerWidth, over = document.documentElement.scrollWidth - vw;
        if (over <= 1) return null;
        const bad = [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > vw + 1 && !e.closest('.bracket-scroll,.seg,.table-wrap,pre,dialog')).slice(0, 4).map(e => e.tagName + '.' + String(e.className).slice(0, 40));
        return { over, bad };
      });
      if (ov) log.push(`[${name}/${mode}] OVERFLOW +${ov.over}px: ${ov.bad.join(' | ')}`);
      await page.screenshot({ path: `${out}/${name}_${mode}.png`, fullPage: true });
      await ctx.close();
    }
  }
  console.log('tournament', t.id); console.log(log.join('\n') || 'sem erros de console');
} finally { await browser.close(); app.stop(); }
