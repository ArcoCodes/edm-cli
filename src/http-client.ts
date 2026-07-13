export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface ApiClient {
  request<T>(path: string, init?: RequestInit): Promise<T>;
}

export function createApiClient(baseUrl: string, cookie: string, fetchImpl: typeof fetch = fetch): ApiClient {
  return {
    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
      const res = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          ...(init.headers as Record<string, string> | undefined),
        },
      });
      const body: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const record = body as Record<string, unknown>;
        const message = (record.error as string | undefined) ?? (record.message as string | undefined) ?? `HTTP ${res.status}`;
        throw new ApiError(message, res.status);
      }
      return body as T;
    },
  };
}
