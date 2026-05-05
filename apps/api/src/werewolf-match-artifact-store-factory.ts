import {
  FileObjectStore,
  MemoryWerewolfMatchArtifactStore,
  ObjectWerewolfMatchArtifactStore,
} from '@agent-poker/persistence';
import type { IObjectStore, IWerewolfMatchArtifactStore } from '@agent-poker/persistence';

export interface WerewolfMatchArtifactStoreEnv {
  WEREWOLF_MATCH_ARTIFACT_STORE?: string;
  WEREWOLF_MATCH_ARTIFACT_BASE_DIR?: string;
}

export interface WerewolfMatchArtifactStoreFactoryOptions {
  objectStore?: IObjectStore;
}

export function createWerewolfMatchArtifactStore(
  env: WerewolfMatchArtifactStoreEnv = process.env,
  options: WerewolfMatchArtifactStoreFactoryOptions = {},
): IWerewolfMatchArtifactStore {
  const mode = env.WEREWOLF_MATCH_ARTIFACT_STORE ?? 'memory';

  if (mode === 'memory') return new MemoryWerewolfMatchArtifactStore();

  if (mode === 'file') {
    const baseDir = env.WEREWOLF_MATCH_ARTIFACT_BASE_DIR;
    if (!baseDir) {
      throw new Error(
        'WEREWOLF_MATCH_ARTIFACT_BASE_DIR is required when WEREWOLF_MATCH_ARTIFACT_STORE=file',
      );
    }
    return new ObjectWerewolfMatchArtifactStore(new FileObjectStore(baseDir));
  }

  if (mode === 'object') {
    if (!options.objectStore) {
      throw new Error('object mode requires an injected IObjectStore');
    }
    return new ObjectWerewolfMatchArtifactStore(options.objectStore);
  }

  throw new Error(`Unsupported WEREWOLF_MATCH_ARTIFACT_STORE mode: ${mode}`);
}
