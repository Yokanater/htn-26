/** Same-origin JSON client shared by the shell. Owner: L4. */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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

let sessionRequest: Promise<{ owner: boolean }> | null = null;

/** Share initial setup and recovery so concurrent requests cannot create competing cookies. */
function ensureSession() {
  sessionRequest ??= request<{ owner: boolean }>('/api/session').finally(() => {
    sessionRequest = null;
  });
  return sessionRequest;
}

export async function json<T>(path: string, init?: RequestInit): Promise<T> {
  if (path === '/api/session' && (!init?.method || init.method === 'GET'))
    return ensureSession() as Promise<T>;
  // Wait for initial app setup when it is already in flight.
  if (sessionRequest && path.startsWith('/api/')) await sessionRequest;
  try {
    return await request<T>(path, init);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      error.code === 'UNAUTHORIZED' &&
      path.startsWith('/api/') &&
      path !== '/api/session' &&
      !init?.signal?.aborted
    ) {
      await ensureSession();
      // Only an authentication rejection is replayed, once. No provider operation ran yet.
      return request<T>(path, init);
    }
    throw error;
  }
}
