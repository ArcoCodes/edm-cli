import type { ApiClient } from '../http-client.js';
import { signInWithEmail } from '../auth-client.js';
import { saveSession, clearSession, type SessionData } from '../session.js';
import type { Me } from '../types.js';

export interface LoginDeps {
  baseUrl: string;
  promptText: (message: string) => Promise<string>;
  promptHidden: (message: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  sessionFilePath?: string;
}

export async function runLogin(deps: LoginDeps): Promise<{ email: string }> {
  const email = await deps.promptText('Email');
  const password = await deps.promptHidden('Password');
  const { cookie } = await signInWithEmail(deps.baseUrl, email, password, deps.fetchImpl);
  const session: SessionData = { cookie, email, savedAt: Date.now() };
  saveSession(session, deps.sessionFilePath);
  return { email };
}

export function runLogout(sessionFilePath?: string): void {
  clearSession(sessionFilePath);
}

export async function runWhoami(client: ApiClient): Promise<Me> {
  return client.request<Me>('/api/me');
}
