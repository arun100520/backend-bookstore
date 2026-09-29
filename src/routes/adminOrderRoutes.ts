import { Router } from 'express';
import { authenticate, isAdmin } from '../middleware/auth.js';
import { listAdminOrders, getOrderEvents, resyncOrder, getAdminOrder } from '../controllers/adminOrderController.js';

const router = Router();
router.use(authenticate, isAdmin);
router.get('/', listAdminOrders);
router.get('/:id', getAdminOrder);
router.get('/:id/events', getOrderEvents);
router.post('/:id/resync', resyncOrder);
export default router;
