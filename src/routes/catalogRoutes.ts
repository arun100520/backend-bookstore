import { Router } from 'express';
import { publicLimit } from '../middleware/rateLimit.js';
import { getHome } from '../controllers/homeController.js';
import {
  getBooks,
  getBookBySlug,
  getCategories,
  getGenres,
  getLanguages,
  searchBooks,
  getSitemapBooks,
} from '../controllers/catalogController.js';

const router = Router();

// Public routes
router.get('/home', publicLimit, getHome);
router.get('/sitemap/books', publicLimit, getSitemapBooks);
router.get('/books', publicLimit, getBooks);
router.get('/books/:slug', publicLimit, getBookBySlug);
router.get('/categories', publicLimit, getCategories);
router.get('/genres', publicLimit, getGenres);
router.get('/languages', publicLimit, getLanguages);
router.get('/search', publicLimit, searchBooks);

export default router;
