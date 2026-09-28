import mongoose, { Document, Schema } from 'mongoose';

export interface ILanguage extends Document {
  name: string;
  slug: string;
}

const languageSchema = new Schema<ILanguage>(
  {
    name: {
      type: String,
      required: [true, 'Language name is required'],
      trim: true,
      maxlength: [100, 'Name must be 100 characters or fewer'],
    },
    slug: {
      type: String,
      required: [true, 'Slug is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, and hyphens'],
    },
  },
  { timestamps: true },
);

const Language = mongoose.model<ILanguage>('Language', languageSchema);
export default Language;
