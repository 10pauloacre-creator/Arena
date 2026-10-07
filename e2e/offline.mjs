// E2E do modo offline (Chromium real, internet cortada com context.setOffline): Pelada, painel do organizador e visitante.
// Uso: cd e2e && npm install && node offline.mjs   (usa o Chromium instalado; CHROME_PATH opcional)
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startApp, launch, DESKTOP, MOBILE, apiSignup, apiCall, loginContext } from './lib.mjs';

const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

const app = await startApp();
const browser = await launch();
const results = [];
const consoleErrors = [];

async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✓ ${name} (${Date.now() - t0} ms)`); }
  catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✗ ${name}\n      ${String(err.message).split('\n').slice(0, 14).join('\n      ')}`);
    if (err.page) { try { await err.page.screenshot({ path: `${SHOTS}FAIL_off_${name.replace(/[^a-z0-9]+/gi, '_').slice(0, 50)}.png`, fullPage: true }); } catch { /* ignora */ } }
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error('Falha: ' + msg); };
const guard = async (page, fn) => { try { return await fn(); } catch (e) { e.page = page; throw e; } };
// erros esperados quando a internet está cortada não contam como erro de JavaScript
const watch = (page, tag) => {
  page.on('pageerror', e => consoleErrors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) consoleErrors.push(`[${tag}] console: ${m.text()}`); });
};
const T = { timeout: 10000 };
const seen = (page, text, o = T) => page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor(o);
const stamp = Date.now().toString(36);
const brToday = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

const api = async (who, method, path, body) => {
  const res = await fetch(app.base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(who?.cookie ? { Cookie: who.cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};
async function apiPlayer(name) {
  const res = await fetch(app.base + '/api/pelada/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, birth: '15/05/1992' }) });
  if (res.status !== 200) throw new Error('signup falhou ' + await res.text());
  return { name, cookie: res.headers.get('set-cookie').split(';')[0], player: (await res.json()).player };
}
async function cookieContext(who, opts) {
  const ctx = await browser.newContext(opts);
  const i = who.cookie.indexOf('=');
  await ctx.addCookies([{ name: who.cookie.slice(0, i), value: who.cookie.slice(i + 1), url: app.base }]);
  return ctx;
}

/** Espera o service worker controlar a página e o motor guardar a cópia dos dados (IndexedDB) — pré-requisito para ficar offline. */
async function readyForOffline(page, { replicas = true } = {}) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, T);
  if (!replicas) return;
  await page.waitForFunction(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('arena-offline'); r.onsuccess = () => res(r.result); r.onerror = rej; });
    const n = await new Promise(res => { const q = db.transaction('replicas').objectStore('replicas').count(); q.onsuccess = () => res(q.result); });
    db.close();
    return n > 0;
  }, null, T);
}
const chip = page => page.locator('.sync-chip:not([hidden])');
const chipState = (page, state, o = T) => page.locator(`.sync-chip[data-state="${state}"]`).waitFor(o);

console.log(`\nModo offline — E2E em ${app.base}\n`);

