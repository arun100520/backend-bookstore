import { requireDisposableDatabase } from '../config/operationalSafety.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import app from '../index.js';
import User from '../models/User.js';
import Book from '../models/Book.js';
import Cart from '../models/Cart.js';
import Order from '../models/Order.js';
import { generateAccessToken } from '../utils/jwt.js';
import { getOrderStatus } from '../services/cashfreeService.js';

dotenv.config({ path: resolve(__dirname, '../../.env'), quiet: true });

async function run() {
  assert.equal(process.env.CASHFREE_ENV?.trim() || 'sandbox', 'sandbox', 'This test requires sandbox mode');
  assert.ok(process.env.MONGO_URI, 'MONGO_URI is required');
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET is required');
  let server: Server | undefined;
  // A dedicated user keeps this test away from real users' carts and orders.
  const userId = new mongoose.Types.ObjectId();
  let attemptedCheckout = false;
  try {
    requireDisposableDatabase();
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15_000 });
    const book = await Book.findOne({ isActive: true, priceInPaise: { $gte: 100 } });
    assert.ok(book, 'Seed at least one active book priced at INR 1 or more before running this test');
    await Promise.all([User.init(), Cart.init(), Order.init()]);
    const user = await User.create({
      _id: userId, name: 'Checkout Sandbox Test',
      email: `checkout-test-${randomUUID()}@example.com`,
      passwordHash: await bcrypt.hash(randomUUID(), 12),
    });
    await Cart.create({ user: userId, items: [{ book: book._id, quantity: 1 }] });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const token = generateAccessToken({ userId: String(user._id), role: 'user' });
    attemptedCheckout = true;
    console.log(`Sandbox test user ID: ${userId}`);
    const response = await fetch(`http://127.0.0.1:${address.port}/api/checkout/create-order`, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomUUID(), 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ customerPhone: '9999999999' }),
    });
    const body = await response.json() as { message?: string; data?: {
      orderId: string; cashfreeOrderId: string; payment_session_id: string;
    } };
    assert.equal(response.status, 201, body.message || 'Checkout request failed');
    assert.ok(body.data?.payment_session_id, 'Missing payment_session_id');
    const local = await Order.findById(body.data.orderId);
    assert.ok(local, 'Order was not saved in MongoDB');
    assert.equal(local.status, 'created');
    assert.equal(String(local.user), String(userId));
    assert.equal(local.amountInPaise, book.priceInPaise);
    assert.equal(local.cashfreeOrderId, body.data.cashfreeOrderId);
    console.log(`MongoDB database: ${mongoose.connection.name}; collection: ${Order.collection.name}`);
    console.log(`Local order ID: ${local._id}`);
    console.log(`Cashfree sandbox order ID: ${local.cashfreeOrderId}`);
    const remote = await getOrderStatus(local.cashfreeOrderId!);
    assert.equal(remote.order_id, local.cashfreeOrderId);
    assert.equal(remote.order_amount, local.amountInPaise / 100);
    assert.equal(remote.order_status, 'ACTIVE');
    console.log('PASS: HTTP 201, payment session returned, MongoDB status=created, Cashfree status=ACTIVE.');
    console.log('Test user, cart and order retained for inspection. No payment was attempted.');
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server!.close((err) => err ? reject(err) : resolve()));
    }
    // Once a remote order may exist, retain its local records even if verification fails.
    if (!attemptedCheckout && mongoose.connection.readyState === 1) {
      await Cart.deleteOne({ user: userId });
      await User.deleteOne({ _id: userId });
    }
    await mongoose.disconnect();
  }
}

run().catch((error: unknown) => {
  // Never log an entire SDK/Axios error with credential-bearing headers.
  const err = error as { name?: string; code?: string; response?: { status?: number } };
  if (err.name === 'AssertionError') console.error((error as Error).message);
  else console.error('Sandbox checkout test failed:', { name: err.name, code: err.code, status: err.response?.status });
  process.exitCode = 1;
});
