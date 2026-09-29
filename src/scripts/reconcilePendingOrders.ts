import dotenv from 'dotenv';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import PaymentEvent from '../models/PaymentEvent.js';
import Entitlement from '../models/Entitlement.js';
import { reconcilePendingOrders } from '../jobs/reconcilePendingOrders.js';

dotenv.config({ path: resolve(__dirname, '../../.env'), quiet: true });
async function run() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15_000 });
  await Promise.all([PaymentEvent.init(), Entitlement.init()]);
  const result = await reconcilePendingOrders({ orderId: process.argv[2] });
  console.log('Reconciliation finished:', result);
  if (result.failed) process.exitCode = 1;
}
run().catch(() => { console.error('Reconciliation failed; check configuration and connectivity.'); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
