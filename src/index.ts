import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { connectDB } from './config/db.js';
import { configureCloudinary } from './config/cloudinary.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import authRoutes from './routes/authRoutes.js';
import adminBookRoutes from './routes/adminBookRoutes.js';
import adminTaxonomyRoutes from './routes/adminTaxonomyRoutes.js';
import catalogRoutes from './routes/catalogRoutes.js';
import cartRoutes from './routes/cartRoutes.js';
import checkoutRoutes from './routes/checkoutRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import PaymentEvent from './models/PaymentEvent.js';
import Entitlement from './models/Entitlement.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ── Global middleware ─────────────────────────────────────────────────────────
app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true, // allow cookies to be sent cross-origin
  }),
);
app.use(cookieParser());
// Signature verification needs exact bytes, before the global JSON parser.
app.use('/api/webhooks', webhookRoutes);
app.use(express.json());

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api', catalogRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/admin/books', adminBookRoutes);
app.use('/api/admin/taxonomy', adminTaxonomyRoutes);

// ── 404 + error handlers (must be last) ──────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Boot ─────────────────────────────────────────────────────────────────────
async function start() {
  await connectDB(); // exits process on failure
  await Promise.all([PaymentEvent.init(), Entitlement.init()]);
  configureCloudinary(); // warns if vars missing but doesn't block
  app.listen(PORT, () => {
    console.log(`[server] Running on http://localhost:${PORT}`);
  });
}

// Importing the app for HTTP tests must not start a second server or DB connection.
if (require.main === module) start();

export default app;
