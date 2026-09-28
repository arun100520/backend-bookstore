import { UploadApiResponse, UploadApiOptions } from 'cloudinary';
import { cloudinary } from '../config/cloudinary.js';

// ── Folder constants ──────────────────────────────────────────────────────────
const COVER_FOLDER = 'ebook-store/covers';
const PDF_FOLDER = 'ebook-store/pdfs';

// ── Internal helper ───────────────────────────────────────────────────────────
function streamUpload(
  buffer: Buffer,
  options: UploadApiOptions,
): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error || !result) {
        reject(error ?? new Error('Cloudinary upload returned no result'));
        return;
      }
      resolve(result);
    });
    stream.end(buffer);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Uploads a cover image to Cloudinary (public, image resource type).
 * Returns the secure_url and public_id.
 */
export async function uploadCoverImage(
  buffer: Buffer,
  publicId?: string,
): Promise<{ url: string; publicId: string }> {
  const result = await streamUpload(buffer, {
    folder: COVER_FOLDER,
    public_id: publicId,
    resource_type: 'image',
    overwrite: true,
    transformation: [
      { width: 800, crop: 'limit' },   // cap width, preserve aspect ratio
      { quality: 'auto', fetch_format: 'auto' }, // auto-optimize format/quality
    ],
  });
  return { url: result.secure_url, publicId: result.public_id };
}

/**
 * Uploads a PDF to Cloudinary as a private raw asset.
 * The secure_url is stored in the DB but NEVER served directly to users.
 * Use generateSignedPdfUrl() to vend short-lived download links.
 */
export async function uploadPdf(
  buffer: Buffer,
  publicId?: string,
): Promise<{ url: string; publicId: string }> {
  const result = await streamUpload(buffer, {
    folder: PDF_FOLDER,
    public_id: publicId,
    resource_type: 'raw',
    type: 'private',       // Cloudinary delivery type: private (requires signing to access)
    overwrite: true,
  });
  return { url: result.secure_url, publicId: result.public_id };
}

/**
 * Generates a short-lived signed URL for a private PDF.
 * @param publicId  The Cloudinary public_id stored on the Book document
 * @param expiresIn Seconds until expiry (default: 60 minutes)
 */
export function generateSignedPdfUrl(
  publicId: string,
  expiresIn: number = 60 * 60,
): string {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  return cloudinary.url(publicId, {
    resource_type: 'raw',
    type: 'private',
    sign_url: true,
    expires_at: expiresAt,
    secure: true,
  });
}
