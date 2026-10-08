// E2E das notificações no app Pelada: sininho com contador, painel, aviso na tela, página, configurações e silenciar pelada.
// Uso: cd e2e && npm install && node pelada-notificacoes.mjs   (usa o Chromium instalado; CHROME_PATH opcional)
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startApp, launch, DESKTOP, MOBILE } from './lib.mjs';

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
    console.log(`  ✗ ${name}\n      ${String(err.message).split('\n').slice(0, 12).join('\n      ')}`);
    if (err.page) { try { await err.page.screenshot({ path: `${SHOTS}FAIL_ntf_${name.replace(/[^a-z0-9]+/gi, '_').slice(0, 50)}.png`, fullPage: true }); } catch { /* ignora */ } }
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error('Falha: ' + msg); };
const guard = async (page, fn) => { try { return await fn(); } catch (e) { e.page = page; throw e; } };
const watch = (page, tag) => {
  page.on('pageerror', e => consoleErrors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource.*(400|401|403|404|409|429)/.test(m.text())) consoleErrors.push(`[${tag}] console: ${m.text()}`); });
};
const T = { timeout: 9000 };
const shot = (page, n) => page.screenshot({ path: `${SHOTS}ntf_${n}.png`, fullPage: false });
const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
/** Pede uma leitura na hora (o app relê ao voltar para a aba). */
const poke = page => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

