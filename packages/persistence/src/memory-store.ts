import type { TableState, HandSummary, ReplayEvent } from '@agent-poker/shared';
import type { ITableStore, IHandStore } from './store-interface.js';

export class MemoryTableStore implements ITableStore {
  private tables = new Map<string, TableState>();

  async saveTable(table: TableState): Promise<void> {
    this.tables.set(table.tableId, table);
  }

  async getTable(tableId: string): Promise<TableState | null> {
    return this.tables.get(tableId) ?? null;
  }

  async listTables(): Promise<TableState[]> {
    return [...this.tables.values()];
  }

  async deleteTable(tableId: string): Promise<void> {
    this.tables.delete(tableId);
  }
}

export class MemoryHandStore implements IHandStore {
  private hands = new Map<string, HandSummary>();
  private events = new Map<string, ReplayEvent[]>();

  async saveHandSummary(hand: HandSummary): Promise<void> {
    this.hands.set(hand.handId, hand);
  }

  async getHandSummary(handId: string): Promise<HandSummary | null> {
    return this.hands.get(handId) ?? null;
  }

  async listHandSummaries(tableId: string): Promise<HandSummary[]> {
    return [...this.hands.values()].filter(h => h.tableId === tableId);
  }

  async appendReplayEvent(event: ReplayEvent): Promise<void> {
    const existing = this.events.get(event.handId) ?? [];
    this.events.set(event.handId, [...existing, event]);
  }

  async getReplayEvents(handId: string): Promise<ReplayEvent[]> {
    return [...(this.events.get(handId) ?? [])].sort((a, b) => a.sequence - b.sequence);
  }
}
