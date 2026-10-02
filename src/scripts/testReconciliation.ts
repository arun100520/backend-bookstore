import { requireDisposableDatabase } from '../config/operationalSafety.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Cashfree } from 'cashfree-pg';
import Order from '../models/Order.js';
import PaymentEvent from '../models/PaymentEvent.js';
import Entitlement from '../models/Entitlement.js';
import { reconcilePendingOrders } from '../jobs/reconcilePendingOrders.js';

dotenv.config({ path: resolve(__dirname, '../../.env'), quiet: true });
const ids: mongoose.Types.ObjectId[] = [];
const originalFetch = Cashfree.prototype.PGFetchOrder;
const originalGrant = Entitlement.updateOne;
async function run() {
  assert.equal(process.env.CASHFREE_ENV?.trim() || 'sandbox', 'sandbox');
  assert.ok(process.env.MONGO_URI);
  requireDisposableDatabase();
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  await Promise.all([Order.init(), PaymentEvent.init(), Entitlement.init()]);
  const now = new Date();
  let providerCalls = 0;
  let remoteStatus = 'PAID';
  Cashfree.prototype.PGFetchOrder = (async (orderId: string) => {
    providerCalls++;
    return { data: { order_id: orderId, order_amount: 10.51, order_currency: 'INR', order_status: remoteStatus } };
  }) as typeof originalFetch;
  async function fixture(ageMinutes: number) {
    const id = new mongoose.Types.ObjectId(); ids.push(id);
    const ref = `reconciliation_test_${randomUUID()}`;
    await Order.create({ _id: id, user: new mongoose.Types.ObjectId(), orderNumber: ref, cashfreeOrderId: ref,
      items: [{ book: new mongoose.Types.ObjectId(), quantity: 1, priceAtPurchase: 1051 }],
      amountInPaise: 1051, currency: 'INR', status: 'created' });
    // Raw update deliberately bypasses Mongoose's immutable createdAt for acceptance testing.
    await Order.collection.updateOne({ _id: id }, { $set: { createdAt: new Date(now.getTime() - ageMinutes * 60000) } });
    return id;
  }
  const old = await fixture(20);
  const fresh = await fixture(1);
  const execute = (id: mongoose.Types.ObjectId) => reconcilePendingOrders({ orderId: String(id), now, minAgeMs: 900000 });
  assert.equal((await execute(fresh)).checked, 0);
  assert.equal(providerCalls, 0);
  assert.equal((await execute(old)).failed, 0);
  assert.equal((await Order.findById(old))?.status, 'paid');
  const event = await PaymentEvent.findOne({ order: old });
  assert.equal(event?.source, 'reconciliation'); assert.equal(event?.signatureVerified, false);
  assert.ok(event?.processedAt); assert.equal(await Entitlement.countDocuments({ order: old }), 1);
  await execute(old);
  assert.equal(providerCalls, 1); assert.equal(await PaymentEvent.countDocuments({ order: old }), 1);
  console.log('PASS: 20-minute-old order resolved without webhook; fresh order skipped; rerun is idempotent.');

  const interrupted = await fixture(20);
  Entitlement.updateOne = (() => { throw new Error('Injected grant failure'); }) as typeof originalGrant;
  assert.equal((await execute(interrupted)).failed, 1);
  assert.equal((await Order.findById(interrupted))?.status, 'paid');
  assert.equal(await Entitlement.countDocuments({ order: interrupted }), 0);
  Entitlement.updateOne = originalGrant;
  const beforeRepair = providerCalls;
  assert.equal((await execute(interrupted)).repaired, 1);
  assert.equal(providerCalls, beforeRepair);
  assert.equal(await Entitlement.countDocuments({ order: interrupted }), 1);
  console.log('PASS: crash after projection repaired from durable event even when order already paid.');

  const concurrent = await fixture(20);
  const results = await Promise.all([execute(concurrent), execute(concurrent)]);
  assert.ok(results.every(result => result.failed === 0));
  assert.equal(await PaymentEvent.countDocuments({ order: concurrent }), 1);
  assert.equal(await Entitlement.countDocuments({ order: concurrent }), 1);
  console.log('PASS: concurrent runs produce one event and one entitlement.');

  const pending = await fixture(20);
  remoteStatus = 'ACTIVE'; await execute(pending); await execute(pending);
  assert.equal((await Order.findById(pending))?.status, 'created');
  assert.equal(await PaymentEvent.countDocuments({ order: pending }), 1);
  remoteStatus = 'EXPIRED'; await execute(pending);
  assert.equal((await Order.findById(pending))?.status, 'failed');
  assert.equal(await Entitlement.countDocuments({ order: pending }), 0);
  console.log('PASS: active order remains pending; expired order fails without granting access.');
}
run().catch(error => {
  console.error('Reconciliation DB test failed:', error instanceof assert.AssertionError ? error.message : (error as Error).name);
  process.exitCode = 1;
}).finally(async () => {
  Cashfree.prototype.PGFetchOrder = originalFetch; Entitlement.updateOne = originalGrant;
  try {
    if (mongoose.connection.readyState === 1) {
      await Entitlement.deleteMany({ order: { $in: ids } });
      await PaymentEvent.deleteMany({ order: { $in: ids } });
      await Order.deleteMany({ _id: { $in: ids } });
      console.log('Temporary reconciliation fixtures removed. No provider calls or existing orders changed.');
    }
  } finally { await mongoose.disconnect(); }
});
