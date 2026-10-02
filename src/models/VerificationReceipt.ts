import mongoose, { Schema } from 'mongoose';

// A completed link is a status receipt, never a credential. Retain only its
// digest so reopening it works after the pending registration's TTL expires.
const schema = new Schema({
  tokenHash: { type: String, required: true, unique: true },
  verifiedAt: { type: Date, required: true, default: Date.now },
});

export default mongoose.model('VerificationReceipt', schema);
