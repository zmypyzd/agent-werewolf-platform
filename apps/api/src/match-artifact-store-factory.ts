import {
  FileObjectStore,
  MemoryMatchArtifactStore,
  ObjectMatchArtifactStore,
} from '@agent-poker/persistence';
import type { IMatchArtifactStore, IObjectStore } from '@agent-poker/persistence';

export interface MatchArtifactStoreEnv {
  MATCH_ARTIFACT_STORE?: string;
  MATCH_ARTIFACT_BASE_DIR?: string;
}

export interface MatchArtifactStoreFactoryOptions {
  objectStore?: IObjectStore;
}

export function createMatchArtifactStore(
  env: MatchArtifactStoreEnv = process.env,
  options: MatchArtifactStoreFactoryOptions = {},
): IMatchArtifactStore {
  const mode = env.MATCH_ARTIFACT_STORE ?? 'memory';

  if (mode === 'memory') return new MemoryMatchArtifactStore();

  if (mode === 'file') {
    const baseDir = env.MATCH_ARTIFACT_BASE_DIR;
    if (!baseDir) {
      throw new Error('MATCH_ARTIFACT_BASE_DIR is required when MATCH_ARTIFACT_STORE=file');
    }
    return new ObjectMatchArtifactStore(new FileObjectStore(baseDir));
  }

  if (mode === 'object') {
    if (!options.objectStore) {
      throw new Error('object mode requires an injected IObjectStore');
    }
    return new ObjectMatchArtifactStore(options.objectStore);
  }

  throw new Error(`Unsupported MATCH_ARTIFACT_STORE mode: ${mode}`);
}
