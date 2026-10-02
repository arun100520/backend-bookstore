import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IPaymentEvent extends Document {
  order: Types.ObjectId;
  cashfreeOrderId: string;
  cashfreeEventId: string;
  eventType: string;
  rawPayload: any;
  signatureVerified: boolean;
  source?: 'webhook' | 'reconciliation';
  processedAt?: Date;
  receivedAt: Date;
  refundId?: string;
  refundAmountInPaise?: number;
}

const paymentEventSchema = new Schema<IPaymentEvent>(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    cashfreeOrderId: { type: String, required: true },
    cashfreeEventId: { type: String, required: true, unique: true },
    eventType: { type: String, required: true },
    rawPayload: { type: Schema.Types.Mixed, required: true },
    signatureVerified: { type: Boolean, required: true },
    source: { type: String, enum: ['webhook', 'reconciliation'], default: 'webhook' },
    processedAt: { type: Date },
    receivedAt: { type: Date, default: Date.now },
    refundId: { type: String },
    refundAmountInPaise: { type: Number, min: 0 },
  },
  { timestamps: false } // Only receivedAt is needed, but we can enable timestamps if we want
);

// Status projection reads an order's complete event history.
paymentEventSchema.index({ order: 1 });
paymentEventSchema.index({ source: 1, processedAt: 1 });

const PaymentEvent = mongoose.model<IPaymentEvent>('PaymentEvent', paymentEventSchema);
export default PaymentEvent;
