import { describe, expect, it } from 'vitest';
import { agentIdForUuidColumn } from '../postgres/postgres-werewolf-decision-trace-store.js';

// Regression coverage for production failure mode:
//   appendDecisionTrace failed: invalid input syntax for type uuid: "agent-p1"
//
// werewolf_decision_traces.agent_id is a uuid column with FK to public.agents.id.
// House-bot seats use synthetic agentIds like "agent-p1" that are NOT registered
// in the agents table and don't even parse as UUIDs. The trace store must coerce
// these to NULL so the trace row goes through; user-registered HTTP agents pass
// real UUIDs and stay intact.
describe('agentIdForUuidColumn', () => {
  it('returns null for empty string (preserving prior behavior)', () => {
    expect(agentIdForUuidColumn('')).toBeNull();
  });

  it('returns null for synthetic house-bot ids like "agent-p1"', () => {
    expect(agentIdForUuidColumn('agent-p1')).toBeNull();
    expect(agentIdForUuidColumn('agent-p9')).toBeNull();
  });

  it('returns null for arbitrary non-uuid strings', () => {
    expect(agentIdForUuidColumn('not-a-uuid')).toBeNull();
    expect(agentIdForUuidColumn('123')).toBeNull();
    expect(agentIdForUuidColumn('cfg-7eb56ce1-e9f')).toBeNull(); // looks like an id but not the right shape
  });

  it('passes through canonical lowercase v4 uuids unchanged', () => {
    const id = '426f4d3f-1b41-4032-b9c6-fe22238adfd4';
    expect(agentIdForUuidColumn(id)).toBe(id);
  });

  it('passes through uppercase + mixed-case uuids unchanged', () => {
    const upper = '426F4D3F-1B41-4032-B9C6-FE22238ADFD4';
    const mixed = '426f4d3F-1B41-4032-B9c6-FE22238adfd4';
    expect(agentIdForUuidColumn(upper)).toBe(upper);
    expect(agentIdForUuidColumn(mixed)).toBe(mixed);
  });

  it('returns null for shapes that are close-but-not-quite uuid', () => {
    // Missing one char from last segment — would raise the prod error if accepted
    expect(agentIdForUuidColumn('426f4d3f-1b41-4032-b9c6-fe22238adfd')).toBeNull();
    // Wrong segment lengths
    expect(agentIdForUuidColumn('426f4d3f1b41-4032-b9c6-fe22238adfd4')).toBeNull();
    // Non-hex characters
    expect(agentIdForUuidColumn('zzz04d3f-1b41-4032-b9c6-fe22238adfd4')).toBeNull();
  });
});