// ------------------------------------------------------------------ Pelada
await test('Pelada: sem internet o dia de jogo funciona (sorteio, partida, cronômetro, gols), sobrevive a recarregar e sincroniza sozinho', async () => {
  const owner = await apiPlayer(`Dono Sem Sinal ${stamp}`);
  const created = await api(owner, 'POST', '/pelada/peladas', { name: 'Pelada Sem Sinal', gender: 'masculino', minPerTeam: 3, matchMinutes: 10, days: [{ date: brToday(), matches: 0 }] });
  assert(created.status === 200, 'pelada criada: ' + JSON.stringify(created.data));
  const pel = created.data.pelada, dayId = pel.days[0].id;
  for (let i = 1; i <= 5; i++) {
    const p = await apiPlayer(`Atleta ${i} Sem Sinal ${stamp}`);
    await api(p, 'POST', `/pelada/peladas/${pel.id}/days/${dayId}/presence`, { present: true });
  }
  await api(owner, 'POST', `/pelada/peladas/${pel.id}/days/${dayId}/presence`, { present: true });

  const ctx = await cookieContext(owner, MOBILE); const page = await ctx.newPage(); watch(page, 'pelada-offline');
  await guard(page, async () => {
    await page.goto(`${app.base}/pelada/p/${pel.id}/d/${dayId}`);
    await seen(page, 'Lista de Confirmados');
    await readyForOffline(page);
    await seen(page, 'Lista de Confirmados');

    await ctx.setOffline(true);
    await chipState(page, 'offline');
    assert(/Sem internet/.test(await chip(page).innerText()), 'selo avisa que está sem internet');

    // sorteia, cria a partida, escolhe os times, inicia e marca gols — tudo sem internet
    await page.locator('[data-act=draw]').click();
    await seen(page, 'Times sorteados', { timeout: 15000 });
    await page.locator('[data-act=add-match]').click();
    const match = page.locator('.match').first();
    await match.waitFor(T);
    await match.locator('[data-slot=a]').click();
    await page.locator('dialog .pick:not([disabled])').first().click();
    await match.locator('[data-slot=b]').click();
    await page.locator('dialog .pick:not([disabled])').first().click();
    await match.getByRole('button', { name: 'Iniciar' }).click();
    await page.locator('.match.running').waitFor(T);
    const cols = match.locator('.sum-col');
    await cols.nth(0).locator('.chip-main').first().click();
    await cols.nth(0).locator('.chip-main').first().click();
    await cols.nth(1).locator('.chip-main').first().click();
    await page.waitForFunction(() => [...document.querySelectorAll('.match .big-score')].map(e => e.textContent).join('x') === '2x1', null, T);
    assert(/guardad/.test(await chip(page).innerText()), 'selo mostra as alterações guardadas: ' + await chip(page).innerText());
    await page.screenshot({ path: `${SHOTS}off_pelada_offline.png`, fullPage: true });

    // recarrega a página SEM internet: o app abre, com os times e o placar guardados
    await page.reload();
    await seen(page, 'Times sorteados');
    await page.waitForFunction(() => [...document.querySelectorAll('.match .big-score')].map(e => e.textContent).join('x') === '2x1', null, T);
    await chipState(page, 'offline');
    assert(/guardad/.test(await chip(page).innerText()), 'a fila sobrevive ao recarregar');

    // a internet volta: sincroniza sozinho
    await ctx.setOffline(false);
    await page.waitForFunction(() => { const c = document.querySelector('.sync-chip'); return !c || c.hidden || c.dataset.state === 'ok'; }, null, { timeout: 20000 });
    const truth = (await api(owner, 'GET', `/pelada/peladas/${pel.id}`)).data.pelada;
    const d = truth.days[0];
    assert(d.draw && d.draw.teams.length === 2, 'sorteio chegou ao servidor');
    assert(d.matches.length === 1 && d.matches[0].status === 'live', 'partida em andamento no servidor');
    assert(d.matches[0].goals.length === 3 && d.matches[0].score.a === 2 && d.matches[0].score.b === 1, 'os 3 gols chegaram ao servidor: ' + JSON.stringify(d.matches[0].score));
    assert(await page.locator('.sync-chip[data-state="error"]').count() === 0, 'nenhuma alteração falhou');
    await page.screenshot({ path: `${SHOTS}off_pelada_sincronizado.png`, fullPage: true });
  });
  await ctx.close();
});

await test('Pelada: abrir o app inteiro sem internet (painel, pelada) com os dados já vistos', async () => {
  const owner = await apiPlayer(`Dona Painel ${stamp}`);
  const created = await api(owner, 'POST', '/pelada/peladas', { name: 'Pelada do Painel Offline', gender: 'feminino', minPerTeam: 4, days: [{ date: brToday() }] });
  const id = created.data.pelada.id;
  const ctx = await cookieContext(owner, MOBILE); const page = await ctx.newPage(); watch(page, 'pelada-painel');
  await guard(page, async () => {
    await page.goto(`${app.base}/pelada/painel`);
    await seen(page, 'Pelada do Painel Offline');
    await page.goto(`${app.base}/pelada/p/${id}`);
    await seen(page, 'Pelada do Painel Offline');
    await readyForOffline(page);
    await ctx.setOffline(true);
    await page.reload();
    await seen(page, 'Pelada do Painel Offline');
    await page.goto(`${app.base}/pelada/painel`).catch(() => {});
    await seen(page, 'Pelada do Painel Offline');
    await ctx.setOffline(false);
  });
  await ctx.close();
});

