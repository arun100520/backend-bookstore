import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Types } from 'mongoose';
import { Cashfree } from 'cashfree-pg';
import Order from '../models/Order.js';
import PaymentEvent from '../models/PaymentEvent.js';
import { computeOrderStatus } from '../services/orderProjection.js';
import { reconciliationConfig, reconciliationEventType, reconcilePendingOrders } from './reconcilePendingOrders.js';

const order = { cashfreeOrderId: 'merchant_1', amountInPaise: 1051, currency: 'INR' };
const snapshot = { order_id: 'merchant_1', order_amount: 10.51, order_currency: 'INR', order_status: 'PAID' };

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
test('selects only old created orders and continues after individual provider errors', async t => {
  const now = new Date('2026-09-28T12:00:00Z');
  t.mock.method(PaymentEvent, 'find', () => ({ cursor: async function* () {} }));
  t.mock.method(Order, 'find', (filter: unknown) => {
    assert.deepEqual(filter, { status: 'created', createdAt: { $lte: new Date('2026-09-28T11:45:00Z') },
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
