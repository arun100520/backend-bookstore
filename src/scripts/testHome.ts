import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import app from '../index.js';
import Book from '../models/Book.js';
import Order from '../models/Order.js';

let server: Server | undefined;
async function run() {
  assert.ok(process.env.MONGO_URI);
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000, autoIndex: false });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/home`);
  assert.equal(response.status, 200);
  const { data } = await response.json() as any;
  const books = await Book.find({ isActive: true }).lean();
  assert.ok(books.length > 0, 'Seeded catalog must contain books');
  assert.equal(data.totalBooks, books.length);
  const byId = new Map(books.map(book => [String(book._id), book]));
  const featured = [...books].sort((a, b) => b.ratingAvg - a.ratingAvg || +b.createdAt - +a.createdAt || String(a._id).localeCompare(String(b._id))).slice(0, 4);
  const releases = [...books].sort((a, b) => +(b.publishedAt ?? b.createdAt) - +(a.publishedAt ?? a.createdAt) || String(a._id).localeCompare(String(b._id))).slice(0, 4);
  assert.deepEqual(data.featured.map((book: any) => book._id), featured.map(book => String(book._id)));
  assert.deepEqual(data.newReleases.map((book: any) => book._id), releases.map(book => String(book._id)));
  assert.deepEqual(data.hero, data.featured[0]);
  const sales = new Map<string, number>();
  for (const order of await Order.find({ status: 'paid' }).select('items').lean()) {
    for (const item of order.items) {
      const id = String(item.book);
      if (byId.has(id)) sales.set(id, (sales.get(id) ?? 0) + item.quantity);
    }
  }
  const bestselling = [...sales].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4).map(([id]) => id);
  assert.deepEqual(data.bestsellers.map((book: any) => book._id), bestselling);
  for (const book of [...data.featured, ...data.newReleases, ...data.bestsellers]) {
    assert.ok(byId.has(book._id));
    assert.equal(book.title, byId.get(book._id)!.title);
    assert.deepEqual(Object.keys(book).sort(), ['_id', 'title', 'slug', 'authors', 'description', 'priceInPaise', 'coverUrl', 'ratingAvg'].sort());
  }
  for (const genre of data.topGenres) {
    assert.ok(genre.bookCount > 0);
    assert.equal(genre.bookCount, books.filter(book => book.genreIds.some(id => String(id) === genre._id)).length);
  }
  for (const category of data.categories) assert.equal(category.bookCount, books.filter(book => book.categoryIds.some(id => String(id) === category._id)).length);
  console.log(`PASS: public home endpoint; ${books.length} live books; featured/release/sales rankings; genre/category counts; public fields only. No database writes.`);
}
run().catch(error => {
  console.error('Home verification failed:', error instanceof assert.AssertionError ? error.message : (error as Error).name);
  process.exitCode = 1;
}).finally(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
  await mongoose.disconnect();
});
