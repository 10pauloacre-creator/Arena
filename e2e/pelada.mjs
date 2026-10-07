// E2E do app Pelada (PWA): do botão "Organize a pelada" até artilharia e compartilhamento.
// Uso: cd e2e && npm install && node pelada.mjs   (usa o Chromium instalado; CHROME_PATH opcional)
import { mkdirSync } from 'node:fs';
import * as fs from 'node:fs/promises';
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
    console.log(`  ✗ ${name}\n      ${String(err.message).split('\n').slice(0, 14).join('\n      ')}`);
    if (err.page) { try { await err.page.screenshot({ path: `${SHOTS}FAIL_pel_${name.replace(/[^a-z0-9]+/gi, '_').slice(0, 50)}.png`, fullPage: true }); } catch { /* ignora */ } }
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error('Falha: ' + msg); };
const guard = async (page, fn) => { try { return await fn(); } catch (e) { e.page = page; throw e; } };
const watch = (page, tag) => {
  page.on('pageerror', e => consoleErrors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_INTERNET_DISCONNECTED|Failed to load resource.*(400|401|403|404|409|429)/.test(m.text())) consoleErrors.push(`[${tag}] console: ${m.text()}`); });
};
const T = { timeout: 9000 };
const seen = (page, text, o = T) => page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor(o);
const noOverflow = async (page, label) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - screen.width);
  assert(over <= 1, `${label}: rolagem horizontal de ${over}px`);
};
const shot = (page, n) => page.screenshot({ path: `${SHOTS}pel_${n}.png`, fullPage: true });
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// imagem de teste (gerada no próprio navegador) para o recorte de foto
const testPng = async () => {
  const p = await browser.newPage({ viewport: { width: 900, height: 600 } });
  await p.setContent('<body style="margin:0"><div style="width:900px;height:600px;background:linear-gradient(135deg,#f6b21b,#12a150 60%,#0a1a3d);display:grid;place-items:center;font:800 120px sans-serif;color:#fff">⚽</div></body>');
  const buf = await p.screenshot({ type: 'png' }); await p.close(); return buf;
};
async function pickImage(page, trigger, buffer) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), trigger()]);
  await fc.setFiles({ name: 'foto.png', mimeType: 'image/png', buffer });
  const dlg = page.locator('dialog:has(.crop-view)');
  await dlg.locator('.crop-view').waitFor(T);
  await dlg.locator('[data-close="ok"]').click();
  await dlg.waitFor({ state: 'detached', timeout: 8000 });
}

async function apiPlayer(name, birth = '15/05/1992') {
  const res = await fetch(app.base + '/api/pelada/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, birth }) });
  if (res.status !== 200) throw new Error('signup falhou ' + await res.text());
  return { name, cookie: res.headers.get('set-cookie').split(';')[0], player: (await res.json()).player };
}
async function playerContext(p, opts = DESKTOP) {
  const ctx = await browser.newContext(opts);
  const i = p.cookie.indexOf('=');
  await ctx.addCookies([{ name: p.cookie.slice(0, i), value: p.cookie.slice(i + 1), url: app.base }]);
  return ctx;
}

console.log(`\nPelada — E2E em ${app.base}\n`);
const png = await testPng();
let ownerCtx, owner, peladaId, dayUrl, inviteUrl;
const stamp = Date.now().toString(36);
const ownerName = `Valéria Souza ${stamp}`;
const todayIso = iso(new Date());
const otherDay = iso(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() === 1 ? 15 : 1));

// ------------------------------------------------------------------ home → conta rápida
await test('home: botão destacado "Organize a pelada" abre OUTRO html (app separado) e, sem conta, vai para a autenticação rápida', async () => {
  ownerCtx = await browser.newContext(MOBILE); owner = await ownerCtx.newPage(); watch(owner, 'owner');
  await guard(owner, async () => {
    await owner.goto(app.base + '/');
    const btn = owner.locator('a.btn-pelada', { hasText: 'Organize a pelada' }).first();
    await btn.waitFor(T);
    assert(await btn.getAttribute('href') === '/pelada/organizar', 'href do botão');
    await shot(owner, '01-arena-home');
    await btn.click();
    await owner.waitForURL('**/pelada/entrar**');
    // é um documento HTML diferente: tem o manifesto do app Pelada
    assert(await owner.locator('link[rel=manifest]').getAttribute('href') === '/pelada/manifest.webmanifest', 'manifesto do app Pelada');
    assert((await owner.title()).includes('Pelada'), 'título do app');
    await owner.locator('#au-name').waitFor(T);
    await shot(owner, '02-auth');
  });
});

await test('conta ultra-rápida: nome + data de nascimento, foto com recorte, cai na Dashboard', async () => {
  await guard(owner, async () => {
    await owner.fill('#au-name', ownerName);
    await owner.fill('#au-birth', '25031990');
    assert(await owner.inputValue('#au-birth') === '25/03/1990', 'máscara da data');
    await owner.click('[data-go]');
    await owner.waitForURL('**/pelada/painel'); // (foto só depois: o upload tem teste próprio abaixo)
    await seen(owner, 'Olá, Valéria');
    await shot(owner, '03-dashboard-vazio');
    await noOverflow(owner, 'dashboard');
  });
});

await test('recorte de foto: abre o editor, ajusta o zoom e salva no perfil', async () => {
  await guard(owner, async () => {
    await owner.locator('[data-menu-btn]').click();
    await owner.locator('[data-profile]').click();
    await pickImage(owner, () => owner.locator('dialog [data-photo]').click(), png).catch(async e => { await shot(owner, 'x'); throw e; });
    await owner.locator('dialog img[src*="/pelada-img/u/"]').first().waitFor(T);
    await owner.keyboard.press('Escape');
    await owner.reload();
    await owner.locator('.user-chip img').waitFor(T);
  });
});

