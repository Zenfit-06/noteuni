/**
 * Central environment helpers. Production is detected via NODE_ENV or the
 * VERCEL env var that Vercel sets automatically on its functions.
 */
const IS_PROD = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

const DEV_FALLBACK_JWT_SECRET = 'noteversity_dev_secret_key_2026_jwt_token_secure';

/**
 * Single source of truth for the JWT signing secret.
 * In production a real JWT_SECRET is REQUIRED — no fallback, fail fast.
 */
function jwtSecret() {
  const secret = (process.env.JWT_SECRET || '').trim();
  if (secret && secret.length >= 16) return secret;
  if (IS_PROD) {
    throw new Error('JWT_SECRET env var is required in production (min 16 characters)');
  }
  return DEV_FALLBACK_JWT_SECRET;
}

/** Session lifetimes */
const GUEST_SESSION_TTL = process.env.JWT_EXPIRES_IN || '7d';
const ADMIN_SESSION_TTL = '8h';
const GUEST_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const ADMIN_COOKIE_MAX_AGE = 8 * 60 * 60 * 1000;

module.exports = {
  IS_PROD,
  jwtSecret,
  GUEST_SESSION_TTL,
  ADMIN_SESSION_TTL,
  GUEST_COOKIE_MAX_AGE,
  ADMIN_COOKIE_MAX_AGE,
};
