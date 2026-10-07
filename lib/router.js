// Roteador mínimo + contexto de requisição + autenticação por cookie.

import { HttpError, unauthorized, forbidden, notFound } from './errors.js';
import { readJson, sendJson, sendRaw, isHttps, baseUrl } from './http.js';
import { getStore } from './store/index.js';
import { getProvider } from './payments/index.js';
import { getSecret, signToken, verifyToken, parseCookies, sessionCookie, SESSION_COOKIE, SESSION_TTL_MS, PLAYER_COOKIE, PLAYER_TTL_MS } from './auth.js';
import { getUser, loadTournament } from './repo.js';
import { getPlayer } from './peladaRepo.js';
import { now as clockNow } from './clock.js';

const routes = [];

export function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:([A-Za-z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, opts });
}

/** Resposta customizada (status/headers/corpo bruto). */
export const reply = (status, body, headers) => ({ __reply: true, status, body, headers });
export const raw = (status, buf, headers) => ({ __raw: true, status, buf, headers });

class Ctx {
  constructor(req, res, url, params, body) {
    Object.assign(this, { req, res, url, params, body, query: Object.fromEntries(url.searchParams), store: getStore(), provider: getProvider() });
    this._user = undefined;
    this._player = undefined;
  }
  get now() { return clockNow(); }
  get base() { return baseUrl(this.req); }

  async user() {
    if (this._user !== undefined) return this._user;
    this._user = null;
    const token = parseCookies(this.req.headers.cookie)[SESSION_COOKIE];
    if (token) {
      const payload = verifyToken(token, await getSecret(this.store), this.now);
      if (payload?.uid) this._user = (await getUser(this.store, payload.uid)) || null;
    }
    return this._user;
  }
  async requireUser() { const u = await this.user(); if (!u) throw unauthorized(); return u; }

  /** Exige um administrador do torneio. Retorna { user, t } (t sem lock, apenas para leitura). */
  async requireAdmin(id) {
    const user = await this.requireUser();
    const t = await loadTournament(this.store, id);
    if (!t) throw notFound('Torneio não encontrado.');
    if (!t.admins.some(a => a.userId === user.id)) throw forbidden('Você não administra este torneio.');
    return { user, t };
  }

  async startSession(user) {
    const token = signToken({ uid: user.id, exp: this.now + SESSION_TTL_MS }, await getSecret(this.store));
    this.res.setHeader('Set-Cookie', sessionCookie(token, { secure: isHttps(this.req) }));
  }
  endSession() { this.res.setHeader('Set-Cookie', sessionCookie('', { secure: isHttps(this.req), clear: true })); }

  /** Jogador do módulo Pelada (conta simplificada; cookie próprio, independente do login de organizador de torneios). */
  async player() {
    if (this._player !== undefined) return this._player;
    this._player = null;
    const token = parseCookies(this.req.headers.cookie)[PLAYER_COOKIE];
    if (token) {
      const payload = verifyToken(token, await getSecret(this.store), this.now);
      if (payload?.plid) {
        const p = await getPlayer(this.store, payload.plid);
        if (p && (p.pv || 0) === (payload.pv || 0)) this._player = p;
      }
    }
    return this._player;
  }
  async requirePlayer() { const p = await this.player(); if (!p) throw unauthorized('Crie sua conta ou entre para continuar.'); return p; }
  async startPlayerSession(player) {
    const token = signToken({ plid: player.id, pv: player.pv || 0, exp: this.now + PLAYER_TTL_MS }, await getSecret(this.store));
    this.res.setHeader('Set-Cookie', sessionCookie(token, { secure: isHttps(this.req), name: PLAYER_COOKIE, ttlMs: PLAYER_TTL_MS }));
    this._player = player;
  }
  endPlayerSession() { this.res.setHeader('Set-Cookie', sessionCookie('', { secure: isHttps(this.req), clear: true, name: PLAYER_COOKIE })); this._player = null; }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return new URL(origin).host === host;
  } catch { return false; }
}

export async function dispatch(req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    let path = url.searchParams.get('__p');
    if (path !== null) url.searchParams.delete('__p');
    else path = url.pathname.replace(/^\/api\/?/, '');
    path = '/' + String(path).replace(/^\/+|\/+$/g, '');
    const method = req.method === 'HEAD' ? 'GET' : req.method;

    let matched = null, allowed = false;
    for (const r of routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      allowed = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } });
      matched = { r, params };
      break;
    }
    if (!matched) throw allowed ? new HttpError(405, 'Método não permitido.', 'METHOD') : notFound('Rota não encontrada.');

    let body = {};
    if (method !== 'GET') {
      if (!matched.r.opts.external) {
        if (!sameOrigin(req)) throw forbidden('Origem não permitida.');
        const ct = String(req.headers['content-type'] || '');
        const len = Number(req.headers['content-length'] || 0);
        if ((len > 0 || req.body) && !ct.includes('application/json')) throw new HttpError(415, 'Use Content-Type: application/json.', 'BAD_CONTENT_TYPE');
      }
      body = await readJson(req);
      if (body === null || typeof body !== 'object' || Array.isArray(body)) body = {};
    }

    const ctx = new Ctx(req, res, url, matched.params, body);
    const out = await matched.r.handler(ctx);
    if (out && out.__raw) return sendRaw(res, out.status, out.buf, out.headers);
    if (out && out.__reply) return sendJson(res, out.status, out.body, out.headers);
    return sendJson(res, 200, out ?? { ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return sendJson(res, err.status, { error: { message: err.message, code: err.code, ...(err.extra ? { details: err.extra } : {}) } });
    }
    console.error('[api] erro inesperado:', err);
    return sendJson(res, 500, { error: { message: 'Erro interno. Tente novamente em instantes.', code: 'INTERNAL' } });
  }
}
