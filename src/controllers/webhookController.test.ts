import '../test/httpFixtures.js';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { before, after, beforeEach, afterEach, test, type TestContext } from 'node:test';
import { Types } from 'mongoose';
import app from '../index.js';
import Order from '../models/Order.js';
import PaymentEvent from '../models/PaymentEvent.js';
import Entitlement from '../models/Entitlement.js';
import Cart from '../models/Cart.js';
import * as projection from '../services/orderProjection.js';

let server: Server;
let url: string;
const originalSecret = process.env.CASHFREE_SECRET_KEY;
const bookId = new Types.ObjectId();
const userId = new Types.ObjectId();
const orderId = new Types.ObjectId();
const cartItemId = new Types.ObjectId();

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  url = `http://127.0.0.1:${address.port}/api/webhooks/cashfree`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
});
beforeEach(() => { process.env.CASHFREE_SECRET_KEY = 'webhook_test_secret'; });
afterEach(() => {
  if (originalSecret === undefined) delete process.env.CASHFREE_SECRET_KEY;
  else process.env.CASHFREE_SECRET_KEY = originalSecret;
});

function payload(status = 'SUCCESS', paymentId: string | number = '12345') {
  return { type: `PAYMENT_${status}_WEBHOOK`, data: {
    order: { order_id: 'merchant_order', order_amount: 10.5, order_currency: 'INR' },
    payment: { cf_payment_id: paymentId, payment_status: status, payment_amount: 10.5, payment_currency: 'INR' },
  } };
}
function fixtures(t: TestContext) {
  const order = { _id: orderId, user: userId, amountInPaise: 1050, currency: 'INR',
    items: [{ cartItemId, book: bookId, quantity: 1 }, { book: bookId, quantity: 1 }] };
  const events = new Map<string, { eventType: string; signatureVerified: boolean }>();
  const find = t.mock.method(Order, 'findOne', async (filter: unknown): Promise<typeof order | null> => {
    assert.deepEqual(filter, { cashfreeOrderId: 'merchant_order' });
    return order;
  });
  const insert = t.mock.method(PaymentEvent, 'updateOne', async (filter: { cashfreeEventId: string }, update: {
    $setOnInsert: { eventType: string; signatureVerified: boolean };
  }) => {
    if (!events.has(filter.cashfreeEventId)) events.set(filter.cashfreeEventId, update.$setOnInsert);
    return {};
  });
  const reduce = t.mock.method(projection, 'reduceOrderStatus', async () => projection.computeOrderStatus([...events.values()]));
  const grant = t.mock.method(Entitlement, 'updateOne', async (filter: unknown, update: unknown) => {
    assert.deepEqual(filter, { user: userId, book: String(bookId) });
    assert.deepEqual(update, { $setOnInsert: { user: userId, book: String(bookId), order: orderId } });
    return {};
  });
  const cleanCart = t.mock.method(Cart, 'updateOne', async (filter: unknown, update: unknown) => {
    assert.ok(grant.mock.callCount() > 0, 'Grant access before removing the purchased cart line');
    assert.deepEqual(filter, { user: userId });
    assert.deepEqual(update, { $pull: { items: { $or: [{ _id: cartItemId, book: bookId, quantity: 1 }] } } });
    return {};
  });
  return { find, insert, grant, reduce, events, cleanCart };
}
async function post(value: unknown, options: { raw?: string; signedRaw?: string; signature?: string;
  timestamp?: string; headers?: Record<string, string> } = {}) {
  const raw = options.raw ?? JSON.stringify(value);
  const timestamp = options.timestamp ?? String(Date.now());
  const signature = options.signature ?? createHmac('sha256', 'webhook_test_secret')
    .update(timestamp).update(options.signedRaw ?? raw).digest('base64');
  const response = await fetch(url, { method: 'POST', body: raw, headers: {
    'Content-Type': 'application/json', 'x-webhook-timestamp': timestamp,
    'x-webhook-signature': signature, ...options.headers,
  } });
  return { status: response.status, body: await response.json() };
}

test('verifies exact raw bytes before database access; rejects tampered or absent signatures', async (t) => {
  const { find } = fixtures(t);
  const value = payload();
  const pretty = JSON.stringify(value, null, 2);
  assert.equal((await post(value, { raw: pretty, signedRaw: JSON.stringify(value) })).status, 401);
  assert.equal((await post(value, { signature: '' })).status, 401);
  assert.equal((await post(value, { timestamp: '' })).status, 401);
  assert.equal(find.mock.callCount(), 0);
  assert.equal((await post(value, { raw: pretty })).status, 200);
});

test('missing server secret rejects an otherwise valid request', async (t) => {
  const { find } = fixtures(t);
  delete process.env.CASHFREE_SECRET_KEY;
  assert.equal((await post(payload())).status, 401);
  assert.equal(find.mock.callCount(), 0);
});

