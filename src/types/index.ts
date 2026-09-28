// ─── Shared domain types for the Ebook Store ─────────────────────────────────
// NOTE: These are intentionally duplicated in frontend/src/types/index.ts
//       (no shared package). Keep both files in sync when making changes.

// ── User ─────────────────────────────────────────────────────────────────────
export type UserRole = 'user' | 'admin';

export interface User {
  _id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  avatarUrl?: string;
  createdAt: Date;
}

// ── Taxonomy ──────────────────────────────────────────────────────────────────
export interface Category {
  _id: string;
  name: string;
  slug: string;
}

export interface Genre {
  _id: string;
  name: string;
  slug: string;
}

export interface Language {
  _id: string;
  name: string;
  slug: string;
}

// ── Book ──────────────────────────────────────────────────────────────────────
export interface Book {
  _id: string;
  title: string;
  slug: string;
  authors: string[];
  description: string;
  priceInPaise: number;
  coverUrl: string;
  pdfUrl: string;
  categoryIds: string[];
  genreIds: string[];
  language: string;
  isbn?: string;
  publishedAt?: Date;
  ratingAvg: number;
  isActive: boolean;
}

// ── Order ─────────────────────────────────────────────────────────────────────
export type OrderStatus = 'created' | 'paid' | 'failed' | 'refunded';

export interface OrderItem {
  bookId: string;
  title: string;
  priceInPaise: number;
}

export interface Order {
  _id: string;
  userId: string;
  orderNumber: string;
  items: OrderItem[];
  amountInPaise: number;
  currency: string;
  status: OrderStatus;
  cashfreeOrderId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── PaymentEvent ──────────────────────────────────────────────────────────────
export interface PaymentEvent {
  _id: string;
  orderId: string;
  cashfreeOrderId: string;
  cashfreeEventId: string;   // unique — used for idempotency
  eventType: string;
  rawPayload: Record<string, unknown>;
  signatureVerified: boolean;
  source?: 'webhook' | 'reconciliation';
  receivedAt: Date;
}

// ── Entitlement ───────────────────────────────────────────────────────────────
export interface Entitlement {
  _id: string;
  userId: string;
  bookId: string;
  orderId: string;
  grantedAt: Date;
}
