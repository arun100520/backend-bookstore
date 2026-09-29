import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import app from '../index.js';
import Book from '../models/Book.js';

let server: Server | undefined;
async function run() {
  assert.ok(process.env.MONGO_URI);
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000, autoIndex: false });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;
  async function get(path: string) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    return await response.json() as any;
  }
  const sample = await Book.findOne({ isActive: true, 'categoryIds.0': { $exists: true }, 'genreIds.0': { $exists: true } }).lean();
  assert.ok(sample, 'Seeded books required');
  const query = new URLSearchParams({ category: String(sample.categoryIds[0]), genre: String(sample.genreIds[0]), language: String(sample.language), minPrice: String(sample.priceInPaise), maxPrice: String(sample.priceInPaise) });
  const filtered = await get(`/books?${query}`);
  assert.ok(filtered.data.some((book: any) => book._id === String(sample._id)));
  for (const book of filtered.data) {
    assert.equal(book.priceInPaise, sample.priceInPaise);
    assert.ok(book.categoryIds.some((item: any) => item._id === String(sample.categoryIds[0])));
    assert.ok(book.genreIds.some((item: any) => item._id === String(sample.genreIds[0])));
    assert.equal(book.language._id, String(sample.language));
    assert.ok(!('pdfUrl' in book));
  }
  const first = await get('/books?limit=1&page=1');
  const second = await get('/books?limit=1&page=2');
  assert.ok(first.meta.total > 1);
  assert.notEqual(first.data[0]._id, second.data[0]._id);
  assert.equal((await get('/books?limit=1&page=1')).data[0]._id, first.data[0]._id);
  const detail = await get(`/books/${encodeURIComponent(sample.slug)}`);
  assert.equal(detail.data.title, sample.title);
  assert.ok(!('pdfUrl' in detail.data));
  const search = await get(`/books?q=${encodeURIComponent(sample.title)}`);
  assert.ok(search.data.some((book: any) => book._id === String(sample._id)));
  for (const endpoint of ['/categories', '/genres', '/languages']) assert.ok((await get(endpoint)).data.length > 0);
  assert.equal((await fetch(base + '/books/nonexistent-catalog-check-5-3')).status, 404);
  console.log('PASS: live catalog combined facets, price range, search, stable pagination, populated detail/taxonomies and missing-book 404. No database writes.');
}
run().catch(error => {
  console.error('Catalog verification failed:', error instanceof assert.AssertionError ? error.message : (error as Error).name);
  process.exitCode = 1;
}).finally(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
  await mongoose.disconnect();
});
