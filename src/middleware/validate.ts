import type { RequestHandler } from 'express';
import { z } from 'zod';
import { normalizeCover, validatePdf } from '../services/uploadValidation.js';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Use a valid 24-character ID').toLowerCase();
export const emptyBody = z.strictObject({}).optional();
export function validateBody(schema: z.ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(result.error);
    req.body = result.data;
    next();
  };
}
export function validateId(field = 'id'): RequestHandler {
  return (req, _res, next) => {
    const result = z.object({ [field]: objectId }).safeParse(req.params);
    if (result.success) req.params[field] = result.data[field];
    next(result.success ? undefined : result.error);
  };
}

const name = z.string().trim().min(1).max(100);
const email = z.string().trim().max(254).email().toLowerCase();
export const signupBody = z.strictObject({ name, email,
  password: z.string().min(8).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes'),
});
export const loginBody = z.strictObject({ email, password: z.string().min(1).max(1024) });
export const quantity = z.number().int().min(1).max(1000);
export const addCartBody = z.strictObject({ bookId: objectId, quantity: quantity.default(1) });
export const updateCartBody = z.strictObject({ quantity });
const slug = z.string().trim().max(300).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase words separated by hyphens');
export const taxonomyBody = z.strictObject({ name, slug });
export const taxonomyPatch = taxonomyBody.partial().refine(value => Object.keys(value).length > 0, 'Provide at least one field');
export const bookBody = z.strictObject({
  title: z.string().trim().min(1).max(300), slug,
  authors: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
  description: z.string().trim().min(1).max(50000),
  priceInPaise: z.number().int().nonnegative().safe(),
  language: objectId,
  categoryIds: z.array(objectId).max(100).optional(),
  genreIds: z.array(objectId).max(100).optional(),
  isbn: z.string().trim().max(32).optional(),
  publishedAt: z.union([z.iso.date(), z.iso.datetime({ offset: true })]).nullable().optional(),
  isActive: z.boolean().optional(),
});
// Files, ratings, timestamps and Mongo update operators cannot be set as metadata.
export const bookPatch = bookBody.partial().refine(value => Object.keys(value).length > 0, 'Provide at least one field');

const file = (mime: (value: string) => boolean, max: number, message: string) => z.custom<Express.Multer.File>(
  value => typeof value === 'object' && value !== null && 'buffer' in value && Buffer.isBuffer(value.buffer)
    && 'mimetype' in value && typeof value.mimetype === 'string' && mime(value.mimetype)
    && value.buffer.length > 0 && value.buffer.length <= max, message,
);
const uploads = z.strictObject({
  cover: z.array(file(type => ['image/jpeg', 'image/png', 'image/webp'].includes(type), 5 * 1024 * 1024, 'Choose a non-empty JPEG, PNG or WebP up to 5 MB')).length(1).optional(),
  pdf: z.array(file(type => type === 'application/pdf', 50 * 1024 * 1024, 'Choose a non-empty PDF up to 50 MB')).length(1).optional(),
}).refine(value => !!value.cover || !!value.pdf, 'Provide a cover or PDF file');
export const validateUploads: RequestHandler = async (req, _res, next) => {
  const result = uploads.safeParse(req.files);
  if (!result.success) return next(result.error);
  try {
    if (result.data.pdf) await validatePdf(result.data.pdf[0].buffer);
    if (result.data.cover) {
      const cover = result.data.cover[0];
      cover.buffer = await normalizeCover(cover.buffer);
      cover.mimetype = 'image/webp'; cover.size = cover.buffer.length;
    }
    next();
  } catch (error) { next(error); }
};
