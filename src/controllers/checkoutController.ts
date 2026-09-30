import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import Cart from '../models/Cart.js';
import Book from '../models/Book.js';
import User from '../models/User.js';
import Order, { type IOrderItem } from '../models/Order.js';
import { AppError } from '../middleware/errorHandler.js';
import { createOrder } from '../services/cashfreeService.js';

const checkoutSchema = z.object({
  customerPhone: z.string().trim().regex(/^(?:\d{10}|\+[1-9]\d{7,14})$/,
    'Use a 10-digit phone number or an international number starting with +'),
});

export async function createCheckoutOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = checkoutSchema.safeParse(req.body);
    if (!input.success) {
      throw input.error;
    }

    const clientUrl = new URL(process.env.CLIENT_URL || 'http://localhost:5173');
    if (!['http:', 'https:'].includes(clientUrl.protocol)) throw new AppError(500, 'Checkout return URL is not configured');

    const userId = req.user!.userId;
    const user = await User.findById(userId).select('name email');
    if (!user) throw new AppError(401, 'User no longer exists');
    const cart = await Cart.findOne({ user: userId });
    if (!cart || cart.items.length === 0) throw new AppError(400, 'Your cart is empty');

    const books = await Book.find({ _id: { $in: cart.items.map((item) => item.book) } })
      .select('priceInPaise isActive');
    const byId = new Map(books.map((book) => [String(book._id), book]));
    let amountInPaise = 0;
    const items: IOrderItem[] = cart.items.map((item) => {
      const book = byId.get(String(item.book));
      if (!book || !book.isActive) {
        throw new AppError(409, 'A book in your cart is no longer available. Update your cart before checkout.');
      }
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
        throw new AppError(400, 'Cart quantities must be positive whole numbers');
      }
      if (!Number.isSafeInteger(book.priceInPaise) || book.priceInPaise < 0) {
        throw new AppError(409, 'A book in your cart has an invalid price');
      }
      amountInPaise += book.priceInPaise * item.quantity;
      if (!Number.isSafeInteger(amountInPaise)) throw new AppError(400, 'Cart total is too large');
      return { cartItemId: item._id, book: item.book, quantity: item.quantity, priceAtPurchase: book.priceInPaise };
    });
    if (amountInPaise < 100) throw new AppError(400, 'Cashfree checkout requires a total of at least INR 1');

    const orderNumber = `ebook_${randomUUID()}`;
    // Persist the merchant order_id before the network request so ambiguous failures
    // can be reconciled later. Cashfree's numeric cf_order_id is a different field.
    const order = await Order.create({
      user: userId, orderNumber, items, amountInPaise,
      currency: 'INR', status: 'created', cashfreeOrderId: orderNumber,
    });

    let payment;
    try {
      payment = await createOrder({
        order_id: order.cashfreeOrderId,
        order_amount: amountInPaise / 100,
        order_currency: order.currency,
        order_meta: {
          return_url: new URL(`/checkout/return?orderId=${order._id}`, clientUrl).toString(),
        },
        customer_details: {
          customer_id: userId,
          customer_phone: input.data.customerPhone,
          customer_email: user.email,
          customer_name: user.name,
        },
      });
      if (payment.order_id !== order.cashfreeOrderId ||
          typeof payment.payment_session_id !== 'string' || !payment.payment_session_id.trim()) {
        throw new Error('Invalid Cashfree order response');
      }
    } catch (error: unknown) {
      // A timeout does not establish payment failure. Keep the order and cart;
      // task 3.8 will reconcile orders using the saved merchant order_id.
      // Do not pass SDK errors to errorHandler: Axios config contains API secrets.
      const failure = error as {
        code?: string; message?: string;
        response?: { status?: number; data?: { code?: string; message?: string } };
      };
      console.warn('[checkout] Cashfree order creation failed', {
        orderNumber,
        status: failure.response?.status,
        code: failure.response?.data?.code || failure.code,
        message: failure.response?.data?.message || failure.message,
      });
      throw new AppError(502, `Could not initialize payment for order ${orderNumber}. Please try again later.`);
    }

    res.status(201).json({ data: {
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      cashfreeOrderId: order.cashfreeOrderId,
      amountInPaise: order.amountInPaise,
      currency: order.currency,
      status: order.status,
      payment_session_id: payment.payment_session_id,
      paymentMode: process.env.CASHFREE_ENV?.trim() || 'sandbox',
    } });
  } catch (err) {
    next(err);
  }
}
