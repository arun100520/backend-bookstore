import { Router } from 'express';
import { createBook, updateBook, deleteBook, uploadBookFiles, listAdminBooks, getAdminBook } from '../controllers/adminBookController.js';
import { authenticate, isAdmin } from '../middleware/auth.js';
import { uploadBookFilesMiddleware } from '../middleware/upload.js';

const router = Router();

// All routes here are protected and require admin privileges
router.use(authenticate, isAdmin);
router.get('/', listAdminBooks);
router.get('/:id', getAdminBook);

router.post('/', createBook);
router.patch('/:id', updateBook);
router.delete('/:id', deleteBook);
router.post('/:id/upload', uploadBookFilesMiddleware, uploadBookFiles);

export default router;
