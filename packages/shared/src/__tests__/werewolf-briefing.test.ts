import { describe, it, expect } from 'vitest';
import {
  WEREWOLF_BRIEFING_OUTPUT_FORMAT,
  WEREWOLF_BRIEFING_RULES_SUMMARY,
  buildDefaultWerewolfBriefing,
} from '../werewolf-briefing.js';

// Briefing is sent on every WerewolfDecisionRequest when enabled, so a
// regression that bloats it would multiply across every agent call and
// every persisted decision-trace artifact. Cap at 1500 bytes per field
// and 3500 bytes total — well above the current size, and still inside
// what an LLM agent can absorb without dominating its prompt budget.
const PER_FIELD_BYTE_LIMIT = 1500;
const TOTAL_BYTE_LIMIT = 3500;

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

describe('werewolf briefing constants', () => {
  it('rulesSummary stays under the per-field byte limit', () => {
    expect(utf8ByteLength(WEREWOLF_BRIEFING_RULES_SUMMARY)).toBeLessThan(
      PER_FIELD_BYTE_LIMIT,
    );
  });

  it('outputFormat stays under the per-field byte limit', () => {
    expect(utf8ByteLength(WEREWOLF_BRIEFING_OUTPUT_FORMAT)).toBeLessThan(
      PER_FIELD_BYTE_LIMIT,
    );
  });

  it('rulesSummary mentions day-speeches and the validActions rule', () => {
    // These are the load-bearing facts an external agent must internalise to
    // not appear silent. If a future edit removes them the briefing has lost
    // its purpose — fail loudly.
    expect(WEREWOLF_BRIEFING_RULES_SUMMARY).toMatch(/day-speeches/);
    expect(WEREWOLF_BRIEFING_RULES_SUMMARY).toMatch(/validActions/);
  });

  it('outputFormat names the three day-speech fields', () => {
    expect(WEREWOLF_BRIEFING_OUTPUT_FORMAT).toMatch(/inner/);
    expect(WEREWOLF_BRIEFING_OUTPUT_FORMAT).toMatch(/performance/);
    expect(WEREWOLF_BRIEFING_OUTPUT_FORMAT).toMatch(/speech/);
  });
});

describe('buildDefaultWerewolfBriefing', () => {
  it('returns a briefing without docsUrl when none is provided', () => {
    const b = buildDefaultWerewolfBriefing();
    expect(b.rulesSummary).toBe(WEREWOLF_BRIEFING_RULES_SUMMARY);
    expect(b.outputFormat).toBe(WEREWOLF_BRIEFING_OUTPUT_FORMAT);
    expect(b).not.toHaveProperty('docsUrl');
  });

  it('includes docsUrl when one is provided', () => {
    const b = buildDefaultWerewolfBriefing({
      docsUrl: 'https://example.com/guide',
    });
    expect(b.docsUrl).toBe('https://example.com/guide');
  });

  it('serialised form stays under the total byte limit', () => {
    const b = buildDefaultWerewolfBriefing({
      docsUrl: 'https://example.com/werewolf-http-agent-guide',
    });
    expect(utf8ByteLength(JSON.stringify(b))).toBeLessThan(TOTAL_BYTE_LIMIT);
  });
});
