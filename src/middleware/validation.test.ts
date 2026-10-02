import '../test/httpFixtures.js';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { before, after, test } from 'node:test';
import app from '../index.js';
import User from '../models/User.js';
import { registration } from '../services/registration.js';
import Book from '../models/Book.js';
import { generateAccessToken } from '../utils/jwt.js';

const id = 'abcdefabcdefabcdefabcdef';
let server: Server, base: string;
const original = [process.env.JWT_SECRET, process.env.CASHFREE_SECRET_KEY];
before(async () => {
  process.env.JWT_SECRET = 'validation-test'; process.env.CASHFREE_SECRET_KEY = 'validation-webhook';
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api`;
});
after(async () => {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  ['JWT_SECRET', 'CASHFREE_SECRET_KEY'].forEach((key, index) => {
    if (original[index] === undefined) delete process.env[key]; else process.env[key] = original[index];
  });
});
async function send(method: string, path: string, raw?: string | FormData, contentType = 'application/json') {
  const headers: Record<string, string> = { Authorization: `Bearer ${generateAccessToken({ userId: id, role: 'admin' })}` };
  if (!(raw instanceof FormData)) headers['Content-Type'] = contentType;
  if (path === '/webhooks/cashfree') {
    headers['x-webhook-timestamp'] = String(Date.now());
    headers['x-webhook-signature'] = createHmac('sha256', 'validation-webhook').update(headers['x-webhook-timestamp']).update(String(raw || '')).digest('base64');
  }
  const response = await fetch(base + path, { method, headers, body: raw });
  return { response, body: await response.json() as any };
}
const writes: [string, string][] = [
  ['POST', '/auth/signup'], ['POST', '/auth/login'], ['POST', '/auth/logout'],
  ['POST', '/cart/items'], ['PATCH', `/cart/items/${id}`],
  ['POST', '/checkout/create-order'], ['PATCH', '/users/me'],
  ['POST', '/admin/books'], ['PATCH', `/admin/books/${id}`], ['POST', `/admin/books/${id}/upload`],
  ['POST', `/admin/orders/${id}/resync`], ['POST', '/webhooks/cashfree'],
  ...['categories', 'genres', 'languages'].flatMap(kind => [
    ['POST', `/admin/taxonomy/${kind}`], ['PATCH', `/admin/taxonomy/${kind}/${id}`],
  ] as [string, string][]),
];
for (const [method, path] of writes) test(`${method} ${path}: malformed JSON returns 400 and body error`, async () => {
  const { response, body } = await send(method, path, '{"invalid":');
  assert.equal(response.status, 400); assert.equal(body.status, 400);
  assert.ok(body.message); assert.ok(body.errors.body);
  assert.equal(body.stack, undefined);
});

test('wrong types, missing fields, unknown fields and protected metadata fail before writes', async () => {
  const cases: [string, string, unknown, string][] = [
    ['POST', '/auth/signup', { name: 123, email: 'bad', password: [] }, 'name'],
    ['POST', '/auth/signup', { name: 'Name', email: 'a@b.com', password: 'abcdefgh', role: 'admin' }, 'role'],
    ['POST', '/auth/signup', { name: 'Name', email: 'a@b.com', password: '😀'.repeat(19) }, 'password'],
    ['POST', '/auth/login', { email: { $ne: '' }, password: true }, 'email'],
    ['POST', '/auth/logout', { userId: id }, 'userId'],
    ['POST', '/cart/items', { bookId: 'bad', quantity: 1 }, 'bookId'],
    ...[0, -1, 1.5, '2', true, 1001, null].map(quantity => ['PATCH', `/cart/items/${id}`, { quantity }, 'quantity'] as [string, string, unknown, string]),
    ['POST', '/admin/books', {}, 'title'],
    ['PATCH', `/admin/books/${id}`, { $set: { isActive: true } }, '$set'],
    ['PATCH', `/admin/books/${id}`, { pdfUrl: 'public.pdf' }, 'pdfUrl'],
    ['PATCH', `/admin/books/${id}`, { priceInPaise: 1.25 }, 'priceInPaise'],
    ['PATCH', `/admin/books/${id}`, { authors: [] }, 'authors'],
    ['PATCH', `/admin/books/${id}`, { categoryIds: ['bad'] }, 'categoryIds.0'],
    ['PATCH', `/admin/books/${id}`, { isActive: 'false' }, 'isActive'],
    ['PATCH', `/admin/books/${id}`, { publishedAt: '2026-02-30' }, 'publishedAt'],
    ['PATCH', `/admin/books/${id}`, {}, 'body'],
    ['POST', `/admin/orders/${id}/resync`, { status: 'paid' }, 'status'],
    ['PATCH', '/users/me', { role: 'admin' }, 'role'],
    ['POST', '/checkout/create-order', { customerPhone: {} }, 'customerPhone'],
    ['POST', '/webhooks/cashfree', { type: 'PAYMENT_SUCCESS_WEBHOOK', data: {} }, 'data.order'],
    ...['categories', 'genres', 'languages'].flatMap(kind => [
      ['POST', `/admin/taxonomy/${kind}`, { name: ' ', slug: 'bad slug' }, 'name'],
      ['PATCH', `/admin/taxonomy/${kind}/${id}`, {}, 'body'],
    ] as [string, string, unknown, string][]),
  ];
  for (const [method, path, input, field] of cases) {
    const { response, body } = await send(method, path, JSON.stringify(input));
    assert.equal(response.status, 400, `${method} ${path}: ${JSON.stringify(body)}`);
    assert.ok(body.errors[field], `${path}: missing error for ${field}`);
  }
});

test('missing bodies and non-object JSON return validation errors', async () => {
  for (const path of ['/auth/signup', '/auth/login', '/cart/items', '/admin/books', '/checkout/create-order']) {
    for (const raw of [undefined, 'null', '[]', '123']) {
      const { response, body } = await send('POST', path, raw);
      assert.equal(response.status, 400, path); assert.ok(body.errors);
    }
  }
});

test('write and delete IDs are validated before database access', async () => {
  for (const path of ['/cart/items/bad', '/admin/books/bad', '/admin/taxonomy/categories/bad', '/admin/taxonomy/genres/bad', '/admin/taxonomy/languages/bad']) {
    for (const method of ['PATCH', 'DELETE']) {
      const { response, body } = await send(method, path, '{}');
      assert.equal(response.status, 400); assert.ok(body.errors[path.startsWith('/cart') ? 'bookId' : 'id']);
    }
  }
  assert.equal((await send('POST', '/admin/orders/bad/resync', '{}')).response.status, 400);
  assert.equal((await send('POST', '/admin/books/bad/upload', '{}')).response.status, 400);
});

test('upload validation rejects wrong types, oversized covers, empty files and broken multipart bodies', async t => {
  const read = t.mock.method(Book, 'findById', () => { throw new Error('Must validate before database access'); });
  const path = `/admin/books/${id}/upload`;
  for (const [name, mime, size] of [['cover', 'text/plain', 4], ['cover', 'image/png', 5 * 1024 * 1024 + 1], ['pdf', 'application/pdf', 0], ['unexpected', 'image/png', 4]] as const) {
    const files = new FormData(); files.append(name, new Blob([new Uint8Array(size)], { type: mime }), 'file');
    const { response, body } = await send('POST', path, files);
    assert.equal(response.status, 400); assert.ok(body.errors);
  }
  const fields = new FormData(); fields.append('title', 'not an upload');
  assert.equal((await send('POST', path, fields)).response.status, 400);
  for (const [raw, type] of [['broken', 'multipart/form-data'], ['--test\r\n', 'multipart/form-data; boundary=test']]) {
    const { response, body } = await send('POST', path, raw, type);
    assert.equal(response.status, 400); assert.ok(body.errors.files);
  }
  assert.equal(read.mock.callCount(), 0);
});

test('normalizes valid signup input and keeps passwords unchanged', async t => {
  let saved: any;
  t.mock.method(registration, 'start', async (data: any) => {
    saved = data;
  });
  const { response, body } = await send('POST', '/auth/signup', JSON.stringify({ name: ' Reader ', email: ' READER@EXAMPLE.COM ', password: 'good password' }));
  assert.equal(response.status, 202); assert.equal(body.accessToken, undefined);
  assert.equal(saved.name, 'Reader'); assert.equal(saved.email, 'reader@example.com');
  assert.ok(saved.passwordHash); assert.equal(body.passwordHash, undefined);
});

test('oversized JSON keeps a safe structured 413 response', async () => {
  const { response, body } = await send('POST', '/auth/login', JSON.stringify({ password: 'x'.repeat(110000) }));
  assert.equal(response.status, 413); assert.equal(body.status, 413); assert.ok(body.errors.body);
});
