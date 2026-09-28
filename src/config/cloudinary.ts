import { v2 as cloudinary } from 'cloudinary';

/**
 * Configures the Cloudinary SDK once at startup.
 * Called from index.ts before any upload can occur.
 */
export function configureCloudinary(): void {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    console.warn(
      '[cloudinary] ⚠️  Missing Cloudinary env vars — file uploads will fail.',
    );
    return;
  }

  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });

  console.log(`[cloudinary] ✅  Configured for cloud: ${CLOUDINARY_CLOUD_NAME}`);
}

export { cloudinary };
