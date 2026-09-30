import { validateBody, validateId, taxonomyBody, taxonomyPatch, emptyBody } from '../middleware/validate.js';
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
router.post('/categories', validateBody(taxonomyBody), createCategory);
router.patch('/categories/:id', validateId(), validateBody(taxonomyPatch), updateCategory);
router.delete('/categories/:id', validateId(), validateBody(emptyBody), deleteCategory);

// ── Genres ────────────────────────────────────────────────────────────────────
router.post('/genres', validateBody(taxonomyBody), createGenre);
router.patch('/genres/:id', validateId(), validateBody(taxonomyPatch), updateGenre);
router.delete('/genres/:id', validateId(), validateBody(emptyBody), deleteGenre);

// ── Languages ─────────────────────────────────────────────────────────────────
router.post('/languages', validateBody(taxonomyBody), createLanguage);
router.patch('/languages/:id', validateId(), validateBody(taxonomyPatch), updateLanguage);
router.delete('/languages/:id', validateId(), validateBody(emptyBody), deleteLanguage);

export default router;
