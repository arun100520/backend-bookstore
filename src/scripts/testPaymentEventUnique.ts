import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables before doing anything else
dotenv.config({ path: resolve(process.cwd(), '.env') });

import { connectDB } from '../config/db.js';
import PaymentEvent from '../models/PaymentEvent.js';

async function runTest() {
  try {
    console.log('🌱 Connecting to DB for PaymentEvent unique index test...');
    await connectDB();

    // Ensure indexes are built
    await PaymentEvent.init();

    const testEventId = `test_event_${Date.now()}`;
    const dummyOrderId = new mongoose.Types.ObjectId();

    console.log('1️⃣ Inserting first PaymentEvent...');
    await PaymentEvent.create({
      order: dummyOrderId,
      cashfreeOrderId: 'order_123',
      cashfreeEventId: testEventId,
      eventType: 'PAYMENT_SUCCESS',
      rawPayload: { test: true },
      signatureVerified: true,
    });
    console.log('✅ First insert successful.');

    console.log('2️⃣ Attempting duplicate insert with same cashfreeEventId...');
    try {
      await PaymentEvent.create({
        order: dummyOrderId,
        cashfreeOrderId: 'order_123',
        cashfreeEventId: testEventId,
        eventType: 'PAYMENT_SUCCESS',
        rawPayload: { test: true },
        signatureVerified: true,
      });
      console.error('❌ Duplicate insert succeeded! Unique index is NOT working.');
      process.exit(1);
    } catch (err: any) {
      if (err.code === 11000) {
        console.log('✅ Duplicate insert correctly rejected with Mongo error 11000.');
      } else {
        console.error('❌ Duplicate insert failed, but with unexpected error:', err);
        process.exit(1);
      }
    }

    console.log('🧹 Cleaning up test data...');
    await PaymentEvent.deleteMany({ cashfreeEventId: testEventId });

    console.log('🎉 Test passed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed unexpectedly:', err);
    process.exit(1);
  }
}

runTest();
