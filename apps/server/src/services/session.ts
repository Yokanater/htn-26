import { newId } from '@sei/contracts';
import type { PrivateDatabase } from './persistence';

export const SESSION_COOKIE = 'sei_owner';

export class OwnerSessions {
  readonly #active: Map<string, number>;

  constructor(database?: PrivateDatabase) {
    this.#active = database?.map<number>('sessions') ?? new Map();
  }

  create(): string {
    const id = newId('sess_');
    this.#active.set(id, Date.now() + 30 * 86400_000);
    return id;
  }

  valid(id: string | undefined): id is string {
    return Boolean(id && (this.#active.get(id) ?? 0) > Date.now());
  }

  revoke(id: string): void {
    this.#active.delete(id);
  }
}
