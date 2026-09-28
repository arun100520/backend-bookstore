import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IBook extends Document {
  title: string;
  slug: string;
  authors: string[];
  description: string;
  priceInPaise: number;           // price stored in paise (1 INR = 100 paise)
  coverUrl: string;               // Cloudinary public URL for the cover image
  pdfUrl: string;                 // Cloudinary raw URL (access controlled — never serve directly)
  categoryIds: Types.ObjectId[];  // refs to Category
  genreIds: Types.ObjectId[];     // refs to Genre
  language: Types.ObjectId;       // ref to Language
  isbn?: string;
  publishedAt?: Date;
  ratingAvg: number;              // 0–5, updated by a separate review aggregation
  isActive: boolean;              // false = draft / delisted
  createdAt: Date;
  updatedAt: Date;
}

const bookSchema = new Schema<IBook>(
  {
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [300, 'Title must be 300 characters or fewer'],
    },
    slug: {
      type: String,
      required: [true, 'Slug is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    authors: {
      type: [String],
      required: [true, 'At least one author is required'],
      validate: {
        validator: (v: string[]) => v.length > 0,
        message: 'At least one author is required',
      },
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
    },
    priceInPaise: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    coverUrl: {
      type: String,
      default: '',
    },
    pdfUrl: {
      type: String,
      default: '',
    },
    categoryIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
      default: [],
    },
    genreIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Genre' }],
      default: [],
    },
    language: {
      type: Schema.Types.ObjectId,
      ref: 'Language',
      required: [true, 'Language is required'],
    },
    isbn: {
      type: String,
      trim: true,
      default: undefined,
    },
    publishedAt: {
      type: Date,
      default: undefined,
    },
    ratingAvg: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

// ── Indexes ───────────────────────────────────────────────────────────────────
// Full-text search on title + authors (used by GET /api/search?q=)
// language_override is needed because our 'language' field is an ObjectId, not a string.
bookSchema.index(
  { title: 'text', authors: 'text' },
  { language_override: 'searchLanguage' }
);
// Filter queries
bookSchema.index({ categoryIds: 1 });
bookSchema.index({ genreIds: 1 });
bookSchema.index({ language: 1 });
bookSchema.index({ isActive: 1 });
bookSchema.index({ priceInPaise: 1 });

const Book = mongoose.model<IBook>('Book', bookSchema);
export default Book;
