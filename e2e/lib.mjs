// Utilitários dos testes E2E: sobe o servidor local com banco temporário e abre o Chromium.
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export async function startApp({ env = {} } = {}) {
  const port = 3100 + Math.floor(Math.random() * 800);
  const dir = mkdtempSync(join(tmpdir(), 'arena-e2e-'));
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), ARENA_DATA_FILE: join(dir, 'db.json'), PAYMENT_PROVIDER: 'mock', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) break; } catch { /* aguarda */ }
    await new Promise(r => setTimeout(r, 150));
    if (i === 59) throw new Error('servidor não subiu: ' + out);
  }
  return { base, port, logs: () => out, stop: () => child.kill() };
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean);
  for (const r of roots) {
    if (!existsSync(r)) continue;
    for (const d of readdirSync(r).filter(x => x.startsWith('chromium-')).sort().reverse()) {
      const p = join(r, d, 'chrome-linux', 'chrome');
      if (existsSync(p)) return p;
    }
  }
  return undefined; // deixa o Playwright procurar o navegador instalado
}

export async function launch() {
  return chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}

export const DESKTOP = { viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' };
export const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' };

/** Cria conta via API e devolve cookies para o contexto do navegador. */
export async function apiSignup(base, name = 'Organizador Teste') {
  const email = `e2e${Date.now()}${Math.floor(Math.random() * 1000)}@teste.com`;
  const res = await fetch(base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password: 'senha-segura-123' }) });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return { email, cookie, password: 'senha-segura-123', user: (await res.json()).user };
}
export async function apiCall(base, cookie, method, path, body) {
  const res = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
export async function loginContext(browser, base, account, opts = DESKTOP) {
  const ctx = await browser.newContext(opts);
  const [name, value] = account.cookie.split('=');
  await ctx.addCookies([{ name, value, url: base }]);
  return ctx;
}
