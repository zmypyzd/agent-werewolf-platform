// Why bcryptjs (pure JS) instead of `argon2` or native `bcrypt`:
// the spec allows an explicit fallback, and the local toolchain has been
// brittle for native compiles (better-sqlite3 already needed a manual
// rebuild). bcryptjs at 12 rounds takes ~250ms/hash on a modern laptop,
// which is acceptable behind a rate-limited /auth/login route.
export const BCRYPT_COST = 12;

export const SESSION_COOKIE_NAME = 'apk_sid';

export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const CSRF_HEADER_NAME = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'fetch';

export const MUTATING_METHODS: readonly string[] = ['POST', 'PATCH', 'PUT', 'DELETE'];

export type RuntimeEnv = 'production' | 'development' | 'test';
