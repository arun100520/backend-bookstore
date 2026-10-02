import type { CookieOptions, RequestHandler } from 'express';
import { AppError } from '../middleware/errorHandler.js';

export function clientOrigin(): string {
  return new URL(process.env.CLIENT_URL || 'http://localhost:5173').origin;
}

export function refreshCookieOptions(): CookieOptions {
  const production = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? 'none' : 'strict',
    // Separate frontend/API hosting requires a cross-site cookie. Partitioning
    // keeps it scoped to this store in browsers that block third-party cookies.
    partitioned: production,
    path: '/',
  };
}

// CORS controls reading responses; explicitly reject cookie-auth requests from
// other browser origins as well. CLI/server clients may omit Origin.
export const requireAuthOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.get('origin');
  if ((origin && origin !== clientOrigin()) || (!origin && req.get('sec-fetch-site') === 'cross-site')) {
    next(new AppError(403, 'Authentication request origin is not allowed'));
    return;
  }
  next();
};
