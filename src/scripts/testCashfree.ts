import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { createOrder, getOrderStatus } from '../services/cashfreeService.js';

// Works when launched from either the project root or backend directory.
dotenv.config({ path: resolve(__dirname, '../../.env'), quiet: true });

async function runTest() {
  if ((process.env.CASHFREE_ENV?.trim() || 'sandbox') !== 'sandbox') {
    throw new Error('This smoke test only runs with CASHFREE_ENV=sandbox.');
  }
  const orderId = `test_${randomUUID()}`;
  const response = await createOrder({
    order_id: orderId,
    order_amount: 10.50,
    order_currency: 'INR',
    customer_details: {
      customer_id: 'test_user_123',
      customer_phone: '9999999999',
      customer_email: 'test@example.com',
    },
  });
  assert.ok(response.payment_session_id, 'Cashfree did not return a payment_session_id');
  assert.equal(response.order_id, orderId);
  console.log('PASS: Sandbox order created with a non-empty payment_session_id.');
  const fetched = await getOrderStatus(orderId);
  assert.equal(fetched.order_id, orderId);
  assert.ok(fetched.order_status, 'Cashfree did not return an order status');
  console.log(`PASS: Sandbox order fetched; status=${fetched.order_status}.`);
}

runTest().catch((error: unknown) => {
  // Axios config contains authentication headers, so never dump the entire error.
  const apiError = error as {
    response?: { status?: number; data?: { code?: string; message?: string } };
    code?: string;
    message?: string;
  };
  console.error('Cashfree sandbox test failed:', {
    status: apiError.response?.status,
    code: apiError.response?.data?.code || apiError.code,
    message: apiError.response?.data?.message || apiError.message,
  });
  process.exitCode = 1;
});
