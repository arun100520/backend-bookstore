import { Request, Response, NextFunction } from 'express';
import Cart from '../models/Cart.js';
import Book from '../models/Book.js';
import Entitlement from '../models/Entitlement.js';
import { AppError } from '../middleware/errorHandler.js';

const cartBookPopulation = {
  path: 'items.book',
  select: 'title slug priceInPaise coverUrl authors isActive',
  // Keep the reference for removal when a book has been deleted.
  transform: (book: unknown, id: unknown) => book ?? { _id: id, title: 'Unavailable book', isActive: false },
};

/** Helper to get or create cart for user */
async function getCart(userId: string) {
  // Ownership is durable confirmation of fulfilment, including payments that
  // finish after the customer leaves checkout and older purchases.
  const ownedBooks = await Entitlement.find({ user: userId }).distinct('book');
  if (ownedBooks.length) {
    await Cart.updateOne({ user: userId }, { $pull: { items: { book: { $in: ownedBooks } } } });
  }
  let cart = await Cart.findOne({ user: userId }).populate(cartBookPopulation);
  if (!cart) {
    cart = await Cart.create({ user: userId, items: [] });
  }
  return cart;
}

// ── GET /api/cart ────────────────────────────────────────────────────────────
export async function getCartHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set('Cache-Control', 'no-store');
  try {
    const cart = await getCart(req.user!.userId);
    const total = await (Cart as any).calculateTotal(req.user!.userId);
    res.status(200).json({ data: cart, meta: { totalPriceInPaise: total } });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/cart/items ──────────────────────────────────────────────────────
export async function addItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { bookId, quantity = 1 } = req.body;
    
    if (!bookId) {
      throw new AppError(400, 'bookId is required');
    }

    const book = await Book.findById(bookId);
    if (!book || !book.isActive) {
      throw new AppError(404, 'Book not found or inactive');
    }

    let cart = await Cart.findOne({ user: req.user!.userId });
    if (!cart) {
      cart = new Cart({ user: req.user!.userId, items: [] });
    }

    const existingItemIndex = cart.items.findIndex((item) => item.book.toString() === bookId);
    if (existingItemIndex > -1) {
      if (cart.items[existingItemIndex].quantity + quantity > 1000) {
        throw new AppError(400, 'Validation failed', { quantity: 'Total quantity must not exceed 1000' });
      }
      cart.items[existingItemIndex].quantity += Number(quantity);
    } else {
      cart.items.push({ book: bookId, quantity: Number(quantity) });
    }

    await cart.save();
    
    cart = await cart.populate(cartBookPopulation);
    const total = await (Cart as any).calculateTotal(req.user!.userId);
    
    res.status(200).json({ data: cart, meta: { totalPriceInPaise: total } });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/cart/items/:bookId ─────────────────────────────────────────────
export async function updateItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { bookId } = req.params;
    const { quantity } = req.body;

    if (quantity === undefined || quantity < 1) {
      throw new AppError(400, 'quantity must be at least 1');
    }

    let cart = await Cart.findOne({ user: req.user!.userId });
    if (!cart) {
      throw new AppError(404, 'Cart not found');
    }

    const existingItem = cart.items.find((item) => item.book.toString() === bookId);
    if (!existingItem) {
      throw new AppError(404, 'Item not found in cart');
    }

    existingItem.quantity = Number(quantity);
    await cart.save();
    
    cart = await cart.populate(cartBookPopulation);
    const total = await (Cart as any).calculateTotal(req.user!.userId);
    
    res.status(200).json({ data: cart, meta: { totalPriceInPaise: total } });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /api/cart/items/:bookId ────────────────────────────────────────────
export async function removeItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { bookId } = req.params;

    let cart = await Cart.findOne({ user: req.user!.userId });
    if (!cart) {
      throw new AppError(404, 'Cart not found');
    }

    cart.items = cart.items.filter((item) => item.book.toString() !== bookId);
    await cart.save();
    
    cart = await cart.populate(cartBookPopulation);
    const total = await (Cart as any).calculateTotal(req.user!.userId);
    
    res.status(200).json({ data: cart, meta: { totalPriceInPaise: total } });
  } catch (err) {
    next(err);
  }
}