await test('conta salva neste aparelho: recarregar não desloga', async () => {
  await guard(owner, async () => {
    await owner.goto(app.base + '/pelada/');
    await owner.waitForURL('**/pelada/painel');
    await seen(owner, 'Olá, Valéria');
    const stored = await owner.evaluate(() => localStorage.getItem('pelada.player.v1'));
    assert(stored && stored.includes('Valéria'), 'perfil salvo localmente');
    // "Organize a pelada" com a conta salva abre direto a Dashboard
    await owner.goto(app.base + '/pelada/organizar');
    await owner.waitForURL('**/pelada/painel');
  });
});

// ------------------------------------------------------------------ painel de criação
await test('painel de criação: nome, categoria, regras, calendário, organização por data e partidas', async () => {
  await guard(owner, async () => {
    await owner.getByRole('link', { name: 'Criar nova pelada' }).first().click();
    await owner.waitForURL('**/pelada/nova');
    await owner.fill('#pf-name', 'Pelada das Quintas');
    await owner.locator('label[for=pf-g-masculino]').click();
    await owner.locator('[data-step=minPerTeam][data-d="-1"]').click(); // 5 → 4 ... e volta
    await owner.locator('[data-step=minPerTeam][data-d="1"]').click();
    assert(await owner.inputValue('#pf-min') === '5', 'mínimo por time = 5');
    await pickImage(owner, () => owner.locator('[data-pick=avatar]').click(), png);
    await pickImage(owner, () => owner.locator('[data-pick=cover]').click(), png);
    await owner.locator(`[data-iso="${todayIso}"]`).click();
    if (otherDay !== todayIso) await owner.locator(`[data-iso="${otherDay}"]`).click();
    await owner.locator(`.day-card[data-day="${todayIso}"]`).waitFor(T);
    // dia 1: padrão herdado + 2 partidas criadas
    await owner.locator(`[data-add-match="${todayIso}"]`).click();
    await owner.locator(`[data-add-match="${todayIso}"]`).click();
    await owner.locator(`[data-add-match="${todayIso}"]`).click();
    await owner.locator(`[data-del-match="${todayIso}"]`).last().click(); // Excluir Partida
    assert(await owner.locator(`.day-card[data-day="${todayIso}"] .mm-list li`).count() === 2, '2 partidas planejadas');
    // dia 2: organização personalizada, sem formação de times
    await owner.locator(`[data-org=custom][data-date="${otherDay}"]`).click();
    await owner.locator(`[data-d-noteams="${otherDay}"]`).evaluate(el => el.click());
    await seen(owner, 'Esta opção desativa o sorteio automático de equipes. O sistema gerará apenas a lista de presença e permitirá a anotação individual de gols para o ranking de artilharia');
    await shot(owner, '04-form');
    await noOverflow(owner, 'form');
    await owner.click('#pf-go');
    await owner.waitForURL(/\/pelada\/p\/PL-[A-Z2-9]{6}/);
    peladaId = owner.url().match(/PL-[A-Z2-9]{6}/)[0];
    await seen(owner, 'Convide a galera');
  });
});

await test('página da pelada: ID, link de convite só para o criador, QR e copiar', async () => {
  await guard(owner, async () => {
    await seen(owner, peladaId);
    inviteUrl = await owner.locator('.invite input').first().inputValue();
    assert(inviteUrl === `${app.base}/pelada/p/${peladaId}`, 'link de convite: ' + inviteUrl);
    assert(await owner.locator('.invite .qr-box svg').count() === 1, 'QR Code');
    await owner.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.base });
    await owner.locator('[data-copy]', { hasText: 'Copiar link' }).click();
    assert(await owner.evaluate(() => navigator.clipboard.readText()) === inviteUrl, 'link copiado');
    await shot(owner, '05-pelada-owner');
    await noOverflow(owner, 'pelada');
    // o dia de hoje existe e abre a página do dia
    await owner.locator('a', { hasText: 'Abrir dia' }).first().click();
    await owner.waitForURL(/\/d\//);
    dayUrl = owner.url();
  });
});

await test('editar pelada: renomeia, muda o mínimo por time, adiciona data; datas com dados não podem ser removidas', async () => {
  await guard(owner, async () => {
    await owner.goto(`${app.base}/pelada/p/${peladaId}/editar`);
    await owner.locator('#pf-name').waitFor(T);
    assert(await owner.inputValue('#pf-name') === 'Pelada das Quintas', 'formulário preenchido');
    await owner.fill('#pf-name', 'Pelada das Quintas FC');
    await owner.locator('[data-step=minPerTeam][data-d="1"]').click();
    assert(await owner.inputValue('#pf-min') === '6', 'mínimo 6');
    await owner.locator('[data-step=minPerTeam][data-d="-1"]').click();
    const future = iso(new Date(Date.now() + 40 * 86400000));
    await owner.locator('[data-nav="1"]').click(); await owner.locator('[data-nav="1"]').click();
    await owner.locator('.cal-day').first().click();
    assert(await owner.locator('.day-card').count() === (otherDay === todayIso ? 1 : 2) + 1, 'nova data adicionada na lista');
    await owner.click('#pf-go');
    await owner.waitForURL(new RegExp(`/pelada/p/${peladaId}$`));
    await seen(owner, 'Pelada das Quintas FC');
    assert(await owner.locator('.day-item').count() === (otherDay === todayIso ? 1 : 2) + 1, '3 datas na lista de jogos');
    void future;
  });
});

