import { describe, it, expect } from 'vitest';
import { CsrfError } from '../errors.js';
import { assertCsrfHeader, isMutating } from '../csrf.js';

describe('csrf.isMutating', () => {
  it.each(['POST', 'PATCH', 'PUT', 'DELETE', 'post', 'delete'])('flags %s as mutating', m => {
    expect(isMutating(m)).toBe(true);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('does not flag %s', m => {
    expect(isMutating(m)).toBe(false);
  });
});

describe('csrf.assertCsrfHeader', () => {
  it('passes for GET regardless of headers', () => {
    expect(() => assertCsrfHeader('GET', {})).not.toThrow();
  });

  it('throws CsrfError on POST without X-Requested-With', () => {
    expect(() => assertCsrfHeader('POST', {})).toThrow(CsrfError);
  });

  it('throws CsrfError on PATCH with the wrong X-Requested-With value', () => {
    expect(() => assertCsrfHeader('PATCH', { 'x-requested-with': 'XMLHttpRequest' })).toThrow(CsrfError);
  });

  it('passes on POST with X-Requested-With: fetch', () => {
    expect(() => assertCsrfHeader('POST', { 'x-requested-with': 'fetch' })).not.toThrow();
  });

  it('rejects cross-site requests via Sec-Fetch-Site even when the fetch header is set', () => {
    expect(() =>
      assertCsrfHeader('POST', {
        'x-requested-with': 'fetch',
        'sec-fetch-site': 'cross-site',
      }),
    ).toThrow(CsrfError);
  });

  it('accepts same-origin Sec-Fetch-Site when present', () => {
    expect(() =>
      assertCsrfHeader('POST', {
        'x-requested-with': 'fetch',
        'sec-fetch-site': 'same-origin',
      }),
    ).not.toThrow();
  });
});
