import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('30d'),
  /** Ed25519 private key (base64 DER, pkcs8) that signs desktop licence leases. */
  LICENSE_SIGNING_KEY: z.string().optional(),
  /** Self-hosted OCR service (services/ocr) used by the desktop app's cloud mode. */
  OCR_URL: z.string().url().default('http://127.0.0.1:4500'),
  /** Self-hosted transliteration service (services/xlit) for secondary-language columns. */
  XLIT_URL: z.string().url().default('http://127.0.0.1:4600'),
  /**
   * MSG91 auth key: confirms the OTP widget's access tokens for the mobile app's
   * sign-in. Unset turns the OTP step off.
   */
  MSG91_AUTH_KEY: z.string().optional(),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  /** Used by `prisma db seed` to create the first super admin. */
  SUPERADMIN_EMAIL: z.string().default('admin@voter.local'),
  SUPERADMIN_PASSWORD: z.string().default('Admin@12345'),
  SUPERADMIN_NAME: z.string().default('Super Admin'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
}

export const env = parsed.data;
