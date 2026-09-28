import jwt from 'jsonwebtoken';

// ── Payload shape ─────────────────────────────────────────────────────────────
export interface JwtPayload {
  userId: string;
  role: string;
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
  return jwt.sign(payload, accessSecret(), {
    expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || '15m') as jwt.SignOptions['expiresIn'],
  });
}

export function generateRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, refreshSecret(), {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, accessSecret()) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, refreshSecret()) as JwtPayload;
}
