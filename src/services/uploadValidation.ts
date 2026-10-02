import sharp from 'sharp';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { AppError } from '../middleware/errorHandler.js';

let active = 0;
export async function validatePdf(buffer: Buffer): Promise<void> {
  if (active >= 2) throw new AppError(503, 'PDF validation is busy. Please retry shortly.');
  active++;
  try {
    await new Promise<void>((resolve, reject) => {
      const compiled = path.join(__dirname, 'pdfValidationWorker.js');
      const worker = new Worker(existsSync(compiled) ? compiled : path.resolve(__dirname, '../../dist/services/pdfValidationWorker.js'), {
        workerData: buffer, resourceLimits: { maxOldGenerationSizeMb: 192 },
      });
      let settled = false;
      const finish = (valid: boolean) => {
        if (settled) return;
        settled = true; clearTimeout(timer); void worker.terminate();
        if (valid) resolve();
        else reject(new AppError(400, 'Invalid upload', { pdf: 'Use a valid, unencrypted PDF without scripts, forms or embedded files' }));
      };
      const timer = setTimeout(() => finish(false), 10_000);
      worker.once('message', value => finish(value === true));
      worker.once('error', () => finish(false));
      worker.once('exit', () => finish(false));
    });
  } finally { active--; }
}
export async function normalizeCover(buffer: Buffer): Promise<Buffer> {
  try {
    const image = sharp(buffer, { limitInputPixels: 20_000_000, failOn: 'warning', animated: false });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format || '') || (metadata.pages ?? 1) !== 1) throw new Error('Unsupported image');
    return await image.rotate().resize({ width: 800, height: 1200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  } catch { throw new AppError(400, 'Invalid upload', { cover: 'Use a valid JPEG, PNG or WebP image up to 20 megapixels' }); }
}
