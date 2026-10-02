import { createHash } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import ipaddr from 'ipaddr.js';
import RateLimit from '../models/RateLimit.js';
import { AppError } from './errorHandler.js';

export function sourceKey(req: Request): string {
  const address = ipaddr.process(req.ip || req.socket.remoteAddress || '127.0.0.1');
  return address.kind() === 'ipv6'
    ? (address as ipaddr.IPv6).parts.slice(0, 4).map(part => part.toString(16)).join(':') + '::/64'
    : address.toString();
}
export const rateStore = {
  async consume(key: string, windowMs: number, now = Date.now()) {
    const bucket = Math.floor(now / windowMs);
    const expiresAt = new Date((bucket + 1) * windowMs);
    const _id = createHash('sha256').update(`${key}:${bucket}`).digest('hex');
    const update = { $inc: { count: 1 }, $setOnInsert: { expiresAt } };
    let row;
    try { row = await RateLimit.findOneAndUpdate({ _id }, update, { upsert: true, returnDocument: 'after' }); }
    catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      row = await RateLimit.findOneAndUpdate({ _id }, { $inc: { count: 1 } }, { returnDocument: 'after' });
    }
    if (!row) throw new Error('Rate limit storage unavailable');
    return { count: row.count, retryAfter: Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000)) };
  },
};
export function rateLimit(scope: string, max: number, windowMs: number,
  identity: (req: Request) => string = sourceKey): RequestHandler {
  return async (req, res, next) => {
    try {
      const result = await rateStore.consume(`${scope}:${identity(req)}`, windowMs);
      if (result.count > max) {
        res.set('Retry-After', String(result.retryAfter));
        res.set('Cache-Control', 'no-store');
        return next(new AppError(429, 'Too many requests. Please try again later.'));
      }
      next();
    } catch { next(new AppError(503, 'Please try again later.')); }
  };
}
const emailKey = (req: Request) => String(req.body?.email || '').trim().toLowerCase();
export const loginLimits = [rateLimit('login-ip', 30, 15 * 60_000), rateLimit('login-account', 10, 15 * 60_000, emailKey)];
export const signupLimits = [rateLimit('signup-ip', 10, 60 * 60_000), rateLimit('signup-email', 3, 60 * 60_000, emailKey)];
export const checkoutLimit = rateLimit('checkout-user', 10, 60_000, req => req.user!.userId);
export const webhookLimit = rateLimit('webhook-ip', 600, 60_000);
export const publicLimit = rateLimit('catalog-ip', 120, 60_000);
