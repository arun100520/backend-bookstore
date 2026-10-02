import express, { Router, type ErrorRequestHandler } from 'express';
import { cashfreeWebhook } from '../controllers/webhookController.js';
import { AppError } from '../middleware/errorHandler.js';
import { webhookLimit } from '../middleware/rateLimit.js';

const router = Router();
router.post('/cashfree', webhookLimit, express.raw({ type: 'application/json', limit: '1mb', inflate: false }), cashfreeWebhook);
const bodyErrorHandler: ErrorRequestHandler = (err, _req, _res, next) => {
  if (err.type === 'entity.too.large') next(new AppError(413, 'Webhook body is too large'));
  else if (err.type === 'encoding.unsupported') next(new AppError(415, 'Compressed webhooks are not supported'));
  else next(err);
};
router.use(bodyErrorHandler);
export default router;
