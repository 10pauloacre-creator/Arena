import { HttpError } from './errors.js';
import { SITE_ORIGIN, isLocalHost } from '../public/assets/js/shared/site.js';

const MAX_BODY = 1_000_000; // 1 MB

export async function readJson(req) {
  // Na Vercel o corpo JSON já chega interpretado em req.body.
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return parse(req.body.toString('utf8'));
    if (typeof req.body === 'string') return parse(req.body);
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Conteúdo grande demais.', 'TOO_LARGE');
    chunks.push(chunk);
  }
  return parse(Buffer.concat(chunks).toString('utf8'));
}

function parse(text) {
  if (!text || !text.trim()) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'JSON inválido.', 'BAD_JSON'); }
}

export function sendJson(res, status, body, headers = {}) {
  const data = JSON.stringify(body ?? null);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(data);
}

export function sendRaw(res, status, buf, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(buf);
}

export const isHttps = req => (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || !!req.socket?.encrypted;

// Endereço público do site: PUBLIC_BASE_URL; sem ela, o domínio oficial. Só o servidor local (localhost) usa o host da requisição.
export function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http')).split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return isLocalHost(host) ? `${proto}://${host}` : SITE_ORIGIN;
}

export function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'ip').toString().split(',')[0].trim();
}
