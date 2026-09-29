import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { before, after, test } from 'node:test';
import { Types } from 'mongoose';
import app from '../index.js';
import Entitlement from '../models/Entitlement.js';
import Book from '../models/Book.js';
import { cloudinary } from '../config/cloudinary.js';
import { generateAccessToken } from '../utils/jwt.js';
import { generateSignedPdfUrl, pdfPublicIdFromUrl } from '../services/cloudinaryService.js';

const userId = String(new Types.ObjectId());
const bookId = String(new Types.ObjectId());
const secret = process.env.JWT_SECRET;
const previousConfig = { ...cloudinary.config() };
let server: Server;
let base: string;
before(async () => {
  process.env.JWT_SECRET = 'library_test_secret';
  cloudinary.config({ cloud_name: 'library-test', api_key: 'test-key', api_secret: 'test-secret', secure: true });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api/library`;
});
after(async () => {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  if (secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secret;
  cloudinary.config(true); cloudinary.config(previousConfig);
});
async function get(path = '', authenticated = true) {
  const response = await fetch(base + path, { headers: authenticated
    ? { Authorization: `Bearer ${generateAccessToken({ userId, role: 'user' })}` } : {} });
  return { response, body: await response.json() as any };
}
test('both routes require authentication; invalid book ID is rejected', async t => {
  const query = t.mock.method(Entitlement, 'exists', () => { throw new Error('Unexpected query'); });
  assert.equal((await get('', false)).response.status, 401);
  assert.equal((await get(`/${bookId}/download-url`, false)).response.status, 401);
  assert.equal((await get('/bad-id/download-url')).response.status, 400);
  assert.equal(query.mock.callCount(), 0);
});
test('no entitlement returns 403 before reading or signing the PDF', async t => {
  t.mock.method(Entitlement, 'exists', async (filter: unknown) => {
    assert.deepEqual(filter, { user: userId, book: bookId }); return null;
  });
  const book = t.mock.method(Book, 'findById', () => { throw new Error('Unexpected book query'); });
  const signer = t.mock.method(cloudinary.utils, 'private_download_url', () => { throw new Error('Unexpected signing'); });
  assert.equal((await get(`/${bookId}/download-url?userId=other`)).response.status, 403);
  assert.equal(book.mock.callCount() + signer.mock.callCount(), 0);
});
test('entitled reader receives a signed five-minute download URL with no caching', async t => {
  t.mock.method(Entitlement, 'exists', async () => ({ _id: 'entitlement' }));
  t.mock.method(Book, 'findById', () => ({ select: () => ({ lean: async () => ({
    pdfUrl: 'https://res.cloudinary.com/library-test/raw/private/v123/ebook-store/pdfs/book.pdf',
  }) }) }));
  const before = Math.floor(Date.now() / 1000);
  const { response, body } = await get(`/${bookId}/download-url`);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const url = new URL(body.data.url);
  assert.equal(url.protocol, 'https:'); assert.match(url.pathname, /\/raw\/download$/);
  assert.equal(url.searchParams.get('public_id'), 'ebook-store/pdfs/book.pdf');
  assert.equal(url.searchParams.get('type'), 'private');
  const expires = Number(url.searchParams.get('expires_at'));
  assert.ok(expires >= before + 300 && expires <= Math.floor(Date.now() / 1000) + 300);
  assert.equal(body.data.expiresAt, new Date(expires * 1000).toISOString());
  const params = Object.fromEntries(url.searchParams);
  delete params.signature; delete params.api_key;
  assert.equal(url.searchParams.get('signature'), cloudinary.utils.api_sign_request(params, 'test-secret'));
});
test('missing PDF returns 404; untrusted PDF storage URL returns safe 503', async t => {
  t.mock.method(Entitlement, 'exists', async () => ({ _id: 'entitlement' }));
  let stored: { pdfUrl: string } | null = null;
  t.mock.method(Book, 'findById', () => ({ select: () => ({ lean: async () => stored }) }));
  for (stored of [null, { pdfUrl: '' }]) assert.equal((await get(`/${bookId}/download-url`)).response.status, 404);
  stored = { pdfUrl: 'https://example.com/book.pdf' };
  assert.equal((await get(`/${bookId}/download-url`)).response.status, 503);
});
test('library scopes entitlements, uses safe book fields, and omits deleted books', async t => {
  t.mock.method(Entitlement, 'find', (filter: unknown) => {
    assert.deepEqual(filter, { user: userId });
    return { select: () => ({ sort: () => ({ populate: (path: string, fields: string) => {
      assert.equal(path, 'book'); assert.equal(fields, '_id title slug authors coverUrl description');
      return { lean: async () => [{ _id: 'kept', book: { _id: bookId, title: 'Book' } }, { _id: 'deleted', book: null }] };
    } }) }) };
  });
  const { response, body } = await get('?user=someone-else');
  assert.equal(response.status, 200);
  assert.deepEqual(body.data, [{ _id: 'kept', book: { _id: bookId, title: 'Book' } }]);
});
test('storage URL parsing preserves raw IDs and rejects other accounts or public assets', () => {
  assert.equal(pdfPublicIdFromUrl('https://res.cloudinary.com/library-test/raw/private/s--abc_DEF--/v1/ebook-store/pdfs/book'), 'ebook-store/pdfs/book');
  assert.equal(pdfPublicIdFromUrl('https://res.cloudinary.com/library-test/raw/private/v1/ebook-store/pdfs/a%20b.pdf'), 'ebook-store/pdfs/a b.pdf');
  for (const url of ['https://res.cloudinary.com/other/raw/private/v1/ebook-store/pdfs/a.pdf',
    'https://res.cloudinary.com/library-test/raw/upload/v1/ebook-store/pdfs/a.pdf',
    'https://res.cloudinary.com/library-test/raw/private/v1/other/a.pdf']) assert.throws(() => pdfPublicIdFromUrl(url));
  assert.throws(() => generateSignedPdfUrl('book', 0));
});
