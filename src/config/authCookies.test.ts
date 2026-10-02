import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcrypt';
import authRoutes from '../routes/authRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { rateStore } from '../middleware/rateLimit.js';
import { sessions } from '../services/sessions.js';
import User from '../models/User.js';
import { refreshCookieOptions } from './authCookies.js';

let server: Server;
let base: string;
before(async () => {
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/api/auth', authRoutes);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api/auth`;
});
after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

test('production login cookie restores sessions and logout clears and revokes it', async t => {
  const values = { NODE_ENV: 'production', CLIENT_URL: 'https://store.example.test/', JWT_SECRET: 'test-access-secret-12345678901234567890', JWT_REFRESH_SECRET: 'test-refresh-secret-12345678901234567890' };
  const prior = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const user = { _id: 'a'.repeat(24), name: 'Reader', email: 'reader@example.test', passwordHash: await bcrypt.hash('test-password', 4), role: 'user', tokenVersion: 0 };
  t.mock.method(User, 'findOne', async () => user);
  t.mock.method(sessions, 'currentUser', async () => user);
  t.mock.method(sessions, 'revokeAll', async () => { user.tokenVersion++; });
  t.mock.method(rateStore, 'consume', async () => ({ count: 1, retryAfter: 60 }));
  const post = (route: string, body: object = {}, headers: Record<string, string> = {}) => fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://store.example.test', ...headers }, body: JSON.stringify(body),
  });
  const login = await post('/login', { email: user.email, password: 'test-password' });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie')!;
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=None', 'Partitioned', 'Path=/', 'Max-Age=604800']) assert.ok(setCookie.includes(attribute), attribute);
  const cookie = setCookie.split(';')[0];
  const refreshed = await post('/refresh', {}, { Cookie: cookie });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.headers.get('cache-control'), 'no-store');
  const { accessToken } = await refreshed.json() as { accessToken: string };
  assert.ok(accessToken);
  for (const origin of ['https://evil.example.test', 'null']) {
    assert.equal((await post('/refresh', {}, { Cookie: cookie, Origin: origin })).status, 403);
    assert.equal((await post('/login', { email: user.email, password: 'test-password' }, { Origin: origin })).status, 403);
    assert.equal((await post('/logout', {}, { Authorization: `Bearer ${accessToken}`, Origin: origin })).status, 403);
  }
  assert.equal((await post('/refresh')).status, 401);
  const logout = await post('/logout', {}, { Cookie: cookie, Authorization: `Bearer ${accessToken}` });
  assert.equal(logout.status, 200);
  const cleared = logout.headers.get('set-cookie')!;
  for (const attribute of ['refreshToken=;', 'HttpOnly', 'Secure', 'SameSite=None', 'Partitioned', 'Path=/', 'Expires=Thu, 01 Jan 1970']) assert.ok(cleared.includes(attribute), attribute);
  assert.equal((await post('/refresh', {}, { Cookie: cookie })).status, 401);
});

test('local HTTP development keeps a non-Secure same-site cookie', () => {
  const prior = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'development';
    assert.deepEqual(refreshCookieOptions(), { httpOnly: true, secure: false, sameSite: 'strict', partitioned: false, path: '/' });
  } finally { if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior; }
});
