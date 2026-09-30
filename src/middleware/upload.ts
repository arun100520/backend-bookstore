import multer, { FileFilterCallback } from 'multer';
import { Request, type RequestHandler } from 'express';
import { AppError } from './errorHandler.js';

// ── Limits ────────────────────────────────────────────────────────────────────
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;  // 5 MB
const MAX_PDF_SIZE   = 50 * 1024 * 1024; // 50 MB

// ── File filters ──────────────────────────────────────────────────────────────
function imageFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
): void {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (jpeg, png, webp …)'));
  }
}

function pdfFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
): void {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are allowed'));
  }
}

// ── Multer instances ──────────────────────────────────────────────────────────
/**
 * Use for cover image uploads.
 * Field name: "cover"
 * After this middleware runs, read from req.file.buffer and pass to uploadCoverImage().
 */
export const uploadCoverMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: imageFilter,
}).single('cover');

/**
 * Use for PDF uploads.
 * Field name: "pdf"
 * After this middleware runs, read from req.file.buffer and pass to uploadPdf().
 */
export const uploadPdfMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_SIZE },
  fileFilter: pdfFilter,
}).single('pdf');

/**
 * Combined middleware — accepts both "cover" and "pdf" fields in one multipart request.
 * Access files via req.files['cover'][0] and req.files['pdf'][0].
 */
const parseBookFiles = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_SIZE, files: 2, fields: 0, parts: 3 },
  fileFilter(_req, file, cb) {
    if (file.fieldname === 'cover' && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else if (file.fieldname === 'pdf' && file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new AppError(400, 'Invalid upload', { [file.fieldname]: 'Unexpected file field or wrong MIME type' }));
    }
  },
}).fields([
  { name: 'cover', maxCount: 1 },
  { name: 'pdf',   maxCount: 1 },
]);

export const uploadBookFilesMiddleware: RequestHandler = (req, res, next) => {
  parseBookFiles(req, res, error => {
    if (!error || error instanceof AppError || error instanceof multer.MulterError) return next(error);
    // Busboy parsing errors (missing boundaries, truncated multipart bodies).
    next(new AppError(400, 'Invalid upload', { files: 'Provide a complete multipart upload with a valid boundary' }));
  });
};
