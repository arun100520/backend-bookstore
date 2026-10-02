import { validateBody, signupBody, loginBody, emptyBody } from '../middleware/validate.js';
import { Router } from 'express';
import { signup, login, logout, me, verifyEmail, verificationStatus, refreshToken } from '../controllers/authController.js';
import { z } from 'zod';
import { loginLimits, signupLimits, rateLimit } from '../middleware/rateLimit.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
const verificationBody = z.strictObject({ token: z.string().regex(/^[a-f0-9]{64}$/) });

router.post('/signup', validateBody(signupBody), ...signupLimits, signup);
router.post('/login', validateBody(loginBody), ...loginLimits, login);
router.post('/refresh', rateLimit('refresh-ip', 30, 15 * 60_000), refreshToken);
router.post('/verify-email', rateLimit('verify-ip', 30, 15 * 60_000), validateBody(verificationBody), verifyEmail);
// Keep the token out of URLs, access logs, and caches. This is a read-only check.
router.post('/verify-email/status', rateLimit('verify-status-ip', 60, 15 * 60_000), validateBody(verificationBody), verificationStatus);
router.post('/logout', validateBody(emptyBody), authenticate, rateLimit('logout-user', 30, 60_000, req => req.user!.userId), logout);
router.get('/me', authenticate, rateLimit('session-user', 120, 60_000, req => req.user!.userId), me);

export default router;

