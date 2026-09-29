import { Request, Response, NextFunction } from 'express';
import Book from '../models/Book.js';
import Category from '../models/Category.js';
import Genre from '../models/Genre.js';
import Order from '../models/Order.js';

// Explicit public fields: never expose PDFs or order/customer information.
const publicBook = {
  _id: 1, title: 1, slug: 1, authors: 1, description: 1,
  priceInPaise: 1, coverUrl: 1, ratingAvg: 1,
};

export async function getHome(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [catalog, bestsellers, categories, genres] = await Promise.all([
      Book.aggregate([
        { $match: { isActive: true } },
        { $facet: {
          featured: [{ $sort: { ratingAvg: -1, createdAt: -1, _id: 1 } }, { $limit: 4 }, { $project: publicBook }],
          newReleases: [
            { $addFields: { releaseDate: { $ifNull: ['$publishedAt', '$createdAt'] } } },
            { $sort: { releaseDate: -1, _id: 1 } }, { $limit: 4 }, { $project: publicBook },
          ],
          genreCounts: [{ $unwind: '$genreIds' }, { $group: { _id: '$genreIds', count: { $sum: 1 } } }],
          categoryCounts: [{ $unwind: '$categoryIds' }, { $group: { _id: '$categoryIds', count: { $sum: 1 } } }],
          total: [{ $count: 'count' }],
        } },
      ]),
      Order.aggregate([
        { $match: { status: 'paid' } },
        { $unwind: '$items' },
        { $group: { _id: '$items.book', quantity: { $sum: '$items.quantity' } } },
        { $sort: { quantity: -1, _id: 1 } },
        { $lookup: { from: Book.collection.name, localField: '_id', foreignField: '_id', as: 'book' } },
        { $unwind: '$book' },
        { $match: { 'book.isActive': true } },
        { $limit: 4 },
        { $replaceRoot: { newRoot: '$book' } },
        { $project: publicBook },
      ]),
      Category.find().select('_id name slug').sort({ name: 1 }).lean(),
      Genre.find().select('_id name slug').lean(),
    ]);
    const data = catalog[0];
    const counts = (rows: { _id: unknown; count: number }[]) => new Map(rows.map(row => [String(row._id), row.count]));
    const genreCounts = counts(data.genreCounts);
    const categoryCounts = counts(data.categoryCounts);
    res.json({ data: {
      hero: data.featured[0] ?? null,
      totalBooks: data.total[0]?.count ?? 0,
      featured: data.featured,
      newReleases: data.newReleases,
      bestsellers,
      topGenres: genres.map(genre => ({ ...genre, bookCount: genreCounts.get(String(genre._id)) ?? 0 }))
        .filter(genre => genre.bookCount > 0)
        .sort((a, b) => b.bookCount - a.bookCount || a.name.localeCompare(b.name)).slice(0, 6),
      categories: categories.map(category => ({ ...category, bookCount: categoryCounts.get(String(category._id)) ?? 0 })),
    } });
  } catch (error) { next(error); }
}
