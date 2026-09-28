import { Router } from 'express';
import { getCartHandler, addItem, updateItem, removeItem } from '../controllers/cartController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All cart routes require a logged-in user
router.use(authenticate);

router.get('/', getCartHandler);
router.post('/items', addItem);
router.patch('/items/:bookId', updateItem);
router.delete('/items/:bookId', removeItem);

export default router;
