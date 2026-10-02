import { validateBody, validateId, bookBody, bookPatch, emptyBody, validateUploads } from '../middleware/validate.js';
import { Router } from 'express';
import { createBook, updateBook, deleteBook, uploadBookFiles, listAdminBooks, getAdminBook } from '../controllers/adminBookController.js';
import { authenticate, isAdmin } from '../middleware/auth.js';
import { uploadBookFilesMiddleware } from '../middleware/upload.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();

// All routes here are protected and require admin privileges
router.use(authenticate, isAdmin);
router.get('/', listAdminBooks);
router.get('/:id', getAdminBook);

router.post('/', validateBody(bookBody), createBook);
router.patch('/:id', validateId(), validateBody(bookPatch), updateBook);
router.delete('/:id', validateId(), validateBody(emptyBody), deleteBook);
router.post('/:id/upload', validateId(), rateLimit('upload-user', 10, 60_000, req => req.user!.userId), uploadBookFilesMiddleware, validateBody(emptyBody), validateUploads, uploadBookFiles);

export default router;
