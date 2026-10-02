import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';
import { Cashfree, CFEnvironment } from 'cashfree-pg';
import { createOrder, getOrderStatus, verifyWebhookSignature } from './cashfreeService.js';

const keys = ['CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY', 'CASHFREE_ENV'] as const;
const saved = keys.map((key) => process.env[key]);
const params = {
  order_id: 'test_order', order_amount: 10.5, order_currency: 'INR',
  customer_details: { customer_id: 'test_user', customer_phone: '9999999999' },
};

beforeEach(() => {
  process.env.CASHFREE_APP_ID = 'test_app';
  process.env.CASHFREE_SECRET_KEY = 'test_secret';
  process.env.CASHFREE_ENV = 'sandbox';
});
afterEach(() => {
  keys.forEach((key, index) => {
    if (saved[index] === undefined) delete process.env[key];
    else process.env[key] = saved[index];
  });
});

test('SDK instance reads credentials after import and receives the order as its first argument', async (t) => {
  const response = { order_id: params.order_id, payment_session_id: 'test_session' };
  t.mock.method(Cashfree.prototype, 'PGCreateOrder', function (this: Cashfree, ...args: unknown[]) {
    assert.equal(this.XClientId, 'test_app');
    assert.equal(this.XClientSecret, 'test_secret');
    assert.equal(this.XEnvironment, CFEnvironment.SANDBOX);
    assert.equal(this.XApiVersion, '2025-01-01');
    assert.equal(args[0], params);
    assert.deepEqual(args[3], { timeout: 15_000 });
    return Promise.resolve({ data: response });
  });
  assert.deepEqual(await createOrder(params), response);
});

test('fetch uses the merchant order ID and the selected environment', async (t) => {
  process.env.CASHFREE_ENV = 'production';
  t.mock.method(Cashfree.prototype, 'PGFetchOrder', function (this: Cashfree, ...args: unknown[]) {
    assert.equal(this.XEnvironment, CFEnvironment.PRODUCTION);
    assert.equal(this.XApiVersion, '2025-01-01');
    assert.equal(args[0], 'test_order');
    return Promise.resolve({ data: { order_status: 'ACTIVE' } });
  });
  assert.equal((await getOrderStatus('test_order')).order_status, 'ACTIVE');
});

test('checkout retries supply a stable UUID provider idempotency key', async t => {
  const id = 'b83229e1-8e63-4c40-b8bb-fbf7248d54aa';
  t.mock.method(Cashfree.prototype, 'PGCreateOrder', async (...args: unknown[]) => {
    assert.equal(args[2], id);
    return { data: { order_id: `ebook_${id}` } };
  });
  await createOrder({ ...params, order_id: `ebook_${id}` });
});

test('missing credentials and invalid environments fail before any API call', async () => {
  delete process.env.CASHFREE_APP_ID;
  await assert.rejects(createOrder(params), /CASHFREE_APP_ID/);
  process.env.CASHFREE_APP_ID = 'test_app';
  delete process.env.CASHFREE_SECRET_KEY;
  await assert.rejects(getOrderStatus('test_order'), /CASHFREE_SECRET_KEY/);
  process.env.CASHFREE_SECRET_KEY = 'test_secret';
  process.env.CASHFREE_ENV = 'prodution';
  await assert.rejects(createOrder(params), /CASHFREE_ENV/);
});

test('API errors retain their diagnostic information', async (t) => {
  const error = Object.assign(new Error('Authentication failed'), { response: { status: 401 } });
  t.mock.method(Cashfree.prototype, 'PGCreateOrder', async () => { throw error; });
  await assert.rejects(createOrder(params), (actual) => actual === error);
});

test('signatures require the exact body bytes and timestamp', () => {
  const body = '{ "amount": 10.50 }';
  const timestamp = '1720000000000';
  const signature = createHmac('sha256', 'test_secret').update(timestamp + body).digest('base64');
  assert.equal(verifyWebhookSignature(signature, timestamp, body), true);
  assert.equal(verifyWebhookSignature(signature, timestamp, Buffer.from(body)), true);
  assert.equal(verifyWebhookSignature(signature, timestamp, JSON.stringify(JSON.parse(body))), false);
  assert.equal(verifyWebhookSignature(signature, timestamp + '1', body), false);
  assert.equal(verifyWebhookSignature('x'.repeat(signature.length), timestamp, body), false);
  assert.equal(verifyWebhookSignature('invalid', timestamp, body), false);
  assert.equal(verifyWebhookSignature('', timestamp, body), false);
  assert.equal(verifyWebhookSignature(signature, '', body), false);
});

test('a signature made with an empty secret is always rejected', () => {
  delete process.env.CASHFREE_SECRET_KEY;
  const signature = createHmac('sha256', '').update('123{}').digest('base64');
  assert.equal(verifyWebhookSignature(signature, '123', '{}'), false);
});
