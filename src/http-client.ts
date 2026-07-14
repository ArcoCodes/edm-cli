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

export interface ApiClientOptions {
  fetchImpl?: typeof fetch;
  onCookieRefresh?: (newCookie: string) => void;
}

export function createApiClient(baseUrl: string, initialCookie: string, optsOrFetch?: ApiClientOptions | typeof fetch): ApiClient {
  const opts: ApiClientOptions = typeof optsOrFetch === 'function' ? { fetchImpl: optsOrFetch } : (optsOrFetch ?? {});
  const fetchFn = opts.fetchImpl ?? fetch;
  let cookie = initialCookie;

  return {
    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
      const res = await fetchFn(`${baseUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          ...(init.headers as Record<string, string> | undefined),
        },
      });

      const setCookies = res.headers.getSetCookie?.() ?? [];
      if (setCookies.length > 0) {
        cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
        opts.onCookieRefresh?.(cookie);
      }

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
