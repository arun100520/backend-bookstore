import { validateBody, validateId, bookBody, bookPatch, emptyBody, validateUploads } from '../middleware/validate.js';
import { Router } from 'express';
import { createBook, updateBook, deleteBook, uploadBookFiles, listAdminBooks, getAdminBook } from '../controllers/adminBookController.js';
import { authenticate, isAdmin } from '../middleware/auth.js';
import { uploadBookFilesMiddleware } from '../middleware/upload.js';

const router = Router();

// All routes here are protected and require admin privileges
router.use(authenticate, isAdmin);
router.get('/', listAdminBooks);
router.get('/:id', getAdminBook);

router.post('/', validateBody(bookBody), createBook);
router.patch('/:id', validateId(), validateBody(bookPatch), updateBook);
router.delete('/:id', validateId(), validateBody(emptyBody), deleteBook);
router.post('/:id/upload', validateId(), uploadBookFilesMiddleware, validateBody(emptyBody), validateUploads, uploadBookFiles);

export default router;
