import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { Types } from 'mongoose';
import { Cashfree } from 'cashfree-pg';
import app from '../index.js';
import Order from '../models/Order.js';
import PaymentEvent from '../models/PaymentEvent.js';
import { generateAccessToken } from '../utils/jwt.js';

const userId = new Types.ObjectId().toString();
const orderId = new Types.ObjectId().toString();
const originalSecret = process.env.JWT_SECRET;
let server: Server;
let baseUrl: string;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
});
beforeEach(() => { process.env.JWT_SECRET = 'order_status_test_secret'; });
afterEach(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

async function get(id = orderId, owner: string | null = userId) {
  const headers: Record<string, string> = {};
  if (owner) headers.Authorization = `Bearer ${generateAccessToken({ userId: owner, role: 'user' })}`;
  return fetch(`${baseUrl}/api/orders/${id}/status`, { headers });
}

async function requestOrders(path = '', owner: string | null = userId) {
  const headers: Record<string, string> = {};
  if (owner) headers.Authorization = `Bearer ${generateAccessToken({ userId: owner, role: 'user' })}`;
  return fetch(`${baseUrl}/api/orders${path}`, { headers });
}

test('history and details require authentication before database access', async t => {
  const list = t.mock.method(Order, 'find', () => { throw new Error('Unexpected query'); });
  const detail = t.mock.method(Order, 'findOne', () => { throw new Error('Unexpected query'); });
  assert.equal((await requestOrders('', null)).status, 401);
  assert.equal((await requestOrders(`/${orderId}`, null)).status, 401);
  assert.equal(list.mock.callCount() + detail.mock.callCount(), 0);
});

test('history rejects invalid pagination and details reject invalid IDs', async t => {
  const list = t.mock.method(Order, 'find', () => { throw new Error('Unexpected query'); });
  const detail = t.mock.method(Order, 'findOne', () => { throw new Error('Unexpected query'); });
  for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=1000001', 'limit=101', 'limit=0', 'page=abc', 'page=1&page=2']) {
    assert.equal((await requestOrders(`?${query}`)).status, 400);
  }
  assert.equal((await requestOrders('/bad-id')).status, 400);
  assert.equal(list.mock.callCount() + detail.mock.callCount(), 0);
});

test('history scopes records and count to the caller, with stable pagination', async t => {
  t.mock.method(Order, 'find', (filter: unknown) => {
    assert.deepEqual(filter, { user: userId });
    return { select: () => ({ sort: (sort: unknown) => {
      assert.deepEqual(sort, { createdAt: -1, _id: -1 });
      return { skip: (skip: number) => {
        assert.equal(skip, 2);
        return { limit: (limit: number) => {
          assert.equal(limit, 2);
          return { lean: async () => [{ _id: orderId, status: 'paid' }] };
        } };
      } };
    } }) };
  });
  t.mock.method(Order, 'countDocuments', async (filter: unknown) => {
    assert.deepEqual(filter, { user: userId }); return 3;
  });
  const response = await requestOrders('?page=2&limit=2&user=someone-else');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { data: [{ _id: orderId, status: 'paid' }], meta: { total: 3, page: 2, limit: 2, totalPages: 2 } });
});

test('order details return the owner snapshot and conceal other users orders', async t => {
  const stored = { _id: orderId, items: [{ book: 'book-id', quantity: 2, priceAtPurchase: 150 }], amountInPaise: 300, status: 'paid' };
  t.mock.method(Order, 'findOne', (filter: { _id: string; user: string }) => ({ select: () => ({
    populate: (path: string, fields: string) => {
      assert.equal(path, 'items.book'); assert.equal(fields, '_id title slug');
      return { lean: async () => filter.user === userId && filter._id === orderId ? stored : null };
    },
  }) }));
  const own = await requestOrders(`/${orderId}`);
  assert.equal(own.status, 200);
  assert.deepEqual(await own.json(), { data: stored });
  const foreign = await requestOrders(`/${orderId}`, new Types.ObjectId().toString());
  const missing = await requestOrders(`/${new Types.ObjectId()}`);
  assert.equal(foreign.status, 404); assert.equal(missing.status, 404);
  assert.deepEqual(await foreign.json(), await missing.json());
});

