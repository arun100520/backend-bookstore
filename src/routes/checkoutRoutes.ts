import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { createCheckoutOrder } from '../controllers/checkoutController.js';

const router = Router();
router.post('/create-order', authenticate, createCheckoutOrder);
export default router;