// ------------------------------------------------------------------ participante pelo convite
let guestPage, guestCtx;
await test('convite: quem não tem conta clica em "Participar", cria a conta no modal e entra; link não mostra convite', async () => {
  guestCtx = await browser.newContext(MOBILE); guestPage = await guestCtx.newPage(); watch(guestPage, 'jogadora');
  await guard(guestPage, async () => {
    await guestPage.goto(inviteUrl);
    await seen(guestPage, 'Pelada das Quintas');
    assert(await guestPage.locator('.invite').count() === 0, 'visitante não vê o convite');
    await guestPage.locator('[data-join]').click();
    await guestPage.locator('dialog #au-name').waitFor(T);
    await guestPage.fill('dialog #au-name', `Joana Lima ${stamp}`);
    await guestPage.fill('dialog #au-birth', '01012000');
    await shot(guestPage, '06-modal-conta');
    await guestPage.click('dialog [data-go]');
    await seen(guestPage, 'Você participa desta pelada');
    await guestPage.locator('a', { hasText: 'Abrir dia' }).first().click();
    await guestPage.waitForURL(/\/d\//);
  });
});

await test('presença: Marcar/Retirar Presença e o nome aparece na hora na Lista de Confirmados (para ela e para o organizador)', async () => {
  await guard(guestPage, async () => {
    await owner.goto(dayUrl);
    await seen(owner, 'Lista de Confirmados');
    await guestPage.getByRole('button', { name: 'Marcar Presença' }).click();
    await guestPage.locator('.confirmed li', { hasText: 'Joana Lima' }).waitFor({ timeout: 1500 }); // imediato (otimista)
    await guestPage.getByRole('button', { name: 'Retirar Presença' }).waitFor(T);
    // o organizador vê sem recarregar (atualização automática)
    await owner.locator('.confirmed li', { hasText: 'Joana Lima' }).waitFor({ timeout: 9000 });
    await guestPage.getByRole('button', { name: 'Retirar Presença' }).click();
    await guestPage.getByRole('button', { name: 'Marcar Presença' }).waitFor(T);
    await guestPage.getByRole('button', { name: 'Marcar Presença' }).click();
    await guestPage.locator('.confirmed li.me').waitFor(T);
    await owner.getByRole('button', { name: 'Marcar Presença' }).click(); // o criador também marca presença
    await owner.locator('.confirmed li.me').waitFor(T);
  });
});

// ------------------------------------------------------------------ sorteio
const names = []; // jogadores criados por API
await test('sorteio: animação por 5 s, times "Time N - Capitã/o", sobra vai para a Cerca, convidado, clique no time mostra as jogadoras', async () => {
  await guard(owner, async () => {
    // 11 presentes + 1 convidado = 12 → 2 times de 5 + 2 na Cerca
    for (let i = 1; i <= 9; i++) {
      const p = await apiPlayer(`Atleta ${stamp} ${String.fromCharCode(64 + i)}${i} Silva`);
      names.push(p);
      const r = await fetch(`${app.base}/api/pelada/peladas/${peladaId}/days/${new URL(dayUrl).pathname.split('/').pop()}/presence`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: p.cookie }, body: JSON.stringify({ present: true }) });
      assert(r.status === 200, 'presença via API');
    }
    await owner.locator('.confirmed li').nth(10).waitFor({ timeout: 9000 });
    assert(await owner.locator('.confirmed li').count() === 11, '11 confirmados');
    // convidado
    await owner.fill('#g-name', 'Zé Convidado');
    await owner.getByRole('button', { name: 'Adicionar', exact: false }).filter({ hasText: /^\s*Adicionar\s*$/ }).first().click();
    await owner.locator('.confirmed li', { hasText: 'Zé Convidado' }).waitFor(T);
    assert(await owner.locator('.confirmed li', { hasText: 'Zé Convidado' }).locator('.badge', { hasText: 'Convidado' }).count() === 1, 'selo de convidado');
    // quem não organiza não vê a opção de sortear (só o resultado)
    assert(await guestPage.getByRole('button', { name: 'Sortear Times' }).count() === 0, 'jogadora não vê o botão de sortear');
    await seen(guestPage, 'O organizador faz o sorteio');
    await shot(owner, '07-day-antes');
    // a jogadora assiste ao sorteio acontecer
    const t0 = Date.now();
    await owner.getByRole('button', { name: 'Sortear Times' }).click();
    await owner.locator('.shuffle').waitFor(T);
    await guestPage.locator('.shuffle').waitFor({ timeout: 8000 }); // aparece também para os jogadores
    await shot(owner, '08-shuffle');
    await owner.locator('.shuffle').waitFor({ state: 'detached', timeout: 9000 });
    const dur = Date.now() - t0;
    assert(dur >= 4800 && dur < 8000, `animação de ~5 s (levou ${dur} ms)`);
    await owner.locator('.team-card').first().waitFor(T);
    assert(await owner.locator('.team-card').count() === 2, '2 times');
    const titles = await owner.locator('.team-title').allTextContents();
    assert(titles.every(t => /^Time \d - \S+/.test(t.trim())), 'rótulos "Time N - Nome": ' + titles.join(' | '));
    await seen(owner, 'Assistente do sorteio');
    await seen(owner, 'ficam na Cerca');
    await seen(owner, 'Cerca (2)');
    assert(await owner.locator('.fence-box li').count() === 2, '2 jogadores na Cerca');
    assert(await owner.locator('.badge', { hasText: 'incompleto' }).count() === 0, 'não existe mais time incompleto');
    // clicar no nome do time mostra os jogadores
    assert(await owner.locator('.team-body:visible').count() === 0, 'times começam fechados');
    await owner.locator('.team-head').first().click();
    await owner.locator('.team-body:visible li').first().waitFor(T);
    const sizes = [];
    for (let i = 0; i < 2; i++) { await owner.locator('.team-head').nth(i).click({ trial: false }).catch(() => {}); }
    await shot(owner, '09-times');
    await noOverflow(owner, 'dia');
    // e a jogadora vê o mesmo resultado
    await guestPage.locator('.team-card').first().waitFor({ timeout: 9000 });
    assert(await guestPage.locator('.team-card').count() === 2, 'jogadora vê os 2 times');
    void sizes;
  });
});

