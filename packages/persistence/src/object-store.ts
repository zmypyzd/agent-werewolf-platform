import fs from 'fs';
import path from 'path';

export interface ObjectStorePutTextInput {
  key: string;
  body: string;
  contentType: string;
}

export interface ObjectStoreListOptions {
  prefix?: string;
  limit?: number;
}

export interface ObjectStoreObjectInfo {
  key: string;
  bytes: number;
  contentType?: string;
  updatedAt?: number;
}

export interface IObjectStore {
  putText(input: ObjectStorePutTextInput): Promise<ObjectStoreObjectInfo>;
  getText(key: string): Promise<string | null>;
  exists(key: string): Promise<boolean>;
  list(options?: ObjectStoreListOptions): Promise<ObjectStoreObjectInfo[]>;
  delete?(key: string): Promise<void>;
}

interface MemoryObjectRecord {
  body: string;
  contentType: string;
  updatedAt: number;
}

function validateObjectKey(key: string): string {
  const segments = key.split('/');
  if (
    key.length === 0 ||
    path.isAbsolute(key) ||
    path.win32.isAbsolute(key) ||
    key.includes('\\') ||
    segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid object key: ${key}`);
  }
  return key;
}

function objectInfo(
  key: string,
  body: string,
  contentType: string | undefined,
  updatedAt: number,
): ObjectStoreObjectInfo {
  return {
    key,
    bytes: Buffer.byteLength(body, 'utf-8'),
    ...(contentType !== undefined ? { contentType } : {}),
    updatedAt,
  };
}

export class MemoryObjectStore implements IObjectStore {
  private records = new Map<string, MemoryObjectRecord>();

  async putText(input: ObjectStorePutTextInput): Promise<ObjectStoreObjectInfo> {
    const key = validateObjectKey(input.key);
    const updatedAt = Date.now();
    this.records.set(key, {
      body: input.body,
      contentType: input.contentType,
      updatedAt,
    });
    return objectInfo(key, input.body, input.contentType, updatedAt);
  }

  async getText(key: string): Promise<string | null> {
    return this.records.get(validateObjectKey(key))?.body ?? null;
  }

  async exists(key: string): Promise<boolean> {
    return this.records.has(validateObjectKey(key));
  }

  async list(options: ObjectStoreListOptions = {}): Promise<ObjectStoreObjectInfo[]> {
    const prefix = options.prefix ?? '';
    if (prefix.length > 0) validateObjectKey(`${prefix}placeholder`);
    const all = [...this.records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, record]) => objectInfo(key, record.body, record.contentType, record.updatedAt));
    return options.limit !== undefined ? all.slice(0, options.limit) : all;
  }

  async delete(key: string): Promise<void> {
    this.records.delete(validateObjectKey(key));
  }
}

export class FileObjectStore implements IObjectStore {
  constructor(private readonly baseDir: string) {}

  async putText(input: ObjectStorePutTextInput): Promise<ObjectStoreObjectInfo> {
    const key = validateObjectKey(input.key);
    const file = this.filePath(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, input.body, 'utf-8');
    return objectInfo(key, input.body, input.contentType, Date.now());
  }

  async getText(key: string): Promise<string | null> {
    const file = this.filePath(validateObjectKey(key));
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, 'utf-8');
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(this.filePath(validateObjectKey(key)));
  }

  async list(options: ObjectStoreListOptions = {}): Promise<ObjectStoreObjectInfo[]> {
    const prefix = options.prefix ?? '';
    if (prefix.length > 0) validateObjectKey(`${prefix}placeholder`);
    if (!fs.existsSync(this.baseDir)) return [];

    const keys = this.walk(this.baseDir)
      .map(file => path.relative(this.baseDir, file).split(path.sep).join('/'))
      .filter(key => key.startsWith(prefix))
      .sort((a, b) => a.localeCompare(b));

    const entries = keys.map(key => {
      const file = this.filePath(key);
      const body = fs.readFileSync(file, 'utf-8');
      return objectInfo(key, body, undefined, fs.statSync(file).mtimeMs);
    });

    return options.limit !== undefined ? entries.slice(0, options.limit) : entries;
  }

  async delete(key: string): Promise<void> {
    const file = this.filePath(validateObjectKey(key));
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  private filePath(key: string): string {
    return path.join(this.baseDir, ...validateObjectKey(key).split('/'));
  }

  private walk(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.flatMap(entry => {
      const next = path.join(dir, entry.name);
      return entry.isDirectory() ? this.walk(next) : [next];
    });
  }
}
