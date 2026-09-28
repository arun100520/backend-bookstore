import { createHash } from 'node:crypto';
import { z } from 'zod';
import Order from '../models/Order.js';
import PaymentEvent from '../models/PaymentEvent.js';
import Entitlement from '../models/Entitlement.js';
import { AppError } from '../middleware/errorHandler.js';
import { reduceOrderStatus } from './orderProjection.js';

const providerId = z.union([z.string().min(1).max(200), z.number().int().nonnegative().safe()])
  .transform(String);
const money = z.number().finite().nonnegative();
const paymentSchema = z.object({
  type: z.enum(['PAYMENT_SUCCESS_WEBHOOK', 'PAYMENT_FAILED_WEBHOOK', 'PAYMENT_USER_DROPPED_WEBHOOK']),
  data: z.object({
    order: z.object({ order_id: z.string().min(1), order_amount: money, order_currency: z.string() }),
    payment: z.object({
      cf_payment_id: providerId, payment_status: z.string(),
      payment_amount: money, payment_currency: z.string(),
    }),
  }),
});
const refundSchema = z.object({
  type: z.literal('REFUND_STATUS_WEBHOOK'),
  data: z.object({ refund: z.object({
    cf_refund_id: providerId, order_id: z.string().min(1), refund_amount: money,
    refund_currency: z.string(), refund_status: z.enum(['SUCCESS', 'PENDING', 'CANCELLED', 'FAILED']),
    refund_type: z.string(),
  }) }),
});

function paise(amount: number): number {
  const result = Math.round(amount * 100);
  if (!Number.isSafeInteger(result) || Math.abs(result / 100 - amount) > 1e-8) {
    throw new AppError(400, 'Invalid webhook amount');
  }
  return result;
}

function duplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

/** The controller MUST verify the raw-body signature before calling this function. */
export async function processCashfreeWebhook(rawPayload: unknown): Promise<void> {
  const envelope = z.object({ type: z.string() }).safeParse(rawPayload);
  if (!envelope.success) throw new AppError(400, 'Invalid webhook payload');

  let cashfreeOrderId: string;
  let identity: string[];
  let eventType: string;
  let amount: number;
  let currency: string;
  let paymentAmount: number | undefined;
  let partialRefund = false;

  if (envelope.data.type === 'REFUND_STATUS_WEBHOOK') {
    const parsed = refundSchema.safeParse(rawPayload);
    if (!parsed.success) throw new AppError(400, 'Invalid refund webhook payload');
    const refund = parsed.data.data.refund;
    // Auto-refunds can concern an extra/failed attempt, not the purchased order.
    if (refund.refund_type !== 'MERCHANT_INITIATED') return;
    cashfreeOrderId = refund.order_id;
    amount = paise(refund.refund_amount);
    currency = refund.refund_currency;
    identity = ['refund', cashfreeOrderId, refund.cf_refund_id, refund.refund_status];
    eventType = `REFUND_${refund.refund_status}`;
    partialRefund = refund.refund_status === 'SUCCESS';
  } else if (['PAYMENT_SUCCESS_WEBHOOK', 'PAYMENT_FAILED_WEBHOOK', 'PAYMENT_USER_DROPPED_WEBHOOK'].includes(envelope.data.type)) {
    const parsed = paymentSchema.safeParse(rawPayload);
    if (!parsed.success) throw new AppError(400, 'Invalid payment webhook payload');
    const { order, payment } = parsed.data.data;
    const expected = {
      PAYMENT_SUCCESS_WEBHOOK: 'SUCCESS', PAYMENT_FAILED_WEBHOOK: 'FAILED', PAYMENT_USER_DROPPED_WEBHOOK: 'USER_DROPPED',
    }[parsed.data.type];
    if (payment.payment_status !== expected) throw new AppError(400, 'Webhook type and payment status disagree');
    cashfreeOrderId = order.order_id;
    amount = paise(order.order_amount);
    currency = order.order_currency;
    if (payment.payment_currency !== currency) throw new AppError(400, 'Webhook payment currency mismatch');
    if (expected === 'SUCCESS') paymentAmount = paise(payment.payment_amount);
    eventType = `PAYMENT_${expected}`;
    identity = ['payment', cashfreeOrderId, payment.cf_payment_id, expected];
  } else {
    // Acknowledge signed dashboard probes and events this store does not consume.
    return;
  }

  const order = await Order.findOne({ cashfreeOrderId });
  if (!order) throw new AppError(404, 'Webhook order not found');
  if (currency !== order.currency ||
      (identity[0] === 'payment' && (amount !== order.amountInPaise ||
        (paymentAmount !== undefined && paymentAmount !== order.amountInPaise))) ||
      (identity[0] === 'refund' && (amount <= 0 || amount > order.amountInPaise))) {
    throw new AppError(400, 'Webhook amount or currency does not match the order');
  }
  if (partialRefund && amount < order.amountInPaise) eventType = 'PARTIAL_REFUND_SUCCESS';

  // Derive identity from signed business fields. Delivery timestamps/headers can
  // change on retries; payment status must be included so failure cannot hide success.
  const cashfreeEventId = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  const filter = { cashfreeEventId };
  try {
    await PaymentEvent.updateOne(filter, { $setOnInsert: {
      order: order._id, cashfreeOrderId, cashfreeEventId, eventType,
      rawPayload, signatureVerified: true,
    } }, { upsert: true, runValidators: true });
  } catch (error) {
    // Concurrent insert races are harmless only when the expected row exists.
    if (!duplicateKey(error) || !await PaymentEvent.exists({ ...filter, order: order._id })) throw error;
  }

  // Always replay downstream work, including on duplicate delivery, to repair a
  // previous crash between inserting the event, projecting status and fulfilment.
  const status = await reduceOrderStatus(String(order._id));
  if (status !== 'paid') return;
  for (const bookId of new Set(order.items.map((item) => String(item.book)))) {
    const entitlementFilter = { user: order.user, book: bookId };
    try {
      await Entitlement.updateOne(entitlementFilter, { $setOnInsert: {
        ...entitlementFilter, order: order._id,
      } }, { upsert: true, runValidators: true });
    } catch (error) {
      if (!duplicateKey(error) || !await Entitlement.exists(entitlementFilter)) throw error;
    }
  }
}
