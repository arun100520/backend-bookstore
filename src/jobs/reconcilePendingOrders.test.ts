import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Types } from 'mongoose';
import { Cashfree } from 'cashfree-pg';
import Order from '../models/Order.js';
import PaymentEvent from '../models/PaymentEvent.js';
import Cart from '../models/Cart.js';
import Entitlement from '../models/Entitlement.js';
import * as projection from '../services/orderProjection.js';
import { computeOrderStatus } from '../services/orderProjection.js';
import { reconciliationConfig, reconciliationEventType, reconcilePendingOrders } from './reconcilePendingOrders.js';

const order = { cashfreeOrderId: 'merchant_1', amountInPaise: 1051, currency: 'INR' };
const snapshot = { order_id: 'merchant_1', order_amount: 10.51, order_currency: 'INR', order_status: 'PAID' };

test('reconciliation removes the checkout snapshot only after verified payment and retries incomplete cleanup', async t => {
  const cartItemId = new Types.ObjectId();
  const paidOrder = { ...order, _id: new Types.ObjectId(), user: new Types.ObjectId(),
    items: [{ cartItemId, book: new Types.ObjectId(), quantity: 1 }] };
  const event = { _id: new Types.ObjectId(), order: paidOrder._id, cashfreeOrderId: order.cashfreeOrderId };
  t.mock.method(PaymentEvent, 'find', () => ({ cursor: async function* () { yield event; } }));
  t.mock.method(Order, 'find', () => ({ sort: () => ({ cursor: async function* () {} }) }));
  t.mock.method(Order, 'findOne', async () => paidOrder);
  let status: 'created' | 'failed' | 'paid' = 'created';
  t.mock.method(projection, 'reduceOrderStatus', async () => status);
  const grant = t.mock.method(Entitlement, 'updateOne', async () => ({}));
  const processed = t.mock.method(PaymentEvent, 'updateOne', async () => ({}));
  let unavailable = true;
  const cleanCart = t.mock.method(Cart, 'updateOne', async (filter: unknown, update: unknown) => {
    assert.equal(status, 'paid');
    assert.ok(grant.mock.callCount() > 0);
    assert.deepEqual(filter, { user: paidOrder.user });
    assert.deepEqual(update, { $pull: { items: { $or: [{ _id: cartItemId, book: paidOrder.items[0].book, quantity: 1 }] } } });
    if (unavailable) throw new Error('temporary DB outage');
    return {};
  });
  for (const pending of ['created', 'failed'] as const) {
    status = pending;
    await reconcilePendingOrders();
  }
  assert.equal(cleanCart.mock.callCount(), 0);
  assert.equal(grant.mock.callCount(), 0);
  const before = processed.mock.callCount();
  status = 'paid';
  assert.equal((await reconcilePendingOrders()).failed, 1);
  assert.equal(processed.mock.callCount(), before, 'Keep the event retryable when cart cleanup fails');
  unavailable = false;
  assert.equal((await reconcilePendingOrders()).repaired, 1);
  assert.equal(processed.mock.callCount(), before + 1);
  assert.equal(cleanCart.mock.callCount(), 2);
});

test('maps provider order states without treating active orders as failed', () => {
  for (const [state, expected] of Object.entries({ PAID: 'PAYMENT_SUCCESS', ACTIVE: 'PAYMENT_PENDING',
    TERMINATION_REQUESTED: 'PAYMENT_PENDING', EXPIRED: 'PAYMENT_FAILED', TERMINATED: 'PAYMENT_FAILED' })) {
    assert.equal(reconciliationEventType({ ...snapshot, order_status: state }, order).eventType, expected);
  }
});
test('rejects mismatched IDs, money, currency, and unrecognized or malformed responses', () => {
  for (const change of [{ order_id: 'other' }, { order_amount: 10.52 }, { order_amount: 10.511 },
    { order_amount: NaN }, { order_currency: 'USD' }, { order_status: 'UNKNOWN' }, { order_amount: '10.51' }]) {
    assert.throws(() => reconciliationEventType({ ...snapshot, ...change }, order));
  }
});
test('trusts server reconciliation without falsely claiming a webhook signature', () => {
  const paid = { eventType: 'PAYMENT_SUCCESS', signatureVerified: false, source: 'reconciliation' as const };
  assert.equal(computeOrderStatus([paid]), 'paid');
  assert.equal(computeOrderStatus([{ ...paid, source: 'webhook' }]), 'created');
  assert.equal(computeOrderStatus([paid, { eventType: 'PAYMENT_FAILED', signatureVerified: true }]), 'paid');
  assert.equal(computeOrderStatus([paid, { eventType: 'REFUND_SUCCESS', signatureVerified: true }]), 'refunded');
});
test('validates interval settings and supports explicitly disabling the scheduler', () => {
  assert.deepEqual(reconciliationConfig({}), { enabled: true, intervalMs: 300000, minAgeMs: 900000 });
  assert.equal(reconciliationConfig({ RECONCILIATION_ENABLED: 'false' }).enabled, false);
  for (const value of ['0', '-1', 'NaN', '1.5', '1441', '']) {
    assert.throws(() => reconciliationConfig({ RECONCILIATION_INTERVAL_MINUTES: value }));
  }
  assert.throws(() => reconciliationConfig({ RECONCILIATION_ENABLED: 'yes' }));
});
test('selects old unresolved orders including failed attempts and continues after provider errors', async t => {
  const now = new Date('2026-09-28T12:00:00Z');
  t.mock.method(PaymentEvent, 'find', () => ({ cursor: async function* () {} }));
  t.mock.method(Order, 'find', (filter: unknown) => {
    assert.deepEqual(filter, { status: { $in: ['created', 'failed'] }, providerClosed: { $ne: true }, createdAt: { $lte: new Date('2026-09-28T11:45:00Z') },
      cashfreeOrderId: { $type: 'string', $ne: '' } });
    return { sort: () => ({ cursor: async function* () {
      yield { ...order, _id: new Types.ObjectId() };
      yield { ...order, _id: new Types.ObjectId(), cashfreeOrderId: 'merchant_2' };
    } }) };
  });
  const originals = [process.env.CASHFREE_APP_ID, process.env.CASHFREE_SECRET_KEY, process.env.CASHFREE_ENV];
  process.env.CASHFREE_APP_ID = 'test'; process.env.CASHFREE_SECRET_KEY = 'test'; process.env.CASHFREE_ENV = 'sandbox';
  const provider = t.mock.method(Cashfree.prototype, 'PGFetchOrder', async () => { throw new Error('Timeout'); });
  const write = t.mock.method(PaymentEvent, 'updateOne', () => { throw new Error('Unexpected event write'); });
  try {
    assert.deepEqual(await reconcilePendingOrders({ now, minAgeMs: 900000 }), { checked: 2, repaired: 0, failed: 2 });
    assert.equal(provider.mock.callCount(), 2);
    assert.equal(write.mock.callCount(), 0);
  } finally {
    ['CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY', 'CASHFREE_ENV'].forEach((key, i) => {
      if (originals[i] === undefined) delete process.env[key]; else process.env[key] = originals[i];
    });
  }
});
