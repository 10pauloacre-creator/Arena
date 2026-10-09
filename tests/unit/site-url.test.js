// Endereço oficial: toda URL mostrada, copiada ou compartilhada sai em partidafacil.click (só localhost fica local).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE_ORIGIN, isLocalHost, publicOrigin, publicUrl } from '../../public/assets/js/shared/site.js';
import { baseUrl } from '../../lib/http.js';

const req = (host, extra = {}) => ({ headers: { host, ...extra }, socket: {} });

test('isLocalHost: localhost, 127.0.0.1, [::1] e *.localhost, com ou sem porta', () => {
  for (const h of ['localhost', 'localhost:3000', '127.0.0.1:8080', '[::1]:3000', 'app.localhost']) assert.ok(isLocalHost(h), h);
  for (const h of ['partidafacil.click', 'arena-master.vercel.app', 'localhost.evil.com', '']) assert.ok(!isLocalHost(h), h);
});

test('publicOrigin/publicUrl: domínio oficial fora do localhost', () => {
  assert.equal(SITE_ORIGIN, 'https://partidafacil.click');
  assert.equal(publicOrigin({ hostname: 'arena-master.vercel.app', origin: 'https://arena-master.vercel.app' }), SITE_ORIGIN);
  assert.equal(publicOrigin({ hostname: 'localhost', origin: 'http://localhost:3000' }), 'http://localhost:3000');
  assert.equal(publicUrl('/pelada/p/PL-ABC123', { hostname: 'x.vercel.app', origin: 'https://x.vercel.app' }), 'https://partidafacil.click/pelada/p/PL-ABC123');
});

test('baseUrl do servidor: PUBLIC_BASE_URL manda; senão domínio oficial; localhost mantém o host', () => {
  const old = process.env.PUBLIC_BASE_URL;
  try {
    delete process.env.PUBLIC_BASE_URL;
    assert.equal(baseUrl(req('arena-master.vercel.app', { 'x-forwarded-proto': 'https' })), SITE_ORIGIN);
    assert.equal(baseUrl(req('127.0.0.1:3000')), 'http://127.0.0.1:3000');
    process.env.PUBLIC_BASE_URL = 'https://partidafacil.click///';
    assert.equal(baseUrl(req('qualquer.vercel.app')), 'https://partidafacil.click');
  } finally {
    if (old === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = old;
  }
});