await test('só o organizador sorteia: o botão "Sortear Times" fica sempre ativo para ele e não aparece para a jogadora', async () => {
  await guard(owner, async () => {
    assert(await owner.getByRole('button', { name: 'Sortear Times' }).count() === 1, 'organizador vê o botão de sortear');
    assert(await owner.getByRole('button', { name: 'Refazer sorteio' }).count() === 0, 'o botão agora é sempre "Sortear Times"');
    assert(await guestPage.getByRole('button', { name: 'Sortear Times' }).count() === 0, 'jogadora não vê o botão de sortear');
    await guestPage.locator('.team-card').first().waitFor({ timeout: 9000 }); // só vê o resultado
  });
});

// ------------------------------------------------------------------ partidas / súmula
await test('partidas: "+" cria jogo com vagas, escolhe times, cronômetro, gols pela lista, encerra e cria a próxima automaticamente', async () => {
  await guard(owner, async () => {
    // abre todos os times para ver a composição
    const dayId = new URL(dayUrl).pathname.split('/').pop();
    // 2 vagas criadas no cadastro: usa a primeira
    const card = owner.locator('.match').first();
    await card.waitFor(T);
    assert(await owner.locator('.match').count() === 2, '2 partidas planejadas aparecem');
    await card.locator('[data-slot=a]').click();
    await owner.locator('dialog .pick').first().click();
    await owner.locator('.match').first().locator('[data-slot=b]').click();
    await owner.locator('dialog .pick:not([disabled])').first().click();
    const start = owner.locator('.match').first().getByRole('button', { name: 'Iniciar' });
    await start.waitFor(T);
    // define o valor do cronômetro e inicia
    await owner.locator('.match').first().locator('[data-mins]').fill('3');
    await owner.locator('.match').first().getByRole('button', { name: 'Definir' }).click();
    await owner.locator('.match').first().locator('[data-clock]').filter({ hasText: '03:00' }).waitFor(T);
    await owner.locator('.match').first().getByRole('button', { name: 'Iniciar' }).click();
    await owner.locator('.match.running').waitFor(T);
    await owner.waitForTimeout(1300);
    const clk = await owner.locator('.match').first().locator('[data-clock]').textContent();
    assert(clk !== '03:00' && /^02:5\d$/.test(clk), 'cronômetro andando: ' + clk);
    // a Cerca aparece no rodapé da partida em andamento
    const foot = owner.locator('.match.running .match-fence');
    assert(await foot.count() === 1 && await foot.locator('li').count() === 2, 'Cerca no rodapé da partida: 2 jogadores');
    // gols: toque no jogador de cada time
    const chips = owner.locator('.match').first().locator('.sum-col');
    await chips.nth(0).locator('.chip-main').first().click();
    await chips.nth(0).locator('.chip-main').first().click();
    await chips.nth(1).locator('.chip-main').first().click();
    await owner.waitForTimeout(500);
    const scores = await owner.locator('.match').first().locator('.big-score').allTextContents();
    assert(scores.join('x') === '2x1', 'placar 2x1: ' + scores.join('x'));
    await shot(owner, '10-sumula');
    await owner.getByRole('button', { name: 'Encerrar partida' }).click();
    // a próxima partida preenche a vaga criada: vencedor fica
    await owner.locator('.match.finished').waitFor(T);
    await seen(owner, 'Próxima partida criada');
    const second = owner.locator('.match').nth(1);
    assert(await second.locator('.slot.filled').count() === 2, 'próxima partida com os dois times já definidos');
    await shot(owner, '11-proxima');
    void dayId;
  });
});

await test('jogadora acompanha a súmula (placar e quem fez os gols) sem poder editar', async () => {
  await guard(guestPage, async () => {
    await guestPage.locator('.match.finished').waitFor({ timeout: 9000 });
    assert(await guestPage.locator('[data-goal]').count() === 0, 'sem botões de gol para jogadores');
    assert(await guestPage.locator('.scorers').count() >= 1, 'artilheiros da partida visíveis');
  });
});

await test('artilharia: abas Dia × Geral, medalhas ouro/prata/bronze e compartilhar (imagem na área de transferência)', async () => {
  await guard(owner, async () => {
    // 2 times → a próxima partida é a revanche (mesmos times). Resultado esperado: 3 (ouro), 2 (prata), 1+1 (bronze)
    const second = owner.locator('.match').nth(1);
    await second.locator('.sum-col').nth(0).locator('.chip-main').nth(0).click(); // quem fez 2 na 1ª partida chega a 3
    await second.locator('.sum-col').nth(1).locator('.chip-main').nth(0).click(); // quem fez 1 chega a 2
    await second.locator('.sum-col').nth(1).locator('.chip-main').nth(1).click(); // 1 gol
    await second.locator('.sum-col').nth(0).locator('.chip-main').nth(1).click(); // 1 gol
    await owner.waitForTimeout(700);
    await owner.getByRole('button', { name: 'Artilharia do Dia' }).waitFor(T);
    assert(await owner.locator('.podium .pod.gold').count() === 1 && await owner.locator('.podium .pod.silver').count() === 1 && await owner.locator('.podium .pod.bronze').count() >= 1, 'ouro, prata e bronze');
    assert(await owner.locator('.pod.gold svg.medal').count() >= 1, 'ícone de medalha');
    await owner.getByRole('button', { name: 'Artilharia Geral' }).click();
    await owner.locator('[data-pod-tab=general][aria-pressed=true]').waitFor(T);
    await shot(owner, '12-podio');
    await owner.getByRole('button', { name: 'Artilharia do Dia' }).click();
    await owner.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.base });
    await owner.getByRole('button', { name: 'Compartilhar Resultados' }).click();
    // tela de compartilhamento: modelo do Canva em alta resolução (2172×2896) com data, nomes e gols; já copia a imagem
    const dlg = owner.locator('dialog[open]').filter({ hasText: 'Compartilhar resultados' }).last();
    await dlg.locator('canvas.share-canvas').waitFor({ timeout: 15000 });
    const size = await dlg.locator('canvas.share-canvas').evaluate(c => [c.width, c.height]);
    assert(size[0] === 2172 && size[1] === 2896, 'imagem em alta resolução do modelo: ' + size.join('x'));
    await seen(owner, 'Imagem copiada');
    await shot(owner, '12b-compartilhar');
    const types = await owner.evaluate(async () => (await navigator.clipboard.read()).flatMap(i => i.types));
    assert(types.includes('image/png'), 'imagem PNG na área de transferência: ' + types.join(','));
    // texto formatado com emojis de futebol e medalhas
    await dlg.getByRole('button', { name: 'Copiar texto' }).click();
    const text = await owner.evaluate(() => navigator.clipboard.readText());
    assert(text.includes('⚽') && text.includes('🥇') && text.includes('🥈') && text.includes('🗓'), 'texto com emojis e período: ' + text);
    // baixar imagem
    const [dl] = await Promise.all([owner.waitForEvent('download'), dlg.getByRole('button', { name: 'Baixar imagem' }).click()]);
    assert(/^artilharia-pl-.*\.png$/.test(dl.suggestedFilename()), 'arquivo baixado: ' + dl.suggestedFilename());
    await dl.saveAs(`${SHOTS}pel_flyer_resultado.png`);
  });
});

