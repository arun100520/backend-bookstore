import type { RequestHandler } from 'express';
import { isIP } from 'node:net';

export function trustedProxies(env = process.env): string[] | false {
  const values = env.TRUSTED_PROXY_CIDRS?.split(',').map(value => value.trim()).filter(Boolean);
  if (!values?.length) return false;
  for (const value of values) {
    const [address, mask, extra] = value.split('/');
    const family = isIP(address);
    if (!family || extra || (mask !== undefined && (!/^\d+$/.test(mask) || Number(mask) < 1 || Number(mask) > (family === 4 ? 32 : 128)))) {
      throw new Error('TRUSTED_PROXY_CIDRS must contain explicit proxy IPs or nonzero CIDRs');
    }
  }
  return values;
}
export function validateProductionConfig(env = process.env): void {
  if (!['development', 'test', 'production'].includes(env.NODE_ENV || 'development')) throw new Error('Invalid NODE_ENV');
  trustedProxies(env);
  if (env.NODE_ENV !== 'production') return;
  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    if (!env[key] || Buffer.byteLength(env[key]!) < 32 || /change.?me|replace|example|your[_-]/i.test(env[key]!)) throw new Error(`Configure a strong ${key}`);
  }
  if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) throw new Error('JWT secrets must be different');
  for (const key of ['MONGO_URI', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY', 'RESEND_API_KEY', 'MAIL_FROM']) {
    if (!env[key]) throw new Error(`Configure ${key} before starting production`);
  }
  const client = new URL(env.CLIENT_URL || '');
  if (client.protocol !== 'https:' || client.username || client.password || client.pathname !== '/' || client.search || client.hash) throw new Error('CLIENT_URL must be an HTTPS origin');
  if (env.CASHFREE_ENV !== 'production') throw new Error('Production requires CASHFREE_ENV=production');
  const lifetime = env.JWT_ACCESS_EXPIRES_IN || '15m';
  if (!/^(?:[1-9]|[1-5]\d|60)s$|^(?:[1-9]|1[0-5])m$/.test(lifetime)) throw new Error('Access token lifetime must be at most 15 minutes (s or m units)');
}
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
  if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
};
