import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getOrder, getOrderStatus, listOrders } from '../controllers/orderController.js';

const router = Router();
router.get('/', authenticate, listOrders);
router.get('/:id/status', authenticate, getOrderStatus);
router.get('/:id', authenticate, getOrder);
export default router;
