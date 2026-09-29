import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import { Cashfree } from 'cashfree-pg';
import app from '../index.js';
import Order from '../models/Order.js';
import PaymentEvent from '../models/PaymentEvent.js';
import Entitlement from '../models/Entitlement.js';
import { generateAccessToken } from '../utils/jwt.js';

const id = new mongoose.Types.ObjectId();
const owner = new mongoose.Types.ObjectId();
const admin = new mongoose.Types.ObjectId();
const ref = `admin_resync_test_${id}`;
const originalFetch = Cashfree.prototype.PGFetchOrder;
let server: Server | undefined;
async function run() {
  assert.ok(process.env.MONGO_URI); assert.equal(process.env.CASHFREE_ENV, 'sandbox');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  await Promise.all([PaymentEvent.init(), Entitlement.init()]);
  await Order.create({ _id: id, user: owner, orderNumber: ref, cashfreeOrderId: ref, status: 'failed',
    amountInPaise: 100, currency: 'INR', items: [{ book: new mongoose.Types.ObjectId(), quantity: 1, priceAtPurchase: 100 }] });
  await PaymentEvent.create({ order: id, cashfreeOrderId: ref, cashfreeEventId: `failed_${id}`, eventType: 'PAYMENT_FAILED',
    signatureVerified: true, rawPayload: { marker: 'temporary_admin_test' } });
  let calls = 0;
  Cashfree.prototype.PGFetchOrder = (async (orderId: string) => {
    assert.equal(orderId, ref); calls++;
    return { data: { order_id: ref, order_amount: 1, order_currency: 'INR', order_status: 'PAID' } };
  }) as typeof originalFetch;
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/admin/orders`;
  async function request(path: string, role: 'admin' | 'user' = 'admin') {
    const r = await fetch(base + path, { method: path.endsWith('/resync') ? 'POST' : 'GET', headers: {
      Authorization: `Bearer ${generateAccessToken({ userId: String(admin), role })}`,
    } });
    return { status: r.status, body: await r.json() as any };
  }
  assert.equal((await request(`/${id}/resync`, 'user')).status, 403); assert.equal(calls, 0);
  const result = await request(`/${id}/resync`);
  assert.equal(result.status, 200); assert.equal(result.body.data.status, 'paid');
  assert.equal((await Order.findById(id))?.status, 'paid');
  assert.equal(await Entitlement.countDocuments({ order: id }), 1);
  assert.equal((await request(`/${id}/resync`)).status, 200); assert.equal(calls, 2);
  assert.equal(await PaymentEvent.countDocuments({ order: id }), 2);
  assert.equal(await Entitlement.countDocuments({ order: id }), 1);
  const first = await request(`/${id}/events?limit=1`);
  const second = await request(`/${id}/events?limit=1&page=2`);
  assert.equal(first.body.meta.total, 2); assert.equal(first.body.meta.totalPages, 2);
  assert.equal(first.body.data[0].rawPayload.marker, 'temporary_admin_test');
  assert.equal(second.body.data[0].source, 'reconciliation');
  assert.equal(second.body.data[0].rawPayload.order_status, 'PAID');
  assert.deepEqual((await request(`/${id}/events?limit=1&page=3`)).body.data, []);
  await PaymentEvent.create({ order: id, cashfreeOrderId: ref, cashfreeEventId: `refund_${id}`, eventType: 'REFUND_SUCCESS',
    signatureVerified: true, rawPayload: { marker: 'temporary_full_refund' } });
  assert.equal((await request(`/${id}/resync`)).body.data.status, 'refunded');
  console.log('PASS: admin-only resync corrects a fresh failed order, fetches every time, deduplicates, grants once, exposes full paginated raw history and preserves refunds.');
}
run().catch(error => {
  console.error('Admin order DB test failed:', error instanceof assert.AssertionError ? error.message : (error as Error).name);
  process.exitCode = 1;
}).finally(async () => {
  Cashfree.prototype.PGFetchOrder = originalFetch;
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
  try {
    if (mongoose.connection.readyState === 1) {
      await Entitlement.deleteMany({ order: id }); await PaymentEvent.deleteMany({ order: id }); await Order.deleteOne({ _id: id });
    }
    console.log('Temporary admin test records removed; no provider calls or existing orders changed.');
  } finally { await mongoose.disconnect(); }
});
