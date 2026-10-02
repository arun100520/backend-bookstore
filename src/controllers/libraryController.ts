import type { Request, Response, NextFunction } from 'express';
import { isObjectIdOrHexString } from 'mongoose';
import Entitlement from '../models/Entitlement.js';
import Book from '../models/Book.js';
import Order from '../models/Order.js';
import { AppError } from '../middleware/errorHandler.js';
import { generateSignedPdfUrl, pdfPublicIdFromUrl } from '../services/cloudinaryService.js';

export async function getLibrary(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set('Cache-Control', 'no-store');
  try {
    const paidBooks = await Order.distinct('items.book', { user: req.user!.userId, status: 'paid' });
    const entries = await Entitlement.find({ user: req.user!.userId, book: { $in: paidBooks } })
      .select('_id book grantedAt').sort({ grantedAt: -1, _id: -1 })
      .populate('book', '_id title slug authors coverUrl description').lean();
    // Deleted books have no deliverable library entry. Inactive purchased books remain accessible.
    res.status(200).json({ data: entries.filter(entry => entry.book !== null) });
  } catch (err) { next(err); }
}

export async function getDownloadUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set('Cache-Control', 'no-store');
  try {
    if (!isObjectIdOrHexString(req.params.bookId)) throw new AppError(400, 'Invalid book ID');
    const entitled = await Entitlement.exists({ user: req.user!.userId, book: req.params.bookId });
    if (!entitled) throw new AppError(403, 'You do not own this book');
    // Entitlements are a fulfilment record, not the authority for access. A
    // stale/replayed grant cannot override a refund. Any other paid purchase
    // preserves access, including repurchases of the same title.
    const paid = await Order.exists({ user: req.user!.userId, status: 'paid', 'items.book': req.params.bookId });
    if (!paid) throw new AppError(403, 'You do not have an active purchase for this book');
    const book = await Book.findById(req.params.bookId).select('pdfUrl').lean();
    if (!book || !book.pdfUrl) throw new AppError(404, 'PDF is not available');
    let url: string;
    try { url = generateSignedPdfUrl(pdfPublicIdFromUrl(book.pdfUrl)); }
    catch { throw new AppError(503, 'PDF download is temporarily unavailable'); }
    const expiresAt = Number(new URL(url).searchParams.get('expires_at'));
    res.status(200).json({ data: { url, expiresAt: new Date(expiresAt * 1000).toISOString() } });
  } catch (err) { next(err); }
}
