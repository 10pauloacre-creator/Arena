// Testes de ponta a ponta: fluxo completo do organizador, do visitante (PIX e cartão), jogos ao vivo e repescagem.
// Uso: cd e2e && npm install && node run.mjs   (usa o Chromium instalado; CHROME_PATH opcional)
import { mkdirSync } from 'node:fs';
import { startApp, launch, DESKTOP, MOBILE, apiSignup, apiCall, loginContext } from './lib.mjs';

const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const app = await startApp();
const browser = await launch();
const results = [];
const consoleErrors = [];
let current = '';

async function test(name, fn) {
  current = name;
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  ✓ ${name} (${Date.now() - t0} ms)`); }
  catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✗ ${name}\n      ${String(err.message).split('\n')[0]}`);
    if (err.page) { try { await err.page.screenshot({ path: `${SHOTS}FAIL_${name.replace(/[^a-z0-9]+/gi, '_').slice(0, 50)}.png`, fullPage: true }); } catch { /* ignora */ } }
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error('Falha: ' + msg); };
async function guard(page, fn) { try { return await fn(); } catch (e) { e.page = page; throw e; } }
const watch = (page, tag) => {
  page.on('pageerror', e => consoleErrors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource.*(401|403|404|409|429)/.test(m.text())) consoleErrors.push(`[${tag}] console: ${m.text()}`); });
};
const noOverflow = async (page, label) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(over <= 1, `${label}: rolagem horizontal de ${over}px`);
};
const T = { timeout: 8000 };
const seen = (page, text, o = T) => page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor(o);

console.log(`\nArenaMaster AI — E2E em ${app.base}\n`);
let orgPage, orgCtx, tid, tname = 'Copa E2E de Futsal';
const orgEmail = `org${Date.now()}@teste.com`;

// ---------------------------------------------------------------- organizador
await test('cadastro: criar conta pelo formulário e cair na home sem torneios', async () => {
  orgCtx = await browser.newContext(DESKTOP); orgPage = await orgCtx.newPage(); watch(orgPage, 'org');
  await guard(orgPage, async () => {
    await orgPage.goto(app.base + '/');
    await seen(orgPage, 'Seu torneio, do');
    await orgPage.getByRole('link', { name: 'Criar meu torneio' }).click();
    await orgPage.waitForURL('**/cadastro');
    await orgPage.fill('#a-name', 'Organizador E2E');
    await orgPage.fill('#a-email', orgEmail);
    await orgPage.fill('#a-pass', 'senha-segura-123');
    await orgPage.click('#authGo');
    await seen(orgPage, 'Você ainda não tem torneios');
  });
});

await test('login: senha errada mostra erro; logout e login corretos', async () => {
  const ctx = await browser.newContext(DESKTOP); const p = await ctx.newPage(); watch(p, 'login');
  await guard(p, async () => {
    await p.goto(app.base + '/entrar');
    await p.fill('#a-email', orgEmail); await p.fill('#a-pass', 'senha-errada-1'); await p.click('#authGo');
    await seen(p, 'E-mail ou senha incorretos');
    await p.fill('#a-pass', 'senha-segura-123'); await p.click('#authGo');
    await seen(p, 'Você ainda não tem torneios');
    await p.locator('[data-menu-btn]').click(); await p.getByText('Sair').click();
    await seen(p, 'Seu torneio, do');
  });
  await ctx.close();
});

await test('criar torneio pelo modal e abrir o painel', async () => {
  await guard(orgPage, async () => {
    await orgPage.getByRole('button', { name: 'Criar meu primeiro torneio' }).click();
    await orgPage.fill('#nt-name', 'x');
    await orgPage.click('#ntGo');
    await seen(orgPage, 'mínimo 3 letras');
    await orgPage.fill('#nt-name', tname);
    await orgPage.click('#ntGo');
    await orgPage.waitForURL(/\/admin\/AM-\d{4}-\d+$/);
    tid = orgPage.url().split('/').pop();
    await seen(orgPage, 'ID único do torneio');
    await seen(orgPage, '#' + tid);
    await noOverflow(orgPage, 'painel');
  });
});

