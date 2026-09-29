import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { before, after, test } from 'node:test';
import { Types } from 'mongoose';
import app from '../index.js';
import User from '../models/User.js';
import { generateAccessToken } from '../utils/jwt.js';

const userId = String(new Types.ObjectId());
const originalSecret = process.env.JWT_SECRET;
let server: Server;
let base: string;
before(async () => {
  process.env.JWT_SECRET = 'profile_test_secret';
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api/users/me`;
});
after(async () => {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
});
async function request(body?: unknown, authorized = true) {
  const response = await fetch(base, { method: body === undefined ? 'GET' : 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(authorized ? {
      Authorization: `Bearer ${generateAccessToken({ userId, role: 'user' })}`,
    } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, body: await response.json() as any };
}
test('GET and PATCH require authentication before database access', async t => {
  const read = t.mock.method(User, 'findById', () => { throw new Error('Unexpected query'); });
  const write = t.mock.method(User, 'findByIdAndUpdate', () => { throw new Error('Unexpected write'); });
  assert.equal((await request(undefined, false)).response.status, 401);
  assert.equal((await request({ name: 'Reader' }, false)).response.status, 401);
  assert.equal(read.mock.callCount() + write.mock.callCount(), 0);
});
test('GET selects safe profile fields for the token owner and disables caching', async t => {
  const profile = { _id: userId, name: 'Reader', email: 'reader@example.com', role: 'user' };
  t.mock.method(User, 'findById', (id: string) => {
    assert.equal(id, userId);
    return { select: (fields: string) => {
      assert.equal(fields, '_id name email role avatarUrl createdAt updatedAt');
      return { lean: async () => profile };
    } };
  });
  const { response, body } = await request();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(body, { data: profile });
});
test('PATCH updates only supplied allowed fields and supports clearing the avatar', async t => {
  let expected: Record<string, string> = {};
  t.mock.method(User, 'findByIdAndUpdate', (id: string, update: unknown, options: unknown) => {
    assert.equal(id, userId); assert.deepEqual(update, { $set: expected });
    assert.deepEqual(options, { returnDocument: 'after', runValidators: true });
    return { select: (fields: string) => {
      assert.ok(!fields.includes('password'));
      return { lean: async () => ({ _id: userId, ...expected }) };
    } };
  });
  for (const input of [{ name: '  Reader  ' }, { avatarUrl: 'https://example.com/avatar.png' },
    { avatarUrl: '' }, { name: 'New Name', avatarUrl: 'https://example.com/new.png' }]) {
    expected = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value.trim()]));
    const { response, body } = await request(input);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(body.data, { _id: userId, ...expected });
  }
});
test('rejects password, role, email, ownership and MongoDB operators even with valid fields', async t => {
  const write = t.mock.method(User, 'findByIdAndUpdate', () => { throw new Error('Unexpected write'); });
  for (const field of ['password', 'passwordHash', 'role', 'email', '_id', 'userId', '$set', 'createdAt']) {
    const result = await request({ name: 'Allowed name', [field]: 'forbidden' });
    assert.equal(result.response.status, 400); assert.ok(result.body.errors);
  }
  assert.equal(write.mock.callCount(), 0);
});
test('rejects empty or malformed bodies, invalid names and unsafe avatar URLs', async t => {
  const write = t.mock.method(User, 'findByIdAndUpdate', () => { throw new Error('Unexpected write'); });
  for (const input of [{}, [], { name: '' }, { name: '   ' }, { name: 'x'.repeat(101) }, { name: null },
    { avatarUrl: 'javascript:alert(1)' }, { avatarUrl: 'data:image/png;base64,AAAA' },
    { avatarUrl: 'https://user:password@example.com/a' }, { avatarUrl: 'not a URL' }, { avatarUrl: null }]) {
    assert.equal((await request(input)).response.status, 400);
  }
  assert.equal(write.mock.callCount(), 0);
});
test('deleted users receive 401 without creating a replacement user', async t => {
  t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => null }) }));
  t.mock.method(User, 'findByIdAndUpdate', (_id: unknown, _update: unknown, options: { upsert?: boolean }) => {
    assert.ok(!options.upsert); return { select: () => ({ lean: async () => null }) };
  });
  assert.equal((await request()).response.status, 401);
  assert.equal((await request({ name: 'Reader' })).response.status, 401);
});
