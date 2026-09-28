import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import PaymentEvent from '../models/PaymentEvent.js';
import { reduceOrderStatus } from '../services/orderProjection.js';

dotenv.config({ path: resolve(__dirname, '../../.env'), quiet: true });

async function run() {
  assert.ok(process.env.MONGO_URI, 'MONGO_URI is required');
  const orderId = new mongoose.Types.ObjectId();
  const otherOrderId = new mongoose.Types.ObjectId();
  const cashfreeOrderId = `projection_test_${randomUUID()}`;
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15_000 });
    await Promise.all([Order.init(), PaymentEvent.init()]);
    await Order.create({
      _id: orderId, user: new mongoose.Types.ObjectId(), orderNumber: cashfreeOrderId,
      cashfreeOrderId, items: [{ book: new mongoose.Types.ObjectId(), quantity: 1, priceAtPurchase: 100 }],
      amountInPaise: 100, currency: 'INR', status: 'created',
    });
    const insert = (eventType: string, signatureVerified = true, order = orderId, remoteId = cashfreeOrderId) =>
      PaymentEvent.create({ order, cashfreeOrderId: remoteId, cashfreeEventId: randomUUID(),
        eventType, signatureVerified, rawPayload: { test: 'order_projection' } });

    assert.equal(await reduceOrderStatus(orderId), 'created');
    await insert('REFUND_SUCCESS', false);
    await insert('REFUND_SUCCESS', true, otherOrderId);
    await insert('REFUND_SUCCESS', true, orderId, 'wrong_remote_order');
    assert.equal(await reduceOrderStatus(orderId), 'created');
    await insert('PAYMENT_FAILED');
    assert.equal(await reduceOrderStatus(orderId), 'failed');
    await insert('PAYMENT_SUCCESS');
    assert.equal(await reduceOrderStatus(orderId), 'paid');
    assert.equal((await Order.findById(orderId))?.status, 'paid');
    console.log('PASS: manually inserted PAYMENT_SUCCESS persisted order.status=paid.');
    await insert('PAYMENT_FAILED');
    assert.equal(await reduceOrderStatus(orderId), 'paid');
    await insert('REFUND_SUCCESS');
    const results = await Promise.all([reduceOrderStatus(orderId), reduceOrderStatus(orderId)]);
    assert.deepEqual(results, ['refunded', 'refunded']);
    assert.equal((await Order.findById(orderId))?.status, 'refunded');
    console.log('PASS: isolation, unverified events, late failures, full refund and concurrent reducers.');
  } finally {
    try {
      if (mongoose.connection.readyState === 1) {
        // Only remove records owned by this unique test run; no existing orders are touched.
        await PaymentEvent.deleteMany({ order: { $in: [orderId, otherOrderId] } });
        await Order.deleteOne({ _id: orderId });
        console.log('Temporary projection test records removed; no Cashfree API calls were made.');
      }
    } finally {
      await mongoose.disconnect();
    }
  }
}

run().catch((error: unknown) => {
  const err = error as { name?: string; code?: string };
  if (err.name === 'AssertionError') console.error((error as Error).message);
  else console.error('Order projection DB test failed:', { name: err.name, code: err.code });
  process.exitCode = 1;
});
