import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Types } from 'mongoose';
import Order from '../models/Order.js';
import PaymentEvent from '../models/PaymentEvent.js';
import { computeOrderStatus, reduceOrderStatus, type ProjectionEvent } from './orderProjection.js';

const event = (eventType: string, signatureVerified = true): ProjectionEvent => ({ eventType, signatureVerified });

test('no events, unknown events and unverified events leave an order created', () => {
  assert.equal(computeOrderStatus([]), 'created');
  assert.equal(computeOrderStatus([
    event('PAYMENT_PENDING'), event('REFUND_PENDING'), event('REFUND_FAILED'),
    event('PARTIAL_REFUND_SUCCESS'), event('PAYMENT_SUCCESS', false), event('REFUND_SUCCESS', false),
  ]), 'created');
});

test('a success marks paid and an unsuccessful attempt alone marks failed', () => {
  assert.equal(computeOrderStatus([event('PAYMENT_SUCCESS')]), 'paid');
  assert.equal(computeOrderStatus([event('PAYMENT_FAILED')]), 'failed');
});

test('late failures, unknown events and duplicate successes cannot downgrade paid', () => {
  for (const events of [
    [event('PAYMENT_FAILED'), event('PAYMENT_SUCCESS')],
    [event('PAYMENT_SUCCESS'), event('PAYMENT_FAILED'), event('PAYMENT_PENDING')],
    [event('PAYMENT_SUCCESS'), event('PAYMENT_SUCCESS'), event('REFUND_FAILED')],
  ]) assert.equal(computeOrderStatus(events), 'paid');
});

test('a full refund wins in every delivery order, including before payment success arrives', () => {
  const success = event('PAYMENT_SUCCESS');
  const failed = event('PAYMENT_FAILED');
  const refund = event('REFUND_SUCCESS');
  for (const events of [
    [success, failed, refund], [success, refund, failed], [failed, success, refund],
    [failed, refund, success], [refund, failed, success], [refund, success, failed],
    [refund, refund],
  ]) assert.equal(computeOrderStatus(events), 'refunded');
});

test('invalid IDs fail before any database query', async (t) => {
  const query = t.mock.method(Order, 'findById', () => { throw new Error('Must not query'); });
  await assert.rejects(reduceOrderStatus('bad-id'), { statusCode: 400 });
  assert.equal(query.mock.callCount(), 0);
});

test('a missing order returns 404 without reading payment events', async (t) => {
  t.mock.method(Order, 'findById', () => ({ select: () => ({ lean: async () => null }) }));
  const query = t.mock.method(PaymentEvent, 'find', () => { throw new Error('Must not query'); });
  await assert.rejects(reduceOrderStatus(new Types.ObjectId()), { statusCode: 404 });
  assert.equal(query.mock.callCount(), 0);
});

test('reads only matching order events and persists paid with a guarded version update', async (t) => {
  const orderId = new Types.ObjectId();
  t.mock.method(Order, 'findById', () => ({ select: () => ({ lean: async () => ({
    _id: orderId, cashfreeOrderId: 'merchant_order', __v: 0,
  }) }) }));
  t.mock.method(PaymentEvent, 'find', (filter: unknown) => {
    assert.deepEqual(filter, { order: orderId, cashfreeOrderId: 'merchant_order' });
    return { select: () => ({ lean: async () => [event('PAYMENT_SUCCESS')] }) };
  });
  t.mock.method(Order, 'findOneAndUpdate', async (filter: unknown, update: unknown) => {
    assert.deepEqual(filter, { _id: orderId, __v: 0 });
    assert.deepEqual(update, { $set: { status: 'paid' }, $inc: { __v: 1 } });
    return { status: 'paid' };
  });
  assert.equal(await reduceOrderStatus(String(orderId)), 'paid');
});

test('a stale projection retries with fresh events instead of downgrading a newer result', async (t) => {
  const orderId = new Types.ObjectId();
  let attempt = 0;
  t.mock.method(Order, 'findById', () => ({ select: () => ({ lean: async () => ({
    _id: orderId, __v: attempt,
  }) }) }));
  t.mock.method(PaymentEvent, 'find', () => ({ select: () => ({ lean: async () =>
    attempt === 0 ? [event('PAYMENT_FAILED')] : [event('PAYMENT_FAILED'), event('PAYMENT_SUCCESS')],
  }) }));
  t.mock.method(Order, 'findOneAndUpdate', async (_filter: unknown, update: unknown) => {
    attempt++;
    if (attempt === 1) return null;
    assert.deepEqual(update, { $set: { status: 'paid' }, $inc: { __v: 1 } });
    return { status: 'paid' };
  });
  assert.equal(await reduceOrderStatus(orderId), 'paid');
  assert.equal(attempt, 2);
});

test('contention retries are bounded and surface a retryable error', async (t) => {
  const orderId = new Types.ObjectId();
  t.mock.method(Order, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: orderId, __v: 0 }) }) }));
  t.mock.method(PaymentEvent, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  const update = t.mock.method(Order, 'findOneAndUpdate', async () => null);
  await assert.rejects(reduceOrderStatus(orderId), { statusCode: 409 });
  assert.equal(update.mock.callCount(), 5);
});
