import mongoose, { Document, Schema } from 'mongoose';
import type { UserRole } from '../types/index.js';

// ── Document interface ────────────────────────────────────────────────────────
export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  avatarUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────
const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name must be 100 characters or fewer'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,          // creates the unique index — duplicate → Mongo 11000
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
    },
    role: {
      type: String,
      enum: ['user', 'admin'] satisfies UserRole[],
      default: 'user',
    },
    avatarUrl: {
      type: String,
      default: undefined,
    },
  },
  {
    timestamps: true, // adds createdAt + updatedAt automatically
  },
);

// ── Model ─────────────────────────────────────────────────────────────────────
const User = mongoose.model<IUser>('User', userSchema);
export default User;
