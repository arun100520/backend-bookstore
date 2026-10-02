import { Cashfree, CFEnvironment, type CreateOrderRequest } from 'cashfree-pg';
import { createHmac, timingSafeEqual } from 'crypto';

export type CreateOrderParams = CreateOrderRequest;

function getClient(): Cashfree {
  // Read at call time: dotenv may run after this module is imported.
  const appId = process.env.CASHFREE_APP_ID?.trim();
  const secret = process.env.CASHFREE_SECRET_KEY?.trim();
  const environment = process.env.CASHFREE_ENV?.trim() || 'sandbox';
  if (!appId || !secret) {
    throw new Error('Set CASHFREE_APP_ID and CASHFREE_SECRET_KEY in backend/.env.');
  }
  if (environment !== 'sandbox' && environment !== 'production') {
    throw new Error('CASHFREE_ENV must be sandbox or production.');
  }
  // SDK v5+ uses an instance. Pin the API contract independently of SDK updates:
  // sandbox creation returned request_failed with v6's 2026-01-01 default.
  const client = new Cashfree(
    environment === 'production' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX,
    appId, secret, undefined, undefined, undefined,
    false, // Disable optional SDK error telemetry.
  );
  client.XApiVersion = '2025-01-01';
  return client;
}

/** Amounts passed to Cashfree are in rupees, not the database's paise. */
export async function createOrder(params: CreateOrderParams) {
  const providerKey = params.order_id?.startsWith('ebook_') ? params.order_id.slice(6) : undefined;
  const response = await getClient().PGCreateOrder(params, undefined, providerKey, { timeout: 15_000 });
  return response.data;
}

/** Pass the merchant order_id used in createOrder, not Cashfree's cf_order_id. */
export async function getOrderStatus(orderId: string) {
  const response = await getClient().PGFetchOrder(orderId, undefined, undefined, { timeout: 15_000 });
  return response.data;
}

/** Verify the original request bytes; never pass JSON.stringify(req.body). */
export function verifyWebhookSignature(
  signature: string,
  timestamp: string,
  rawBody: string | Buffer,
): boolean {
  const secret = process.env.CASHFREE_SECRET_KEY?.trim();
  if (!secret || !signature || !timestamp) return false;
  try {
    const expected = createHmac('sha256', secret).update(timestamp).update(rawBody).digest('base64');
    const receivedBytes = Buffer.from(signature, 'utf8');
    const expectedBytes = Buffer.from(expected, 'utf8');
    return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
  } catch {
    return false;
  }
}