test('requires authentication before querying orders', async t => {
  const query = t.mock.method(Order, 'findOne', () => { throw new Error('Unexpected query'); });
  assert.equal((await get(orderId, null)).status, 401);
  assert.equal(query.mock.callCount(), 0);
});

test('invalid order IDs return 400 without querying the database', async t => {
  const query = t.mock.method(Order, 'findOne', () => { throw new Error('Unexpected query'); });
  assert.equal((await get('not-an-object-id')).status, 400);
  assert.equal(query.mock.callCount(), 0);
});

test('polls fresh stored statuses without calling Cashfree or exposing order details', async t => {
  let status = 'created';
  t.mock.method(Order, 'findOne', (filter: unknown) => {
    assert.deepEqual(filter, { _id: orderId, user: userId });
    return { select: () => ({ lean: async () => ({ _id: orderId, status, user: userId, items: ['private'] }) }) };
  });
  const provider = t.mock.method(Cashfree.prototype, 'PGFetchOrder', () => { throw new Error('Must not call Cashfree'); });
  const write = t.mock.method(Order, 'findOneAndUpdate', () => { throw new Error('Must not project status'); });
  for (status of ['created', 'paid', 'failed', 'refunded']) {
    const response = await get();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { data: { orderId, status } });
  }
  assert.equal(provider.mock.callCount(), 0);
  assert.equal(write.mock.callCount(), 0);
});

test('another user cannot read the status, and missing orders have the same 404', async t => {
  const otherUser = new Types.ObjectId().toString();
  t.mock.method(Order, 'findOne', (filter: { _id: string; user: string }) => ({
    select: () => ({ lean: async () => filter.user === userId && filter._id === orderId
      ? { _id: orderId, status: 'paid' } : null }),
  }));
  const foreign = await get(orderId, otherUser);
  const missing = await get(new Types.ObjectId().toString());
  assert.equal(foreign.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(await foreign.json(), await missing.json());
});

test('database failures use the central error handler', async t => {
  t.mock.method(Order, 'findOne', () => ({ select: () => ({ lean: async () => { throw new Error('Database unavailable'); } }) }));
  assert.equal((await get()).status, 500);
});

test('customer timeline requires authentication and validates IDs before querying', async t => {
  const owned = t.mock.method(Order, 'exists', () => { throw new Error('Unexpected query'); });
  assert.equal((await requestOrders(`/${orderId}/events`, null)).status, 401);
  assert.equal((await requestOrders('/invalid/events')).status, 400);
  assert.equal(owned.mock.callCount(), 0);
});

test('customer timeline checks ownership before querying events, including unknown orders', async t => {
  t.mock.method(Order, 'exists', async (filter: unknown) => {
    assert.deepEqual(filter, { _id: orderId, user: userId }); return null;
  });
  const events = t.mock.method(PaymentEvent, 'find', () => { throw new Error('Must not query events'); });
  assert.equal((await requestOrders(`/${orderId}/events`)).status, 404);
  assert.equal(events.mock.callCount(), 0);
});

test('customer timeline returns only safe, trusted event summaries in stable time order', async t => {
  t.mock.method(Order, 'exists', async (filter: unknown) => {
    assert.deepEqual(filter, { _id: orderId, user: userId }); return { _id: orderId };
  });
  t.mock.method(PaymentEvent, 'find', (filter: unknown) => {
    assert.deepEqual(filter, { order: orderId, $or: [{ signatureVerified: true }, { source: 'reconciliation' }],
      eventType: { $in: ['PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'PAYMENT_PENDING', 'REFUND_SUCCESS'] } });
    return { select: (fields: string) => {
      assert.equal(fields, '_id eventType receivedAt');
      return { sort: (sort: unknown) => {
        assert.deepEqual(sort, { receivedAt: 1, _id: 1 });
        return { lean: async () => [{ _id: 'event', eventType: 'PAYMENT_SUCCESS', receivedAt: '2026-09-29', rawPayload: { secret: 'private' }, cashfreeEventId: 'private' }] };
      } };
    } };
  });
  const result = await requestOrders(`/${orderId}/events`);
  assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await result.json(), { data: [{ _id: 'event', eventType: 'PAYMENT_SUCCESS', receivedAt: '2026-09-29' }] });
});
