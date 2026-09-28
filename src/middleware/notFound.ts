import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';

/**
 * 404 catch-all — register AFTER all route handlers.
 * Converts an unknown route into an AppError so errorHandler formats it consistently.
 */
export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}
