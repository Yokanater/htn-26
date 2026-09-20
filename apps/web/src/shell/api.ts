/** Same-origin JSON client shared by the shell. Owner: L4. */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number = 0,
  ) {
    super(message);
  }
}

export async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...init,
    headers,
  });
  // A proxy or crash can answer with plain text: never surface the JSON parse error.
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: { code?: string; message?: string } })
    | null;
  if (!response.ok || payload === null)
    throw new ApiError(
      payload?.error?.message ?? `Request failed (${response.status}). Try again.`,
      payload?.error?.code ?? null,
      response.status,
    );
  return payload;
}
