import { Router } from 'express';
import { getHome } from '../controllers/homeController.js';
import {
  getBooks,
  getBookBySlug,
  getCategories,
  getGenres,
  getLanguages,
  searchBooks,
} from '../controllers/catalogController.js';

const router = Router();

// Public routes
router.get('/home', getHome);
router.get('/books', getBooks);
router.get('/books/:slug', getBookBySlug);
router.get('/categories', getCategories);
router.get('/genres', getGenres);
router.get('/languages', getLanguages);
router.get('/search', searchBooks);

export default router;
