import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import app from '../index.js';
import Book from '../models/Book.js';
import Entitlement from '../models/Entitlement.js';
import { cloudinary, configureCloudinary } from '../config/cloudinary.js';
import { uploadPdf, pdfPublicIdFromUrl, generateSignedPdfUrl } from '../services/cloudinaryService.js';
import { generateAccessToken } from '../utils/jwt.js';

const bookId = new mongoose.Types.ObjectId();
const owner = new mongoose.Types.ObjectId();
const other = new mongoose.Types.ObjectId();
let publicId: string | undefined;
let server: Server | undefined;
async function run() {
  assert.ok(process.env.MONGO_URI); assert.ok(process.env.JWT_SECRET);
  assert.ok(process.env.CLOUDINARY_API_SECRET);
  configureCloudinary();
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  await Entitlement.init();
  // A minimal PDF, stored as raw bytes. No existing book or asset is touched.
  const pdf = Buffer.from('%PDF-1.1\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
  publicId = `ebook-store/pdfs/library-test-${bookId}`;
  const uploaded = await uploadPdf(pdf, `library-test-${bookId}`);
  publicId = uploaded.publicId;
  console.log('Temporary asset path:', new URL(uploaded.url).pathname);
  assert.equal(pdfPublicIdFromUrl(uploaded.url), publicId);
  assert.ok(generateSignedPdfUrl(publicId));
  await Book.create({ _id: bookId, title: 'Temporary library verification', slug: `library-test-${bookId}`,
    authors: ['Test'], description: 'Temporary fixture', priceInPaise: 100, pdfUrl: uploaded.url,
    language: new mongoose.Types.ObjectId(), isActive: false });
  await Entitlement.create({ user: owner, book: bookId, order: new mongoose.Types.ObjectId() });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/library`;
  async function get(path: string, user = owner) {
    const response = await fetch(base + path, { headers: {
      Authorization: `Bearer ${generateAccessToken({ userId: String(user), role: 'user' })}`,
    } });
    return { status: response.status, body: await response.json() as any };
  }
  assert.equal((await get(`/${bookId}/download-url`, other)).status, 403);
  assert.deepEqual((await get('', other)).body.data, []);
  const library = await get('');
  assert.equal(library.body.data.length, 1);
  assert.equal(library.body.data[0].book._id, String(bookId));
  assert.ok(!JSON.stringify(library.body).includes('pdfUrl'));
  const download = await get(`/${bookId}/download-url`);
  assert.equal(download.status, 200);
  const url = new URL(download.body.data.url);
  assert.ok(url.searchParams.get('signature')); assert.ok(url.searchParams.get('expires_at'));
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, `Private download failed: ${response.headers.get('x-cld-error')}`);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
  const expired = cloudinary.utils.private_download_url(publicId, 'pdf', {
    resource_type: 'raw', type: 'private', attachment: true, expires_at: Math.floor(Date.now() / 1000) - 60,
  });
  const denied = await fetch(expired, { signal: AbortSignal.timeout(30000) });
  assert.ok([400, 401, 403].includes(denied.status), `Expired URL unexpectedly returned ${denied.status}`);
  await denied.arrayBuffer();
  console.log('PASS: MongoDB entitlement isolation, inactive purchased book access, PDF secrecy, actual private download and Cloudinary expiry enforcement.');
}
run().catch(error => {
  console.error('Library integration failed:', error instanceof assert.AssertionError ? error.message : (error as Error).name);
  process.exitCode = 1;
}).finally(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
  try {
    if (mongoose.connection.readyState === 1) {
      await Entitlement.deleteMany({ user: owner, book: bookId });
      await Book.deleteOne({ _id: bookId });
    }
    if (publicId) {
      const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'raw', type: 'private' });
      assert.ok(['ok', 'not found'].includes(result.result));
    }
    console.log('Temporary library records and Cloudinary asset removed.');
  } catch { console.error('Temporary fixture cleanup failed; inspect library-test fixture.'); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
});
