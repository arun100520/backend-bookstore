import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getProfile, updateProfile } from '../controllers/userController.js';

const router = Router();
router.use(authenticate);
router.get('/me', getProfile);
router.patch('/me', updateProfile);
export default router;