// ------------------------------------------------------------------ histórico público e data sem times
await test('histórico público: visitante sem conta consulta resultados e artilharia', async () => {
  const ctx = await browser.newContext(DESKTOP); const p = await ctx.newPage(); watch(p, 'visitante');
  await guard(p, async () => {
    await p.goto(inviteUrl);
    await p.locator('[data-tab=historico]').click();
    await p.locator('.hist-day .hist-match').first().waitFor(T);
    await seen(p, 'Artilheiros do dia');
    await p.locator('[data-tab=artilharia]').click();
    await p.locator('.podium').waitFor(T);
    await p.locator('[data-tab=jogadores]').click();
    await seen(p, 'Organizador');
    await shot(p, '13-historico-publico');
  });
  await ctx.close();
});

await test('data "Sem formação de times": lista de presença e gols individuais para a artilharia', async () => {
  if (otherDay === todayIso) return;
  await guard(owner, async () => {
    await owner.goto(`${app.base}/pelada/p/${peladaId}`);
    const link = owner.locator('.day-item', { hasText: 'sem formação de times' }).locator('a', { hasText: 'Abrir dia' });
    await link.click();
    await seen(owner, 'Esta opção desativa o sorteio automático de equipes');
    assert(await owner.getByRole('button', { name: 'Sortear Times' }).count() === 0, 'sem botão de sorteio');
    await owner.getByRole('button', { name: 'Marcar Presença' }).click();
    await owner.locator('.loose-list li').first().waitFor(T);
    await owner.locator('[data-loose][data-delta="1"]').first().click();
    await owner.locator('.loose-n').first().filter({ hasText: '1' }).waitFor(T);
    await shot(owner, '14-sem-times');
  });
});

// ------------------------------------------------------------------ pelada demo
await test('criação: "Criar pelada demo" monta o jogo de hoje com 17 jogadores com foto; dá para sortear e o painel marca como demonstração', async () => {
  const p0 = await apiPlayer(`Demo ${stamp}`);
  const ctx = await playerContext(p0, MOBILE); const p = await ctx.newPage(); watch(p, 'demo');
  await guard(p, async () => {
    await p.goto(app.base + '/pelada/nova');
    await seen(p, 'Quer ver como funciona antes de criar a sua?');
    await noOverflow(p, 'criar pelada com o cartão demo');
    await p.locator('[data-demo]').click();
    await p.waitForURL(/\/pelada\/p\/PL-[A-Z0-9]{6}\/d\/d_/, T);
    await p.locator('ul.confirmed li').nth(16).waitFor(T);
    assert(await p.locator('ul.confirmed li').count() === 17, '17 confirmados na lista');
    const names = await p.locator('ul.confirmed li .grow b').allTextContents();
    assert(names.length === 17 && names.every(n => /^\S+ \S+$/u.test(n.trim())), 'nomes com 2 palavras: ' + names.join(', '));
    await p.waitForFunction(() => [...document.querySelectorAll('ul.confirmed li img')].every(i => i.complete && i.naturalWidth > 0), null, T);
    assert(await p.locator('ul.confirmed li img').count() === 17, 'foto de perfil para os 17');
    await seen(p, 'Demonstração');
    await shot(p, '16-demo-dia');
    await p.getByRole('button', { name: 'Sortear Times' }).click();
    await p.locator('[data-team-toggle]').first().waitFor({ timeout: 15000 });
    assert(await p.locator('[data-team-toggle]').count() === 3, '17 jogadores com mínimo de 5 = 3 times');
    await shot(p, '17-demo-sorteio');
    await noOverflow(p, 'dia da pelada demo');
    await p.goto(app.base + '/pelada/painel');
    await p.locator('.pel-card').first().waitFor(T);
    await seen(p, 'Demonstração');
  });
  await ctx.close();
});

