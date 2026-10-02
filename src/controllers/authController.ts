import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { registration, registrationMessage } from '../services/registration.js';
import { sessions } from '../services/sessions.js';
import User from '../models/User.js';
import { AppError } from '../middleware/errorHandler.js';
import { refreshCookieOptions } from '../config/authCookies.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../utils/jwt.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const BCRYPT_ROUNDS = 12;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
const REFRESH_COOKIE = 'refreshToken';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Helpers ───────────────────────────────────────────────────────────────────
function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...refreshCookieOptions(),
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

function safeUser(user: InstanceType<typeof User>) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
  };
}

// ── POST /api/auth/signup ─────────────────────────────────────────────────────
export async function signup(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { name, email, password } = req.body as {
      name?: string;
      email?: string;
      password?: string;
    };

    if (!name || !email || !password) {
      throw new AppError(400, 'name, email and password are required');
    }
    if (password.length < 8) {
      throw new AppError(400, 'Password must be at least 8 characters');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await registration.start({ name, email, passwordHash });
    res.set('Cache-Control', 'no-store');
    res.status(202).json({ message: registrationMessage });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────
export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      throw new AppError(400, 'email and password are required');
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    const match = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !match) {
      throw new AppError(401, 'Invalid email or password');
    }

    const payload = { userId: String(user._id), role: user.role, tokenVersion: user.tokenVersion ?? 0 };
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);
    setRefreshCookie(res, refreshToken);

    res.set('Cache-Control', 'no-store');
    res.status(200).json({ accessToken, user: safeUser(user) });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await sessions.revokeAll(req.user!.userId);
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ message: 'Logged out on all devices' });
  } catch (error) { next(error); }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await registration.complete(req.body.token);
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'verified', message: 'Email verified. You can now sign in with your password.' });
  } catch (error) { next(error); }
}

export async function verificationStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ status: await registration.status(req.body.token) });
  } catch (error) { next(error); }
}

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
// authenticate() middleware runs first (see authRoutes.ts) — req.user is guaranteed here
export async function me(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.set('Cache-Control', 'no-store');
    const user = await User.findById(req.user!.userId).select('-passwordHash');
    if (!user) {
      throw new AppError(401, 'User no longer exists');
    }
    res.status(200).json({ user: safeUser(user) });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
// Reads the httpOnly refresh cookie and issues a new short-lived access token.
export async function refreshToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.set('Cache-Control', 'no-store');
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) throw new AppError(401, 'Refresh token required');

    let payload;
    try { payload = verifyRefreshToken(token); }
    catch { throw new AppError(401, 'Invalid or expired refresh token'); }

    // Reject revoked sessions — tokenVersion is incremented on logout.
    const user = await sessions.currentUser(payload.userId);
    if (!user || payload.tokenVersion !== (user.tokenVersion ?? 0)) {
      throw new AppError(401, 'Session has been revoked');
    }

    const accessToken = generateAccessToken({ userId: payload.userId, role: user.role, tokenVersion: user.tokenVersion ?? 0 });
    res.status(200).json({ accessToken });
  } catch (err) {
    next(err);
  }
}
