import type { IWerewolfMatchArtifactStore } from '@agent-poker/persistence';
import type { WerewolfOrchestrator } from './orchestrator.js';

export interface WerewolfMatchTtlCleanerOptions {
  readonly orchestrator: WerewolfOrchestrator;
  readonly store: IWerewolfMatchArtifactStore;
  // A match is eligible for cleanup once `now - completedAt >= ttlMs`.
  readonly ttlMs: number;
}

export class WerewolfMatchTtlCleaner {
  private readonly orchestrator: WerewolfOrchestrator;
  private readonly store: IWerewolfMatchArtifactStore;
  private readonly ttlMs: number;

  constructor(options: WerewolfMatchTtlCleanerOptions) {
    this.orchestrator = options.orchestrator;
    this.store = options.store;
    this.ttlMs = options.ttlMs;
  }

  // Returns the matchIds that were dropped from the orchestrator. Callers can
  // log or aggregate. Persisted artifacts are NOT removed — that lives in the
  // store's deleteMatchArtifact and is policy-distinct from in-memory cleanup.
  async runOnce(now: number = Date.now()): Promise<string[]> {
    const entries = await this.store.listMatchArtifacts();
    const cleaned: string[] = [];
    for (const entry of entries) {
      if (now - entry.completedAt < this.ttlMs) continue;
      const removed = this.orchestrator.deleteMatch(entry.matchId);
      if (removed) cleaned.push(entry.matchId);
    }
    return cleaned;
  }
}
