import { describe, expect, it } from 'vitest';
import {
  MemoryMatchArtifactStore,
  ObjectMatchArtifactStore,
} from '@agent-poker/persistence';
import { createMatchArtifactStore } from '../match-artifact-store-factory.js';

describe('createMatchArtifactStore', () => {
  it('returns memory store by default', () => {
    const store = createMatchArtifactStore({});
    expect(store).toBeInstanceOf(MemoryMatchArtifactStore);
  });

  it('returns object-backed file store when mode=file and base dir is provided', () => {
    const store = createMatchArtifactStore({
      MATCH_ARTIFACT_STORE: 'file',
      MATCH_ARTIFACT_BASE_DIR: '/tmp/poker-artifacts',
    });
    expect(store).toBeInstanceOf(ObjectMatchArtifactStore);
  });

  it('rejects file mode without a base dir', () => {
    expect(() => createMatchArtifactStore({ MATCH_ARTIFACT_STORE: 'file' }))
      .toThrow('MATCH_ARTIFACT_BASE_DIR is required when MATCH_ARTIFACT_STORE=file');
  });

  it('rejects object mode without an injected object store', () => {
    expect(() => createMatchArtifactStore({ MATCH_ARTIFACT_STORE: 'object' }))
      .toThrow('object mode requires an injected IObjectStore');
  });
});
