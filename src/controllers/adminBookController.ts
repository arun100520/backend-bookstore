import { Request, Response, NextFunction } from 'express';
import Book from '../models/Book.js';
import { AppError } from '../middleware/errorHandler.js';
import { uploadCoverImage, uploadPdf } from '../services/cloudinaryService.js';
import { isObjectIdOrHexString } from 'mongoose';
import { z } from 'zod';

const listSchema = z.object({
  page: z.string().regex(/^[1-9]\d*$/).default('1').transform(Number).pipe(z.number().max(1_000_000)),
  limit: z.string().regex(/^[1-9]\d*$/).default('20').transform(Number).pipe(z.number().max(100)),
  q: z.string().trim().max(200).default(''),
  status: z.enum(['all', 'published', 'draft']).default('all'),
});

export async function listAdminBooks(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set('Cache-Control', 'no-store');
  try {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(400, 'Invalid book filters or pagination');
    const { page, limit, q, status } = parsed.data;
    const filter: Record<string, unknown> = {};
    if (status !== 'all') filter.isActive = status === 'published';
    if (q) {
      const literal = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ title: { $regex: literal, $options: 'i' } }, { authors: { $regex: literal, $options: 'i' } }];
    }
    const [books, total] = await Promise.all([
      Book.find(filter).select('_id title slug authors priceInPaise coverUrl isActive').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Book.countDocuments(filter),
    ]);
    res.json({ data: books, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
}

export async function getAdminBook(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set('Cache-Control', 'no-store');
  try {
    if (!isObjectIdOrHexString(req.params.id)) throw new AppError(400, 'Invalid book ID');
    const book = await Book.findById(req.params.id).lean();
    if (!book) throw new AppError(404, 'Book not found');
    res.json({ book });
  } catch (err) { next(err); }
}

export async function createBook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const book = await Book.create(req.body);
    res.status(201).json({ book });
  } catch (err) {
    next(err);
  }
}

export async function updateBook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const book = await Book.findByIdAndUpdate(req.params.id, { $set: req.body }, {
      new: true,
      runValidators: true,
    });
    if (!book) {
      throw new AppError(404, 'Book not found');
    }
    res.status(200).json({ book });
  } catch (err) {
    next(err);
  }
}

export async function deleteBook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const book = await Book.findByIdAndDelete(req.params.id);
    if (!book) {
      throw new AppError(404, 'Book not found');
    }
    res.status(200).json({ message: 'Book deleted successfully' });
  } catch (err) {
    next(err);
  }
}

export async function uploadBookFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const bookId = req.params.id;
    const book = await Book.findById(bookId);

    if (!book) {
      throw new AppError(404, 'Book not found');
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    if (!files || (!files['cover'] && !files['pdf'])) {
      throw new AppError(400, 'No files provided');
    }

    let coverUrl = book.coverUrl;
    let pdfUrl = book.pdfUrl;

    if (files['cover'] && files['cover'].length > 0) {
      const coverResult = await uploadCoverImage(files['cover'][0].buffer, `book-${bookId}-cover`);
      coverUrl = coverResult.url;
    }

    if (files['pdf'] && files['pdf'].length > 0) {
      const pdfResult = await uploadPdf(files['pdf'][0].buffer, `book-${bookId}-pdf`);
      pdfUrl = pdfResult.url;
    }

    book.coverUrl = coverUrl;
    book.pdfUrl = pdfUrl;
    await book.save();

    res.status(200).json({ message: 'Files uploaded successfully', book });
  } catch (err) {
    next(err);
  }
}
