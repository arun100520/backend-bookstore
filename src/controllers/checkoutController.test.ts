import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, afterEach, before, beforeEach, test, type TestContext } from 'node:test';
import { Types } from 'mongoose';
import { Cashfree, type CreateOrderRequest } from 'cashfree-pg';
import app from '../index.js';
import User from '../models/User.js';
import Book from '../models/Book.js';
import Cart from '../models/Cart.js';
import Order from '../models/Order.js';
import { generateAccessToken } from '../utils/jwt.js';

const userId = new Types.ObjectId().toString();
const bookId = new Types.ObjectId();
const otherBookId = new Types.ObjectId();
const envKeys = ['JWT_SECRET', 'CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY', 'CASHFREE_ENV'] as const;
const originalEnv = envKeys.map((key) => process.env[key]);
let server: Server;
let baseUrl: string;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
});
beforeEach(() => {
  process.env.JWT_SECRET = 'checkout_test_secret';
  process.env.CASHFREE_APP_ID = 'test_app';
  process.env.CASHFREE_SECRET_KEY = 'test_secret';
  process.env.CASHFREE_ENV = 'sandbox';
});
afterEach(() => envKeys.forEach((key, i) => {
  if (originalEnv[i] === undefined) delete process.env[key];
  else process.env[key] = originalEnv[i];
}));

function fixtures(t: TestContext) {
  const state = {
    user: { name: 'Test Reader', email: 'reader@example.com' } as { name: string; email: string } | null,
    cart: { items: [{ _id: new Types.ObjectId(), book: bookId, quantity: 2 }, { _id: new Types.ObjectId(), book: otherBookId, quantity: 1 }] } as
      { items: { _id: Types.ObjectId; book: Types.ObjectId; quantity: number }[] } | null,
    books: [
      { _id: bookId, priceInPaise: 1051, isActive: true },
      { _id: otherBookId, priceInPaise: 1999, isActive: true },
    ],
    order: undefined as InstanceType<typeof Order> | undefined,
    request: undefined as CreateOrderRequest | undefined,
  };
  t.mock.method(User, 'findById', (id: string) => {
    assert.equal(id, userId);
    return { select: async () => state.user };
  });
  t.mock.method(Cart, 'findOne', async (filter: unknown) => {
    assert.deepEqual(filter, { user: userId });
    return state.cart;
  });
  t.mock.method(Book, 'find', () => ({ select: async () => state.books }));
  const orderCreate = t.mock.method(Order, 'create', async (data: Record<string, unknown>) => {
    state.order = new Order(data);
    await state.order.validate();
    return state.order;
  });
  const apiCreate = t.mock.method(Cashfree.prototype, 'PGCreateOrder', async (request: CreateOrderRequest) => {
    assert.ok(state.order, 'The local order must exist before the remote API call');
    state.request = request;
    return { data: { order_id: request.order_id, payment_session_id: 'session_test' } };
  });
  return { state, orderCreate, apiCreate };
}

