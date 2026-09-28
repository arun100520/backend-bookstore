import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { AppError } from './errorHandler.js';

/**
 * authenticate — verifies the Bearer token in the Authorization header,
 * attaches `{ userId, role }` to `req.user`, and calls next().
 *
 * Returns 401 if:
 *   - No Authorization header / not Bearer format
 *   - Token is missing, expired, or tampered with
 */
export function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, 'Access token required');
    }

    const token = authHeader.slice(7);

    if (!token) {
      throw new AppError(401, 'Access token required');
    }

    try {
      req.user = verifyAccessToken(token);
    } catch {
      throw new AppError(401, 'Invalid or expired access token');
    }

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * isAdmin — must be used AFTER authenticate().
 * Returns 403 if the authenticated user's role is not 'admin'.
 */
export function isAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (req.user?.role !== 'admin') {
    next(new AppError(403, 'Admin access required'));
    return;
  }
  next();
}
