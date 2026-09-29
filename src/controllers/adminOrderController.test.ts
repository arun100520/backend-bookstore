import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { before, after, test } from 'node:test';
import { Types } from 'mongoose';
import { Cashfree } from 'cashfree-pg';
import app from '../index.js';
import Order from '../models/Order.js';
import PaymentEvent from '../models/PaymentEvent.js';
import { generateAccessToken } from '../utils/jwt.js';

const id = String(new Types.ObjectId());
const saved = ['JWT_SECRET', 'CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY', 'CASHFREE_ENV'].map(key => process.env[key]);
let server: Server;
let base: string;
before(async () => {
  process.env.JWT_SECRET = 'admin_order_test'; process.env.CASHFREE_APP_ID = 'test';
  process.env.CASHFREE_SECRET_KEY = 'test'; process.env.CASHFREE_ENV = 'sandbox';
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api/admin/orders`;
});
after(async () => {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  ['JWT_SECRET', 'CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY', 'CASHFREE_ENV'].forEach((key, i) => {
    if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i];
  });
});
async function request(path = '', role: 'admin' | 'user' | null = 'admin') {
  const r = await fetch(base + path, { method: path.endsWith('/resync') ? 'POST' : 'GET', headers: role ? {
    Authorization: `Bearer ${generateAccessToken({ userId: id, role })}`,
  } : {} });
  return { status: r.status, body: await r.json() as any };
}
test('all admin order routes reject anonymous and non-admin callers before data access', async t => {
  const read = t.mock.method(Order, 'findById', () => { throw new Error('Unexpected read'); });
  const list = t.mock.method(Order, 'find', () => { throw new Error('Unexpected list'); });
  for (const path of ['', `/${id}`, `/${id}/events`, `/${id}/resync`]) {
    assert.equal((await request(path, null)).status, 401);
    assert.equal((await request(path, 'user')).status, 403);
  }
  assert.equal(read.mock.callCount() + list.mock.callCount(), 0);
});

test('admin order details validate IDs, select receipt fields and handle missing orders', async t => {
  let stored: unknown = { _id: id, user: 'another-user', status: 'paid' };
  t.mock.method(Order, 'findById', (value: unknown) => {
    assert.equal(value, id);
    return { select: (fields: string) => { assert.equal(fields, '_id user orderNumber items amountInPaise currency status cashfreeOrderId createdAt updatedAt'); return { lean: async () => stored }; } };
  });
  assert.equal((await request('/bad')).status, 400);
  assert.deepEqual((await request(`/${id}`)).body, { data: stored });
  stored = null; assert.equal((await request(`/${id}`)).status, 404);
});
test('invalid IDs and pagination return 400; missing orders return 404', async t => {
  t.mock.method(Order, 'findById', async () => null);
  for (const path of ['?page=0', '?limit=101', '/bad/events', '/bad/resync']) assert.equal((await request(path)).status, 400);
  assert.equal((await request(`/${id}/events`)).status, 404);
  assert.equal((await request(`/${id}/resync`)).status, 404);
});
test('admin list includes all owners with pagination', async t => {
  t.mock.method(Order, 'find', (filter: unknown) => {
    assert.deepEqual(filter, {});
    return { select: () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [{ _id: id, user: 'another-user' }] }) }) }) }) };
  });
  t.mock.method(Order, 'countDocuments', async () => 1);
  const result = await request(); assert.equal(result.status, 200);
  assert.equal(result.body.data[0].user, 'another-user'); assert.equal(result.body.meta.total, 1);
});
test('resync without a provider reference returns 409', async t => {
  t.mock.method(Order, 'findById', async () => ({ _id: id }));
  assert.equal((await request(`/${id}/resync`)).status, 409);
});
test('provider failures and mismatched responses return safe 502 without inserting events', async t => {
  t.mock.method(Order, 'findById', async () => ({ _id: id, cashfreeOrderId: 'merchant', amountInPaise: 100, currency: 'INR' }));
  let fail = true;
  t.mock.method(Cashfree.prototype, 'PGFetchOrder', async () => {
    if (fail) throw new Error('secret-provider-header');
    return { data: { order_id: 'other', order_amount: 1, order_currency: 'INR', order_status: 'PAID' } };
  });
  const write = t.mock.method(PaymentEvent, 'updateOne', () => { throw new Error('Unexpected write'); });
  for (fail of [true, false]) {
    const result = await request(`/${id}/resync`); assert.equal(result.status, 502);
    assert.ok(!JSON.stringify(result.body).includes('secret-provider-header'));
  }
  assert.equal(write.mock.callCount(), 0);
});
