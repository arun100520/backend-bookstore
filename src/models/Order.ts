import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IOrderItem {
  cartItemId?: Types.ObjectId; // Exact cart line selected for this checkout
  book: Types.ObjectId;
  quantity: number;
  priceAtPurchase: number; // Snapshot of the price in paise at the time of order
}

export interface IOrder extends Document {
  user: Types.ObjectId;
  orderNumber: string;
  items: IOrderItem[];
  amountInPaise: number;
  currency: string;
  status: 'created' | 'paid' | 'failed' | 'refunded';
  cashfreeOrderId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const orderItemSchema = new Schema<IOrderItem>({
  cartItemId: { type: Schema.Types.ObjectId },
  book: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
  quantity: { type: Number, required: true, default: 1, min: 1 },
  priceAtPurchase: { type: Number, required: true },
});

const orderSchema = new Schema<IOrder>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    orderNumber: { type: String, required: true, unique: true },
    items: { type: [orderItemSchema], required: true },
    amountInPaise: { type: Number, required: true },
    currency: { type: String, required: true, default: 'INR' },
    status: {
      type: String,
      enum: ['created', 'paid', 'failed', 'refunded'],
      default: 'created',
    },
    cashfreeOrderId: { type: String }, // Merchant order_id, saved before calling Cashfree
  },
  { timestamps: true }
);

orderSchema.index({ status: 1, createdAt: 1 });
orderSchema.index({ user: 1, createdAt: -1, _id: -1 });
const Order = mongoose.model<IOrder>('Order', orderSchema);
export default Order;
