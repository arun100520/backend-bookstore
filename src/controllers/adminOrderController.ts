import type { Request, Response, NextFunction } from 'express';
import { isObjectIdOrHexString } from 'mongoose';
import { z } from 'zod';
import Order from '../models/Order.js';
import PaymentEvent from '../models/PaymentEvent.js';
import { AppError } from '../middleware/errorHandler.js';
import { reconcileOrder } from '../jobs/reconcilePendingOrders.js';

const querySchema = z.object({
  page: z.string().regex(/^[1-9]\d*$/).default('1').transform(Number).pipe(z.number().int().max(1_000_000)),
  limit: z.string().regex(/^[1-9]\d*$/).default('20').transform(Number).pipe(z.number().int().max(100)),
});
function pagination(req: Request) {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(400, 'Invalid pagination');
  return parsed.data;
}
async function requireOrder(req: Request) {
  if (!isObjectIdOrHexString(req.params.id)) throw new AppError(400, 'Invalid order ID');
  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError(404, 'Order not found');
  return order;
}
export async function listAdminOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set('Cache-Control', 'no-store');
  try {
    const { page, limit } = pagination(req);
    const [orders, total] = await Promise.all([
      Order.find({}).select('_id user orderNumber items amountInPaise currency status cashfreeOrderId createdAt updatedAt')
        .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Order.countDocuments({}),
    ]);
    res.json({ data: orders, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
}
export async function getOrderEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set('Cache-Control', 'no-store');
  try {
    const { page, limit } = pagination(req);
    const order = await requireOrder(req);
    const filter = { order: order._id };
    const [events, total] = await Promise.all([
      PaymentEvent.find(filter).sort({ receivedAt: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      PaymentEvent.countDocuments(filter),
    ]);
    res.json({ data: events, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
}
export async function resyncOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set('Cache-Control', 'no-store');
  try {
    const order = await requireOrder(req);
    const status = await reconcileOrder(order);
    res.json({ data: { orderId: String(order._id), status } });
  } catch (err) { next(err); }
}