await test('painel: botão Salvar só habilita ao editar; salva nome/data e persiste ao recarregar', async () => {
  await guard(orgPage, async () => {
    const save = orgPage.locator('[data-save]');
    assert(await save.isDisabled(), 'Salvar deveria começar desabilitado');
    await orgPage.fill('#p-name', 'Copa E2E de Futsal — Edição Especial');
    assert(await save.isEnabled(), 'Salvar deveria habilitar');
    await seen(orgPage, 'Alterações não salvas');
    await orgPage.fill('#p-date', '2026-12-20');
    await save.click();
    await seen(orgPage, 'Alterações salvas.');
    await seen(orgPage, 'Tudo salvo');
    assert(await save.isDisabled(), 'Salvar deveria desabilitar após salvar');
    await orgPage.reload();
    await seen(orgPage, 'Copa E2E de Futsal — Edição Especial');
    assert((await orgPage.inputValue('#p-date')) === '2026-12-20', 'data persistida');
    tname = 'Copa E2E de Futsal — Edição Especial';
  });
});

await test('painel: trocar de seção com alterações pede confirmação', async () => {
  await guard(orgPage, async () => {
    await orgPage.fill('#p-name', 'Nome provisório que será descartado');
    await orgPage.locator('.sidenav a[data-sec="times"]').click();
    await seen(orgPage, 'Descartar alterações?');
    await orgPage.getByRole('button', { name: 'Continuar editando' }).click();
    assert(orgPage.url().endsWith(tid), 'deveria continuar no painel');
    await orgPage.getByRole('button', { name: 'Descartar' }).first().click();
    assert((await orgPage.inputValue('#p-name')) === tname, 'descartar restaura o nome');
  });
});

await test('configurações: prazo, valor, vagas e salvar', async () => {
  await guard(orgPage, async () => {
    await orgPage.goto(`${app.base}/admin/${tid}/configuracoes`);
    await seen(orgPage, 'Inscrições abertas');
    const d = new Date(Date.now() + 5 * 86400_000); const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await orgPage.fill('#s-dd', day); await orgPage.fill('#s-dt', '23:59');
    await orgPage.fill('#s-fee', '50,00');
    await orgPage.selectOption('#s-mt', '4');
    await orgPage.fill('#s-venue', 'Ginásio da Vila');
    await orgPage.locator('#saveBtn').waitFor();
    await orgPage.fill('#s-fee', '2,00'); await orgPage.click('#saveBtn');
    await seen(orgPage, 'mínimo cobrável');
    await orgPage.fill('#s-fee', '50,00'); await orgPage.click('#saveBtn');
    await seen(orgPage, 'Configurações salvas.');
    await orgPage.reload();
    await seen(orgPage, 'Inscrições abertas');
    assert((await orgPage.inputValue('#s-fee')) === '50,00', 'valor persistido');
    assert((await orgPage.inputValue('#s-mt')) === '4', 'vagas persistidas');
  });
});

await test('convite: gerar link, outro usuário aceita e passa a administrar; criador remove', async () => {
  await guard(orgPage, async () => {
    await orgPage.getByRole('button', { name: 'Gerar link de convite' }).click();
    await seen(orgPage, 'Link de convite criado');
    const url = await orgPage.locator('input[aria-label="Link de convite"]').inputValue();
    assert(/\/convite\/[\w-]{20,}$/.test(url), 'formato do link: ' + url);
    const guest = await apiSignup(app.base, 'Convidada E2E');
    const gctx = await loginContext(browser, app.base, guest); const gp = await gctx.newPage(); watch(gp, 'guest');
    await guard(gp, async () => {
      await gp.goto(url);
      await seen(gp, 'Convite para administrar'); await seen(gp, 'Organizador E2E');
      await gp.click('#accept');
      await gp.waitForURL(/\/admin\/AM-/);
      await gp.goto(app.base + '/');
      await seen(gp, 'Co-admin');
      await seen(gp, tname);
      // convite é de uso único
      const g2 = await apiSignup(app.base, 'Terceiro'); const c2 = await loginContext(browser, app.base, g2); const p2 = await c2.newPage();
      await p2.goto(url); await seen(p2, 'Convite indisponível'); await c2.close();
    });
    await gctx.close();
    await orgPage.reload();
    await orgPage.locator('.admin-row', { hasText: 'Convidada E2E' }).waitFor(T);
    await orgPage.locator('.admin-row', { hasText: 'Convidada E2E' }).getByRole('button', { name: 'Remover' }).click();
    await orgPage.locator('dialog').getByRole('button', { name: 'Remover' }).click();
    await seen(orgPage, 'Administrador removido.');
  });
});

