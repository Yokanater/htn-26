import { newId } from '@sei/contracts';

export const SESSION_COOKIE = 'sei_owner';

export class OwnerSessions {
  readonly #active = new Set<string>();

  create(): string {
    const id = newId('sess_');
    this.#active.add(id);
    return id;
  }

  valid(id: string | undefined): id is string {
    return Boolean(id && this.#active.has(id));
  }

  revoke(id: string): void {
    this.#active.delete(id);
  }
}
