import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { checkoutLimit } from '../middleware/rateLimit.js';
import { createCheckoutOrder } from '../controllers/checkoutController.js';

const router = Router();
router.post('/create-order', authenticate, checkoutLimit, createCheckoutOrder);
export default router;
