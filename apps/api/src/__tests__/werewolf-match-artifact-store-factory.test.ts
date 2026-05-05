import { describe, expect, it } from 'vitest';
import {
  MemoryWerewolfMatchArtifactStore,
  ObjectWerewolfMatchArtifactStore,
} from '@agent-poker/persistence';
import { createWerewolfMatchArtifactStore } from '../werewolf-match-artifact-store-factory.js';

describe('createWerewolfMatchArtifactStore', () => {
  it('returns memory store by default', () => {
    const store = createWerewolfMatchArtifactStore({});
    expect(store).toBeInstanceOf(MemoryWerewolfMatchArtifactStore);
  });

  it('returns object-backed file store when mode=file and base dir is provided', () => {
    const store = createWerewolfMatchArtifactStore({
      WEREWOLF_MATCH_ARTIFACT_STORE: 'file',
      WEREWOLF_MATCH_ARTIFACT_BASE_DIR: '/tmp/werewolf-artifacts',
    });
    expect(store).toBeInstanceOf(ObjectWerewolfMatchArtifactStore);
  });

  it('rejects file mode without a base dir', () => {
    expect(() => createWerewolfMatchArtifactStore({ WEREWOLF_MATCH_ARTIFACT_STORE: 'file' }))
      .toThrow('WEREWOLF_MATCH_ARTIFACT_BASE_DIR is required when WEREWOLF_MATCH_ARTIFACT_STORE=file');
  });

  it('rejects object mode without an injected object store', () => {
    expect(() => createWerewolfMatchArtifactStore({ WEREWOLF_MATCH_ARTIFACT_STORE: 'object' }))
      .toThrow('object mode requires an injected IObjectStore');
  });

  it('rejects unknown modes', () => {
    expect(() => createWerewolfMatchArtifactStore({ WEREWOLF_MATCH_ARTIFACT_STORE: 'redis' }))
      .toThrow(/Unsupported WEREWOLF_MATCH_ARTIFACT_STORE mode: redis/);
  });
});
