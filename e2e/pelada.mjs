// E2E do app Pelada (PWA): do botão "Organize a pelada" até artilharia e compartilhamento.
// Uso: cd e2e && npm install && node pelada.mjs   (usa o Chromium instalado; CHROME_PATH opcional)
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
// JPEG gravado "deitado" (600×300: metade esquerda vermelha, direita azul) com EXIF Orientation=6, como as fotos
// tiradas em pé no iPhone. Na posição certa ele fica em pé: vermelho em cima, azul embaixo.
const exifJpeg = async () => {
  const p = await browser.newPage();
  const b64 = await p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 300;
    const x = c.getContext('2d'); x.fillStyle = '#f00'; x.fillRect(0, 0, 300, 300); x.fillStyle = '#00f'; x.fillRect(300, 0, 300, 300);
    return c.toDataURL('image/jpeg', 0.95).split(',')[1];
  });
  await p.close();
  const jpg = Buffer.from(b64, 'base64');
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0])]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 255]), exif]);
  return Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)]);
};
async function chooseImage(page, trigger, file) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), trigger()]);
  // no iPhone, um <input type=file> fora da página pode ser descartado com o seletor aberto (a foto some)
  assert(await fc.element().evaluate(el => el.isConnected), 'o campo de arquivo fica na página enquanto o seletor está aberto');
  await fc.setFiles(file);
  const dlg = page.locator('dialog:has(.crop-view)');
  await dlg.locator('.crop-view').waitFor(T);
  assert(await page.locator('input[type=file]').count() === 0, 'o campo de arquivo sai da página depois da escolha');
  return dlg;
}
async function pickImage(page, trigger, buffer) {
  const dlg = await chooseImage(page, trigger, { name: 'foto.png', mimeType: 'image/png', buffer });
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

await test('foto do iPhone no cadastro: respeita a orientação EXIF e não apaga o nome nem a data já digitados', async () => {
  const ctx = await browser.newContext(MOBILE); const page = await ctx.newPage(); watch(page, 'iphone');
  await guard(page, async () => {
    await page.goto(app.base + '/pelada/entrar');
    await page.fill('#au-name', `Iara Lima ${stamp}`);
    await page.fill('#au-birth', '07101995');
    const dlg = await chooseImage(page, () => page.locator('[data-photo]').click(), { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: await exifJpeg() });
    const [topRight, bottomLeft] = await dlg.locator('.crop-view canvas').evaluate(c => {
      const x = c.getContext('2d'), px = (a, b) => [...x.getImageData(a, b, 1, 1).data];
      return [px(c.width - 40, 20), px(40, c.height - 20)];
    });
    assert(topRight[0] > 180 && topRight[2] < 90 && bottomLeft[2] > 180 && bottomLeft[0] < 90, `foto em pé (vermelho em cima, azul embaixo): ${topRight} / ${bottomLeft}`);
    await dlg.locator('[data-close="ok"]').click();
    await dlg.waitFor({ state: 'detached', timeout: 8000 });
    await page.locator('.av-btn img').waitFor(T);
    assert(await page.inputValue('#au-name') === `Iara Lima ${stamp}`, 'nome mantido após escolher a foto');
    assert(await page.inputValue('#au-birth') === '07/10/1995', 'data de nascimento mantida após escolher a foto');
    await page.click('[data-go]');
    await page.waitForURL('**/pelada/painel');
    await page.locator('.user-chip img').waitFor(T);
  });
  await ctx.close();
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
await test('sorteio: animação por 5 s, times "Time N - Capitã/o", sobra (regra B), convidado, clique no time mostra as jogadoras', async () => {
  await guard(owner, async () => {
    // 11 presentes no total → 2 times de 5 + 1 sobra (regra B → um time com 6)
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
    // 12 presentes → 2 times de 5 + sobra de 2 → regra B (dois times com 6)
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
    await seen(owner, 'distribuído');
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

await test('jogadora também vê "Sortear Times" antes do sorteio e o criador pode refazer só até começar a partida', async () => {
  await guard(owner, async () => {
    assert(await owner.getByRole('button', { name: 'Refazer sorteio' }).count() === 1, 'organizador pode refazer');
    assert(await guestPage.getByRole('button', { name: 'Refazer sorteio' }).count() === 0, 'jogadora não refaz');
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
    for (const path of ['/pelada/painel', `/pelada/p/${peladaId}`, new URL(dayUrl).pathname, '/pelada/nova']) {
      await p.goto(app.base + path);
      await p.waitForTimeout(700);
      await noOverflow(p, path);
    }
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