// ---------------------------------------------------------------- visitante
let vctx, vpage, team1 = {}, team2 = {};
async function fillTeam(p, name) {
  await p.fill('#tf-name', name); await p.fill('#tf-origin', 'Vila ' + name.slice(0, 3));
  await p.fill('#tf-cname', 'Capitão ' + name); await p.fill('#tf-cphone', '11987654321'); await p.fill('#tf-cmail', 'cap@teste.com');
  await p.getByRole('button', { name: 'Continuar' }).click();
  await seen(p, 'Elenco de ' + name);
  await p.getByRole('button', { name: 'Preencher elenco de exemplo' }).click();
  await p.locator('[data-act=next2]').click();
  await seen(p, 'Revise e conclua');
}

await test('visitante: acessa por ID na página inicial e vê o torneio (sem login)', async () => {
  vctx = await browser.newContext(DESKTOP); vpage = await vctx.newPage(); watch(vpage, 'visitante');
  await guard(vpage, async () => {
    await vpage.goto(app.base + '/');
    await vpage.fill('#join-id', tid.toLowerCase());
    await vpage.getByRole('button', { name: 'Acessar torneio' }).click();
    await vpage.waitForURL('**/t/' + tid);
    await seen(vpage, tname); await seen(vpage, 'Inscrições abertas'); await seen(vpage, 'R$ 50,00 por time');
    await seen(vpage, 'Termina em');
    await noOverflow(vpage, 'visitante');
  });
});

await test('visitante: ID inexistente mostra mensagem amigável', async () => {
  const c = await browser.newContext(DESKTOP); const p = await c.newPage();
  await guard(p, async () => { await p.goto(app.base + '/t/AM-2026-0000'); await seen(p, 'Torneio não encontrado'); });
  await c.close();
});

await test('inscrição paga por PIX: time só entra na lista após o pagamento', async () => {
  await guard(vpage, async () => {
    await vpage.getByRole('link', { name: 'Inscrever meu time' }).first().click();
    await seen(vpage, 'Dados do time e do responsável');
    await vpage.getByRole('button', { name: 'Continuar' }).click();
    await seen(vpage, 'Informe o nome do time');
    await fillTeam(vpage, 'Tigres do Bairro');
    await vpage.getByRole('button', { name: 'Ir para o pagamento' }).click();
    await seen(vpage, 'Vaga reservada');
    await seen(vpage, 'Total a pagar');
    await vpage.getByRole('button', { name: 'Gerar PIX' }).click();
    await seen(vpage, 'Pague R$ 50,00 com PIX');
    const code = await vpage.locator('input[aria-label="PIX copia e cola"]').inputValue();
    assert(/^000201.*6304[0-9A-F]{4}$/.test(code), 'código PIX válido');
    assert(await vpage.locator('.pix-box .qr svg').count() === 1, 'QR do PIX exibido');
    // ainda não aparece na lista pública
    const pub = await (await fetch(`${app.base}/api/public/${tid}`)).json();
    assert(pub.tournament.teams.length === 0, 'time não deve aparecer antes do pagamento');
    await vpage.getByRole('button', { name: 'Simular pagamento aprovado' }).click();
    await seen(vpage, 'Pagamento confirmado!');
    await seen(vpage, 'Inscrição confirmada!', { timeout: 6000 });
    team1.code = (await vpage.locator('.code-box').first().innerText()).trim();
    assert(/^[A-Z0-9]{8}$/.test(team1.code), 'código do capitão: ' + team1.code);
    const pub2 = await (await fetch(`${app.base}/api/public/${tid}`)).json();
    assert(pub2.tournament.teams.length === 1 && pub2.tournament.teams[0].name === 'Tigres do Bairro', 'time entrou na lista');
  });
});