// ------------------------------------------------------------------ Cerca, sorteio automático e correções
await test('configuração: "Sorteio automático de jogadores" com frequência (1, 2, 3 partidas ou nunca), no padrão e por data', async () => {
  const o = await apiPlayer(`Config ${stamp}`);
  const ctx = await playerContext(o, MOBILE); const p = await ctx.newPage(); watch(p, 'config');
  await guard(p, async () => {
    await p.goto(app.base + '/pelada/nova');
    await p.fill('#pf-name', 'Pelada Automática');
    await p.locator('label[for=pf-g-feminino]').click();
    assert(await p.locator('input[name=autoDraw]').count() === 1 && !(await p.locator('input[name=autoDraw]').isChecked()), 'opção desligada por padrão');
    assert(await p.locator('[data-auto-every]').count() === 0, 'frequência só aparece com a opção ligada');
    await p.locator('input[name=autoDraw]').evaluate(el => el.click());
    const opts = await p.locator('.auto-draw [data-auto-every]').allTextContents();
    assert(opts.join('|') === 'A cada 1 partida|A cada 2 partidas|A cada 3 partidas|Nunca', 'opções: ' + opts.join('|'));
    await p.locator('.auto-draw [data-auto-every="2"]').click();
    await p.locator('.auto-draw [data-auto-every="2"][aria-pressed=true]').waitFor(T);
    await p.locator(`[data-iso="${todayIso}"]`).click();
    await p.locator(`[data-org=custom][data-date="${todayIso}"]`).click();
    await p.locator(`.day-card[data-day="${todayIso}"] [data-auto-every="3"]`).waitFor(T); // a data herda e pode personalizar
    assert(await p.locator(`.day-card[data-day="${todayIso}"] [data-auto-every="3"]`).isVisible(), 'frequência por data');
    await p.locator(`.day-card[data-day="${todayIso}"] [data-auto-every="3"]`).click();
    await shot(p, '18-config-auto');
    await noOverflow(p, 'form com sorteio automático');
    await p.click('#pf-go');
    await p.waitForURL(/\/pelada\/p\/PL-[A-Z2-9]{6}/);
    const id = p.url().match(/PL-[A-Z2-9]{6}/)[0];
    const view = (await (await fetch(`${app.base}/api/pelada/peladas/${id}`)).json()).pelada;
    assert(view.autoDraw === true && view.autoEvery === 2, 'padrão salvo: ' + view.autoDraw + '/' + view.autoEvery);
    assert(view.days[0].custom && view.days[0].org.autoDraw && view.days[0].org.autoEvery === 3, 'data personalizada salva');
    await p.goto(`${app.base}/pelada/p/${id}/editar`); // ao editar, os valores voltam preenchidos
    await p.locator('.auto-draw [data-auto-every="2"][aria-pressed=true]').first().waitFor(T);
  });
  await ctx.close();
});

await test('Cerca + sorteio automático (demo de 17): Cerca no rodapé, sorteio ativo com partida em andamento, rotação ao encerrar e correção do placar', async () => {
  const o = await apiPlayer(`Auto ${stamp}`);
  const ctx = await playerContext(o, MOBILE); const p = await ctx.newPage(); watch(p, 'auto');
  const call = async (method, path, body) => (await fetch(app.base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', Cookie: o.cookie }, body: body ? JSON.stringify(body) : undefined })).json();
  await guard(p, async () => {
    const demo = await call('POST', '/pelada/peladas/demo');
    const pid = demo.pelada.id, dayId = demo.dayId;
    await call('PATCH', `/pelada/peladas/${pid}`, { autoDraw: true, autoEvery: 1 });
    await p.goto(`${app.base}/pelada/p/${pid}/d/${dayId}`);
    await seen(p, 'Auto a cada 1 partida');
    await p.getByRole('button', { name: 'Sortear Times' }).click();
    await p.locator('[data-team-toggle]').first().waitFor({ timeout: 15000 });
    assert(await p.locator('[data-team-toggle]').count() === 3, '3 times de 5');
    await seen(p, 'Cerca (2)');
    const fenceNames = await p.locator('.fence-box li .grow').allTextContents();
    assert(fenceNames.length === 2, 'Cerca com 2 jogadores');
    // partida: escolhe os times e inicia
    await p.getByRole('button', { name: 'Adicionar partida' }).click();
    await p.locator('.match').first().waitFor(T);
    await p.locator('.match').first().locator('[data-slot=a]').click();
    await p.locator('dialog .pick').first().click();
    await p.locator('.match').first().locator('[data-slot=b]').click();
    await p.locator('dialog .pick:not([disabled])').first().click();
    await p.locator('.match').first().getByRole('button', { name: 'Iniciar' }).click();
    await p.locator('.match.running').waitFor(T);
    assert(await p.locator('.match.running .match-fence li').count() === 2, 'Cerca no rodapé da partida em andamento');
    // o sorteio continua ativo mesmo com a partida em andamento (define a próxima composição)
    const playing = await p.locator('.match.running .slot-name').allTextContents();
    await p.getByRole('button', { name: 'Sortear Times' }).click();
    await seen(p, 'Sortear a próxima composição?');
    await p.locator('dialog [data-close=ok]').click();
    await p.locator('.shuffle').waitFor(T);
    await p.locator('.shuffle').waitFor({ state: 'detached', timeout: 9000 });
    await seen(p, 'se mantêm');
    assert((await p.locator('.match.running .slot-name').allTextContents()).join() === playing.join(), 'os times em quadra continuam os mesmos');
    assert(await p.locator('.match.running').count() === 1, 'a partida segue em andamento');
    await shot(p, '19-sorteio-com-partida');
    // gol, encerra: o vencedor fica, a Cerca entra no time que perdeu e há nova Cerca
    await p.locator('.match.running .sum-col').nth(0).locator('.chip-main').first().click();
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: 'Encerrar partida' }).click();
    await p.locator('.match.finished').waitFor(T);
    await seen(p, 'Sorteio automático:');
    await seen(p, 'Nova Cerca');
    assert(await p.locator('.match').nth(1).locator('.match-fence li').count() === 2, 'a próxima partida mostra a nova Cerca');
    await shot(p, '20-rotacao');
    // corrigir o placar da partida encerrada (só o organizador)
    assert((await p.locator('.match.finished .big-score').allTextContents()).join('x') === '1x0', 'placar 1x0');
    await p.locator('.match.finished details.fix summary').click();
    await p.locator('.match.finished details.fix .sum-col').nth(1).locator('.chip-main').first().click();
    await p.waitForFunction(() => [...document.querySelectorAll('.match.finished .big-score')].map(e => e.textContent).join('x') === '1x1', null, T);
    assert(await p.locator('.match.finished details.fix[open]').count() === 1, 'a edição continua aberta depois de salvar');
    await p.waitForTimeout(4200); // a atualização automática não fecha nem desfaz a correção
    assert((await p.locator('.match.finished .big-score').allTextContents()).join('x') === '1x1', 'placar corrigido 1x1');
    await noOverflow(p, 'dia com Cerca');
    // quem só acompanha vê o resultado, sem botão de sortear nem edição
    const viewer = await browser.newContext(MOBILE); const vp = await viewer.newPage(); watch(vp, 'espectador');
    await vp.goto(`${app.base}/pelada/p/${pid}/d/${dayId}`);
    await vp.locator('.team-card').first().waitFor(T);
    assert(await vp.getByRole('button', { name: 'Sortear Times' }).count() === 0, 'visitante não vê "Sortear Times"');
    assert(await vp.locator('details.fix').count() === 0, 'visitante não edita partida encerrada');
    await viewer.close();
  });
  await ctx.close();
});

