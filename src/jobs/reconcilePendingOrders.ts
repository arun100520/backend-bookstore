import { createHash } from 'node:crypto';
import { isObjectIdOrHexString } from 'mongoose';
import { z } from 'zod';
import Order, { type IOrder } from '../models/Order.js';
import { AppError } from '../middleware/errorHandler.js';
import PaymentEvent from '../models/PaymentEvent.js';
import Entitlement from '../models/Entitlement.js';
import { getOrderStatus } from '../services/cashfreeService.js';
import { reduceOrderStatus } from '../services/orderProjection.js';

const snapshotSchema = z.object({
  order_id: z.string().min(1),
  order_amount: z.number().finite().nonnegative(),
  order_currency: z.string(),
  order_status: z.enum(['ACTIVE', 'PAID', 'EXPIRED', 'TERMINATED', 'TERMINATION_REQUESTED']),
}).passthrough();

export function reconciliationEventType(raw: unknown, order: { cashfreeOrderId?: string; amountInPaise: number; currency: string }) {
  const snapshot = snapshotSchema.parse(raw);
  const paise = Math.round(snapshot.order_amount * 100);
  if (snapshot.order_id !== order.cashfreeOrderId || snapshot.order_currency !== order.currency ||
      !Number.isSafeInteger(paise) || Math.abs(paise / 100 - snapshot.order_amount) > 1e-8 || paise !== order.amountInPaise) {
    throw new Error('Cashfree order does not match the local order');
  }
  return { snapshot, eventType: snapshot.order_status === 'PAID' ? 'PAYMENT_SUCCESS'
    : ['EXPIRED', 'TERMINATED'].includes(snapshot.order_status) ? 'PAYMENT_FAILED' : 'PAYMENT_PENDING' };
}

function duplicateKey(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

// Replays durable events even if a prior run crashed after changing status to paid.
async function completeEvent(event: { _id: unknown; order: unknown; cashfreeOrderId: string }) {
  const order = await Order.findOne({ _id: String(event.order), cashfreeOrderId: event.cashfreeOrderId });
  if (!order) throw new Error('Reconciliation order not found');
  const status = await reduceOrderStatus(String(order._id));
  if (status === 'paid') {
    for (const book of new Set(order.items.map(item => String(item.book)))) {
      const filter = { user: order.user, book };
      try {
        await Entitlement.updateOne(filter, { $setOnInsert: { ...filter, order: order._id } }, { upsert: true, runValidators: true });
      } catch (error) {
        if (!duplicateKey(error) || !await Entitlement.exists(filter)) throw error;
      }
    }
  }
  await PaymentEvent.updateOne({ _id: String(event._id) }, { $set: { processedAt: new Date() } });
  return status;
}


/** Fetch and reconcile one order regardless of age/status; shared by admin resync and the job. */
export async function reconcileOrder(order: Pick<IOrder, '_id' | 'cashfreeOrderId' | 'amountInPaise' | 'currency'>) {
  if (!order.cashfreeOrderId) throw new AppError(409, 'Order has no Cashfree reference');
  let raw;
  try { raw = await getOrderStatus(order.cashfreeOrderId!); }
  catch { throw new AppError(502, 'Could not fetch Cashfree order status; retry later'); }
  let validated;
  try { validated = reconciliationEventType(raw, order); }
  catch { throw new AppError(502, 'Cashfree returned an invalid or mismatched order'); }
  const { snapshot, eventType } = validated;
  const cashfreeEventId = createHash('sha256')
    .update(JSON.stringify(['reconciliation', String(order._id), snapshot.order_id, snapshot.order_status])).digest('hex');
  const filter = { cashfreeEventId };
  try {
    await PaymentEvent.updateOne(filter, { $setOnInsert: {
      order: order._id, cashfreeOrderId: snapshot.order_id, cashfreeEventId, eventType,
      source: 'reconciliation', signatureVerified: false, rawPayload: raw,
    } }, { upsert: true, runValidators: true });
  } catch (error) {
    if (!duplicateKey(error)) throw error;
  }
  const event = await PaymentEvent.findOne({ ...filter, order: order._id, source: 'reconciliation' });
  if (!event) throw new Error('Reconciliation event was not persisted');
  return completeEvent(event);
}

export function reconciliationConfig(env = process.env) {
  function minutes(name: string, fallback: number) {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isInteger(value) || value < 1 || value > 1440) throw new Error(`${name} must be an integer from 1 to 1440`);
    return value * 60_000;
  }
  function seconds(name: string, fallback: number) {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isInteger(value) || value < 1 || value > 86400) throw new Error(`${name} must be an integer from 1 to 86400`);
    return value * 1_000;
  }
  if (env.RECONCILIATION_ENABLED !== undefined && !['true', 'false'].includes(env.RECONCILIATION_ENABLED)) {
    throw new Error('RECONCILIATION_ENABLED must be true or false');
  }
  // RECONCILIATION_MIN_AGE_SECONDS takes priority over RECONCILIATION_MIN_AGE_MINUTES
  const minAgeMs = env.RECONCILIATION_MIN_AGE_SECONDS !== undefined
    ? seconds('RECONCILIATION_MIN_AGE_SECONDS', 10)
    : minutes('RECONCILIATION_MIN_AGE_MINUTES', 15);
  // RECONCILIATION_INTERVAL_SECONDS takes priority over RECONCILIATION_INTERVAL_MINUTES
  const intervalMs = env.RECONCILIATION_INTERVAL_SECONDS !== undefined
    ? seconds('RECONCILIATION_INTERVAL_SECONDS', 30)
    : minutes('RECONCILIATION_INTERVAL_MINUTES', 5);
  return { enabled: env.RECONCILIATION_ENABLED !== 'false',
    intervalMs,
    minAgeMs };
}

