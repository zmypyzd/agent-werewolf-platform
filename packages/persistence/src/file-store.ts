import fs from 'fs';
import path from 'path';
import type { HandSummary, ReplayEvent } from '@agent-poker/shared';
import type { IHandStore } from './store-interface.js';

export class FileHandStore implements IHandStore {
  constructor(private readonly baseDir: string) {}

  private dir(tableId: string): string {
    return path.join(this.baseDir, tableId);
  }

  private ensureDir(tableId: string): void {
    fs.mkdirSync(this.dir(tableId), { recursive: true });
  }

  async saveHandSummary(hand: HandSummary): Promise<void> {
    this.ensureDir(hand.tableId);
    const file = path.join(this.dir(hand.tableId), `${hand.handId}.summary.json`);
    fs.writeFileSync(file, JSON.stringify(hand, null, 2), 'utf-8');
  }

  async getHandSummary(handId: string): Promise<HandSummary | null> {
    // Search all table dirs for the handId summary file
    if (!fs.existsSync(this.baseDir)) return null;
    for (const tableDir of fs.readdirSync(this.baseDir)) {
      const file = path.join(this.baseDir, tableDir, `${handId}.summary.json`);
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf-8');
        return JSON.parse(raw) as HandSummary;
      }
    }
    return null;
  }

  async listHandSummaries(tableId: string): Promise<HandSummary[]> {
    const dir = this.dir(tableId);
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.summary.json'));
    return files.map(f => {
      const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
      return JSON.parse(raw) as HandSummary;
    });
  }

  async appendReplayEvent(event: ReplayEvent): Promise<void> {
    this.ensureDir(event.tableId);
    const file = path.join(this.dir(event.tableId), `${event.handId}.replay.jsonl`);
    fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf-8');
  }

  async getReplayEvents(handId: string): Promise<ReplayEvent[]> {
    if (!fs.existsSync(this.baseDir)) return [];
    for (const tableDir of fs.readdirSync(this.baseDir)) {
      const file = path.join(this.baseDir, tableDir, `${handId}.replay.jsonl`);
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf-8');
        return raw
          .split('\n')
          .filter(line => line.trim().length > 0)
          .map(line => JSON.parse(line) as ReplayEvent)
          .sort((a, b) => a.sequence - b.sequence);
      }
    }
    return [];
  }
}
