import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE, MUTATING_METHODS } from './config.js';
import { CsrfError } from './errors.js';

export function isMutating(method: string): boolean {
  return MUTATING_METHODS.includes(method.toUpperCase());
}

type Headers = Record<string, string | string[] | undefined>;

function headerValue(headers: Headers, name: string): string | null {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// Cross-origin form posts cannot set custom headers, so requiring an
// X-Requested-With header on mutating routes blocks the basic CSRF case
// while leaving same-origin fetch() (which always sets it) untouched.
// Sec-Fetch-Site, when present, is enforced too: cross-site is rejected.
export function assertCsrfHeader(method: string, headers: Headers): void {
  if (!isMutating(method)) return;

  const requestedWith = headerValue(headers, CSRF_HEADER_NAME);
  if (requestedWith !== CSRF_HEADER_VALUE) {
    throw new CsrfError(`missing or wrong ${CSRF_HEADER_NAME} header`);
  }

  const fetchSite = headerValue(headers, 'sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none') {
    throw new CsrfError(`disallowed sec-fetch-site=${fetchSite}`);
  }
}