export async function reconcilePendingOrders(options: { now?: Date; minAgeMs?: number; orderId?: string } = {}) {
  const minAgeMs = options.minAgeMs ?? reconciliationConfig().minAgeMs;
  if (!Number.isFinite(minAgeMs) || minAgeMs <= 0) throw new Error('Invalid minimum age');
  if (options.orderId && !isObjectIdOrHexString(options.orderId)) throw new Error('Invalid order ID');
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid reconciliation time');
  const result = { checked: 0, repaired: 0, failed: 0 };
  function failed(orderId: unknown, error: unknown) {
    result.failed++;
    // SDK errors may contain credentials: never log their payload, headers or message.
    const status = (error as { response?: { status?: number } })?.response?.status;
    console.warn('[reconciliation] Order needs retry', { orderId: String(orderId), httpStatus: status });
  }
  const unfinished = PaymentEvent.find({ source: 'reconciliation', processedAt: { $exists: false },
    ...(options.orderId ? { order: options.orderId } : {}) }).cursor();
  for await (const event of unfinished) {
    try { await completeEvent(event); result.repaired++; }
    catch (error) { failed(event.order, error); }
  }
  const pending = Order.find({ status: 'created', createdAt: { $lte: new Date(now.getTime() - minAgeMs) },
    cashfreeOrderId: { $type: 'string', $ne: '' }, ...(options.orderId ? { _id: options.orderId } : {}) })
    .sort({ createdAt: 1 }).cursor();
  for await (const order of pending) {
    result.checked++;
    try {
      await reconcileOrder(order);
    } catch (error) { failed(order._id, error); }
  }
  return result;
}

export function startReconciliationJob() {
  const config = reconciliationConfig();
  if (!config.enabled) return () => {};
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Schedule after completion, preventing overlapping runs in this process.
  async function tick() {
    try { console.log('[reconciliation]', await reconcilePendingOrders({ minAgeMs: config.minAgeMs })); }
    catch { console.error('[reconciliation] Run failed; will retry next interval'); }
    if (!stopped) { timer = setTimeout(tick, config.intervalMs); timer.unref(); }
  }
  void tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
