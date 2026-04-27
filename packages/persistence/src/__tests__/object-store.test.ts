import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileObjectStore, MemoryObjectStore } from '../object-store.js';

const dirs: string[] = [];

function makeTmpDir(): string {
  const dir = path.join(os.tmpdir(), `poker-object-store-${randomUUID()}`);
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe('MemoryObjectStore', () => {
  it('stores, reads, checks existence, lists by prefix, and deletes text objects', async () => {
    const store = new MemoryObjectStore();
    await store.putText({ key: 'matches/a/summary.json', body: '{"a":1}', contentType: 'application/json' });
    await store.putText({ key: 'matches/a/replay.jsonl', body: '{}\n', contentType: 'application/x-ndjson' });
    await store.putText({ key: 'other/key.txt', body: 'x', contentType: 'text/plain' });

    expect(await store.getText('matches/a/summary.json')).toBe('{"a":1}');
    expect(await store.exists('matches/a/replay.jsonl')).toBe(true);
    expect((await store.list({ prefix: 'matches/a/' })).map(object => object.key)).toEqual([
      'matches/a/replay.jsonl',
      'matches/a/summary.json',
    ]);

    await store.delete('matches/a/summary.json');
    expect(await store.getText('matches/a/summary.json')).toBeNull();
  });

  it('applies list limits after prefix filtering', async () => {
    const store = new MemoryObjectStore();
    await store.putText({ key: 'matches/c.json', body: 'c', contentType: 'application/json' });
    await store.putText({ key: 'matches/a.json', body: 'a', contentType: 'application/json' });
    await store.putText({ key: 'matches/b.json', body: 'b', contentType: 'application/json' });

    expect((await store.list({ prefix: 'matches/', limit: 2 })).map(object => object.key)).toEqual([
      'matches/a.json',
      'matches/b.json',
    ]);
  });
});

describe('FileObjectStore', () => {
  it('stores object keys under the configured base directory', async () => {
    const dir = makeTmpDir();
    const store = new FileObjectStore(dir);

    await store.putText({ key: 'matches/a/summary.json', body: '{"ok":true}', contentType: 'application/json' });

    expect(await store.getText('matches/a/summary.json')).toBe('{"ok":true}');
    expect(fs.readFileSync(path.join(dir, 'matches', 'a', 'summary.json'), 'utf-8')).toBe('{"ok":true}');
  });

  it('rejects traversal and absolute object keys', async () => {
    const dir = makeTmpDir();
    const store = new FileObjectStore(dir);

    await expect(store.putText({ key: '../secret.json', body: '{}', contentType: 'application/json' }))
      .rejects.toThrow('Invalid object key');
    await expect(store.putText({ key: '/absolute.json', body: '{}', contentType: 'application/json' }))
      .rejects.toThrow('Invalid object key');
    await expect(store.putText({ key: 'matches\\bad.json', body: '{}', contentType: 'application/json' }))
      .rejects.toThrow('Invalid object key');
    expect(fs.existsSync(path.join(path.dirname(dir), 'secret.json'))).toBe(false);
  });
});