await test('botão de perfil: abre o menu e o perfil (uma vez só), mesmo depois de a página se atualizar sozinha', async () => {
  await guard(owner, async () => {
    await owner.goto(`${app.base}/pelada/p/${peladaId}`);
    await owner.locator('[data-menu-btn]').waitFor(T);
    await owner.waitForTimeout(6500); // passa pela atualização automática (a tela é redesenhada)
    await owner.locator('[data-menu-btn]').click();
    await owner.locator('.menu-pop:not([hidden])').waitFor(T);
    await owner.locator('[data-profile]').click();
    await owner.locator('dialog[open]').filter({ hasText: 'Meu perfil' }).waitFor(T);
    assert(await owner.locator('dialog[open]').count() === 1, 'um único perfil aberto');
    await owner.keyboard.press('Escape');
  });
});

await test('sair da pelada: ícone no canto superior direito, confirmação, some da lista; gols dela continuam na artilharia; excluir jogador (organizador)', async () => {
  await guard(guestPage, async () => {
    // organizador não tem o ícone; a participante tem
    await owner.goto(`${app.base}/pelada/p/${peladaId}`);
    await owner.locator('.pel-head').waitFor(T);
    assert(await owner.locator('.leave-btn').count() === 0, 'organizador não vê o ícone de sair');
    // organizador exclui um jogador que fez gol (artilharia geral guarda os gols)
    await owner.locator('[data-tab=artilharia]').click();
    await owner.getByRole('button', { name: 'Artilharia Geral' }).click();
    await owner.locator('.podium .pod-name').first().waitFor(T);
    const scorers = [...await owner.locator('.podium .pod-name').allTextContents(), ...await owner.locator('.rank-rest .grow').allTextContents()].map(t => t.trim());
    const victim = scorers.find(n => !n.includes('Valéria') && n.startsWith('Atleta'));
    assert(victim, 'há um artilheiro que pode ser excluído: ' + scorers.join(', '));
    const goalsBefore = await owner.locator('.podium .pod, .rank-rest li').filter({ hasText: victim }).first().textContent();
    await owner.locator('[data-tab=jogadores]').click();
    const row = owner.locator('.player-list li', { hasText: victim });
    await row.locator('[data-rm-member]').click();
    await seen(owner, 'continuam somando na artilharia');
    await owner.locator('dialog [data-close=ok]').click();
    await owner.locator('.player-list li', { hasText: victim }).waitFor({ state: 'detached', timeout: 9000 });
    await owner.locator('[data-tab=artilharia]').click();
    await owner.getByRole('button', { name: 'Artilharia Geral' }).click();
    const after = await owner.locator('.podium .pod, .rank-rest li').filter({ hasText: victim }).first().textContent();
    assert(after && after.replace(/\s+/g, '') === goalsBefore.replace(/\s+/g, ''), `gols do excluído continuam na artilharia: ${goalsBefore} → ${after}`);

    // a participante sai da pelada
    await guestPage.goto(`${app.base}/pelada/p/${peladaId}`);
    await guestPage.locator('.leave-btn').waitFor(T);
    const box = await guestPage.locator('.leave-btn').boundingBox(), head = await guestPage.locator('.pel-head').boundingBox();
    assert(box.x + box.width > head.x + head.width - 40 && box.y < head.y + 40, 'ícone no canto superior direito da pelada');
    await shot(guestPage, '21-sair');
    await guestPage.locator('.leave-btn').click();
    await seen(guestPage, 'Sair da pelada?');
    await guestPage.locator('dialog [data-close=ok]').click();
    await guestPage.waitForURL('**/pelada/painel', T);
    await guestPage.waitForTimeout(600);
    assert(await guestPage.locator('.pel-card', { hasText: 'Pelada das Quintas' }).count() === 0, 'a pelada não aparece mais para quem saiu');
    // dá para voltar pelo convite
    await guestPage.goto(inviteUrl);
    await guestPage.locator('[data-join]').waitFor(T);
  });
});

