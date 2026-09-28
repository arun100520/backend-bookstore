import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IEntitlement extends Document {
  user: Types.ObjectId;
  book: Types.ObjectId;
  order: Types.ObjectId;
  grantedAt: Date;
}

const entitlementSchema = new Schema<IEntitlement>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    book: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    grantedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// Compound unique index to prevent granting the same book multiple times to a user
entitlementSchema.index({ user: 1, book: 1 }, { unique: true });

const Entitlement = mongoose.model<IEntitlement>('Entitlement', entitlementSchema);
export default Entitlement;
