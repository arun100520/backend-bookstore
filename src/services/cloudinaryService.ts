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
 * @param expiresIn Seconds until expiry (default: five minutes)
 */
export function generateSignedPdfUrl(
  publicId: string,
  expiresIn: number = 300,
): string {
  if (!publicId || !Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 3600) {
    throw new Error('Invalid private download parameters');
  }
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  return cloudinary.utils.private_download_url(publicId, 'pdf', {
    resource_type: 'raw',
    type: 'private',
    expires_at: expiresAt,
    attachment: true,
  });
}

/** Existing books store the upload's secure_url rather than a separate public ID. */
export function pdfPublicIdFromUrl(pdfUrl: string): string {
  const url = new URL(pdfUrl);
  const cloudName = cloudinary.config().cloud_name;
  const prefix = `/${cloudName}/raw/private/`;
  if (!cloudName || url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' ||
      url.port || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix)) {
    throw new Error('Unsupported private PDF URL');
  }
  const publicId = decodeURIComponent(url.pathname.slice(prefix.length)
    .replace(/^s--[A-Za-z0-9_-]+--\//, '').replace(/^v\d+\//, ''));
  if (!publicId.startsWith(`${PDF_FOLDER}/`) || publicId.endsWith('/') || publicId.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Unsupported private PDF public ID');
  }
  return publicId;
}