// ------------------------------------------------------------------ ArenaMaster: painel do organizador
await test('ArenaMaster: organizador marca o placar ao vivo sem internet, recarrega e tudo sincroniza', async () => {
  const org = await apiSignup(app.base, 'Dono Placar Offline');
  const call = (m, p, b) => apiCall(app.base, org.cookie, m, p, b);
  const t = (await call('POST', '/tournaments', { name: 'Copa Sem Sinal', sport: 'futebol', demo: true })).data.tournament;
  const key = (await call('POST', `/tournaments/${t.id}/draw`)).data.tournament.bracket.rounds[0].matches[0].key;

  const ctx = await loginContext(browser, app.base, org, DESKTOP); const page = await ctx.newPage(); watch(page, 'admin-offline');
  await guard(page, async () => {
    await page.goto(`${app.base}/admin/${t.id}/ao-vivo`);
    await seen(page, 'Jogos ao vivo');
    await page.waitForSelector('.scoreboard');
    await readyForOffline(page);
    await page.waitForSelector('.scoreboard');

    await ctx.setOffline(true);
    await chipState(page, 'offline');
    await page.getByRole('button', { name: 'Iniciar jogo' }).click();
    await page.locator('.scoreboard .badge.live').waitFor(T);
    const plusA = page.locator('.sb-controls .ctl').first().locator('[data-act=plus]');
    await plusA.click(); await plusA.click();
    await page.locator('.sb-controls .ctl').nth(1).locator('[data-act=plus]').click();
    await page.waitForFunction(() => document.querySelector('.scoreboard .sb-score')?.innerText.replace(/\s+/g, '') === '2:1', null, T);
    assert(/guardad/.test(await chip(page).innerText()), 'selo mostra as alterações guardadas');

    await page.reload();                                   // sem internet: o painel abre com o placar guardado
    await page.waitForFunction(() => document.querySelector('.scoreboard .sb-score')?.innerText.replace(/\s+/g, '') === '2:1', null, T);
    await chipState(page, 'offline');

    await ctx.setOffline(false);
    await page.waitForFunction(() => { const c = document.querySelector('.sync-chip'); return !c || c.hidden || c.dataset.state === 'ok'; }, null, { timeout: 20000 });
    const truth = (await call('GET', `/tournaments/${t.id}`)).data.tournament;
    const m = truth.bracket.rounds[0].matches.find(x => x.key === key);
    assert(m.score.a === 2 && m.score.b === 1, 'placar no servidor: ' + JSON.stringify(m.score));
    assert(m.events.filter(e => e.type === 'goal').length === 3 && m.phase === 'live', 'três gols e partida ao vivo no servidor');
  });
  await ctx.close();
});

await test('ArenaMaster: o organizador abre a lista de torneios e o painel sem internet', async () => {
  const org = await apiSignup(app.base, 'Dona Lista Offline');
  const call = (m, p, b) => apiCall(app.base, org.cookie, m, p, b);
  const t = (await call('POST', '/tournaments', { name: 'Copa da Lista Offline', sport: 'futsal' })).data.tournament;
  const ctx = await loginContext(browser, app.base, org, DESKTOP); const page = await ctx.newPage(); watch(page, 'admin-lista');
  await guard(page, async () => {
    await page.goto(`${app.base}/`);
    await seen(page, 'Copa da Lista Offline');
    await page.goto(`${app.base}/admin/${t.id}`);
    await seen(page, 'Copa da Lista Offline');
    await readyForOffline(page);
    await ctx.setOffline(true);
    await page.goto(`${app.base}/`).catch(() => {});
    await seen(page, 'Copa da Lista Offline');          // continua logado e com a lista guardada
    await page.goto(`${app.base}/admin/${t.id}/times`).catch(() => {});
    await seen(page, 'Times e inscrições');
    await ctx.setOffline(false);
  });
  await ctx.close();
});

