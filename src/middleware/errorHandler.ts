import { Request, Response, NextFunction } from 'express';

/**
 * Shape of every error response the API sends.
 * Keep it consistent so the frontend can always expect the same structure.
 */
export interface ApiError {
  status: number;
  message: string;
  errors?: Record<string, string>; // field-level validation errors (task 6.1)
}

/**
 * Custom error class — throw this anywhere in route/controller code.
 *
 * @example
 *   throw new AppError(409, 'Email already in use');
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly errors?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Centralized Express error handler — MUST be the last middleware registered.
 * Catches AppError instances (known errors) and any unexpected Error.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    const body: ApiError = { status: err.statusCode, message: err.message };
    if (err.errors) body.errors = err.errors;
    res.status(err.statusCode).json(body);
    return;
  }

  // Mongoose duplicate-key error (e.g. unique email constraint)
  if ((err as NodeJS.ErrnoException).name === 'MongoServerError' &&
      (err as unknown as { code: number }).code === 11000) {
    const keyPattern = (err as unknown as { keyValue?: Record<string, unknown> }).keyValue;
    const field = keyPattern ? Object.keys(keyPattern)[0] : 'field';
    res.status(409).json({ status: 409, message: `${field} is already in use` });
    return;
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors: Record<string, string> = {};
    const ve = err as unknown as { errors: Record<string, { message: string }> };
    Object.keys(ve.errors).forEach((key) => {
      errors[key] = ve.errors[key].message;
    });
    res.status(400).json({ status: 400, message: 'Validation failed', errors });
    return;
  }

  // Unexpected / unhandled error — log it, never leak the stack to the client
  console.error('[errorHandler] Unhandled error:', err);
  res.status(500).json({ status: 500, message: 'Internal server error' });
}
