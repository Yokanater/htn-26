import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Private single-process SQLite storage. Values never leave owner-scoped services. */
export class PrivateDatabase {
  readonly db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(
      'PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS private_state (namespace TEXT, key TEXT, value TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(namespace,key))',
    );
    this.db.prepare('DELETE FROM private_state WHERE updated < ?').run(Date.now() - 30 * 86400_000);
  }
  map<T>(namespace: string): Map<string, T> {
    return new DurableMap<T>(this.db, namespace);
  }
}

class DurableMap<T> extends Map<string, T> {
  constructor(
    private readonly db: DatabaseSync,
    private readonly namespace: string,
  ) {
    super();
    const rows = db
      .prepare('SELECT key, value FROM private_state WHERE namespace = ?')
      .all(namespace);
    for (const row of rows)
      super.set(
        String(row.key),
        JSON.parse(String(row.value), (_key, value) =>
          value?.__privateMap ? new Map(value.__privateMap) : value,
        ),
      );
  }
  override set(key: string, value: T): this {
    const encoded = JSON.stringify(value, (_key, item) =>
      item instanceof Map ? { __privateMap: [...item] } : item,
    );
    this.db
      .prepare(
        'INSERT INTO private_state VALUES (?, ?, ?, ?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value, updated=excluded.updated',
      )
      .run(this.namespace, key, encoded, Date.now());
    return super.set(key, value);
  }
  override delete(key: string): boolean {
    this.db
      .prepare('DELETE FROM private_state WHERE namespace = ? AND key = ?')
      .run(this.namespace, key);
    return super.delete(key);
  }
}
