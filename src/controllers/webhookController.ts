import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler.js';
import { verifyWebhookSignature } from '../services/cashfreeService.js';
import { processCashfreeWebhook } from '../services/cashfreeWebhook.js';

export async function cashfreeWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!Buffer.isBuffer(req.body)) throw new AppError(415, 'Webhook requires application/json');
    if (!verifyWebhookSignature(req.get('x-webhook-signature') || '', req.get('x-webhook-timestamp') || '', req.body)) {
      throw new AppError(401, 'Invalid webhook signature');
    }
    let payload: unknown;
    try { payload = JSON.parse(req.body.toString('utf8')); }
    catch { throw new AppError(400, 'Invalid webhook JSON'); }
    await processCashfreeWebhook(payload);
    // Respond only after durable processing. Failures remain non-200 for Cashfree retries.
    res.status(200).json({ received: true });
  } catch (error) {
    next(error);
  }
}
