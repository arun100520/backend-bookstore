import { requireDisposableDatabase } from '../config/operationalSafety.js';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import app from '../index.js';
import Book from '../models/Book.js';
import Cart from '../models/Cart.js';
import User from '../models/User.js';
import { generateAccessToken } from '../utils/jwt.js';

const userId = new mongoose.Types.ObjectId();
const missingBook = new mongoose.Types.ObjectId();
let server: Server | undefined;
async function run() {
  assert.ok(process.env.MONGO_URI); assert.ok(process.env.JWT_SECRET);
  requireDisposableDatabase();
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000, autoIndex: false });
  await User.create({ _id: userId, name: 'Cart test', email: `cart-${userId}@example.invalid`, passwordHash: 'disabled-test-login' });
  const book = await Book.findOne({ isActive: true }).lean();
  assert.ok(book, 'Seeded book required');
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/cart`;
  const token = generateAccessToken({ userId: String(userId), role: 'user' });
  async function request(method: string, path = '', body?: object) {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    assert.equal(response.status, 200);
    return await response.json() as any;
  }
  assert.equal((await fetch(base)).status, 401);
  assert.equal((await request('GET')).data.items.length, 0);
  const added = await request('POST', '/items', { bookId: String(book._id), quantity: 1 });
  assert.equal(added.data.items[0].book.isActive, true);
  assert.ok(!('pdfUrl' in added.data.items[0].book));
  assert.equal(added.meta.totalPriceInPaise, book.priceInPaise);
  const again = await request('POST', '/items', { bookId: String(book._id), quantity: 1 });
  assert.equal(again.data.items.length, 1); assert.equal(again.data.items[0].quantity, 2);
  const updated = await request('PATCH', `/items/${book._id}`, { quantity: 3 });
  assert.equal(updated.meta.totalPriceInPaise, book.priceInPaise * 3);
  assert.equal((await request('GET')).data.items[0].quantity, 3);
  // A dangling reference only in this temporary cart exercises deleted-book removal.
  await Cart.updateOne({ user: userId }, { $push: { items: { book: missingBook, quantity: 1 } } });
  const missing = (await request('GET')).data.items.find((item: any) => item.book._id === String(missingBook));
  assert.ok(missing); assert.equal(missing.book.isActive, false);
  await request('DELETE', `/items/${missingBook}`);
  const empty = await request('DELETE', `/items/${book._id}`);
  assert.equal(empty.data.items.length, 0); assert.equal(empty.meta.totalPriceInPaise, 0);
  console.log('PASS: authenticated live cart add/repeated add/update/remove, persistence, totals, safe fields and deleted-book removal.');
}
run().catch(error => {
  console.error('Cart verification failed:', error instanceof assert.AssertionError ? error.message : (error as Error).name);
  process.exitCode = 1;
}).finally(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
  try { if (mongoose.connection.readyState === 1) { await Cart.deleteOne({ user: userId }); await User.deleteOne({ _id: userId }); } }
  finally { await mongoose.disconnect(); }
  console.log('Temporary cart removed; existing user carts and catalog unchanged.');
});
