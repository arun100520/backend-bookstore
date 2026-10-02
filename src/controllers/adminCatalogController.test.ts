import '../test/httpFixtures.js';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { before, after, test } from 'node:test';
import { Types } from 'mongoose';
import app from '../index.js';
import Book from '../models/Book.js';
import * as uploads from '../services/cloudinaryService.js';
import { generateAccessToken } from '../utils/jwt.js';
const id = String(new Types.ObjectId());
const secret = process.env.JWT_SECRET;
let server: Server, base: string;
before(async () => {
  process.env.JWT_SECRET = 'admin_catalog_test';
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api/admin/books`;
});
after(async () => {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  if (secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secret;
});
async function get(path = '', role: 'admin' | 'user' | null = 'admin') {
  return fetch(base + path, { headers: role ? { Authorization: `Bearer ${generateAccessToken({ userId: id, role })}` } : {} });
}
test('admin catalog reads reject guests and non-admins before accessing books', async t => {
  const list = t.mock.method(Book, 'find', () => { throw new Error('Unexpected read'); });
  const detail = t.mock.method(Book, 'findById', () => { throw new Error('Unexpected read'); });
  for (const path of ['', `/${id}`]) {
    assert.equal((await get(path, null)).status, 401); assert.equal((await get(path, 'user')).status, 403);
  }
  assert.equal(list.mock.callCount() + detail.mock.callCount(), 0);
});
test('admin books validate pagination, status, search and IDs', async t => {
  const list = t.mock.method(Book, 'find', () => { throw new Error('Unexpected read'); });
  for (const path of ['?page=0', '?limit=101', '?page=1.5', '?status=bad', '?q=' + 'x'.repeat(201), '/invalid']) assert.equal((await get(path)).status, 400);
  assert.equal(list.mock.callCount(), 0);
});
test('admin catalog includes drafts, escapes search regex, and uses matching counts and stable pagination', async t => {
  const expected = { isActive: false, $or: [{ title: { $regex: 'A\\.\\*', $options: 'i' } }, { authors: { $regex: 'A\\.\\*', $options: 'i' } }] };
  t.mock.method(Book, 'find', (filter: unknown) => {
    assert.deepEqual(filter, expected);
    return { select: (fields: string) => {
      assert.ok(!fields.includes('pdfUrl'));
      return { sort: (sort: unknown) => { assert.deepEqual(sort, { createdAt: -1, _id: -1 }); return {
        skip: (skip: number) => { assert.equal(skip, 2); return { limit: (limit: number) => {
          assert.equal(limit, 2); return { lean: async () => [{ _id: id, isActive: false }] };
        } }; },
      }; } };
    } };
  });
  t.mock.method(Book, 'countDocuments', async (filter: unknown) => { assert.deepEqual(filter, expected); return 3; });
  const response = await get('?page=2&limit=2&status=draft&q=A.*');
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { data: [{ _id: id, isActive: false }], meta: { total: 3, page: 2, limit: 2, totalPages: 2 } });
});
test('admin details load unpublished metadata and return 404 for missing books', async t => {
  let stored: unknown = { _id: id, isActive: false, categoryIds: ['category'], pdfUrl: 'private-upload' };
  t.mock.method(Book, 'findById', (value: unknown) => { assert.equal(value, id); return { lean: async () => stored }; });
  const response = await get(`/${id}`); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { book: stored });
  stored = null; assert.equal((await get(`/${id}`)).status, 404);
});

test('admin can create a draft, upload multipart assets, publish and read the public book', async t => {
  let stored: any;
  t.mock.method(Book, 'create', async (data: any) => {
    stored = { ...data, _id: id, coverUrl: '', pdfUrl: '', async save() {} };
    return stored;
  });
  t.mock.method(Book, 'findById', async () => stored);
  t.mock.method(Book, 'findByIdAndUpdate', async (_id: unknown, data: any) => {
    Object.assign(stored, data.$set); return stored;
  });
  t.mock.method(uploads, 'uploadCoverImage', async (buffer: Buffer) => {
    assert.equal((await sharp(buffer).metadata()).format, 'webp'); return { url: 'https://example.com/cover.png' };
  });
  t.mock.method(uploads, 'uploadPdf', async (buffer: Buffer) => {
    assert.equal((await PDFDocument.load(buffer)).getPageCount(), 1); return { url: 'private-pdf-reference' };
  });
  t.mock.method(Book, 'findOne', (filter: any) => {
    assert.equal(filter.isActive, true);
    const chain: any = { populate: () => chain, then: (resolve: any) => {
      const { pdfUrl, save, ...publicBook } = stored;
      return Promise.resolve(stored.isActive && filter.slug === stored.slug ? publicBook : null).then(resolve);
    } };
    return { select: (fields: string) => { assert.equal(fields, '-pdfUrl'); return chain; } };
  });
  const headers = { Authorization: `Bearer ${generateAccessToken({ userId: id, role: 'admin' })}` };
  const metadata = { title: 'HTTP published book', slug: 'http-published', authors: ['Author'], description: 'A book', priceInPaise: 12345, language: id, isActive: false };
  let response = await fetch(base, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(metadata) });
  assert.equal(response.status, 201);
  const publicUrl = base.replace('/admin/books', '/books/http-published');
  assert.equal((await fetch(publicUrl)).status, 404);
  const files = new FormData();
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const pdf = await PDFDocument.create(); pdf.addPage();
  files.append('cover', new Blob([new Uint8Array(image)], { type: 'image/png' }), 'cover.png');
  files.append('pdf', new Blob([new Uint8Array(await pdf.save())], { type: 'application/pdf' }), 'book.pdf');
  response = await fetch(`${base}/${id}/upload`, { method: 'POST', headers, body: files });
  assert.equal(response.status, 200);
  assert.equal(stored.pdfUrl, 'private-pdf-reference');
  assert.equal((await fetch(publicUrl)).status, 404);
  response = await fetch(`${base}/${id}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: true }) });
  assert.equal(response.status, 200);
  response = await fetch(publicUrl);
  assert.equal(response.status, 200);
  const { data } = await response.json() as any;
  assert.equal(data.title, metadata.title);
  assert.equal(data.coverUrl, 'https://example.com/cover.png');
  assert.equal(data.priceInPaise, 12345);
  assert.equal(data.pdfUrl, undefined);
});
