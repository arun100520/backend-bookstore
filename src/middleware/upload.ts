import multer, { FileFilterCallback } from 'multer';
import { Request } from 'express';

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
export const uploadBookFilesMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_SIZE }, // pdf is the larger limit
  fileFilter(_req, file, cb) {
    if (file.fieldname === 'cover' && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else if (file.fieldname === 'pdf' && file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error(`Unexpected field "${file.fieldname}" or wrong MIME type`));
    }
  },
}).fields([
  { name: 'cover', maxCount: 1 },
  { name: 'pdf',   maxCount: 1 },
]);
