import { isObjectIdOrHexString, type Types } from 'mongoose';
import Order from '../models/Order.js';
import PaymentEvent from '../models/PaymentEvent.js';
import { AppError } from '../middleware/errorHandler.js';
import type { OrderStatus } from '../types/index.js';

export interface ProjectionEvent {
  eventType: string;
  signatureVerified: boolean;
  source?: 'webhook' | 'reconciliation';
}

/**
 * Reduce normalized, trusted events independently of delivery order.
 * Ingestion must normalize provider events before saving them:
 * PAYMENT_SUCCESS, PAYMENT_FAILED, REFUND_SUCCESS (a full-order refund only).
 * A failed attempt is provisional: a later success always takes precedence.
 * Unknown, pending and partial-refund events do not change the order status.
 */
export function computeOrderStatus(events: readonly ProjectionEvent[]): OrderStatus {
  let status: OrderStatus = 'created';
  for (const event of events) {
    // Reconciliation is authenticated by the server-to-server API, not a webhook signature.
    if (event.signatureVerified !== true && event.source !== 'reconciliation') continue;
    if (event.eventType === 'REFUND_SUCCESS') return 'refunded';
    if (event.eventType === 'PAYMENT_SUCCESS') status = 'paid';
    else if (event.eventType === 'PAYMENT_FAILED' && status === 'created') status = 'failed';
  }
  return status;
}

/**
 * Rebuild status from the event log and return the persisted status.
 * Call after inserting an event. Keep payment events append-only and route all
 * status changes through this service so its optimistic concurrency check works.
 * Webhook ingestion/entitlements and reconciliation are separate later tasks.
 */
export async function reduceOrderStatus(orderId: string | Types.ObjectId): Promise<OrderStatus> {
  if (!isObjectIdOrHexString(orderId)) throw new AppError(400, 'Invalid order ID');

  for (let attempt = 0; attempt < 5; attempt++) {
    // Read the version BEFORE events, so an older event snapshot cannot overwrite
    // a newer projection that finishes while this one is still running.
    const order = await Order.findById(orderId).select('cashfreeOrderId __v').lean();
    if (!order) throw new AppError(404, 'Order not found');

    const events = await PaymentEvent.find({
      order: order._id,
      ...(order.cashfreeOrderId ? { cashfreeOrderId: order.cashfreeOrderId } : {}),
    }).select('eventType signatureVerified source').lean();
    const status = computeOrderStatus(events);
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, __v: order.__v },
      { $set: { status }, $inc: { __v: 1 } },
      { returnDocument: 'after', runValidators: true },
    );
    if (updated) return updated.status;
    // Another reducer won the write. Reread both the version and the events.
  }
  throw new AppError(409, 'Order changed during status projection; retry the operation');
}
