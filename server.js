// Servidor local de desenvolvimento: serve /public e roteia /api/* para o mesmo handler usado na Vercel.
//   npm run dev   →   http://localhost:3000
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// .env simples (sem dependências)
const envFile = resolve(fileURLToPath(new URL('.', import.meta.url)), '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined && m[2] !== '') process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { default: apiHandler } = await import('./lib/handler.js');

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};
const CSP = "default-src 'self'; script-src 'self' https://sdk.mercadopago.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://i.ytimg.com; font-src 'self'; connect-src 'self' https://api.mercadopago.com https://*.mercadopago.com; frame-src https://www.youtube-nocookie.com https://player.twitch.tv https://*.mercadopago.com; base-uri 'self'; form-action 'self'; object-src 'none'";

async function serveStatic(req, res, pathname) {
  let rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = join(ROOT, rel);
  if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.statusCode = 403; return res.end('Forbidden'); }
  let isAsset = rel.startsWith('assets' + sep) || rel.startsWith('assets/');
  try {
    const s = await stat(file);
    if (s.isDirectory()) { file = join(file, 'index.html'); await stat(file); }
  } catch {
    if (isAsset || extname(rel)) { res.statusCode = 404; return res.end('Not found'); }
    // fallback de SPA: o app Pelada (PWA próprio) tem seu index.html em /pelada
    file = rel === 'pelada' || rel.startsWith('pelada/') || rel.startsWith('pelada' + sep) ? join(ROOT, 'pelada', 'index.html') : join(ROOT, 'index.html');
  }
  const body = await readFile(file);
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.end(req.method === 'HEAD' ? undefined : body);
}

export function createAppServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return await apiHandler(req, res);
      // imagens do módulo Pelada (mesma reescrita do vercel.json: /pelada-img/* → /api/pelada/img/*)
      if (url.pathname.startsWith('/pelada-img/')) { req.url = '/api/pelada/img/' + url.pathname.slice('/pelada-img/'.length) + url.search; return await apiHandler(req, res); }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end('Method not allowed'); }
      return await serveStatic(req, res, url.pathname);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.statusCode = 500;
      res.end('Erro interno');
    }
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  createAppServer().listen(port, () => {
    console.log(`ArenaMaster AI rodando em http://localhost:${port}`);
  });
}
