import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

export type SqliteDb = Database.Database;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadSchema(): string {
  const candidates = [
    path.join(__dirname, 'schema.sql'),
    // Fallback for cases where the compiled artifact is in dist/ but schema.sql wasn't copied.
    path.join(__dirname, '..', '..', 'src', 'sqlite', 'schema.sql'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8');
  }
  throw new Error(`schema.sql not found near ${__dirname}`);
}

export function openDatabase(filePath?: string): SqliteDb {
  const target = filePath ?? process.env.DATABASE_PATH ?? ':memory:';
  const db = new Database(target);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(loadSchema());
  return db;
}
