import { describe, expect, it } from 'vitest';
import { ServiceUnavailableError } from '@agent-poker/shared';
import { rewrapPostgresError } from '../postgres/postgres-werewolf-match-artifact-store.js';

// Regression: production werewolf-api on Render returned a generic 500 with
// "permission denied for view werewolf_matches_public" leaked to clients of
// GET /api/v1/werewolf-matches because the supabase migration that grants
// SELECT on the public view to the anon role was never applied to the prod
// database. The HTTP layer needs a 503 SERVICE_UNAVAILABLE so the operator
// sees a clear, actionable error code instead of an opaque internal error
// (and so monitors can distinguish "DB not provisioned" from "code bug").
describe('rewrapPostgresError', () => {
  it('throws ServiceUnavailableError on PG insufficient_privilege code (42501)', () => {
    expect(() =>
      rewrapPostgresError('listMatchArtifacts', {
        code: '42501',
        message: 'permission denied for view werewolf_matches_public',
      }),
    ).toThrowError(ServiceUnavailableError);
  });

  it('throws ServiceUnavailableError when the error message starts with "permission denied"', () => {
    // Some PostgREST paths return only `.message` without the typed `.code`
    // (e.g. when the error originates from a view that the role cannot see at all).
    expect(() =>
      rewrapPostgresError('listMatchArtifacts', {
        message: 'permission denied for table werewolf_matches',
      }),
    ).toThrowError(ServiceUnavailableError);
  });

  it('falls back to generic Error for unrelated postgres failures', () => {
    expect(() =>
      rewrapPostgresError('listMatchArtifacts', {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      }),
    ).toThrow(/listMatchArtifacts: duplicate key/);
  });

  it('does not leak the underlying postgres message into the 503 surface', () => {
    // The user-facing message must mention pending migrations rather than
    // surfacing the internal "permission denied for view <name>" string,
    // which leaks the schema name + role layout.
    let captured: ServiceUnavailableError | null = null;
    try {
      rewrapPostgresError('listMatchArtifacts', {
        code: '42501',
        message: 'permission denied for view werewolf_matches_public',
      });
    } catch (e) {
      if (e instanceof ServiceUnavailableError) captured = e;
    }
    expect(captured).not.toBeNull();
    expect(captured!.message).not.toContain('werewolf_matches_public');
    expect(captured!.message).toMatch(/migration/i);
  });
});
