import { validateBody, validateId, addCartBody, updateCartBody, emptyBody } from '../middleware/validate.js';
import { Router } from 'express';
import { getCartHandler, addItem, updateItem, removeItem } from '../controllers/cartController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All cart routes require a logged-in user
router.use(authenticate);

router.get('/', getCartHandler);
router.post('/items', validateBody(addCartBody), addItem);
router.patch('/items/:bookId', validateId('bookId'), validateBody(updateCartBody), updateItem);
router.delete('/items/:bookId', validateId('bookId'), validateBody(emptyBody), removeItem);

export default router;
