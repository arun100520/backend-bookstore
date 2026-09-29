import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import app from '../index.js';
import Order from '../models/Order.js';
import { generateAccessToken } from '../utils/jwt.js';

const owner = new mongoose.Types.ObjectId();
const other = new mongoose.Types.ObjectId();
const empty = new mongoose.Types.ObjectId();
const ids = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
let server: Server | undefined;
async function run() {
  assert.ok(process.env.MONGO_URI); assert.ok(process.env.JWT_SECRET);
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  await Order.init();
  for (const [i, id] of ids.entries()) {
    await Order.create({ _id: id, user: i === 2 ? other : owner, orderNumber: `order_history_test_${id}`,
      cashfreeOrderId: `private_reference_${id}`, status: 'created', amountInPaise: 300, currency: 'INR',
      items: [{ book: new mongoose.Types.ObjectId(), quantity: 2, priceAtPurchase: 150 }] });
  }
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  async function get(path: string, user = owner, role: 'user' | 'admin' = 'user') {
    const response = await fetch(`http://127.0.0.1:${address && typeof address !== 'string' ? address.port : 0}/api/orders${path}`, {
      headers: { Authorization: `Bearer ${generateAccessToken({ userId: String(user), role })}` },
    });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, body: await response.json() as any };
  }
  const first = await get('?limit=1');
  const second = await get('?limit=1&page=2');
  assert.equal(first.status, 200); assert.equal(first.body.meta.total, 2);
  assert.equal(first.body.data.length, 1); assert.equal(first.body.meta.totalPages, 2);
  assert.equal(first.body.data[0]._id, String(ids[1])); assert.equal(second.body.data[0]._id, String(ids[0]));
  assert.deepEqual((await get('?page=3&limit=1')).body.data, []);
  assert.deepEqual((await get('', empty)).body, { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } });
  assert.equal((await get(`?user=${other}&userId=${other}`)).body.meta.total, 2);
  const detail = await get(`/${ids[0]}`);
  assert.equal(detail.status, 200); assert.equal(detail.body.data.items[0].priceAtPurchase, 150);
  for (const key of ['user', '__v', 'cashfreeOrderId', 'rawPayload', 'pdfUrl']) assert.ok(!(key in detail.body.data));
  const denied = await get(`/${ids[2]}`);
  assert.equal(denied.status, 404);
  assert.deepEqual(denied, await get(`/${new mongoose.Types.ObjectId()}`));
  assert.equal((await get(`/${ids[0]}`, other)).status, 404);
  assert.equal((await get(`/${ids[2]}`, owner, 'admin')).status, 404);
  assert.equal((await get(`/${ids[0]}/status`)).body.data.status, 'created');
  console.log('PASS: real HTTP/MongoDB ownership, admin isolation, pagination, empty history, price snapshots, safe fields and status route.');
}
run().catch(error => {
  console.error('Order history DB test failed:', error instanceof assert.AssertionError ? error.message : (error as Error).name);
  process.exitCode = 1;
}).finally(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
  try {
    if (mongoose.connection.readyState === 1) await Order.deleteMany({ _id: { $in: ids } });
  } finally { await mongoose.disconnect(); }
  console.log('Temporary order fixtures removed; existing orders unchanged.');
});
