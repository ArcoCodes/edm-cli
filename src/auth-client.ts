export interface LoginResult {
  cookie: string;
}

export async function signInWithEmail(
  baseUrl: string,
  email: string,
  password: string,
  fetchImpl: typeof fetch = fetch
): Promise<LoginResult> {
  const res = await fetchImpl(`${baseUrl}/api/_es/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const record = body as Record<string, unknown>;
    const message = (record.message as string | undefined) ?? (record.error as string | undefined) ?? `Login failed (HTTP ${res.status})`;
    throw new Error(message);
  }
  const cookies = res.headers.getSetCookie?.() ?? [];
  if (cookies.length === 0) {
    throw new Error('Login succeeded but the server did not return a session cookie.');
  }
  const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
  return { cookie };
}
