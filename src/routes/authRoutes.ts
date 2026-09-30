import { validateBody, signupBody, loginBody, emptyBody } from '../middleware/validate.js';
import { Router } from 'express';
import { signup, login, logout, me } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/signup', validateBody(signupBody), signup);
router.post('/login', validateBody(loginBody), login);
router.post('/logout', validateBody(emptyBody), logout);
router.get('/me', authenticate, me); // authenticate runs first, then me

export default router;
