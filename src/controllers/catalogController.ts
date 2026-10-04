import { Request, Response, NextFunction } from 'express';
import Book from '../models/Book.js';
import Category from '../models/Category.js';
import Genre from '../models/Genre.js';
import Language from '../models/Language.js';
import { AppError } from '../middleware/errorHandler.js';
import { z } from 'zod';
import { objectId } from '../middleware/validate.js';

const positiveInteger = (fallback: string, max: number) => z.string().regex(/^[1-9]\d*$/).default(fallback)
  .transform(Number).pipe(z.number().int().max(max));
const price = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().safe()).optional();
const searchText = z.string().trim().max(200).optional();
const catalogQuery = z.strictObject({
  category: objectId.optional(), genre: objectId.optional(), language: objectId.optional(),
  minPrice: price, maxPrice: price, q: searchText,
  page: positiveInteger('1', 1001), limit: positiveInteger('20', 100),
}).refine(input => (input.page - 1) * input.limit <= 10_000, 'Maximum offset is 10000')
  .refine(input => input.minPrice === undefined || input.maxPrice === undefined || input.minPrice <= input.maxPrice, 'Invalid price range');
const searchQuery = z.strictObject({ q: searchText, limit: positiveInteger('10', 100) });

// Cursor pagination avoids the public catalog's 10,000-result offset cap.
// Only public URL metadata is returned, never download locations.
export async function getSitemapBooks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { after } = z.strictObject({ after: objectId.optional() }).parse(req.query);
    const books = await Book.find({ isActive: true, ...(after ? { _id: { $gt: after } } : {}) })
      .select('_id slug updatedAt').sort({ _id: 1 }).limit(1001).maxTimeMS(5000).lean();
    const data = books.slice(0, 1000);
    res.json({
      data: data.map(book => ({ slug: book.slug, updatedAt: book.updatedAt })),
      meta: { nextCursor: books.length > 1000 ? String(data[data.length - 1]._id) : null },
    });
  } catch (error) { next(error); }
}

// ── GET /api/books ────────────────────────────────────────────────────────────
export async function getBooks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { category, genre, language, minPrice, maxPrice, q, page: pageNum, limit: limitNum } = catalogQuery.parse(req.query);

    const query: any = { isActive: true };

    if (q) {
      query.$text = { $search: String(q) };
    }
    if (category) query.categoryIds = category;
    if (genre) query.genreIds = genre;
    if (language) query.language = language;

    if (minPrice !== undefined || maxPrice !== undefined) {
      query.priceInPaise = {};
      if (minPrice !== undefined) query.priceInPaise.$gte = minPrice;
      if (maxPrice !== undefined) query.priceInPaise.$lte = maxPrice;
    }

    const skip = (pageNum - 1) * limitNum;

    // Use projection to omit pdfUrl so it doesn't leak unless purchased
    const [books, total] = await Promise.all([
      Book.find(query).maxTimeMS(3000)
        .select('-pdfUrl')
        .populate('categoryIds', 'name slug')
        .populate('genreIds', 'name slug')
        .populate('language', 'name slug')
        .skip(skip)
        .limit(limitNum)
        .sort(q ? { score: { $meta: 'textScore' }, _id: -1 } : { createdAt: -1, _id: -1 }),
      Book.countDocuments(query).maxTimeMS(3000),
    ]);

    res.status(200).json({
      data: books,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/books/:slug ──────────────────────────────────────────────────────
export async function getBookBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const book = await Book.findOne({ slug: req.params.slug, isActive: true })
      .select('-pdfUrl')
      .populate('categoryIds', 'name slug')
      .populate('genreIds', 'name slug')
      .populate('language', 'name slug');

    if (!book) {
      throw new AppError(404, 'Book not found');
    }

    res.status(200).json({ data: book });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/categories ───────────────────────────────────────────────────────
export async function getCategories(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const categories = await Category.find().sort({ name: 1 });
    res.status(200).json({ data: categories });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/genres ───────────────────────────────────────────────────────────
export async function getGenres(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const genres = await Genre.find().sort({ name: 1 });
    res.status(200).json({ data: genres });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/languages ────────────────────────────────────────────────────────
export async function getLanguages(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const languages = await Language.find().sort({ name: 1 });
    res.status(200).json({ data: languages });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/search?q= ────────────────────────────────────────────────────────
export async function searchBooks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { q, limit: limitNum } = searchQuery.parse(req.query);

    if (!q) {
      res.status(200).json({ data: [] });
      return;
    }

    const books = await Book.find({ isActive: true, $text: { $search: String(q) } })
      .maxTimeMS(3000)
      .select('title slug coverUrl authors priceInPaise')
      .limit(limitNum)
      .sort({ score: { $meta: 'textScore' } });

    res.status(200).json({ data: books });
  } catch (err) {
    next(err);
  }
}
