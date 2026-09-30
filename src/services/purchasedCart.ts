import Cart from '../models/Cart.js';
import type { IOrder } from '../models/Order.js';

/** Call only after server-verified payment and successful fulfilment. */
export async function removePurchasedCartItems(order: Pick<IOrder, 'user' | 'items'>): Promise<void> {
  const purchased = order.items.filter(item => item.cartItemId).map(item => ({
    _id: item.cartItemId, book: item.book, quantity: item.quantity,
  }));
  // Older orders have no cart snapshot. Never guess which current lines they
  // purchased. Matching line IDs makes retries safe if a book is added again;
  // matching quantities preserves lines edited while payment was in progress.
  if (!purchased.length) return;
  await Cart.updateOne({ user: order.user }, { $pull: { items: { $or: purchased } } });
}
