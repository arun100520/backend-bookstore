import jwt from 'jsonwebtoken';

// ── Payload shape ─────────────────────────────────────────────────────────────
export interface JwtPayload {
  userId: string;
  role: string;
  tokenVersion?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function accessSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

function refreshSecret(): string {
  const s = process.env.JWT_REFRESH_SECRET;
  if (!s) throw new Error('JWT_REFRESH_SECRET is not set');
  return s;
}

export function generateAccessToken(payload: JwtPayload): string {
  return jwt.sign({ ...payload, tokenVersion: payload.tokenVersion ?? 0 }, accessSecret(), {
    algorithm: 'HS256', issuer: 'ebook-store', audience: 'ebook-store:access',
    expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || '15m') as jwt.SignOptions['expiresIn'],
  });
}

export function generateRefreshToken(payload: JwtPayload): string {
  return jwt.sign({ ...payload, tokenVersion: payload.tokenVersion ?? 0 }, refreshSecret(), {
    algorithm: 'HS256', issuer: 'ebook-store', audience: 'ebook-store:refresh',
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): JwtPayload {
  return checked(jwt.verify(token, accessSecret(), { algorithms: ['HS256'], issuer: 'ebook-store', audience: 'ebook-store:access' }));
}

export function verifyRefreshToken(token: string): JwtPayload {
  return checked(jwt.verify(token, refreshSecret(), { algorithms: ['HS256'], issuer: 'ebook-store', audience: 'ebook-store:refresh' }));
}

function checked(value: string | jwt.JwtPayload): JwtPayload {
  if (typeof value === 'string' || !/^[a-f0-9]{24}$/i.test(value.userId) ||
      !['user', 'admin'].includes(value.role) || !Number.isSafeInteger(value.tokenVersion) ||
      value.tokenVersion < 0 || !Number.isFinite(value.exp)) throw new Error('Invalid token claims');
  return value as JwtPayload;
}
