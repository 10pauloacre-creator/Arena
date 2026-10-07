// Captura estados de interface (diálogos, assistente de inscrição, pagamento) para revisão visual.
// Uso: node ui-tour.mjs <pasta-de-saída> [desktop|mobile]
import { startApp, launch, DESKTOP, MOBILE, apiSignup, apiCall, loginContext } from './lib.mjs';
const [, , out, mode = 'desktop'] = process.argv;
const opts = mode === 'mobile' ? MOBILE : DESKTOP;
const app = await startApp(); const browser = await launch();
const errs = [];
try {
  const acc = await apiSignup(app.base, 'Paulo Acre');
  const call = (m, p, b) => apiCall(app.base, acc.cookie, m, p, b);
  const t = (await call('POST', '/tournaments', { name: 'Copa Amigos da Vila 2026', sport: 'futsal' })).data.tournament;
  const d = new Date(Date.now() + 6 * 86400_000);
  await call('PATCH', `/tournaments/${t.id}`, { fee: 7500, venue: 'Ginásio Municipal', regDeadline: d.toISOString(), description: 'Torneio beneficente. Troféu para os 3 primeiros.' });
  for (const n of ['Tigres FC', 'Leões EC']) await call('POST', `/tournaments/${t.id}/teams`, { name: n, origin: 'Vila', captain: { name: 'Cap ' + n, phone: '11988887777', email: 'c@x.com' }, players: Array.from({ length: 5 }, (_, i) => ({ name: `Jogador ${n} ${i + 1}`, number: i + 1 })), paid: true });
  const shot = async (page, name) => { await page.waitForTimeout(350); await page.screenshot({ path: `${out}/${name}_${mode}.png`, fullPage: true }); };
  const watch = p => { p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); };

  // organizador: home, diálogo de novo torneio, times, detalhes, adicionar time
  const octx = await loginContext(browser, app.base, acc, opts); const op = await octx.newPage(); watch(op);
  await op.goto(app.base + '/'); await op.waitForSelector('.t-card'); await op.getByRole('button', { name: /Criar novo torneio|Novo torneio/ }).first().click(); await shot(op, 'dlg_novo_torneio'); await op.keyboard.press('Escape');
  await op.goto(`${app.base}/admin/${t.id}/times`); await op.waitForSelector('.team-row'); await shot(op, 'admin_times');
  await op.getByRole('button', { name: 'Detalhes' }).first().click(); await shot(op, 'dlg_time_detalhes'); await op.keyboard.press('Escape');
  await op.getByRole('button', { name: 'Adicionar time' }).click(); await shot(op, 'dlg_add_time'); await op.keyboard.press('Escape');
  await op.goto(`${app.base}/admin/${t.id}`); await op.waitForSelector('.hero'); await shot(op, 'admin_painel');
  await op.goto(`${app.base}/admin/${t.id}/configuracoes`); await op.waitForSelector('#settingsForm'); await shot(op, 'admin_config');
  await op.goto(`${app.base}/entrar`); // já logado ainda mostra formulário
  await octx.close();

  // visitante: início, assistente (3 passos), pagamento PIX e cartão, sucesso
  const vctx = await browser.newContext(opts); const vp = await vctx.newPage(); watch(vp);
  await vp.goto(`${app.base}/t/${t.id}`); await vp.waitForSelector('.v-hero'); await shot(vp, 'v_inicio');
  await vp.goto(`${app.base}/t/${t.id}/inscricao`); await vp.waitForSelector('#step1'); await shot(vp, 'v_passo1');
  await vp.fill('#tf-name', 'Águias da Praça'); await vp.fill('#tf-origin', 'Centro'); await vp.fill('#tf-cname', 'Marcos Lima'); await vp.fill('#tf-cphone', '11987654321'); await vp.fill('#tf-cmail', 'marcos@x.com');
  await vp.getByRole('button', { name: 'Continuar' }).click(); await vp.waitForSelector('#rosterBox'); await shot(vp, 'v_passo2_vazio');
  await vp.getByRole('button', { name: 'Preencher elenco de exemplo' }).click(); await shot(vp, 'v_passo2');
  await vp.locator('[data-act=next2]').click(); await vp.waitForSelector('.summary-box'); await shot(vp, 'v_passo3');
  await vp.getByRole('button', { name: 'Ir para o pagamento' }).click(); await vp.waitForSelector('.pay-options'); await shot(vp, 'v_pagamento');
  await vp.getByRole('button', { name: 'Gerar PIX' }).click(); await vp.waitForSelector('.pix-box'); await shot(vp, 'v_pix');
  await vp.getByRole('button', { name: 'Trocar forma de pagamento' }).click(); await vp.locator('label[for=pm-card]').click(); await shot(vp, 'v_cartao');
  await vp.locator('label[for=pm-pix]').click(); await vp.getByRole('button', { name: 'Gerar PIX' }).click(); await vp.getByRole('button', { name: 'Simular pagamento aprovado' }).click(); await vp.waitForSelector('.success-card .code-box', { timeout: 8000 }); await shot(vp, 'v_sucesso');
  await vp.goto(`${app.base}/t/${t.id}/meu-time`); await vp.waitForSelector('.code-box'); await shot(vp, 'v_meutime');
  await vp.goto(`${app.base}/t/${t.id}/times`); await vp.waitForSelector('.team-card'); await shot(vp, 'v_times');
  await vctx.close();
  console.log('erros de console:', errs.length ? errs.join('\n') : 'nenhum');
} finally { await browser.close(); app.stop(); }