async function post(body: unknown = { customerPhone: '9999999999' }, authorized = true) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authorized) headers.Authorization = `Bearer ${generateAccessToken({ userId, role: 'user' })}`;
  const response = await fetch(`${baseUrl}/api/checkout/create-order`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

test('checkout requires authentication before accessing any data', async (t) => {
  const { orderCreate, apiCreate } = fixtures(t);
  assert.equal((await post({}, false)).status, 401);
  assert.equal(orderCreate.mock.callCount(), 0);
  assert.equal(apiCreate.mock.callCount(), 0);
});

test('creates a price snapshot for the authenticated cart and ignores client-supplied totals and ownership', async (t) => {
  const { state } = fixtures(t);
  const result = await post({ customerPhone: '9999999999', amountInPaise: 1, userId: 'attacker', items: [] });
  assert.equal(result.status, 201);
  assert.equal(result.body.data.payment_session_id, 'session_test');
  assert.equal(result.body.data.status, 'created');
  assert.equal(result.body.data.amountInPaise, 4101);
  assert.equal(result.body.data.orderId, String(state.order!._id));
  assert.equal(String(state.order!.user), userId);
  assert.equal(state.order!.items[0].priceAtPurchase, 1051);
  assert.equal(state.order!.items[0].quantity, 2);
  assert.equal(String(state.order!.items[0].cartItemId), String(state.cart!.items[0]._id));
  assert.equal(String(state.order!.items[1].cartItemId), String(state.cart!.items[1]._id));
  assert.equal(state.order!.items[1].priceAtPurchase, 1999);
  assert.equal(state.order!.cashfreeOrderId, state.request!.order_id);
  assert.equal(state.request!.order_amount, 41.01);
  assert.equal(state.request!.order_currency, 'INR');
  assert.equal(state.request!.order_meta!.return_url, new URL(`/checkout/return?orderId=${state.order!._id}`, process.env.CLIENT_URL || 'http://localhost:5173').toString());
  assert.equal(result.body.data.paymentMode, 'sandbox');
  assert.deepEqual(state.request!.customer_details, {
    customer_id: userId, customer_phone: '9999999999',
    customer_name: 'Test Reader', customer_email: 'reader@example.com',
  });
  assert.equal(state.cart!.items.length, 2, 'Starting payment must not clear the cart');
});

test('rejects missing or malformed phone numbers with field errors', async (t) => {
  const { orderCreate } = fixtures(t);
  for (const body of [{}, { customerPhone: 'abc' }, { customerPhone: 9999999999 }]) {
    const result = await post(body);
    assert.equal(result.status, 400);
    assert.ok(result.body.errors.customerPhone);
  }
  assert.equal(orderCreate.mock.callCount(), 0);
});

test('rejects a deleted user', async (t) => {
  const { state, orderCreate } = fixtures(t);
  state.user = null;
  assert.equal((await post()).status, 401);
  assert.equal(orderCreate.mock.callCount(), 0);
});

test('rejects missing and empty carts', async (t) => {
  const { state, orderCreate, apiCreate } = fixtures(t);
  state.cart = null;
  assert.equal((await post()).status, 400);
  state.cart = { items: [] };
  assert.equal((await post()).status, 400);
  assert.equal(orderCreate.mock.callCount(), 0);
  assert.equal(apiCreate.mock.callCount(), 0);
});

test('rejects inactive and deleted books instead of silently changing the purchase', async (t) => {
  const { state, orderCreate } = fixtures(t);
  state.books[0].isActive = false;
  assert.equal((await post()).status, 409);
  state.books = [];
  assert.equal((await post()).status, 409);
  assert.equal(orderCreate.mock.callCount(), 0);
});

test('rejects invalid quantities and prices already present in the database', async (t) => {
  const { state, orderCreate } = fixtures(t);
  for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    state.cart!.items[0].quantity = quantity;
    assert.equal((await post()).status, 400);
  }
  state.cart!.items[0].quantity = 1;
  for (const price of [-1, 1.5, Infinity]) {
    state.books[0].priceInPaise = price;
    assert.equal((await post()).status, 409);
  }
  assert.equal(orderCreate.mock.callCount(), 0);
});

test('rejects totals below INR 1 and unsafe integer totals', async (t) => {
  const { state, orderCreate } = fixtures(t);
  state.books.forEach((book) => { book.priceInPaise = 0; });
  assert.equal((await post()).status, 400);
  state.books[0].priceInPaise = Number.MAX_SAFE_INTEGER;
  assert.equal((await post()).status, 400);
  assert.equal(orderCreate.mock.callCount(), 0);
});

test('a Cashfree timeout returns a safe error and retains the local order reference and cart', async (t) => {
  const { state, apiCreate } = fixtures(t);
  apiCreate.mock.mockImplementation(async () => {
    throw Object.assign(new Error('timeout'), { config: { headers: { secret: 'do_not_leak' } } });
  });
  const result = await post();
  assert.equal(result.status, 502);
  assert.equal(state.order!.status, 'created');
  assert.ok(state.order!.cashfreeOrderId);
  assert.equal(state.cart!.items.length, 2);
  assert.equal(JSON.stringify(result.body).includes('do_not_leak'), false);
});

test('a database write failure prevents the Cashfree call', async (t) => {
  const { orderCreate, apiCreate } = fixtures(t);
  t.mock.method(console, 'error', () => {});
  orderCreate.mock.mockImplementation(async () => { throw new Error('DB unavailable'); });
  assert.equal((await post()).status, 500);
  assert.equal(apiCreate.mock.callCount(), 0);
});

test('rejects missing sessions and mismatched remote order IDs', async (t) => {
  const { apiCreate } = fixtures(t);
  apiCreate.mock.mockImplementation(async (request: CreateOrderRequest) => ({
    data: { order_id: request.order_id, payment_session_id: '' },
  }));
  assert.equal((await post()).status, 502);
  apiCreate.mock.mockImplementation(async () => ({ data: { order_id: 'wrong', payment_session_id: 'session' } }));
  assert.equal((await post()).status, 502);
});