// ------------------------------------------------------------------ ArenaMaster: visitante
await test('Visitante: o torneio abre sem internet e a inscrição gratuita feita offline é enviada sozinha quando a internet volta', async () => {
  const org = await apiSignup(app.base, 'Dona Visitante Offline');
  const t = (await apiCall(app.base, org.cookie, 'POST', '/tournaments', { name: 'Copa Livre Sem Sinal', sport: 'volei' })).data.tournament;
  const ctx = await browser.newContext(MOBILE); const page = await ctx.newPage(); watch(page, 'visitante-offline');
  await guard(page, async () => {
    await page.goto(`${app.base}/t/${t.id}`);
    await seen(page, 'Inscrições abertas');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, T);
    await seen(page, 'Inscrições abertas');

    await ctx.setOffline(true);
    await page.reload();
    await seen(page, 'Copa Livre Sem Sinal');            // a página abre com a última cópia
    await page.goto(`${app.base}/t/${t.id}/inscricao`).catch(() => {});
    await page.fill('#tf-name', 'Vôlei Sem Sinal'); await page.fill('#tf-cname', 'Capitã Bia'); await page.fill('#tf-cphone', '21988887777'); await page.fill('#tf-cmail', 'bia@teste.com');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('button', { name: 'Preencher elenco de exemplo' }).click();
    await page.locator('[data-act=next2]').click();
    await page.getByRole('button', { name: 'Concluir inscrição' }).click();
    await seen(page, 'Inscrição guardada neste aparelho');
    await chipState(page, 'offline');

    await ctx.setOffline(false);
    await seen(page, 'Inscrição confirmada!', { timeout: 20000 });  // enviada sozinha; mostra o código do capitão
    const teams = (await apiCall(app.base, org.cookie, 'GET', `/tournaments/${t.id}`)).data.tournament.teams.filter(x => x.name === 'Vôlei Sem Sinal');
    assert(teams.length === 1 && teams[0].status === 'confirmed', 'o time foi criado uma única vez: ' + JSON.stringify(teams.map(x => x.status)));
    const saved = await page.evaluate(id => localStorage.getItem('am_team_' + id), t.id);
    assert(saved && JSON.parse(saved).code === teams[0].accessCode, 'o código do capitão ficou salvo para "Meu time"');
  });
  await ctx.close();
});

await test('Visitante: inscrição com taxa NÃO é guardada offline (pagamento exige internet) e o formulário não se perde', async () => {
  const org = await apiSignup(app.base, 'Dono Taxa Offline');
  const call = (m, p, b) => apiCall(app.base, org.cookie, m, p, b);
  const t = (await call('POST', '/tournaments', { name: 'Copa Paga Sem Sinal', sport: 'volei' })).data.tournament;
  await call('PATCH', `/tournaments/${t.id}`, { fee: 5000 });
  const ctx = await browser.newContext(MOBILE); const page = await ctx.newPage(); watch(page, 'visitante-taxa');
  await guard(page, async () => {
    await page.goto(`${app.base}/t/${t.id}/inscricao`);
    await page.fill('#tf-name', 'Time Pago Offline'); await page.fill('#tf-cname', 'Capitão Zé'); await page.fill('#tf-cphone', '21988887777'); await page.fill('#tf-cmail', 'ze@teste.com');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('button', { name: 'Preencher elenco de exemplo' }).click();
    await page.locator('[data-act=next2]').click();
    await ctx.setOffline(true);
    await page.getByRole('button', { name: 'Ir para o pagamento' }).click();
    await seen(page, 'precisa de conexão');
    assert(await page.getByRole('button', { name: 'Ir para o pagamento' }).isVisible(), 'continua na revisão para tentar de novo');
    await ctx.setOffline(false);
    await page.getByRole('button', { name: 'Ir para o pagamento' }).click();
    await seen(page, 'Vaga reservada');
  });
  await ctx.close();
});

await test('sem erros de JavaScript no console durante todo o fluxo', async () => {
  assert(consoleErrors.length === 0, 'erros no console:\n' + consoleErrors.join('\n'));
});

await browser.close(); app.stop();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram.`);
if (failed.length) { failed.forEach(f => console.log(`\n✗ ${f.name}\n${f.err.stack?.split('\n').slice(0, 5).join('\n')}`)); console.log('\nServidor:\n' + app.logs().slice(-1500)); process.exit(1); }
