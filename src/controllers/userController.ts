import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import User from '../models/User.js';
import { AppError } from '../middleware/errorHandler.js';

const profileFields = '_id name email role avatarUrl createdAt updatedAt';
const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  avatarUrl: z.string().trim().max(2048).refine(value => {
    if (value === '') return true; // Empty string clears the avatar.
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  }, 'Use an HTTP(S) URL or an empty string to clear the avatar').optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'Provide name or avatarUrl');

export async function getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set('Cache-Control', 'no-store');
  try {
    const user = await User.findById(req.user!.userId).select(profileFields).lean();
    if (!user) throw new AppError(401, 'User no longer exists');
    res.status(200).json({ data: user });
  } catch (err) { next(err); }
}

export async function updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set('Cache-Control', 'no-store');
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0] ?? 'body'), issue.message]));
      throw new AppError(400, 'Validation failed', errors);
    }
    const user = await User.findByIdAndUpdate(req.user!.userId, { $set: parsed.data }, {
      returnDocument: 'after', runValidators: true,
    }).select(profileFields).lean();
    if (!user) throw new AppError(401, 'User no longer exists');
    res.status(200).json({ data: user });
  } catch (err) { next(err); }
}
