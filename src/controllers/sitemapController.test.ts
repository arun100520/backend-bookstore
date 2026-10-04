import '../test/httpFixtures.js';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { before, after, test } from 'node:test';
import app from '../index.js';
import Book from '../models/Book.js';

let server: Server, base: string;
before(async () => {
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api/sitemap/books`;
});
after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

test('sitemap validates cursor and rejects unknown query parameters before reading DB', async t => {
  const find = t.mock.method(Book, 'find', () => { throw new Error('Unexpected DB read'); });
  for (const query of ['?after=invalid', '?limit=0', '?after=aaaaaaaaaaaaaaaaaaaaaaaa&after=bbbbbbbbbbbbbbbbbbbbbbbb']) assert.equal((await fetch(base + query)).status, 400);
  assert.equal(find.mock.callCount(), 0);
});

test('sitemap uses bounded active-book cursor queries and exposes only slugs and dates', async t => {
  const cursor = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const updatedAt = new Date('2026-10-01T00:00:00Z');
  const rows = Array.from({ length: 1001 }, (_, index) => ({ _id: String(index + 1).padStart(24, '0'), slug: `book-${index}`, updatedAt, pdfUrl: 'private' }));
  t.mock.method(Book, 'find', (filter: unknown) => {
    assert.deepEqual(filter, { isActive: true, _id: { $gt: cursor } });
    return { select: (fields: string) => {
      assert.equal(fields, '_id slug updatedAt');
      return { sort: (value: unknown) => {
        assert.deepEqual(value, { _id: 1 });
        return { limit: (value: number) => {
          assert.equal(value, 1001);
          return { maxTimeMS: () => ({ lean: async () => rows }) };
        } };
      } };
    } };
  });
  const response = await fetch(`${base}?after=${cursor}`);
  assert.equal(response.status, 200);
  const body = await response.json() as { data: unknown[]; meta: { nextCursor: string } };
  assert.equal(body.data.length, 1000);
  assert.deepEqual(body.data[0], { slug: 'book-0', updatedAt: updatedAt.toISOString() });
  assert.equal(body.meta.nextCursor, rows[999]._id);
  assert(!JSON.stringify(body).includes('private'));
});