async function apiPlayer(name) {
  const res = await fetch(app.base + '/api/pelada/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, birth: '15/05/1992' }) });
  if (res.status !== 200) throw new Error('signup falhou ' + await res.text());
  const p = { name, cookie: res.headers.get('set-cookie').split(';')[0], player: (await res.json()).player };
  p.call = async (method, path, body) => {
    const r = await fetch(app.base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', Cookie: p.cookie }, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => null);
    if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(data)}`);
    return data;
  };
  return p;
}
async function contextFor(p, opts = DESKTOP) {
  const ctx = await browser.newContext(opts);
  const i = p.cookie.indexOf('=');
  await ctx.addCookies([{ name: p.cookie.slice(0, i), value: p.cookie.slice(i + 1), url: app.base }]);
  return ctx;
}

console.log(`\nPelada — notificações (E2E) em ${app.base}\n`);
const stamp = Date.now().toString(36);
const org = await apiPlayer(`Organizadora ${stamp}`);
const ana = await apiPlayer(`Ana Paula ${stamp}`);
const bia = await apiPlayer(`Bia Souza ${stamp}`);
const cris = await apiPlayer(`Cris Lima ${stamp}`);
const created = await org.call('POST', '/pelada/peladas', { name: 'Pelada das Notificações', gender: 'feminino', minPerTeam: 2, matchMinutes: 10, days: [{ date: today }] });
const pid = created.pelada.id, dayId = created.pelada.days[0].id;
const dayPath = `/pelada/peladas/${pid}/days/${dayId}`;
for (const p of [ana, bia, cris]) await p.call('POST', `/pelada/peladas/${pid}/join`);

let orgCtx, orgPage, anaCtx, anaPage;

await test('sininho mostra o número de novidades e o painel lista quem entrou na pelada', async () => {
  orgCtx = await contextFor(org); orgPage = await orgCtx.newPage(); watch(orgPage, 'org');
  await guard(orgPage, async () => {
    await orgPage.goto(app.base + '/pelada/painel');
    const count = orgPage.locator('[data-bell] [data-bell-count]');
    await count.waitFor({ state: 'visible', ...T });
    assert(Number(await count.textContent()) >= 3, 'contador com as 3 entradas');
    await orgPage.locator('[data-bell]').click();
    const dlg = orgPage.locator('dialog.ntf-dlg');
    await dlg.getByText(`${ana.name} entrou na pelada.`).waitFor(T);
    await dlg.getByText(`${cris.name} entrou na pelada.`).waitFor(T);
    assert(await dlg.locator('.ntf-item.unread').count() >= 3, 'itens novos destacados');
    await shot(orgPage, '01_painel_desktop');
    await count.waitFor({ state: 'hidden', ...T }); // abrir o painel marca como lidas
    // tocar no item leva para a lista de jogadores
    await dlg.getByText(`${ana.name} entrou na pelada.`).click();
    await orgPage.waitForURL(`**/pelada/p/${pid}/jogadores`, T);
    await orgPage.locator('dialog.ntf-dlg').waitFor({ state: 'detached', ...T }); // painel fecha ao abrir o item
  });
});

await test('presença confirmada com o app aberto: aviso na tela + contador', async () => {
  await guard(orgPage, async () => {
    await orgPage.goto(app.base + `/pelada/p/${pid}/d/${dayId}`);
    await orgPage.locator('[data-bell]').waitFor(T);
    await poke(orgPage); await orgPage.waitForTimeout(400); // primeira leitura desta página (não gera aviso)
    await ana.call('POST', `${dayPath}/presence`, { present: true });
    await poke(orgPage);
    const t = orgPage.locator('.toast', { hasText: `Presença confirmada: ${ana.name} confirmou presença no jogo de hoje (1 confirmada).` });
    await t.waitFor(T);
    assert((await orgPage.locator('[data-bell-count]').textContent()) === '1', 'contador = 1');
    await shot(orgPage, '02_aviso_presenca');
    await t.getByRole('button', { name: 'Ver' }).click();
    await orgPage.locator('[data-bell-count]').waitFor({ state: 'hidden', ...T });
  });
});

await test('participante (celular): sorteio diz em qual time ela ficou; resultado com o placar', async () => {
  anaCtx = await contextFor(ana, MOBILE); anaPage = await anaCtx.newPage(); watch(anaPage, 'ana');
  await guard(anaPage, async () => {
    for (const p of [org, bia, cris]) await p.call('POST', `${dayPath}/presence`, { present: true });
    await org.call('POST', `${dayPath}/draw`);
    const pel = (await org.call('GET', `/pelada/peladas/${pid}`)).pelada;
    const d = pel.days[0];
    const mine = d.draw.teams.find(t => t.players.includes(`u:${ana.player.id}`));
    const [t1, t2] = d.draw.teams;
    const m = await org.call('POST', `${dayPath}/matches`, { a: t1.id, b: t2.id });
    await org.call('POST', `${dayPath}/matches/${m.matchId}/timer`, { action: 'start' });
    await org.call('POST', `${dayPath}/matches/${m.matchId}/goals`, { teamId: t1.id, pid: t1.players[0] });
    await org.call('POST', `${dayPath}/matches/${m.matchId}/finish`);

    await anaPage.goto(app.base + '/pelada/notificacoes');
    await anaPage.getByText(`Você está no ${mine.label}.`, { exact: false }).waitFor(T);
    await anaPage.getByText('Resultado da partida 1').waitFor(T);
    await anaPage.getByText(`${t1.label} 1 × 0 ${t2.label}.`, { exact: false }).waitFor(T);
    await anaPage.getByRole('heading', { name: 'Hoje' }).waitFor(T);
    assert(!(await anaPage.getByText('Bola rolando').count()), '"início das partidas" vem desligado');
    const over = await anaPage.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(over <= 1, `sem rolagem horizontal (${over}px)`);
    await shot(anaPage, '03_pagina_celular');
    await anaPage.locator('[data-bell]').click();
    await anaPage.locator('dialog.ntf-dlg').getByText('Resultado da partida 1').waitFor(T);
    await shot(anaPage, '04_painel_celular');
    await anaPage.keyboard.press('Escape');
  });
});

await test('configurações: desligar um tipo vale na hora e fica salvo; ligar "Início das partidas"', async () => {
  await guard(anaPage, async () => {
    await anaPage.goto(app.base + '/pelada/configuracoes');
    const presence = anaPage.getByRole('checkbox', { name: /Presenças no jogo do dia/ });
    await presence.waitFor({ state: 'attached', ...T });
    assert(await presence.isChecked(), 'presenças ligadas por padrão');
    assert(!(await anaPage.getByRole('checkbox', { name: /Início das partidas/ }).isChecked()), 'início desligado por padrão');
    await presence.locator('xpath=..').click();
    await anaPage.getByText('✓ Preferências salvas.').waitFor(T);
    await anaPage.getByRole('checkbox', { name: /Início das partidas/ }).locator('xpath=..').click();
    await anaPage.waitForFunction(() => document.querySelector('[data-save-status]')?.textContent.includes('salvas'));
    await anaPage.waitForTimeout(300);
    const prefs = (await ana.call('GET', '/pelada/notifications/prefs')).prefs;
    assert(prefs.types.presence === false && prefs.types.match === true, 'salvo no servidor: ' + JSON.stringify(prefs.types));
    await shot(anaPage, '05_configuracoes_celular');
    // a presença de outra pessoa não aparece mais para a Ana
    const inbox = await ana.call('GET', '/pelada/notifications');
    assert(!inbox.items.some(i => i.type === 'presence'), 'sem avisos de presença');
    await anaPage.reload();
    await anaPage.getByRole('checkbox', { name: /Presenças no jogo do dia/ }).waitFor({ state: 'attached', ...T });
    assert(!(await anaPage.getByRole('checkbox', { name: /Presenças no jogo do dia/ }).isChecked()), 'continua desligado depois de recarregar');
  });
});

await test('avisos no celular: ativar neste aparelho (permissão + inscrição enviada ao servidor), botão de teste e desativar', async () => {
  const cp = await apiPlayer(`Push ${stamp}`);
  const ctx = await contextFor(cp, MOBILE);
  await ctx.grantPermissions(['notifications'], { origin: app.base });
  // o Chromium de teste não alcança os serviços reais de push: uma inscrição de mentira (com chaves de verdade) prova a ligação do app
  await ctx.addInitScript(() => {
    const fake = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-' + Math.random().toString(36).slice(2),
      toJSON() { return { endpoint: this.endpoint, keys: { p256dh: window.__p256dh, auth: window.__auth } }; },
      unsubscribe: async () => { window.__unsubscribed = true; window.__sub = null; return true; },
    };
    window.__subscribeCalls = [];
    PushManager.prototype.getSubscription = async function () { return window.__sub || null; };
    PushManager.prototype.subscribe = async function (opts) { window.__subscribeCalls.push(opts); window.__sub = fake; return fake; };
  });
  const p = await ctx.newPage(); watch(p, 'push');
  const calls = [];
  p.on('response', r => { if (r.url().includes('/api/pelada/push/')) calls.push(`${r.request().method()} ${r.url().split('/api/pelada/push/')[1]} ${r.status()}`); });
  const { createECDH, randomBytes } = await import('node:crypto');
  const e = createECDH('prime256v1'); e.generateKeys();
  await p.addInitScript(({ k, a }) => { window.__p256dh = k; window.__auth = a; }, { k: e.getPublicKey().toString('base64url'), a: randomBytes(16).toString('base64url') });
  await guard(p, async () => {
    await p.goto(app.base + '/pelada/configuracoes');
    await p.getByText('Avisos no celular').first().waitFor(T);
    await p.getByRole('button', { name: /Ativar neste aparelho/ }).click();
    await p.getByRole('button', { name: /Desativar neste aparelho/ }).waitFor(T);
    const sub = await p.evaluate(() => window.__subscribeCalls.map(o => ({ vis: o.userVisibleOnly, keyLen: new Uint8Array(o.applicationServerKey).length })));
    assert(sub.length === 1 && sub[0].vis === true && sub[0].keyLen === 65, 'inscrição pedida com a chave VAPID do servidor: ' + JSON.stringify(sub));
    assert(calls.includes('GET key 200') && calls.includes('POST subscribe 200'), 'o servidor recebeu a inscrição: ' + calls.join(', '));
    assert(calls.some(c => c.startsWith('POST test')), 'aviso de teste enviado ao ativar (a rede real pode recusar a inscrição de mentira)');
    await shot(p, '06_push_ativo');
    await p.getByRole('button', { name: /Desativar neste aparelho/ }).click();
    await p.getByRole('button', { name: /Ativar neste aparelho/ }).waitFor(T);
    assert(await p.evaluate(() => window.__unsubscribed === true), 'inscrição do navegador removida');
    assert(calls.includes('POST unsubscribe 200'), 'o servidor removeu o aparelho: ' + calls.join(', '));
  });
  await ctx.close();
});

await test('silenciar só esta pelada pela página da pelada e reativar', async () => {
  await guard(anaPage, async () => {
    await anaPage.goto(app.base + `/pelada/p/${pid}`);
    const btn = anaPage.locator('[data-mute]');
    await btn.waitFor(T);
    assert((await btn.textContent()).includes('Notificações ativadas'), 'começa ativado');
    await btn.click();
    await anaPage.locator('[data-mute]', { hasText: 'Notificações silenciadas' }).waitFor(T);
    assert((await ana.call('GET', '/pelada/notifications/prefs')).prefs.muted.includes(pid), 'pelada silenciada no servidor');
    assert((await ana.call('GET', '/pelada/notifications')).items.length === 0, 'nenhum aviso desta pelada');
    await anaPage.goto(app.base + '/pelada/configuracoes');
    const sw = anaPage.getByRole('checkbox', { name: 'Receber notificações de Pelada das Notificações' });
    await sw.waitFor({ state: 'attached', ...T });
    assert(!(await sw.isChecked()), 'configurações mostram a pelada silenciada');
    await sw.locator('xpath=..').click();
    await anaPage.getByText('✓ Preferências salvas.').waitFor(T);
    assert(!(await ana.call('GET', '/pelada/notifications/prefs')).prefs.muted.length, 'reativada');
  });
});

await test('desligar todas: sem contador e a página explica como religar (modo escuro)', async () => {
  await guard(orgPage, async () => {
    await orgPage.evaluate(() => { localStorage.setItem('am-theme', 'dark'); });
    await orgPage.goto(app.base + '/pelada/configuracoes');
    const master = orgPage.getByRole('checkbox', { name: /Receber notificações/ }).first();
    await master.waitFor({ state: 'attached', ...T });
    await master.locator('xpath=..').click();
    await orgPage.getByText('✓ Preferências salvas.').waitFor(T);
    assert(await orgPage.getByRole('checkbox', { name: /Aviso na tela/ }).isDisabled(), 'opções ficam desativadas');
    await shot(orgPage, '06_configuracoes_escuro');
    await bia.call('POST', `${dayPath}/presence`, { present: false });
    await orgPage.goto(app.base + '/pelada/notificacoes');
    await orgPage.getByText('Notificações desligadas').waitFor(T);
    assert(await orgPage.locator('[data-bell-count]').isHidden(), 'sem contador');
    await orgPage.getByRole('link', { name: /Abrir configurações/ }).click();
    await orgPage.waitForURL('**/pelada/configuracoes', T);
    await orgPage.evaluate(() => localStorage.removeItem('am-theme'));
  });
});

await test('menu da conta leva a Notificações e Configurações', async () => {
  await guard(anaPage, async () => {
    await anaPage.goto(app.base + '/pelada/painel');
    await anaPage.locator('[data-menu-btn]').click();
    await anaPage.getByRole('menuitem', { name: 'Configurações' }).click();
    await anaPage.waitForURL('**/pelada/configuracoes', T);
    await anaPage.locator('[data-menu-btn]').click();
    await anaPage.getByRole('menuitem', { name: 'Notificações' }).click();
    await anaPage.waitForURL('**/pelada/notificacoes', T);
  });
});

await browser.close();
app.stop();
const failed = results.filter(r => !r.ok);
if (consoleErrors.length) { console.log('\nErros no console:'); consoleErrors.forEach(e => console.log('  ' + e)); }
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram.`);
process.exit(failed.length || consoleErrors.length ? 1 : 0);