test('malformed JSON and recognized malformed payloads return 400; unsupported media returns 415', async (t) => {
  const { find } = fixtures(t);
  assert.equal((await post({}, { raw: '{broken' })).status, 400);
  assert.equal((await post({ type: 'PAYMENT_SUCCESS_WEBHOOK' })).status, 400);
  assert.equal((await post(payload(), { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal(find.mock.callCount(), 0);
});

test('signed probes and unsupported event types are acknowledged without granting books', async (t) => {
  const { insert, grant } = fixtures(t);
  assert.equal((await post({ type: 'WEBHOOK', data: { test: true } })).status, 200);
  assert.equal((await post({ type: 'AUTO_REFUND_STATUS_WEBHOOK' })).status, 200);
  assert.equal(insert.mock.callCount(), 0);
  assert.equal(grant.mock.callCount(), 0);
});

test('a success is normalized, duplicates keep one event, and duplicate book lines grant once per delivery', async (t) => {
  const { events, grant, reduce } = fixtures(t);
  assert.equal((await post(payload(), { headers: { 'x-idempotency-key': 'first' } })).status, 200);
  assert.equal((await post(payload('SUCCESS', 12345), { timestamp: '123', headers: { 'x-idempotency-key': 'changed' } })).status, 200);
  assert.equal(events.size, 1);
  assert.equal([...events.values()][0].eventType, 'PAYMENT_SUCCESS');
  assert.equal(grant.mock.callCount(), 2);
  assert.equal(reduce.mock.callCount(), 2);
});

test('different attempts/statuses remain distinct; only confirmed payment removes purchased cart lines', async (t) => {
  const { events, grant, cleanCart } = fixtures(t);
  assert.equal((await post(payload('FAILED'))).status, 200);
  assert.equal((await post(payload('USER_DROPPED', '12346'))).status, 200);
  assert.equal(grant.mock.callCount(), 0);
  assert.equal(cleanCart.mock.callCount(), 0);
  assert.equal((await post(payload('SUCCESS'))).status, 200);
  assert.equal(events.size, 3);
  assert.equal(grant.mock.callCount(), 1);
  assert.equal(cleanCart.mock.callCount(), 1);
});

test('redelivery retries cart cleanup after a temporary failure', async t => {
  const { cleanCart } = fixtures(t);
  t.mock.method(console, 'error', () => {});
  cleanCart.mock.mockImplementationOnce(async () => { throw new Error('temporary DB outage'); });
  assert.equal((await post(payload())).status, 500);
  assert.equal((await post(payload())).status, 200);
  assert.equal(cleanCart.mock.callCount(), 2);
});

test('unknown orders and incorrect money/status are rejected before event insertion', async (t) => {
  const { insert, find } = fixtures(t);
  const wrongStatus = payload(); wrongStatus.data.payment.payment_status = 'FAILED';
  assert.equal((await post(wrongStatus)).status, 400);
  const wrongAmount = payload(); wrongAmount.data.order.order_amount = 1;
  assert.equal((await post(wrongAmount)).status, 400);
  const underpaid = payload(); underpaid.data.payment.payment_amount = 1;
  assert.equal((await post(underpaid)).status, 400);
  const wrongCurrency = payload(); wrongCurrency.data.payment.payment_currency = 'USD';
  assert.equal((await post(wrongCurrency)).status, 400);
  const fractional = payload(); fractional.data.order.order_amount = 10.501;
  assert.equal((await post(fractional)).status, 400);
  find.mock.mockImplementation(async () => null);
  assert.equal((await post(payload())).status, 404);
  assert.equal(insert.mock.callCount(), 0);
});

test('redelivery repairs fulfilment after an event was saved and granting failed', async (t) => {
  const { grant, events } = fixtures(t);
  t.mock.method(console, 'error', () => {});
  grant.mock.mockImplementationOnce(async () => { throw new Error('temporary DB outage'); });
  assert.equal((await post(payload())).status, 500);
  assert.equal(events.size, 1);
  assert.equal((await post(payload())).status, 200);
  assert.equal(events.size, 1);
  assert.equal(grant.mock.callCount(), 2);
});

test('unique-index races succeed only when the expected event and entitlement already exist', async (t) => {
  const { insert, grant, reduce } = fixtures(t);
  insert.mock.mockImplementation(async () => { throw { code: 11000 }; });
  t.mock.method(PaymentEvent, 'exists', async () => ({ _id: new Types.ObjectId() }));
  reduce.mock.mockImplementation(async () => 'paid' as const);
  grant.mock.mockImplementation(async () => { throw { code: 11000 }; });
  t.mock.method(Entitlement, 'exists', async () => ({ _id: new Types.ObjectId() }));
  assert.equal((await post(payload())).status, 200);
});

test('refund notifications distinguish a full refund from partial, pending and cancelled refunds', async (t) => {
  const { events, grant } = fixtures(t);
  const refund = (id: number, status: string, amount: number) => ({ type: 'REFUND_STATUS_WEBHOOK', data: {
    refund: { cf_refund_id: id, order_id: 'merchant_order', refund_amount: amount,
      refund_currency: 'INR', refund_status: status, refund_type: 'MERCHANT_INITIATED' },
  } });
  assert.equal((await post(refund(1, 'PENDING', 10.5))).status, 200);
  assert.equal((await post(refund(2, 'SUCCESS', 5))).status, 200);
  assert.equal((await post(refund(3, 'CANCELLED', 10.5))).status, 200);
  assert.equal(projection.computeOrderStatus([...events.values()]), 'created');
  assert.equal((await post(refund(1, 'SUCCESS', 10.5))).status, 200);
  assert.equal(projection.computeOrderStatus([...events.values()]), 'refunded');
  assert.equal(grant.mock.callCount(), 0);
});
