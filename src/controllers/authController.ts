import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import User from '../models/User.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  generateAccessToken,
  generateRefreshToken,
} from '../utils/jwt.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const BCRYPT_ROUNDS = 12;
const REFRESH_COOKIE = 'refreshToken';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Helpers ───────────────────────────────────────────────────────────────────
function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
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
    const user = await User.create({ name, email, passwordHash });

    const payload = { userId: String(user._id), role: user.role };
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);
    setRefreshCookie(res, refreshToken);

    res.status(201).json({ accessToken, user: safeUser(user) });
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
    if (!user) {
      throw new AppError(401, 'Invalid email or password');
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      throw new AppError(401, 'Invalid email or password');
    }

    const payload = { userId: String(user._id), role: user.role };
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);
    setRefreshCookie(res, refreshToken);

    res.status(200).json({ accessToken, user: safeUser(user) });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
export function logout(_req: Request, res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, sameSite: 'lax' });
  res.status(200).json({ message: 'Logged out successfully' });
}

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
// authenticate() middleware runs first (see authRoutes.ts) — req.user is guaranteed here
export async function me(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await User.findById(req.user!.userId).select('-passwordHash');
    if (!user) {
      throw new AppError(401, 'User no longer exists');
    }
    res.status(200).json({ user: safeUser(user) });
  } catch (err) {
    next(err);
  }
}
