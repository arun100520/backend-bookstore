import { Request, Response, NextFunction } from 'express';
import Book from '../models/Book.js';
import Category from '../models/Category.js';
import Genre from '../models/Genre.js';
import Language from '../models/Language.js';
import { AppError } from '../middleware/errorHandler.js';

// ── GET /api/books ────────────────────────────────────────────────────────────
export async function getBooks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { category, genre, language, minPrice, maxPrice, q, page = '1', limit = '20' } = req.query;

    const query: any = { isActive: true };

    if (q) {
      query.$text = { $search: String(q) };
    }
    if (category) query.categoryIds = category;
    if (genre) query.genreIds = genre;
    if (language) query.language = language;

    if (minPrice || maxPrice) {
      query.priceInPaise = {};
      if (minPrice) query.priceInPaise.$gte = Number(minPrice);
      if (maxPrice) query.priceInPaise.$lte = Number(maxPrice);
    }

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.max(1, parseInt(String(limit), 10) || 20);
    const skip = (pageNum - 1) * limitNum;

    // Use projection to omit pdfUrl so it doesn't leak unless purchased
    const [books, total] = await Promise.all([
      Book.find(query)
        .select('-pdfUrl')
        .populate('categoryIds', 'name slug')
        .populate('genreIds', 'name slug')
        .populate('language', 'name slug')
        .skip(skip)
        .limit(limitNum)
        .sort(q ? { score: { $meta: 'textScore' }, _id: -1 } : { createdAt: -1, _id: -1 }),
      Book.countDocuments(query),
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
    const { q, limit = '10' } = req.query;

    if (!q) {
      res.status(200).json({ data: [] });
      return;
    }

    const limitNum = Math.max(1, parseInt(String(limit), 10) || 10);

    const books = await Book.find({ isActive: true, $text: { $search: String(q) } })
      .select('title slug coverUrl authors priceInPaise')
      .limit(limitNum)
      .sort({ score: { $meta: 'textScore' } });

    res.status(200).json({ data: books });
  } catch (err) {
    next(err);
  }
}