await test('inscrição paga por cartão: recusa com 4000…0002 e aprova com 4242…', async () => {
  const c = await browser.newContext(DESKTOP); const p = await c.newPage(); watch(p, 'cartao');
  await guard(p, async () => {
    await p.goto(`${app.base}/t/${tid}/inscricao`);
    await seen(p, 'Dados do time e do responsável');
    await fillTeam(p, 'Leões da Praça');
    await p.getByRole('button', { name: 'Ir para o pagamento' }).click();
    await seen(p, 'Total a pagar');
    await p.locator('label[for=pm-card]').click();
    await seen(p, 'Nome impresso no cartão');
    await p.getByRole('button', { name: /Pagar R\$/ }).click();
    await seen(p, 'Número de cartão inválido');
    await p.fill('#c-num', '4000000000000002'); await p.fill('#c-name', 'FULANO DE TAL'); await p.fill('#c-exp', '1239'); await p.fill('#c-cvv', '123');
    await p.getByRole('button', { name: /Pagar R\$/ }).click();
    await seen(p, 'recusado');
    assert((await p.inputValue('#c-name')) === 'FULANO DE TAL', 'nome do cartão preservado após recusa');
    assert((await p.inputValue('#c-cvv')) === '', 'CVV não é preservado');
    await p.fill('#c-num', '4242424242424242'); await p.fill('#c-cvv', '123');
    await p.getByRole('button', { name: /Pagar R\$/ }).click();
    await seen(p, 'Pagamento confirmado!'); await seen(p, 'Inscrição confirmada!', { timeout: 6000 });
    team2.code = (await p.locator('.code-box').first().innerText()).trim();
  });
  await c.close();
});

await test('visitante: "Meu time" por código em outro aparelho e lista de times', async () => {
  const c = await browser.newContext(DESKTOP); const p = await c.newPage(); watch(p, 'meutime');
  await guard(p, async () => {
    await p.goto(`${app.base}/t/${tid}/meu-time`);
    await seen(p, 'Acessar meu time');
    await p.fill('#mt-code', 'ZZZZZZZZ'); await p.getByRole('button', { name: 'Acessar' }).click();
    await seen(p, 'Código não encontrado');
    await p.fill('#mt-code', team1.code.toLowerCase()); await p.getByRole('button', { name: 'Acessar' }).click();
    await seen(p, 'Tigres do Bairro'); await seen(p, 'Confirmado'); await seen(p, 'Elenco (11'.replace('11', '5'));
    await p.goto(`${app.base}/t/${tid}/times`);
    await seen(p, 'Tigres do Bairro'); await seen(p, 'Leões da Praça');
  });
  await c.close();
});

// ---------------------------------------------------------------- admin: times, sorteio, jogos
await test('admin: vê os times confirmados e adiciona os demais manualmente', async () => {
  await guard(orgPage, async () => {
    await orgPage.goto(`${app.base}/admin/${tid}/times`);
    await seen(orgPage, 'Tigres do Bairro'); await seen(orgPage, 'Leões da Praça');
    await seen(orgPage, 'R$ 100,00'); // receita
    for (const name of ['Águias FC', 'Raposas EC']) {
      await orgPage.getByRole('button', { name: 'Adicionar time' }).click();
      await orgPage.fill('#tf-name', name); await orgPage.fill('#tf-cname', 'Cap ' + name); await orgPage.fill('#tf-cphone', '11999998888'); await orgPage.fill('#tf-cmail', 'x@teste.com');
      await orgPage.locator('dialog [data-act=demo]').click();
      await orgPage.locator('#atGo').click();
      await seen(orgPage, name + ' adicionado');
      await orgPage.waitForSelector('dialog', { state: 'detached' });
    }
    await seen(orgPage, 'Águias FC'); await seen(orgPage, 'Raposas EC');
    // com 4/4 vagas, o visitante não consegue mais se inscrever
    const r = await fetch(`${app.base}/api/public/${tid}`); const j = await r.json();
    assert(j.tournament.registration.open === false && j.tournament.registration.reason === 'Vagas esgotadas.', 'vagas esgotadas');
  });
});

await test('admin: sorteia o chaveamento (semifinais) e o visitante vê a chave', async () => {
  await guard(orgPage, async () => {
    await orgPage.goto(`${app.base}/admin/${tid}/chaveamento`);
    await orgPage.getByRole('button', { name: 'Sortear chaveamento' }).click();
    await seen(orgPage, 'Sorteio inteligente', { timeout: 3000 });
    await orgPage.locator('#bracketCard .match').first().waitFor({ timeout: 10000 });
    assert(await orgPage.locator('#bracketCard .match').count() >= 3, 'semifinais + final');
    await seen(orgPage, 'Índice de equilíbrio');
    await vpage.goto(`${app.base}/t/${tid}/chaveamento`);
    await vpage.locator('.bracket .match').first().waitFor();
    assert(await vpage.locator('.bracket .match').count() >= 3, 'visitante vê a chave');
    await noOverflow(vpage, 'chaveamento visitante');
  });
});

