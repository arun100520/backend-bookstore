import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getLibrary, getDownloadUrl } from '../controllers/libraryController.js';

const router = Router();
router.use(authenticate);
router.get('/', getLibrary);
router.get('/:bookId/download-url', getDownloadUrl);
export default router;
