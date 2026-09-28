import mongoose from 'mongoose';

/**
 * Connects to MongoDB using MONGO_URI from the environment.
 * Logs a clear error and exits the process (code 1) if the connection fails —
 * this ensures the server never silently runs without a database.
 */
export async function connectDB(): Promise<void> {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('[db] ❌  MONGO_URI is not set in environment variables.');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log(`[db] ✅  Connected to MongoDB: ${redactUri(uri)}`);
  } catch (err) {
    console.error('[db] ❌  Failed to connect to MongoDB:', (err as Error).message);
    process.exit(1);
  }
}

/**
 * Strips credentials from a MongoDB URI before logging it.
 * e.g. mongodb+srv://user:secret@cluster.mongodb.net/db → mongodb+srv://***@cluster.mongodb.net/db
 */
function redactUri(uri: string): string {
  try {
    const parsed = new URL(uri);
    if (parsed.password) parsed.password = '***';
    if (parsed.username) parsed.username = '***';
    return parsed.toString();
  } catch {
    return '<unparseable URI>';
  }
}