await test('jogo ao vivo: iniciar, marcar gols, visitante acompanha em tempo real, encerrar e avançar', async () => {
  await guard(orgPage, async () => {
    await orgPage.goto(`${app.base}/admin/${tid}/ao-vivo`);
    await seen(orgPage, 'Jogos ao vivo');
    await orgPage.getByRole('button', { name: 'Iniciar jogo' }).click();
    await orgPage.locator('.scoreboard .badge.live').waitFor();
    const plusA = orgPage.locator('.sb-controls .ctl').first().locator('[data-act=plus]');
    await plusA.click(); await plusA.click();
    await orgPage.locator('.sb-score').getByText('2').first().waitFor();
    // visitante (sem recarregar) recebe o placar
    await vpage.goto(`${app.base}/t/${tid}`);
    await vpage.locator('.scoreboard .sb-score').waitFor({ timeout: 8000 });
    assert((await vpage.locator('.scoreboard .sb-score').innerText()).replace(/\s+/g, '') === '2:0', 'placar visitante 2:0');
    await orgPage.locator('.sb-controls .ctl').nth(1).locator('[data-act=plus]').click();
    await vpage.waitForFunction(() => document.querySelector('.scoreboard .sb-score')?.innerText.replace(/\s+/g, '') === '2:1', null, { timeout: 12000 });
    // desfazer e encerrar
    await orgPage.locator('.sb-controls .ctl').nth(1).locator('[data-act=minus]').click();
    await orgPage.getByRole('button', { name: 'Encerrar partida' }).click();
    await seen(orgPage, 'Encerrar partida?');
    await orgPage.getByRole('button', { name: 'Encerrar e lançar' }).click();
    await seen(orgPage, 'Resultado lançado');
    await vpage.goto(`${app.base}/t/${tid}/jogos`);
    await seen(vpage, 'Encerrados');
    await seen(vpage, '2 : 0');
  });
});

await test('jogo com empate pede pênaltis; final define o campeão e finaliza o torneio', async () => {
  await guard(orgPage, async () => {
    await orgPage.goto(`${app.base}/admin/${tid}/ao-vivo`);
    await seen(orgPage, 'Jogos ao vivo');
    // 2ª semifinal: 1 x 1 → pênaltis
    await orgPage.getByRole('button', { name: 'Iniciar jogo' }).click();
    await orgPage.locator('.sb-controls .ctl').first().locator('[data-act=plus]').click();
    await orgPage.locator('.sb-controls .ctl').nth(1).locator('[data-act=plus]').click();
    await orgPage.getByRole('button', { name: 'Encerrar partida' }).click();
    await orgPage.getByRole('button', { name: 'Encerrar e lançar' }).click();
    await seen(orgPage, 'Empate: pênaltis');
    await orgPage.fill('#pa', '3'); await orgPage.fill('#pb', '3'); await orgPage.getByRole('button', { name: 'Confirmar' }).click();
    await seen(orgPage, 'não podem terminar empatados');
    await orgPage.fill('#pb', '5'); await orgPage.getByRole('button', { name: 'Confirmar' }).click();
    await seen(orgPage, 'Resultado lançado');
    // final por resultado direto
    await seen(orgPage, 'Grande Final');
    await orgPage.getByRole('button', { name: 'Lançar resultado direto' }).click();
    await orgPage.fill('#ra', '4'); await orgPage.fill('#rb', '2'); await orgPage.locator('#resGo').click();
    await seen(orgPage, 'Temos um campeão');
    await orgPage.goto(`${app.base}/admin/${tid}`);
    await seen(orgPage, 'Finalizado'); await seen(orgPage, '3/3');
    await vpage.goto(`${app.base}/t/${tid}`);
    await seen(vpage, 'CAMPEÃO');
  });
});