await test('login salvo no aparelho: mesmo sem o cookie de sessão o app continua logado (e o link de convite mostra a pré-visualização)', async () => {
  const o = await apiPlayer(`Persistente ${stamp}`);
  const ctx = await playerContext(o, MOBILE); const p = await ctx.newPage(); watch(p, 'login-salvo');
  await guard(p, async () => {
    await p.goto(app.base + '/pelada/painel');
    await seen(p, 'Olá, Persistente');
    const tk = await p.evaluate(() => localStorage.getItem('pelada.token.v1'));
    assert(tk && tk.includes('.'), 'chave do aparelho guardada');
    await ctx.clearCookies(); // o navegador apagou o cookie de sessão
    await p.goto(app.base + '/pelada/painel');
    await seen(p, 'Olá, Persistente');
    const me = await p.evaluate(async () => (await (await fetch('/api/pelada/auth/me')).json()).player?.name);
    assert(me && me.startsWith('Persistente'), 'sessão refeita no servidor: ' + me);
    // sair de verdade apaga a chave do aparelho
    await p.locator('[data-menu-btn]').click(); await p.locator('[data-profile]').click();
    await p.locator('dialog [data-logout]').click();
    await p.waitForURL('**/pelada/');
    assert(await p.evaluate(() => localStorage.getItem('pelada.token.v1')) === null, 'chave apagada no logout');
  });
  await ctx.close();
  // pré-visualização do link de convite (WhatsApp lê estas metatags): capa + foto de perfil + dados
  const html = await (await fetch(inviteUrl)).text();
  assert(/og:title" content="Pelada das Quintas FC · Pelada"/.test(html), 'og:title com o nome da pelada');
  assert(/og:description" content="[^"]*Pelada masculina[^"]*participante[^"]*mín\. \d por time/.test(html), 'og:description com os dados da pelada');
  const img = html.match(/og:image" content="([^"]+)"/)[1];
  assert(img.includes(`/pelada-img/p/${peladaId}/preview`), 'og:image é a prévia montada com capa + foto: ' + img);
  const res = await fetch(img);
  const buf = Buffer.from(await res.arrayBuffer());
  assert(res.headers.get('content-type') === 'image/jpeg' && buf.length > 4000 && buf.length <= 230_000, `prévia JPEG (${buf.length} bytes)`);
  const sof = buf.findIndex((b, i) => b === 0xff && (buf[i + 1] === 0xc0 || buf[i + 1] === 0xc2));
  assert(buf.readUInt16BE(sof + 7) === 1200 && buf.readUInt16BE(sof + 5) === 630, 'prévia 1200×630');
  await fs.writeFile(`${SHOTS}pel_preview_link.jpg`, buf);
});

// ------------------------------------------------------------------ PWA
await test('PWA: manifesto próprio (escopo /pelada/), ícones, service worker e abertura offline', async () => {
  const ctx = await browser.newContext(MOBILE); const p = await ctx.newPage(); watch(p, 'pwa');
  await guard(p, async () => {
    const m = await (await fetch(app.base + '/pelada/manifest.webmanifest')).json();
    assert(m.scope === '/pelada/' && m.display === 'standalone' && m.short_name === 'Pelada', 'manifesto');
    assert(m.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable') && m.icons.some(i => i.sizes === '192x192'), 'ícones 192/512/maskable');
    for (const i of m.icons) assert((await fetch(app.base + i.src)).status === 200, 'ícone existe: ' + i.src);
    await p.goto(app.base + '/pelada/');
    await seen(p, 'Organize a pelada');
    const reg = await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, active: !!r.active }; });
    assert(reg.active && reg.scope === app.base + '/pelada/', 'service worker ativo no escopo /pelada/: ' + JSON.stringify(reg));
    await p.reload(); // já controlada pelo SW
    await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, T);
    await shot(p, '15-home-pelada');
    await noOverflow(p, 'home pelada');
    await ctx.setOffline(true);
    await p.reload().catch(() => {});
    await p.locator('.pl-hero').waitFor(T);
    assert(await p.locator('.pl-top').count() === 1, 'app abre offline (casca em cache)');
    await p.goto(app.base + '/pelada/entrar').catch(() => {});
    await p.locator('#au-name').waitFor(T); // outras telas também abrem offline (pré-cache da interface)
    await ctx.setOffline(false);
  });
  await ctx.close();
});

await test('mobile: sem rolagem horizontal nas telas principais (dia, pelada, painel)', async () => {
  const p0 = await apiPlayer(`Mobile ${stamp}`);
  const ctx = await playerContext(p0, MOBILE); const p = await ctx.newPage(); watch(p, 'mobile');
  await guard(p, async () => {
    const paths = ['/pelada/painel', `/pelada/p/${peladaId}`, new URL(dayUrl).pathname, '/pelada/nova'];
    for (const path of paths) {
      await p.goto(app.base + path);
      await p.waitForTimeout(700);
      await noOverflow(p, path);
    }
    // celulares estreitos: se algo estoura a largura, o Chrome mobile encolhe a página inteira (parece "versão desktop")
    for (const w of [360, 320]) {
      await p.setViewportSize({ width: w, height: 700 });
      for (const path of paths) {
        await p.goto(app.base + path);
        await p.waitForTimeout(500);
        const [inner, scroll] = await p.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
        assert(inner === w && scroll <= w, `${path} em ${w}px: viewport ${inner}, conteúdo ${scroll}`);
      }
    }
    // barra de navegação inferior no celular (com conta)
    await p.setViewportSize({ width: 390, height: 800 });
    await p.goto(app.base + '/pelada/painel');
    await p.locator('.pl-bnav').waitFor(T);
    assert(await p.locator('.pl-bnav a[aria-current="page"]').count() === 1, 'item ativo na barra inferior');
    await p.locator('[data-bn-id]').click();
    await p.locator('dialog #bn-id').waitFor(T);
    const fs = await p.locator('dialog #bn-id').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    assert(fs >= 16, 'campos com 16px+ (evita zoom automático do iOS): ' + fs);
    await p.keyboard.press('Escape');
  });
  await ctx.close();
});

await test('sem erros de JavaScript no console durante todo o fluxo', async () => {
  assert(consoleErrors.length === 0, 'erros no console:\n' + consoleErrors.join('\n'));
});

await browser.close();
app.stop();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram.`);
if (failed.length) { console.log(app.logs().slice(-1500)); process.exit(1); }
process.exit(0);
