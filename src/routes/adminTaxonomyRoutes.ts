import { Router } from 'express';
import {
  createCategory, updateCategory, deleteCategory,
  createGenre, updateGenre, deleteGenre,
  createLanguage, updateLanguage, deleteLanguage
} from '../controllers/adminTaxonomyController.js';
import { authenticate, isAdmin } from '../middleware/auth.js';

const router = Router();

// All routes here are protected and require admin privileges
router.use(authenticate, isAdmin);

// ── Categories ────────────────────────────────────────────────────────────────
router.post('/categories', createCategory);
router.patch('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);

// ── Genres ────────────────────────────────────────────────────────────────────
router.post('/genres', createGenre);
router.patch('/genres/:id', updateGenre);
router.delete('/genres/:id', deleteGenre);

// ── Languages ─────────────────────────────────────────────────────────────────
router.post('/languages', createLanguage);
router.patch('/languages/:id', updateLanguage);
router.delete('/languages/:id', deleteLanguage);

export default router;
