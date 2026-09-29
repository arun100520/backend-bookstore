import type { Request, Response, NextFunction } from 'express';
import { isObjectIdOrHexString } from 'mongoose';
import { z } from 'zod';
import Order from '../models/Order.js';
import PaymentEvent from '../models/PaymentEvent.js';
import { AppError } from '../middleware/errorHandler.js';

const orderFields = '_id orderNumber items amountInPaise currency status createdAt updatedAt';
const pagination = z.object({
  page: z.string().regex(/^[1-9]\d*$/).default('1').transform(Number).pipe(z.number().int().min(1).max(1_000_000)),
  limit: z.string().regex(/^[1-9]\d*$/).default('20').transform(Number).pipe(z.number().int().min(1).max(100)),
});

export async function listOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set('Cache-Control', 'no-store');
  try {
    const parsed = pagination.safeParse(req.query);
    if (!parsed.success) throw new AppError(400, 'Invalid pagination: page must be 1-1000000 and limit 1-100');
    const { page, limit } = parsed.data;
    const filter = { user: req.user!.userId };
    const [orders, total] = await Promise.all([
      Order.find(filter).select(orderFields).sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);
    res.status(200).json({ data: orders, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
}

export async function getOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set('Cache-Control', 'no-store');
  try {
    if (!isObjectIdOrHexString(req.params.id)) throw new AppError(400, 'Invalid order ID');
    const order = await Order.findOne({ _id: req.params.id, user: req.user!.userId })
      .select(orderFields).populate('items.book', '_id title slug').lean();
    if (!order) throw new AppError(404, 'Order not found');
    res.status(200).json({ data: order });
  } catch (err) { next(err); }
}

export async function getOrderEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set('Cache-Control', 'no-store');
  try {
    if (!isObjectIdOrHexString(req.params.id)) throw new AppError(400, 'Invalid order ID');
    const owned = await Order.exists({ _id: req.params.id, user: req.user!.userId });
    if (!owned) throw new AppError(404, 'Order not found');
    const events = await PaymentEvent.find({ order: req.params.id,
      $or: [{ signatureVerified: true }, { source: 'reconciliation' }],
      eventType: { $in: ['PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'PAYMENT_PENDING', 'REFUND_SUCCESS'] },
    }).select('_id eventType receivedAt').sort({ receivedAt: 1, _id: 1 }).lean();
    // Explicit DTO prevents provider payloads or identifiers reaching customer pages.
    res.status(200).json({ data: events.map(event => ({
      _id: String(event._id), eventType: event.eventType, receivedAt: event.receivedAt,
    })) });
  } catch (err) { next(err); }
}

export async function getOrderStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set('Cache-Control', 'no-store');
  try {
    if (!isObjectIdOrHexString(req.params.id)) throw new AppError(400, 'Invalid order ID');
    const order = await Order.findOne({ _id: req.params.id, user: req.user!.userId })
      .select('_id status').lean();
    if (!order) throw new AppError(404, 'Order not found');
    res.status(200).json({ data: { orderId: String(order._id), status: order.status } });
  } catch (err) {
    next(err);
  }
}