// ---------------------------------------------------------------- repescagem (torneio separado)
await test('repescagem: capitão eliminado doa por PIX, libera a revanche e volta à tabela', async () => {
  const org = await apiSignup(app.base, 'Dona Repescagem');
  const call = (m, p, b) => apiCall(app.base, org.cookie, m, p, b);
  const t = (await call('POST', '/tournaments', { name: 'Copa Repescagem', sport: 'futsal', demo: true })).data.tournament;
  const drawn = (await call('POST', `/tournaments/${t.id}/draw`)).data.tournament;
  const qf = drawn.bracket.rounds[0].matches[0];
  await call('POST', `/tournaments/${t.id}/matches/${qf.key}`, { action: 'result', sa: 3, sb: 0 });
  const adm = (await call('GET', `/tournaments/${t.id}`)).data.tournament;
  const loser = adm.teams.find(x => x.id === qf.b);
  const c = await browser.newContext(DESKTOP); const p = await c.newPage(); watch(p, 'repescagem');
  await guard(p, async () => {
    await p.goto(`${app.base}/t/${t.id}/meu-time`);
    await p.fill('#mt-code', loser.accessCode); await p.getByRole('button', { name: 'Acessar' }).click();
    await seen(p, loser.name); await seen(p, 'Repescagem beneficente');
    await p.getByRole('button', { name: 'Continuar para o pagamento' }).click();
    await seen(p, 'Marque a confirmação');
    await p.locator('input[name=agree]').check();
    await p.getByRole('button', { name: 'Continuar para o pagamento' }).click();
    await seen(p, 'Total a pagar');
    await p.getByRole('button', { name: 'Gerar PIX' }).click();
    await p.getByRole('button', { name: 'Simular pagamento aprovado' }).click();
    await seen(p, 'Pagamento confirmado!');
    await seen(p, 'usou a repescagem', { timeout: 8000 });
    const after = (await call('GET', `/tournaments/${t.id}`)).data.tournament;
    assert(after.bracket.playins.length === 1, 'revanche criada');
    assert(after.donations.total >= 2000, 'doação contabilizada');
    // admin joga a revanche
    const pk = after.bracket.playins[0].key;
    await call('POST', `/tournaments/${t.id}/matches/${pk}`, { action: 'result', sa: 1, sb: 0 });
    const fin = (await call('GET', `/tournaments/${t.id}`)).data.tournament;
    assert(fin.bracket.rounds[1].matches[0].a === loser.id || fin.bracket.rounds[1].matches[0].b === loser.id, 'desafiante voltou à tabela');
    await p.goto(`${app.base}/t/${t.id}/chaveamento`);
    await seen(p, 'Repescada');
  });
  await c.close();
});

// ---------------------------------------------------------------- mobile
await test('mobile: inscrição gratuita completa sem rolagem horizontal', async () => {
  const org = await apiSignup(app.base, 'Dona Mobile');
  const t = (await apiCall(app.base, org.cookie, 'POST', '/tournaments', { name: 'Copa Mobile', sport: 'volei' })).data.tournament;
  const c = await browser.newContext(MOBILE); const p = await c.newPage(); watch(p, 'mobile');
  await guard(p, async () => {
    await p.goto(`${app.base}/t/${t.id}`);
    await seen(p, 'Inscrições abertas'); await noOverflow(p, 'home mobile');
    await p.goto(`${app.base}/t/${t.id}/inscricao`);
    await p.fill('#tf-name', 'Vôlei das Meninas'); await p.fill('#tf-cname', 'Capitã Ana'); await p.fill('#tf-cphone', '21988887777'); await p.fill('#tf-cmail', 'ana@teste.com');
    await noOverflow(p, 'inscrição mobile 1');
    await p.getByRole('button', { name: 'Continuar' }).click();
    await p.getByRole('button', { name: 'Preencher elenco de exemplo' }).click(); await noOverflow(p, 'inscrição mobile 2');
    await p.locator('[data-act=next2]').click();
    await p.getByRole('button', { name: 'Concluir inscrição' }).click();
    await seen(p, 'Inscrição confirmada!'); await noOverflow(p, 'inscrição mobile 3');
    await p.screenshot({ path: `${SHOTS}mobile_inscricao_ok.png`, fullPage: true });
  });
  const mctx = await loginContext(browser, app.base, org, MOBILE); const mp = await mctx.newPage(); watch(mp, 'admin-mobile');
  await guard(mp, async () => {
    for (const s of ['', '/times', '/ao-vivo', '/chaveamento', '/marketing', '/configuracoes']) {
      await mp.goto(`${app.base}/admin/${t.id}${s}`); await mp.waitForLoadState('networkidle'); await noOverflow(mp, 'admin mobile ' + (s || 'painel'));
    }
  });
  await c.close(); await mctx.close();
});

await test('sem erros de JavaScript no console durante todo o fluxo', async () => {
  assert(consoleErrors.length === 0, 'erros no console:\n' + consoleErrors.join('\n'));
});

// ---------------------------------------------------------------- resumo
await browser.close(); app.stop();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram.`);
if (failed.length) { failed.forEach(f => console.log(`\n✗ ${f.name}\n${f.err.stack?.split('\n').slice(0, 4).join('\n')}`)); console.log('\nServidor:\n' + app.logs().slice(-1500)); process.exit(1); }
