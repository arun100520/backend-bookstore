import { requireDisposableDatabase } from '../config/operationalSafety.js';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import app from '../index.js';
import User from '../models/User.js';
import Book from '../models/Book.js';
import Order from '../models/Order.js';
import PaymentEvent from '../models/PaymentEvent.js';
import Entitlement from '../models/Entitlement.js';

dotenv.config({ path: resolve(__dirname, '../../.env'), quiet: true });

async function run() {
  assert.equal(process.env.CASHFREE_ENV?.trim() || 'sandbox', 'sandbox', 'This test requires sandbox mode');
  assert.ok(process.env.MONGO_URI, 'MONGO_URI is required');
  const retain = process.argv.includes('--keep');
  // This secret exists only inside this test process, never in .env or a live server.
  const originalSecret = process.env.CASHFREE_SECRET_KEY;
  const testSecret = randomUUID();
  process.env.CASHFREE_SECRET_KEY = testSecret;
  const userId = new mongoose.Types.ObjectId();
  const orderId = new mongoose.Types.ObjectId();
  const cashfreeOrderId = `webhook_test_${randomUUID()}`;
  let server: Server | undefined;
  let passed = false;
  try {
    requireDisposableDatabase();
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15_000 });
    await Promise.all([User.init(), Order.init(), PaymentEvent.init(), Entitlement.init()]);
    const books = await Book.find({ isActive: true, priceInPaise: { $gte: 100 } }).limit(2);
    assert.equal(books.length, 2, 'Seed at least two active books before running the test');
    await User.create({ _id: userId, name: 'SIMULATED Webhook Test - no real payment',
      email: `webhook-test-${randomUUID()}@example.com`, passwordHash: await bcrypt.hash(randomUUID(), 12) });
    const amountInPaise = books.reduce((sum, book) => sum + book.priceInPaise, 0);
    await Order.create({ _id: orderId, user: userId, orderNumber: cashfreeOrderId, cashfreeOrderId,
      items: books.map((book) => ({ book: book._id, quantity: 1, priceAtPurchase: book.priceInPaise })),
      amountInPaise, currency: 'INR', status: 'created' });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const rawBody = JSON.stringify({
      type: 'PAYMENT_SUCCESS_WEBHOOK', event_time: new Date().toISOString(),
      test_marker: 'SIMULATED_WEBHOOK_TEST_NO_REAL_PAYMENT',
      data: {
        order: { order_id: cashfreeOrderId, order_amount: amountInPaise / 100, order_currency: 'INR' },
        payment: { cf_payment_id: `simulated_${randomUUID()}`, payment_status: 'SUCCESS',
          payment_amount: amountInPaise / 100, payment_currency: 'INR' },
      },
    }, null, 2);
    async function send(invalid = false) {
      const timestamp = String(Date.now());
      const signature = createHmac('sha256', testSecret).update(timestamp).update(rawBody).digest('base64');
      const response = await fetch(`http://127.0.0.1:${(address as { port: number }).port}/api/webhooks/cashfree`, {
        method: 'POST', body: rawBody, headers: { 'Content-Type': 'application/json',
          'x-webhook-signature': invalid ? 'invalid' : signature, 'x-webhook-timestamp': timestamp },
      });
      await response.text();
      return response.status;
    }

    assert.equal(await send(true), 401);
    assert.equal(await PaymentEvent.countDocuments({ order: orderId }), 0);
    assert.equal(await send(), 200);
    assert.equal(await send(), 200);
    assert.equal(await PaymentEvent.countDocuments({ order: orderId }), 1);
    assert.equal((await Order.findById(orderId))?.status, 'paid');
    assert.equal(await Entitlement.countDocuments({ user: userId }), 2);
    console.log('PASS: two deliveries produced one PaymentEvent, a paid order, and two Entitlements.');

    // Emulate a missing entitlement after partial processing; replay must repair it.
    await Entitlement.deleteOne({ user: userId, book: books[0]._id });
    assert.deepEqual(await Promise.all([send(), send(), send()]), [200, 200, 200]);
    assert.equal(await PaymentEvent.countDocuments({ order: orderId }), 1);
    assert.equal(await Entitlement.countDocuments({ user: userId }), 2);
    console.log('PASS: concurrent redeliveries repaired the missing entitlement without duplicates.');
    console.log(`Database: ${mongoose.connection.name}; simulated order ID: ${orderId}; test user ID: ${userId}`);
    console.log(`Test reference: ${cashfreeOrderId} (not a Cashfree dashboard order).`);
    passed = true;
  } finally {
    try {
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server!.close((err) => err ? reject(err) : resolve()));
      }
      if (mongoose.connection.readyState === 1 && !(passed && retain)) {
        await Entitlement.deleteMany({ user: userId });
        await PaymentEvent.deleteMany({ order: orderId });
        await Order.deleteOne({ _id: orderId });
        await User.deleteOne({ _id: userId });
        console.log('Test fixtures removed.');
      } else if (passed && retain) {
        console.log('Labeled simulated paid order, event, user and entitlements retained for inspection.');
      }
    } finally {
      if (originalSecret === undefined) delete process.env.CASHFREE_SECRET_KEY;
      else process.env.CASHFREE_SECRET_KEY = originalSecret;
      await mongoose.disconnect();
    }
  }
}

run().catch((error: unknown) => {
  const err = error as { name?: string; code?: string };
  if (err.name === 'AssertionError') console.error((error as Error).message);
  else console.error('Webhook DB test failed:', { name: err.name, code: err.code });
  process.exitCode = 1;
});
