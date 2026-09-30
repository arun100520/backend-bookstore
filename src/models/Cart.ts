import mongoose, { Document, Schema, Types, Model } from 'mongoose';

export interface ICartItem {
  _id?: Types.ObjectId;
  book: Types.ObjectId;
  quantity: number;
}

export interface ICart extends Document {
  user: Types.ObjectId;
  items: ICartItem[];
  createdAt: Date;
  updatedAt: Date;
}

// Extend Model to include static methods
interface CartModel extends Model<ICart> {
  calculateTotal(userId: Types.ObjectId | string): Promise<number>;
}

const cartItemSchema = new Schema<ICartItem>({
  book: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
  quantity: { type: Number, required: true, default: 1, min: 1 },
});

const cartSchema = new Schema<ICart, CartModel>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // One cart per user
    },
    items: {
      type: [cartItemSchema],
      default: [],
    },
  },
  { timestamps: true }
);

/**
 * Static method to calculate the total price in paise for a user's cart.
 * Populates the items array and sums the priceInPaise of each active book.
 */
cartSchema.statics.calculateTotal = async function (userId: Types.ObjectId | string): Promise<number> {
  const cart = await this.findOne({ user: userId }).populate('items.book', 'priceInPaise isActive');
  if (!cart) return 0;

  let total = 0;
  for (const item of cart.items as any[]) {
    // Only sum up books that are still active
    if (item.book && item.book.isActive && item.book.priceInPaise) {
      total += item.book.priceInPaise * item.quantity;
    }
  }

  return total;
};

const Cart = mongoose.model<ICart, CartModel>('Cart', cartSchema);
export default Cart;
