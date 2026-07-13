# EDM CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, agent-friendly CLI (`edm-cli`) that creates EDM campaigns, writes their HTML/text content, sets recipients, sends them, and inspects history — talking to the already-deployed EDM server's existing `/api/*` routes, with zero changes to that server/web app.

**Architecture:** Plain Node + TypeScript, run via `tsx` (no build step). `commander` for subcommands. A hand-rolled `fetch`-based HTTP client replays a session cookie obtained by logging in through the same Better Auth endpoint the web app's `@edgespark/web` client uses (`POST /api/_es/auth/sign-in/email`), cached at `~/.edm-cli/session.json` (mode 600). Business logic for every command lives in plain, dependency-injected `run*` functions (testable without a network); `src/cli.ts` is a thin commander wiring layer over them.

**Tech Stack:** Node.js ≥18.14 (needed for `Headers.getSetCookie()`), TypeScript, `commander`, `tsx`, Node's built-in `node:test` runner (no test framework dependency).

## Global Constraints

- Target server is fixed: `https://optimal-dodo-5009.edgespark.app` (no `--base-url` flag in this version).
- Never persist the user's password — only the session cookie returned by login is cached, and only to `~/.edm-cli/session.json` with file mode `600`.
- No changes to any file outside this repo (the `edm` server/web app is untouched).
- `campaign send`, `campaign resend-failed`, and `campaign delete` are irreversible/external-effect operations: they must require either an interactive `y/N` confirmation or an explicit `--yes` flag before doing anything.
- Every module with real logic (not pure data/types, not raw terminal IO) gets `node:test` unit tests using dependency-injected fakes (fake `fetch`, fake `ApiClient`, fake prompts) — no real network calls in automated tests.
- All source under `src/`, ESM (`"type": "module"`), `.js` extensions in relative imports (required by NodeNext module resolution even though the files are `.ts`).

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `bin/edm-cli.js`

**Interfaces:**
- Produces: an installable npm project with `npm test` (runs `node:test` via `tsx`) and `npm run typecheck` (runs `tsc --noEmit`) available for every later task.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "edm-cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "edm-cli": "bin/edm-cli.js"
  },
  "engines": {
    "node": ">=18.14.0"
  },
  "scripts": {
    "test": "tsx --test \"src/**/*.test.ts\"",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "tsx": "^4.19.2"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.2"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src", "bin"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
*.log
.DS_Store
```

- [ ] **Step 4: Create the bin wrapper `bin/edm-cli.js`**

```js
#!/usr/bin/env node
import { register } from 'tsx/esm/api';

register();
await import('../src/index.ts');
```

- [ ] **Step 5: Install dependencies and make the bin executable**

Run: `cd /Users/l13/Desktop/edm-cli && npm install && chmod +x bin/edm-cli.js`
Expected: `npm install` completes with no errors (there's no `src/index.ts` yet, so don't run the CLI yet).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore bin/edm-cli.js
git commit -m "chore: scaffold edm-cli project"
```

---

### Task 2: Session storage

**Files:**
- Create: `src/types.ts`
- Create: `src/session.ts`
- Test: `src/session.test.ts`

**Interfaces:**
- Produces: `SessionData { cookie: string; email: string; savedAt: number }`, `sessionFilePath(): string`, `saveSession(data: SessionData, filePath?: string): void`, `loadSession(filePath?: string): SessionData | null`, `clearSession(filePath?: string): void` — all consumed by Task 4 (auth-client is unrelated) and Task 8 (`commands/auth.ts`) and Task 12 (`cli.ts`).
- Produces (types.ts, no behavior, no test needed): `Campaign`, `SendLog`, `Me`, `SendChunkResult` — consumed by Tasks 9, 10, 11, 12.

- [ ] **Step 1: Create `src/types.ts`**

```ts
export interface Campaign {
  id: string;
  name: string;
  subject: string;
  description: string | null;
  contentType: 'html' | 'text';
  htmlContent: string | null;
  textContent: string | null;
  status: string;
  recipientFilter: string | null;
  totalRecipients: number | null;
  sentCount: number;
  failedCount: number;
  openedCount: number;
  clickedCount: number;
  isTest: number;
  startedAt: number | null;
  completedAt: number | null;
  createdBy: string | null;
  sentBy: string | null;
  lastError: string | null;
  sendGeneration: number;
  createdAt: number;
  updatedAt: number;
}

export interface SendLog {
  id: string;
  campaignId: string;
  recipientEmail: string;
  recipientName: string | null;
  status: string;
  error: string | null;
  sentBy: string | null;
  openedAt: number | null;
  clickedAt: number | null;
  createdAt: number;
}

export interface Me {
  email: string;
  isSuperAdmin: boolean;
  canSend: boolean;
}

export interface SendChunkResult {
  done: boolean;
  completed: boolean;
  generation: number;
  sentCount?: number;
  failedCount?: number;
  totalRecipients?: number;
  error?: string;
}
```

- [ ] **Step 2: Write the failing test `src/session.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { saveSession, loadSession, clearSession } from './session.js';

function tempSessionPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'edm-cli-test-')), 'session.json');
}

test('loadSession returns null when no file exists', () => {
  assert.equal(loadSession(tempSessionPath()), null);
});

test('saveSession then loadSession round-trips the data', () => {
  const filePath = tempSessionPath();
  saveSession({ cookie: 'a=1', email: 'x@youware.com', savedAt: 123 }, filePath);
  assert.deepEqual(loadSession(filePath), { cookie: 'a=1', email: 'x@youware.com', savedAt: 123 });
});

test('saveSession writes the file with mode 600', () => {
  const filePath = tempSessionPath();
  saveSession({ cookie: 'a=1', email: 'x@youware.com', savedAt: 123 }, filePath);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
});

test('clearSession removes an existing session file', () => {
  const filePath = tempSessionPath();
  saveSession({ cookie: 'a=1', email: 'x@youware.com', savedAt: 123 }, filePath);
  clearSession(filePath);
  assert.equal(fs.existsSync(filePath), false);
});

test('clearSession is a no-op when no file exists', () => {
  assert.doesNotThrow(() => clearSession(tempSessionPath()));
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/session.test.ts`
Expected: FAIL — `Cannot find module './session.js'`

- [ ] **Step 4: Implement `src/session.ts`**

```ts
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface SessionData {
  cookie: string;
  email: string;
  savedAt: number;
}

export function sessionFilePath(): string {
  return path.join(os.homedir(), '.edm-cli', 'session.json');
}

export function saveSession(data: SessionData, filePath: string = sessionFilePath()): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

export function loadSession(filePath: string = sessionFilePath()): SessionData | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SessionData;
  } catch {
    return null;
  }
}

export function clearSession(filePath: string = sessionFilePath()): void {
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/session.test.ts`
Expected: PASS — 5 tests passing

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/session.ts src/session.test.ts
git commit -m "feat: add session storage and shared types"
```

---

### Task 3: HTTP client

**Files:**
- Create: `src/http-client.ts`
- Test: `src/http-client.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `class ApiError extends Error { status: number }`, `interface ApiClient { request<T>(path: string, init?: RequestInit): Promise<T> }`, `createApiClient(baseUrl: string, cookie: string, fetchImpl?: typeof fetch): ApiClient` — consumed by every command module (Tasks 8–12).

- [ ] **Step 1: Write the failing test `src/http-client.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiError } from './http-client.js';

test('request returns parsed JSON body on success', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ campaign: { id: 'c1' } }), { status: 200 });
  const client = createApiClient('https://example.test', 'session=abc', fakeFetch as typeof fetch);
  const result = await client.request<{ campaign: { id: string } }>('/api/campaigns/c1');
  assert.deepEqual(result, { campaign: { id: 'c1' } });
});

test('request sends the cookie header', async () => {
  let capturedHeaders: Headers | undefined;
  const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = new Headers(init?.headers);
    return new Response('{}', { status: 200 });
  };
  const client = createApiClient('https://example.test', 'session=abc', fakeFetch as typeof fetch);
  await client.request('/api/me');
  assert.equal(capturedHeaders?.get('cookie'), 'session=abc');
});

test('request throws ApiError with the server error message on failure', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ error: 'Campaign not found' }), { status: 404 });
  const client = createApiClient('https://example.test', 'session=abc', fakeFetch as typeof fetch);
  await assert.rejects(
    () => client.request('/api/campaigns/missing'),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.message, 'Campaign not found');
      assert.equal(err.status, 404);
      return true;
    }
  );
});

test('request falls back to a generic message when the body has neither error nor message', async () => {
  const fakeFetch = async () => new Response('not json', { status: 500 });
  const client = createApiClient('https://example.test', 'session=abc', fakeFetch as typeof fetch);
  await assert.rejects(
    () => client.request('/api/campaigns'),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.message, 'HTTP 500');
      return true;
    }
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/http-client.test.ts`
Expected: FAIL — `Cannot find module './http-client.js'`

- [ ] **Step 3: Implement `src/http-client.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/http-client.test.ts`
Expected: PASS — 4 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/http-client.ts src/http-client.test.ts
git commit -m "feat: add HTTP client with cookie auth and error normalization"
```

---

### Task 4: Auth client (login endpoint)

**Files:**
- Create: `src/auth-client.ts`
- Test: `src/auth-client.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `interface LoginResult { cookie: string }`, `signInWithEmail(baseUrl: string, email: string, password: string, fetchImpl?: typeof fetch): Promise<LoginResult>` — consumed by Task 8 (`commands/auth.ts`).

The real endpoint (`POST /api/_es/auth/sign-in/email`) was probed directly against production with bogus credentials and confirmed to return `{"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}` with HTTP 401 — the error-path test below matches that exactly. The success path (cookie(s) via `Set-Cookie`) is inferred from Better Auth's client contract used by `@edgespark/web`; Task 14 verifies it against a real account.

- [ ] **Step 1: Write the failing test `src/auth-client.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signInWithEmail } from './auth-client.js';

function responseWithCookies(bodyObj: unknown, status: number, cookies: string[]): Response {
  const headers = new Headers();
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(JSON.stringify(bodyObj), { status, headers });
}

test('signInWithEmail returns a combined cookie string on success', async () => {
  const fakeFetch = async () =>
    responseWithCookies({ user: { email: 'a@youware.com' } }, 200, [
      'better-auth.session_token=xyz; Path=/; HttpOnly',
      'other=1; Path=/',
    ]);
  const result = await signInWithEmail('https://example.test', 'a@youware.com', 'pw', fakeFetch as typeof fetch);
  assert.equal(result.cookie, 'better-auth.session_token=xyz; other=1');
});

test('signInWithEmail throws the exact server message on invalid credentials', async () => {
  const fakeFetch = async () =>
    new Response(JSON.stringify({ message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD' }), { status: 401 });
  await assert.rejects(
    () => signInWithEmail('https://example.test', 'a@youware.com', 'wrong', fakeFetch as typeof fetch),
    { message: 'Invalid email or password' }
  );
});

test('signInWithEmail throws when the server returns no cookie', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ user: {} }), { status: 200 });
  await assert.rejects(
    () => signInWithEmail('https://example.test', 'a@youware.com', 'pw', fakeFetch as typeof fetch),
    { message: 'Login succeeded but the server did not return a session cookie.' }
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/auth-client.test.ts`
Expected: FAIL — `Cannot find module './auth-client.js'`

- [ ] **Step 3: Implement `src/auth-client.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/auth-client.test.ts`
Expected: PASS — 3 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/auth-client.ts src/auth-client.test.ts
git commit -m "feat: add Better Auth email/password sign-in client"
```

---

### Task 5: Terminal prompts (no automated test)

**Files:**
- Create: `src/prompt.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `promptText(message: string): Promise<string>`, `confirm(message: string): Promise<boolean>`, `promptHidden(message: string): Promise<string>` — consumed by Task 12 (`cli.ts`, as the real, non-fake implementations of the prompt/confirm dependencies).

This module is raw terminal IO (masked password input via stdin raw mode) with no meaningful assertions to make without an actual pty — faking one would test the fake, not the behavior. It is verified manually in Task 14 by actually running `edm-cli login` and `edm-cli campaign delete` interactively. Every other task that *uses* prompting (Tasks 8, 11, 12) takes these functions as injected dependencies and is tested by passing fakes, so the risk of this module having a bug is isolated to Task 14's manual check.

- [ ] **Step 1: Implement `src/prompt.ts`**

```ts
import * as readline from 'node:readline';

export async function promptText(message: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(`${message}: `, resolve));
  rl.close();
  return answer.trim();
}

export async function confirm(message: string): Promise<boolean> {
  const answer = await promptText(`${message} [y/N]`);
  return /^y(es)?$/i.test(answer);
}

export async function promptHidden(message: string): Promise<string> {
  return new Promise<string>((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(`${message}: `);
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let input = '';
    const onData = (char: string) => {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input);
        return;
      }
      if (char === '\u0003') {
        process.stdout.write('\n');
        process.exit(1);
      }
      if (char === '\x7f' || char === '\b') {
        input = input.slice(0, -1);
        return;
      }
      input += char;
    };
    stdin.on('data', onData);
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/l13/Desktop/edm-cli && npm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/prompt.ts
git commit -m "feat: add terminal prompt helpers (text, confirm, hidden password)"
```

---

### Task 6: Recipient filter parsing

**Files:**
- Create: `src/recipients.ts`
- Test: `src/recipients.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `type RecipientFilter = { type: 'all' } | { type: 'active'; days: number } | { type: 'plan_starter' } | { type: 'plan_standard' } | { type: 'plan_advanced' } | { type: 'manual'; emails: string[] }`, `interface RecipientFlags { recipients?: string; days?: string; emails?: string }`, `parseRecipientFilter(flags: RecipientFlags): RecipientFilter` (throws `Error` with a descriptive message on invalid input), `filterToQuery(filter: RecipientFilter): string` — consumed by Tasks 9, 10, 11, 12.

- [ ] **Step 1: Write the failing test `src/recipients.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecipientFilter, filterToQuery } from './recipients.js';

test('parseRecipientFilter requires --recipients', () => {
  assert.throws(() => parseRecipientFilter({}), /--recipients is required/);
});

test('parseRecipientFilter rejects an unknown type', () => {
  assert.throws(() => parseRecipientFilter({ recipients: 'bogus' }), /Invalid --recipients value/);
});

test('parseRecipientFilter returns {type:"all"} for all', () => {
  assert.deepEqual(parseRecipientFilter({ recipients: 'all' }), { type: 'all' });
});

test('parseRecipientFilter defaults days to 30 for active', () => {
  assert.deepEqual(parseRecipientFilter({ recipients: 'active' }), { type: 'active', days: 30 });
});

test('parseRecipientFilter honors an explicit --days for active', () => {
  assert.deepEqual(parseRecipientFilter({ recipients: 'active', days: '7' }), { type: 'active', days: 7 });
});

test('parseRecipientFilter rejects an out-of-range --days', () => {
  assert.throws(() => parseRecipientFilter({ recipients: 'active', days: '400' }), /--days must be an integer between 1 and 365/);
});

test('parseRecipientFilter parses a comma-separated --emails list for manual', () => {
  assert.deepEqual(
    parseRecipientFilter({ recipients: 'manual', emails: 'a@b.com, c@d.com' }),
    { type: 'manual', emails: ['a@b.com', 'c@d.com'] }
  );
});

test('parseRecipientFilter rejects manual with no --emails', () => {
  assert.throws(() => parseRecipientFilter({ recipients: 'manual' }), /--emails is required/);
});

test('parseRecipientFilter rejects an invalid email in --emails', () => {
  assert.throws(() => parseRecipientFilter({ recipients: 'manual', emails: 'not-an-email' }), /Invalid email address/);
});

test('parseRecipientFilter passes through plan_starter/plan_standard/plan_advanced', () => {
  assert.deepEqual(parseRecipientFilter({ recipients: 'plan_starter' }), { type: 'plan_starter' });
  assert.deepEqual(parseRecipientFilter({ recipients: 'plan_standard' }), { type: 'plan_standard' });
  assert.deepEqual(parseRecipientFilter({ recipients: 'plan_advanced' }), { type: 'plan_advanced' });
});

test('filterToQuery serializes each filter type', () => {
  assert.equal(filterToQuery({ type: 'all' }), 'type=all');
  assert.equal(filterToQuery({ type: 'active', days: 7 }), 'type=active&days=7');
  assert.equal(filterToQuery({ type: 'manual', emails: ['a@b.com', 'c@d.com'] }), 'type=manual&emails=a%40b.com%2Cc%40d.com');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/recipients.test.ts`
Expected: FAIL — `Cannot find module './recipients.js'`

- [ ] **Step 3: Implement `src/recipients.ts`**

```ts
export type RecipientFilter =
  | { type: 'all' }
  | { type: 'active'; days: number }
  | { type: 'plan_starter' }
  | { type: 'plan_standard' }
  | { type: 'plan_advanced' }
  | { type: 'manual'; emails: string[] };

export interface RecipientFlags {
  recipients?: string;
  days?: string;
  emails?: string;
}

const VALID_TYPES = ['all', 'active', 'plan_starter', 'plan_standard', 'plan_advanced', 'manual'] as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseRecipientFilter(flags: RecipientFlags): RecipientFilter {
  if (!flags.recipients) {
    throw new Error('--recipients is required (one of: all, active, plan_starter, plan_standard, plan_advanced, manual)');
  }
  if (!(VALID_TYPES as readonly string[]).includes(flags.recipients)) {
    throw new Error(`Invalid --recipients value "${flags.recipients}" (must be one of: ${VALID_TYPES.join(', ')})`);
  }
  const type = flags.recipients as (typeof VALID_TYPES)[number];

  if (type === 'active') {
    const days = flags.days ? Number(flags.days) : 30;
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new Error('--days must be an integer between 1 and 365');
    }
    return { type: 'active', days };
  }

  if (type === 'manual') {
    const emails = (flags.emails ?? '').split(',').map((e) => e.trim()).filter(Boolean);
    if (emails.length === 0) {
      throw new Error('--emails is required and must be non-empty when --recipients manual');
    }
    for (const email of emails) {
      if (!EMAIL_PATTERN.test(email)) {
        throw new Error(`Invalid email address in --emails: "${email}"`);
      }
    }
    return { type: 'manual', emails };
  }

  return { type } as RecipientFilter;
}

export function filterToQuery(filter: RecipientFilter): string {
  const params = new URLSearchParams({ type: filter.type });
  if (filter.type === 'active') params.set('days', String(filter.days));
  if (filter.type === 'manual') params.set('emails', filter.emails.join(','));
  return params.toString();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/recipients.test.ts`
Expected: PASS — 11 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/recipients.ts src/recipients.test.ts
git commit -m "feat: add recipient filter parsing and query serialization"
```

---

### Task 7: Output formatting

**Files:**
- Create: `src/output.ts`
- Test: `src/output.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `printOutput(json: boolean, value: unknown, humanLines: string[]): void` — consumed by Task 12 (`cli.ts`), once per command.

- [ ] **Step 1: Write the failing test `src/output.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printOutput } from './output.js';

function captureConsoleLog(fn: () => void): string[] {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines;
}

test('printOutput prints human lines when json is false', () => {
  const lines = captureConsoleLog(() => printOutput(false, { id: 'c1' }, ['id: c1', 'status: draft']));
  assert.deepEqual(lines, ['id: c1', 'status: draft']);
});

test('printOutput prints pretty JSON when json is true', () => {
  const lines = captureConsoleLog(() => printOutput(true, { id: 'c1' }, ['id: c1']));
  assert.deepEqual(lines, [JSON.stringify({ id: 'c1' }, null, 2)]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/output.test.ts`
Expected: FAIL — `Cannot find module './output.js'`

- [ ] **Step 3: Implement `src/output.ts`**

```ts
export function printOutput(json: boolean, value: unknown, humanLines: string[]): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    for (const line of humanLines) {
      console.log(line);
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/output.test.ts`
Expected: PASS — 2 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/output.ts src/output.test.ts
git commit -m "feat: add human/JSON output formatter"
```

---

### Task 8: Auth commands (login/logout/whoami)

**Files:**
- Create: `src/commands/auth.ts`
- Test: `src/commands/auth.test.ts`

**Interfaces:**
- Consumes: `signInWithEmail` (Task 4), `saveSession`/`clearSession`/`SessionData` (Task 2), `ApiClient` (Task 3), `Me` (Task 2's `types.ts`).
- Produces: `interface LoginDeps { baseUrl: string; promptText: (message: string) => Promise<string>; promptHidden: (message: string) => Promise<string>; fetchImpl?: typeof fetch; sessionFilePath?: string }`, `runLogin(deps: LoginDeps): Promise<{ email: string }>`, `runLogout(sessionFilePath?: string): void`, `runWhoami(client: ApiClient): Promise<Me>` — consumed by Task 12 (`cli.ts`).

- [ ] **Step 1: Write the failing test `src/commands/auth.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runLogin, runLogout, runWhoami } from './auth.js';
import { loadSession } from '../session.js';
import type { ApiClient } from '../http-client.js';

function tempSessionPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'edm-cli-test-')), 'session.json');
}

test('runLogin prompts for credentials, signs in, and saves the session', async () => {
  const filePath = tempSessionPath();
  const fakeFetch = async () => {
    const headers = new Headers();
    headers.append('set-cookie', 'session=xyz; Path=/');
    return new Response(JSON.stringify({ user: {} }), { status: 200, headers });
  };
  const result = await runLogin({
    baseUrl: 'https://example.test',
    promptText: async () => 'a@youware.com',
    promptHidden: async () => 'pw',
    fetchImpl: fakeFetch as typeof fetch,
    sessionFilePath: filePath,
  });
  assert.equal(result.email, 'a@youware.com');
  const saved = loadSession(filePath);
  assert.equal(saved?.cookie, 'session=xyz');
  assert.equal(saved?.email, 'a@youware.com');
});

test('runLogout clears the cached session', () => {
  const filePath = tempSessionPath();
  fs.writeFileSync(filePath, JSON.stringify({ cookie: 'x', email: 'a@b.com', savedAt: 1 }));
  runLogout(filePath);
  assert.equal(fs.existsSync(filePath), false);
});

test('runWhoami returns the client response verbatim', async () => {
  const fakeClient: ApiClient = {
    request: async () => ({ email: 'a@youware.com', isSuperAdmin: false, canSend: true }),
  };
  const me = await runWhoami(fakeClient);
  assert.deepEqual(me, { email: 'a@youware.com', isSuperAdmin: false, canSend: true });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/commands/auth.test.ts`
Expected: FAIL — `Cannot find module './auth.js'`

- [ ] **Step 3: Implement `src/commands/auth.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/commands/auth.test.ts`
Expected: PASS — 3 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/commands/auth.ts src/commands/auth.test.ts
git commit -m "feat: add login/logout/whoami command logic"
```

---

### Task 9: Campaign write commands (create/update/set-html/set-text/set-recipients)

**Files:**
- Create: `src/commands/campaign-write.ts`
- Test: `src/commands/campaign-write.test.ts`

**Interfaces:**
- Consumes: `ApiClient` (Task 3), `Campaign` (Task 2), `parseRecipientFilter`/`RecipientFlags` (Task 6).
- Produces: `interface CreateOpts { name: string; subject: string; description?: string; contentType?: 'html' | 'text'; file: string; test?: boolean; recipientFlags: RecipientFlags }`, `runCreate(client: ApiClient, opts: CreateOpts): Promise<Campaign>`, `interface UpdateOpts { name?: string; subject?: string; description?: string }`, `runUpdate(client: ApiClient, id: string, opts: UpdateOpts): Promise<Campaign>`, `runSetHtml(client: ApiClient, id: string, filePath: string): Promise<Campaign>`, `runSetText(client: ApiClient, id: string, filePath: string): Promise<Campaign>`, `runSetRecipients(client: ApiClient, id: string, flags: RecipientFlags): Promise<Campaign>` — consumed by Task 12 (`cli.ts`).

- [ ] **Step 1: Write the failing test `src/commands/campaign-write.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runCreate, runUpdate, runSetHtml, runSetText, runSetRecipients } from './campaign-write.js';
import type { ApiClient } from '../http-client.js';
import type { Campaign } from '../types.js';

function tempFile(content: string, ext = '.html'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edm-cli-test-'));
  const file = path.join(dir, `content${ext}`);
  fs.writeFileSync(file, content);
  return file;
}

function fakeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'c1', name: 'n', subject: 's', description: null, contentType: 'html',
    htmlContent: null, textContent: null, status: 'draft', recipientFilter: null,
    totalRecipients: null, sentCount: 0, failedCount: 0, openedCount: 0, clickedCount: 0,
    isTest: 0, startedAt: null, completedAt: null, createdBy: null, sentBy: null,
    lastError: null, sendGeneration: 0, createdAt: 0, updatedAt: 0, ...overrides,
  };
}

function recordingClient(response: unknown): { client: ApiClient; calls: Array<{ path: string; init?: RequestInit }> } {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  return {
    calls,
    client: {
      request: async (reqPath: string, init?: RequestInit) => {
        calls.push({ path: reqPath, init });
        return response as any;
      },
    },
  };
}

test('runCreate reads the file and POSTs htmlContent for html campaigns', async () => {
  const file = tempFile('<p>hi</p>');
  const { client, calls } = recordingClient({ campaign: fakeCampaign() });
  await runCreate(client, { name: 'N', subject: 'S', file, recipientFlags: {} });
  assert.equal(calls[0].path, '/api/campaigns');
  assert.equal(calls[0].init?.method, 'POST');
  const body = JSON.parse(calls[0].init?.body as string);
  assert.equal(body.htmlContent, '<p>hi</p>');
  assert.equal(body.contentType, 'html');
});

test('runCreate POSTs textContent for text campaigns', async () => {
  const file = tempFile('hello', '.txt');
  const { client, calls } = recordingClient({ campaign: fakeCampaign() });
  await runCreate(client, { name: 'N', subject: 'S', file, contentType: 'text', recipientFlags: {} });
  const body = JSON.parse(calls[0].init?.body as string);
  assert.equal(body.textContent, 'hello');
  assert.equal(body.contentType, 'text');
});

test('runCreate includes a parsed recipientFilter when --recipients is given', async () => {
  const file = tempFile('<p>hi</p>');
  const { client, calls } = recordingClient({ campaign: fakeCampaign() });
  await runCreate(client, { name: 'N', subject: 'S', file, recipientFlags: { recipients: 'active', days: '7' } });
  const body = JSON.parse(calls[0].init?.body as string);
  assert.deepEqual(body.recipientFilter, { type: 'active', days: 7 });
});

test('runCreate throws when the file does not exist', async () => {
  const { client } = recordingClient({ campaign: fakeCampaign() });
  await assert.rejects(
    () => runCreate(client, { name: 'N', subject: 'S', file: '/no/such/file.html', recipientFlags: {} }),
    /File not found/
  );
});

test('runUpdate PUTs the given fields', async () => {
  const { client, calls } = recordingClient({ campaign: fakeCampaign({ name: 'New' }) });
  const campaign = await runUpdate(client, 'c1', { name: 'New' });
  assert.equal(calls[0].path, '/api/campaigns/c1');
  assert.equal(calls[0].init?.method, 'PUT');
  assert.equal(campaign.name, 'New');
});

test('runSetHtml reads the file and PUTs htmlContent + contentType html', async () => {
  const file = tempFile('<p>v2</p>');
  const { client, calls } = recordingClient({ campaign: fakeCampaign() });
  await runSetHtml(client, 'c1', file);
  const body = JSON.parse(calls[0].init?.body as string);
  assert.equal(body.htmlContent, '<p>v2</p>');
  assert.equal(body.contentType, 'html');
});

test('runSetText reads the file and PUTs textContent + contentType text', async () => {
  const file = tempFile('plain body', '.txt');
  const { client, calls } = recordingClient({ campaign: fakeCampaign() });
  await runSetText(client, 'c1', file);
  const body = JSON.parse(calls[0].init?.body as string);
  assert.equal(body.textContent, 'plain body');
  assert.equal(body.contentType, 'text');
});

test('runSetRecipients PUTs the parsed recipientFilter', async () => {
  const { client, calls } = recordingClient({ campaign: fakeCampaign() });
  await runSetRecipients(client, 'c1', { recipients: 'manual', emails: 'a@b.com' });
  const body = JSON.parse(calls[0].init?.body as string);
  assert.deepEqual(body.recipientFilter, { type: 'manual', emails: ['a@b.com'] });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/commands/campaign-write.test.ts`
Expected: FAIL — `Cannot find module './campaign-write.js'`

- [ ] **Step 3: Implement `src/commands/campaign-write.ts`**

```ts
import * as fs from 'node:fs';
import type { ApiClient } from '../http-client.js';
import type { Campaign } from '../types.js';
import { parseRecipientFilter, type RecipientFlags } from '../recipients.js';

function readContentFile(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.trim()) {
    throw new Error(`File is empty: ${filePath}`);
  }
  return content;
}

export interface CreateOpts {
  name: string;
  subject: string;
  description?: string;
  contentType?: 'html' | 'text';
  file: string;
  test?: boolean;
  recipientFlags: RecipientFlags;
}

export async function runCreate(client: ApiClient, opts: CreateOpts): Promise<Campaign> {
  const contentType = opts.contentType ?? 'html';
  const content = readContentFile(opts.file);
  const recipientFilter = opts.recipientFlags.recipients ? parseRecipientFilter(opts.recipientFlags) : undefined;
  const body: Record<string, unknown> = {
    name: opts.name,
    subject: opts.subject,
    description: opts.description,
    contentType,
    isTest: opts.test,
    recipientFilter,
  };
  if (contentType === 'html') body.htmlContent = content;
  else body.textContent = content;
  const result = await client.request<{ campaign: Campaign }>('/api/campaigns', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return result.campaign;
}

export interface UpdateOpts {
  name?: string;
  subject?: string;
  description?: string;
}

export async function runUpdate(client: ApiClient, id: string, opts: UpdateOpts): Promise<Campaign> {
  const result = await client.request<{ campaign: Campaign }>(`/api/campaigns/${id}`, {
    method: 'PUT',
    body: JSON.stringify(opts),
  });
  return result.campaign;
}

export async function runSetHtml(client: ApiClient, id: string, filePath: string): Promise<Campaign> {
  const htmlContent = readContentFile(filePath);
  const result = await client.request<{ campaign: Campaign }>(`/api/campaigns/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ contentType: 'html', htmlContent }),
  });
  return result.campaign;
}

export async function runSetText(client: ApiClient, id: string, filePath: string): Promise<Campaign> {
  const textContent = readContentFile(filePath);
  const result = await client.request<{ campaign: Campaign }>(`/api/campaigns/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ contentType: 'text', textContent }),
  });
  return result.campaign;
}

export async function runSetRecipients(client: ApiClient, id: string, flags: RecipientFlags): Promise<Campaign> {
  const recipientFilter = parseRecipientFilter(flags);
  const result = await client.request<{ campaign: Campaign }>(`/api/campaigns/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ recipientFilter }),
  });
  return result.campaign;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/commands/campaign-write.test.ts`
Expected: PASS — 8 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/commands/campaign-write.ts src/commands/campaign-write.test.ts
git commit -m "feat: add campaign create/update/set-html/set-text/set-recipients logic"
```

---

### Task 10: Campaign read commands (list/get/logs/preview-recipients)

**Files:**
- Create: `src/commands/campaign-read.ts`
- Test: `src/commands/campaign-read.test.ts`

**Interfaces:**
- Consumes: `ApiClient` (Task 3), `Campaign`/`SendLog` (Task 2), `parseRecipientFilter`/`filterToQuery`/`RecipientFlags` (Task 6).
- Produces: `interface ListOpts { status?: string; limit?: number; offset?: number }`, `runList(client: ApiClient, opts: ListOpts): Promise<Campaign[]>`, `runGet(client: ApiClient, id: string): Promise<Campaign>`, `interface LogsOpts { status?: string; email?: string; limit?: number; offset?: number }`, `runLogs(client: ApiClient, id: string, opts: LogsOpts): Promise<SendLog[]>`, `runPreviewRecipients(client: ApiClient, flags: RecipientFlags): Promise<number>` — consumed by Task 12 (`cli.ts`).

- [ ] **Step 1: Write the failing test `src/commands/campaign-read.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runList, runGet, runLogs, runPreviewRecipients } from './campaign-read.js';
import type { ApiClient } from '../http-client.js';

function recordingClient(response: unknown): { client: ApiClient; calls: string[] } {
  const calls: string[] = [];
  const client: ApiClient = {
    request: async (reqPath: string) => { calls.push(reqPath); return response as any; },
  };
  return { client, calls };
}

test('runList builds the query string from status/limit/offset', async () => {
  const { client, calls } = recordingClient({ campaigns: [] });
  await runList(client, { status: 'draft', limit: 10, offset: 20 });
  assert.equal(calls[0], '/api/campaigns?status=draft&limit=10&offset=20');
});

test('runList omits absent filters', async () => {
  const { client, calls } = recordingClient({ campaigns: [] });
  await runList(client, {});
  assert.equal(calls[0], '/api/campaigns?');
});

test('runGet fetches a single campaign by id', async () => {
  const { client, calls } = recordingClient({ campaign: { id: 'c1' } });
  const campaign = await runGet(client, 'c1');
  assert.equal(calls[0], '/api/campaigns/c1');
  assert.equal(campaign.id, 'c1');
});

test('runLogs builds the query string from status/email/limit/offset', async () => {
  const { client, calls } = recordingClient({ logs: [] });
  await runLogs(client, 'c1', { status: 'failed', email: 'a@b.com', limit: 5, offset: 0 });
  assert.equal(calls[0], '/api/campaigns/c1/logs?status=failed&email=a%40b.com&limit=5&offset=0');
});

test('runPreviewRecipients returns the count for the parsed filter', async () => {
  const { client, calls } = recordingClient({ count: 42 });
  const count = await runPreviewRecipients(client, { recipients: 'active', days: '7' });
  assert.equal(calls[0], '/api/campaigns/recipients/preview?type=active&days=7');
  assert.equal(count, 42);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/commands/campaign-read.test.ts`
Expected: FAIL — `Cannot find module './campaign-read.js'`

- [ ] **Step 3: Implement `src/commands/campaign-read.ts`**

```ts
import type { ApiClient } from '../http-client.js';
import type { Campaign, SendLog } from '../types.js';
import { parseRecipientFilter, filterToQuery, type RecipientFlags } from '../recipients.js';

export interface ListOpts {
  status?: string;
  limit?: number;
  offset?: number;
}

export async function runList(client: ApiClient, opts: ListOpts): Promise<Campaign[]> {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.offset !== undefined) params.set('offset', String(opts.offset));
  const result = await client.request<{ campaigns: Campaign[] }>(`/api/campaigns?${params.toString()}`);
  return result.campaigns;
}

export async function runGet(client: ApiClient, id: string): Promise<Campaign> {
  const result = await client.request<{ campaign: Campaign }>(`/api/campaigns/${id}`);
  return result.campaign;
}

export interface LogsOpts {
  status?: string;
  email?: string;
  limit?: number;
  offset?: number;
}

export async function runLogs(client: ApiClient, id: string, opts: LogsOpts): Promise<SendLog[]> {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.email) params.set('email', opts.email);
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.offset !== undefined) params.set('offset', String(opts.offset));
  const result = await client.request<{ logs: SendLog[] }>(`/api/campaigns/${id}/logs?${params.toString()}`);
  return result.logs;
}

export async function runPreviewRecipients(client: ApiClient, flags: RecipientFlags): Promise<number> {
  const filter = parseRecipientFilter(flags);
  const result = await client.request<{ count: number }>(`/api/campaigns/recipients/preview?${filterToQuery(filter)}`);
  return result.count;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/commands/campaign-read.test.ts`
Expected: PASS — 5 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/commands/campaign-read.ts src/commands/campaign-read.test.ts
git commit -m "feat: add campaign list/get/logs/preview-recipients logic"
```

---

### Task 11: Campaign send commands (send/resend-failed/delete)

**Files:**
- Create: `src/commands/campaign-send.ts`
- Test: `src/commands/campaign-send.test.ts`

**Interfaces:**
- Consumes: `ApiClient` (Task 3), `Campaign`/`SendChunkResult` (Task 2), `filterToQuery` (Task 6).
- Produces: `class AbortedError extends Error {}`, `interface SendOptions { confirm: (message: string) => Promise<boolean>; onProgress: (result: SendChunkResult) => void; yes?: boolean }`, `runSend(client: ApiClient, id: string, opts: SendOptions): Promise<SendChunkResult>`, `interface ResendFailedResult { status: string }`, `runResendFailed(client: ApiClient, id: string, opts: { confirm: (m: string) => Promise<boolean>; yes?: boolean }): Promise<ResendFailedResult>`, `runDelete(client: ApiClient, id: string, opts: { confirm: (m: string) => Promise<boolean>; yes?: boolean }): Promise<void>` — consumed by Task 12 (`cli.ts`).

- [ ] **Step 1: Write the failing test `src/commands/campaign-send.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSend, runResendFailed, runDelete, AbortedError } from './campaign-send.js';
import type { ApiClient } from '../http-client.js';

function queuedClient(responses: unknown[]): { client: ApiClient; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const client: ApiClient = {
    request: async (reqPath: string) => {
      calls.push(reqPath);
      const response = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return response as any;
    },
  };
  return { client, calls };
}

test('runSend confirms with the recipient count, then drives the chunk loop to completion', async () => {
  const { client, calls } = queuedClient([
    { campaign: { id: 'c1', recipientFilter: null, sendGeneration: 0 } },
    { count: 2 },
    { done: false, completed: false, generation: 1, sentCount: 1, failedCount: 0, totalRecipients: 2 },
    { done: true, completed: true, generation: 1, sentCount: 2, failedCount: 0, totalRecipients: 2 },
  ]);
  const progress: unknown[] = [];
  let confirmedMessage = '';
  const result = await runSend(client, 'c1', {
    confirm: async (message) => { confirmedMessage = message; return true; },
    onProgress: (r) => progress.push(r),
  });
  assert.equal(confirmedMessage, 'This will send real emails to 2 recipients. Continue?');
  assert.equal(result.completed, true);
  assert.equal(progress.length, 2);
  assert.deepEqual(calls, [
    '/api/campaigns/c1',
    '/api/campaigns/recipients/preview?type=all',
    '/api/campaigns/c1/send',
    '/api/campaigns/c1/send/continue',
  ]);
});

test('runSend throws AbortedError when the user declines confirmation', async () => {
  const { client } = queuedClient([
    { campaign: { id: 'c1', recipientFilter: null, sendGeneration: 0 } },
    { count: 2 },
  ]);
  await assert.rejects(
    () => runSend(client, 'c1', { confirm: async () => false, onProgress: () => {} }),
    AbortedError
  );
});

test('runSend skips confirmation when yes is true', async () => {
  const { client } = queuedClient([
    { campaign: { id: 'c1', recipientFilter: null, sendGeneration: 0 } },
    { count: 2 },
    { done: true, completed: true, generation: 1, sentCount: 2, failedCount: 0, totalRecipients: 2 },
  ]);
  let confirmCalled = false;
  const result = await runSend(client, 'c1', {
    yes: true,
    confirm: async () => { confirmCalled = true; return true; },
    onProgress: () => {},
  });
  assert.equal(confirmCalled, false);
  assert.equal(result.completed, true);
});

test('runResendFailed requires confirmation unless yes is set', async () => {
  const { client, calls } = queuedClient([{ status: 'sending' }]);
  await assert.rejects(
    () => runResendFailed(client, 'c1', { confirm: async () => false }),
    AbortedError
  );
  assert.equal(calls.length, 0);
});

test('runResendFailed calls the resend-failed endpoint when confirmed', async () => {
  const { client, calls } = queuedClient([{ status: 'sending' }]);
  const result = await runResendFailed(client, 'c1', { confirm: async () => true });
  assert.equal(calls[0], '/api/campaigns/c1/resend-failed');
  assert.equal(result.status, 'sending');
});

test('runDelete calls DELETE when confirmed', async () => {
  const { client, calls } = queuedClient([{}]);
  await runDelete(client, 'c1', { confirm: async () => true });
  assert.equal(calls[0], '/api/campaigns/c1');
});

test('runDelete throws AbortedError without calling the API when declined', async () => {
  const { client, calls } = queuedClient([{}]);
  await assert.rejects(() => runDelete(client, 'c1', { confirm: async () => false }), AbortedError);
  assert.equal(calls.length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/commands/campaign-send.test.ts`
Expected: FAIL — `Cannot find module './campaign-send.js'`

- [ ] **Step 3: Implement `src/commands/campaign-send.ts`**

```ts
import type { ApiClient } from '../http-client.js';
import type { Campaign, SendChunkResult } from '../types.js';
import { filterToQuery, type RecipientFilter } from '../recipients.js';

export class AbortedError extends Error {}

export interface SendOptions {
  confirm: (message: string) => Promise<boolean>;
  onProgress: (result: SendChunkResult) => void;
  yes?: boolean;
}

export async function runSend(client: ApiClient, id: string, opts: SendOptions): Promise<SendChunkResult> {
  const { campaign } = await client.request<{ campaign: Campaign }>(`/api/campaigns/${id}`);
  const filter: RecipientFilter = campaign.recipientFilter ? JSON.parse(campaign.recipientFilter) : { type: 'all' };
  const { count } = await client.request<{ count: number }>(`/api/campaigns/recipients/preview?${filterToQuery(filter)}`);

  if (!opts.yes) {
    const proceed = await opts.confirm(`This will send real emails to ${count} recipients. Continue?`);
    if (!proceed) throw new AbortedError('Send aborted by user');
  }

  let result = await client.request<SendChunkResult>(`/api/campaigns/${id}/send`, { method: 'POST' });
  opts.onProgress(result);
  while (!result.done) {
    result = await client.request<SendChunkResult>(`/api/campaigns/${id}/send/continue`, {
      method: 'POST',
      body: JSON.stringify({ offset: 0, generation: result.generation }),
    });
    opts.onProgress(result);
  }
  return result;
}

export interface ResendFailedResult {
  status: string;
}

export async function runResendFailed(
  client: ApiClient,
  id: string,
  opts: { confirm: (m: string) => Promise<boolean>; yes?: boolean }
): Promise<ResendFailedResult> {
  if (!opts.yes) {
    const proceed = await opts.confirm(`Resend all failed emails for campaign ${id}?`);
    if (!proceed) throw new AbortedError('Resend aborted by user');
  }
  return client.request<ResendFailedResult>(`/api/campaigns/${id}/resend-failed`, { method: 'POST' });
}

export async function runDelete(
  client: ApiClient,
  id: string,
  opts: { confirm: (m: string) => Promise<boolean>; yes?: boolean }
): Promise<void> {
  if (!opts.yes) {
    const proceed = await opts.confirm(`Delete campaign ${id}? This cannot be undone.`);
    if (!proceed) throw new AbortedError('Delete aborted by user');
  }
  await client.request(`/api/campaigns/${id}`, { method: 'DELETE' });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/commands/campaign-send.test.ts`
Expected: PASS — 7 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/commands/campaign-send.ts src/commands/campaign-send.test.ts
git commit -m "feat: add campaign send/resend-failed/delete logic"
```

---

### Task 12: CLI wiring (commander program + entrypoint)

**Files:**
- Create: `src/cli.ts`
- Create: `src/index.ts`
- Test: `src/cli.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–11 (`createApiClient`/`ApiError` from Task 3, `loadSession` from Task 2, `printOutput` from Task 7, `runLogin`/`runLogout`/`runWhoami` from Task 8, `runCreate`/`runUpdate`/`runSetHtml`/`runSetText`/`runSetRecipients` from Task 9, `runList`/`runGet`/`runLogs`/`runPreviewRecipients` from Task 10, `runSend`/`runResendFailed`/`runDelete`/`AbortedError` from Task 11, `promptText`/`promptHidden`/`confirm` from Task 5).
- Produces: `interface CliDeps { baseUrl: string; sessionFilePath?: string; fetchImpl?: typeof fetch; promptText: (m: string) => Promise<string>; promptHidden: (m: string) => Promise<string>; confirm: (m: string) => Promise<boolean> }`, `defaultDeps(baseUrl: string): CliDeps`, `buildProgram(deps: CliDeps): Command` — this is the last task producing library code; `src/index.ts` is the real entrypoint, not consumed by anything else.

- [ ] **Step 1: Write the failing test `src/cli.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProgram, defaultDeps } from './cli.js';

test('buildProgram registers the expected top-level and campaign subcommands', () => {
  const program = buildProgram(defaultDeps('https://example.test'));
  const topNames = program.commands.map((c) => c.name()).sort();
  assert.deepEqual(topNames, ['campaign', 'login', 'logout', 'whoami']);

  const campaign = program.commands.find((c) => c.name() === 'campaign');
  assert.ok(campaign);
  const campaignNames = campaign!.commands.map((c) => c.name()).sort();
  assert.deepEqual(campaignNames, [
    'create', 'delete', 'get', 'list', 'logs', 'preview-recipients',
    'resend-failed', 'send', 'set-html', 'set-recipients', 'set-text', 'update',
  ]);
});

test('campaign create requires --name, --subject, and --file', () => {
  const program = buildProgram(defaultDeps('https://example.test'));
  const campaign = program.commands.find((c) => c.name() === 'campaign')!;
  const create = campaign.commands.find((c) => c.name() === 'create')!;
  const requiredFlags = create.options.filter((o) => o.mandatory).map((o) => o.long);
  assert.deepEqual(requiredFlags.sort(), ['--file', '--name', '--subject']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/cli.test.ts`
Expected: FAIL — `Cannot find module './cli.js'`

- [ ] **Step 3: Implement `src/cli.ts`**

```ts
import { Command } from 'commander';
import { createApiClient, ApiError, type ApiClient } from './http-client.js';
import { loadSession } from './session.js';
import { printOutput } from './output.js';
import { runLogin, runLogout, runWhoami } from './commands/auth.js';
import { runCreate, runUpdate, runSetHtml, runSetText, runSetRecipients } from './commands/campaign-write.js';
import { runList, runGet, runLogs, runPreviewRecipients } from './commands/campaign-read.js';
import { runSend, runResendFailed, runDelete, AbortedError } from './commands/campaign-send.js';
import { promptText, promptHidden, confirm } from './prompt.js';

export interface CliDeps {
  baseUrl: string;
  sessionFilePath?: string;
  fetchImpl?: typeof fetch;
  promptText: (message: string) => Promise<string>;
  promptHidden: (message: string) => Promise<string>;
  confirm: (message: string) => Promise<boolean>;
}

export function defaultDeps(baseUrl: string): CliDeps {
  return { baseUrl, promptText, promptHidden, confirm };
}

function requireClient(deps: CliDeps): ApiClient {
  const session = loadSession(deps.sessionFilePath);
  if (!session) {
    throw new Error('Not logged in — run "edm-cli login" first.');
  }
  return createApiClient(deps.baseUrl, session.cookie, deps.fetchImpl);
}

function isJson(command: Command): boolean {
  return Boolean((command.optsWithGlobals() as { json?: boolean }).json);
}

function handleAction(fn: () => Promise<void>): void {
  fn().catch((err: unknown) => {
    if (err instanceof AbortedError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    if (err instanceof ApiError) {
      console.error(`Error: ${err.message} (HTTP ${err.status})`);
      if (err.status === 401) console.error('Session expired or invalid — run "edm-cli login" again.');
      process.exitCode = 1;
      return;
    }
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}

export function buildProgram(deps: CliDeps): Command {
  const program = new Command();
  program
    .name('edm-cli')
    .description('Agent-friendly CLI for the EDM campaign tool')
    .option('--json', 'output structured JSON instead of human-readable text');

  program
    .command('login')
    .description('Log in with email + password and cache the session')
    .action(() => handleAction(async () => {
      const result = await runLogin({
        baseUrl: deps.baseUrl,
        promptText: deps.promptText,
        promptHidden: deps.promptHidden,
        fetchImpl: deps.fetchImpl,
        sessionFilePath: deps.sessionFilePath,
      });
      console.log(`Logged in as ${result.email}`);
    }));

  program
    .command('logout')
    .description('Clear the cached session')
    .action(() => handleAction(async () => {
      runLogout(deps.sessionFilePath);
      console.log('Logged out.');
    }));

  program
    .command('whoami')
    .description('Show the current session identity and send permission')
    .action((_opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const me = await runWhoami(client);
      printOutput(isJson(command), me, [
        `email: ${me.email}`,
        `isSuperAdmin: ${me.isSuperAdmin}`,
        `canSend: ${me.canSend}`,
      ]);
    }));

  const campaign = program.command('campaign').description('Manage EDM campaigns');

  campaign
    .command('create')
    .requiredOption('--name <name>', 'campaign name')
    .requiredOption('--subject <subject>', 'email subject')
    .option('--description <description>', 'internal description')
    .option('--content-type <type>', 'html or text', 'html')
    .requiredOption('--file <path>', 'path to the HTML or text body')
    .option('--recipients <type>', 'all|active|plan_starter|plan_standard|plan_advanced|manual')
    .option('--days <n>', 'lookback window for --recipients active')
    .option('--emails <list>', 'comma-separated emails for --recipients manual')
    .option('--test', 'mark as a test campaign')
    .action((opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const result = await runCreate(client, {
        name: opts.name,
        subject: opts.subject,
        description: opts.description,
        contentType: opts.contentType,
        file: opts.file,
        test: opts.test,
        recipientFlags: { recipients: opts.recipients, days: opts.days, emails: opts.emails },
      });
      printOutput(isJson(command), result, [`Created campaign ${result.id}`]);
    }));

  campaign
    .command('update <id>')
    .option('--name <name>')
    .option('--subject <subject>')
    .option('--description <description>')
    .action((id, opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const result = await runUpdate(client, id, opts);
      printOutput(isJson(command), result, [`Updated campaign ${result.id}`]);
    }));

  campaign
    .command('set-html <id>')
    .requiredOption('--file <path>', 'path to the HTML body')
    .action((id, opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const result = await runSetHtml(client, id, opts.file);
      printOutput(isJson(command), result, [`Updated HTML for campaign ${result.id}`]);
    }));

  campaign
    .command('set-text <id>')
    .requiredOption('--file <path>', 'path to the plain-text body')
    .action((id, opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const result = await runSetText(client, id, opts.file);
      printOutput(isJson(command), result, [`Updated text content for campaign ${result.id}`]);
    }));

  campaign
    .command('set-recipients <id>')
    .requiredOption('--recipients <type>', 'all|active|plan_starter|plan_standard|plan_advanced|manual')
    .option('--days <n>')
    .option('--emails <list>')
    .action((id, opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const result = await runSetRecipients(client, id, { recipients: opts.recipients, days: opts.days, emails: opts.emails });
      printOutput(isJson(command), result, [`Updated recipients for campaign ${result.id}`]);
    }));

  campaign
    .command('list')
    .option('--status <status>', 'draft|sending|completed|failed|pending')
    .option('--limit <n>')
    .option('--offset <n>')
    .action((opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const campaigns = await runList(client, {
        status: opts.status,
        limit: opts.limit ? Number(opts.limit) : undefined,
        offset: opts.offset ? Number(opts.offset) : undefined,
      });
      printOutput(
        isJson(command),
        campaigns,
        campaigns.map((c) => `${c.id}  ${c.status.padEnd(10)}  ${c.name}  (sent ${c.sentCount}/${c.totalRecipients ?? '?'})`)
      );
    }));

  campaign
    .command('get <id>')
    .option('--full', 'include raw htmlContent/textContent')
    .action((id, opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const result = await runGet(client, id);
      const lines = [
        `id: ${result.id}`,
        `name: ${result.name}`,
        `subject: ${result.subject}`,
        `status: ${result.status}`,
        `contentType: ${result.contentType}`,
        `recipientFilter: ${result.recipientFilter ?? '(none)'}`,
        `sent/failed/total: ${result.sentCount}/${result.failedCount}/${result.totalRecipients ?? '?'}`,
      ];
      if (opts.full) {
        lines.push(`htmlContent: ${result.htmlContent ?? '(none)'}`);
        lines.push(`textContent: ${result.textContent ?? '(none)'}`);
      }
      printOutput(isJson(command), result, lines);
    }));

  campaign
    .command('logs <id>')
    .option('--status <status>', 'pending|sent|failed')
    .option('--email <email>')
    .option('--limit <n>')
    .option('--offset <n>')
    .action((id, opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const logs = await runLogs(client, id, {
        status: opts.status,
        email: opts.email,
        limit: opts.limit ? Number(opts.limit) : undefined,
        offset: opts.offset ? Number(opts.offset) : undefined,
      });
      printOutput(isJson(command), logs, logs.map((l) => `${l.recipientEmail}  ${l.status}${l.error ? `  error=${l.error}` : ''}`));
    }));

  campaign
    .command('preview-recipients')
    .requiredOption('--recipients <type>', 'all|active|plan_starter|plan_standard|plan_advanced|manual')
    .option('--days <n>')
    .option('--emails <list>')
    .action((opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const count = await runPreviewRecipients(client, { recipients: opts.recipients, days: opts.days, emails: opts.emails });
      printOutput(isJson(command), { count }, [`${count} recipients match this filter`]);
    }));

  campaign
    .command('send <id>')
    .option('--yes', 'skip the confirmation prompt')
    .action((id, opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const result = await runSend(client, id, {
        yes: opts.yes,
        confirm: deps.confirm,
        onProgress: (r) => console.error(`sent ${r.sentCount ?? 0} / failed ${r.failedCount ?? 0} / total ${r.totalRecipients ?? '?'}`),
      });
      printOutput(isJson(command), result, [result.completed ? 'Send completed.' : `Send stopped: ${result.error ?? 'unknown reason'}`]);
    }));

  campaign
    .command('resend-failed <id>')
    .option('--yes', 'skip the confirmation prompt')
    .action((id, opts, command: Command) => handleAction(async () => {
      const client = requireClient(deps);
      const result = await runResendFailed(client, id, { yes: opts.yes, confirm: deps.confirm });
      printOutput(isJson(command), result, [`Status: ${result.status}`]);
    }));

  campaign
    .command('delete <id>')
    .option('--yes', 'skip the confirmation prompt')
    .action((id, opts) => handleAction(async () => {
      const client = requireClient(deps);
      await runDelete(client, id, { yes: opts.yes, confirm: deps.confirm });
      console.log(`Deleted campaign ${id}`);
    }));

  return program;
}
```

- [ ] **Step 4: Implement `src/index.ts`**

```ts
import { buildProgram, defaultDeps } from './cli.js';

const BASE_URL = 'https://optimal-dodo-5009.edgespark.app';

const program = buildProgram(defaultDeps(BASE_URL));
await program.parseAsync(process.argv);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/l13/Desktop/edm-cli && npx tsx --test src/cli.test.ts`
Expected: PASS — 2 tests passing

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `cd /Users/l13/Desktop/edm-cli && npm test && npm run typecheck`
Expected: every test file across all tasks passes; typecheck reports no errors.

- [ ] **Step 7: Smoke-test the real bin without hitting the network**

Run: `cd /Users/l13/Desktop/edm-cli && ./bin/edm-cli.js --help && ./bin/edm-cli.js campaign --help`
Expected: commander's generated help text listing `login`, `logout`, `whoami`, and the `campaign` subcommand with its 9 sub-subcommands.

- [ ] **Step 8: Commit**

```bash
git add src/cli.ts src/cli.test.ts src/index.ts
git commit -m "feat: wire commander CLI over all command modules"
```

---

### Task 13: Documentation (`SKILL.md` + `README.md`)

**Files:**
- Create: `SKILL.md`
- Create: `README.md`

**Interfaces:**
- Consumes: the full command surface from Task 12 (documents it; does not import it).
- Produces: nothing consumed by code — these are the human/agent-facing reference docs called for in the design spec.

- [ ] **Step 1: Create `SKILL.md`**

```markdown
# edm-cli

Agent-friendly CLI for the EDM campaign tool at `https://optimal-dodo-5009.edgespark.app`. Use this instead of asking the user to drive the web UI when you need to create a campaign, set its content, choose recipients, send it, or inspect send history.

Every command supports `--json` (put it right after `edm-cli`, before the subcommand: `edm-cli --json campaign list`) for structured output. Without it, output is short human-readable lines.

## Setup (one-time, human does this)

```
edm-cli login
```
Prompts for email + password interactively (password is masked, never stored). The session cookie is cached at `~/.edm-cli/session.json` (mode 600) and reused by every other command. An agent should never run `login` on the user's behalf or ask the user to paste a password into chat — tell the user to run it themselves in their own terminal.

`edm-cli whoami` confirms the session is valid and shows `canSend` (whether this account is allowed to actually send campaigns).

## Safety rule

`campaign send`, `campaign resend-failed`, and `campaign delete` have real, irreversible effects (real emails to real people; permanent deletion). They prompt for interactive `y/N` confirmation by default. Pass `--yes` to skip the prompt **only** when the user has explicitly asked for that action in this turn — never add `--yes` on your own initiative to "save a round trip."

## Commands

```
edm-cli login
edm-cli logout
edm-cli whoami [--json]

edm-cli campaign create --name <n> --subject <s> [--description <d>]
                         [--content-type html|text]        # default html
                         --file <path>                      # HTML or text body
                         [--recipients all|active|plan_starter|plan_standard|plan_advanced|manual]
                         [--days N]                         # only with --recipients active (default 30)
                         [--emails a@b.com,c@d.com]          # only with --recipients manual
                         [--test]
                         [--json]

edm-cli campaign set-html <id> --file <path.html>
edm-cli campaign set-text <id> --file <path.txt>
edm-cli campaign set-recipients <id> --recipients <type> [--days N] [--emails ...]
edm-cli campaign update <id> [--name <n>] [--subject <s>] [--description <d>]

edm-cli campaign list [--status draft|sending|completed|failed|pending] [--limit N] [--offset N] [--json]
edm-cli campaign get <id> [--full] [--json]        # --full includes raw htmlContent/textContent
edm-cli campaign logs <id> [--status pending|sent|failed] [--email <e>] [--limit N] [--offset N] [--json]
edm-cli campaign preview-recipients --recipients <type> [--days N] [--emails ...] [--json]

edm-cli campaign send <id> [--yes]
edm-cli campaign resend-failed <id> [--yes]
edm-cli campaign delete <id> [--yes]
```

## Typical flow

```
edm-cli campaign create --name "July newsletter" --subject "What's new in July" \
  --file ./newsletter.html --recipients active --days 30
# -> prints the new campaign id, e.g. Created campaign 3f2a...

edm-cli campaign preview-recipients --recipients active --days 30
# -> sanity-check the recipient count before sending

edm-cli campaign send 3f2a... --yes   # only after the user has explicitly asked to send
```

## `--json` output shapes

- `whoami`: `{ email, isSuperAdmin, canSend }`
- `campaign create/update/set-html/set-text/set-recipients/get`: `{ ...Campaign }` (id, name, subject, status, contentType, htmlContent, textContent, recipientFilter (JSON string), sentCount, failedCount, totalRecipients, etc.)
- `campaign list`: `[ ...Campaign ]`
- `campaign logs`: `[ { id, campaignId, recipientEmail, status, error, ... } ]`
- `campaign preview-recipients`: `{ count }`
- `campaign send`: final chunk result `{ done, completed, generation, sentCount, failedCount, totalRecipients, error? }`
- `campaign resend-failed`: `{ status }`

## Errors

Non-zero exit code on any failure. The error message printed to stderr is the server's own message where available (e.g. `Campaign not found`, `Cannot edit while sending`, `Sending is not enabled for your account`). A `401`/session error means the cached session expired — tell the user to run `edm-cli login` again.
```

- [ ] **Step 2: Create `README.md`**

```markdown
# edm-cli

Agent-friendly command-line tool for the EDM campaign app. Talks to the already-deployed server at `https://optimal-dodo-5009.edgespark.app` over its existing `/api/*` routes — no changes to that server/web app.

See [`SKILL.md`](./SKILL.md) for the full command reference.

## Install

```bash
npm install
npm link   # exposes the `edm-cli` command globally
```

## Usage

```bash
edm-cli login       # one-time interactive login, caches a session cookie
edm-cli whoami
edm-cli campaign list
```

## Development

```bash
npm test        # runs the unit test suite (node:test via tsx)
npm run typecheck
```
```

- [ ] **Step 3: Commit**

```bash
git add SKILL.md README.md
git commit -m "docs: add SKILL.md reference and README"
```

---

### Task 14: Manual end-to-end verification against production (human-run, not automated)

**Files:** none (verification only).

**Interfaces:** none — this task exercises the full stack built in Tasks 1–13 against the real server.

This task must be run by the human (the agent must not attempt to type a real password anywhere, including via piped stdin) because it needs a real `@youware.com` account's credentials. Only non-destructive/reversible steps are included; `send` and `resend-failed` are intentionally left for the user to trigger on their own schedule with a real campaign, not as part of routine verification.

- [ ] **Step 1: Install the CLI globally**

Run: `cd /Users/l13/Desktop/edm-cli && npm link`
Expected: `edm-cli` is now on `PATH`.

- [ ] **Step 2: Log in interactively**

Run: `edm-cli login`
Expected: prompts for email then a masked password; prints `Logged in as <email>`. If it instead prints an error about the session cookie (e.g. `Login succeeded but the server did not return a session cookie.`), the cookie-name assumption in Task 4 needs revisiting — capture the actual response headers with `curl -i` using the same real credentials and adjust `signInWithEmail` in `src/auth-client.ts` accordingly, then re-run this step.

- [ ] **Step 3: Verify the session**

Run: `edm-cli whoami --json`
Expected: `{ "email": "<your email>", "isSuperAdmin": ..., "canSend": ... }`

- [ ] **Step 4: Create a test campaign**

Run:
```bash
cat > /tmp/edm-cli-test.html <<'EOF'
<html><body><p>edm-cli test campaign — safe to delete.</p></body></html>
EOF
edm-cli campaign create --name "edm-cli verification" --subject "edm-cli test" \
  --file /tmp/edm-cli-test.html --recipients manual --emails "$(edm-cli whoami --json | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf-8")).email')" \
  --test --json
```
Expected: prints the created campaign JSON with `status: "draft"`, `contentType: "html"`, `isTest: 1`. Note the returned `id` for the next steps.

- [ ] **Step 5: Update content and recipients**

Run: `edm-cli campaign set-recipients <id> --recipients all` then `edm-cli campaign get <id>`
Expected: `get` shows `recipientFilter: {"type":"all"}`.

- [ ] **Step 6: Preview recipients**

Run: `edm-cli campaign preview-recipients --recipients active --days 30`
Expected: a plausible recipient count (matches what the web UI's "preview" shows for the same filter).

- [ ] **Step 7: List and inspect logs**

Run: `edm-cli campaign list --status draft` and `edm-cli campaign logs <id>`
Expected: the test campaign appears in the list; logs is an empty array (nothing sent yet).

- [ ] **Step 8: Clean up**

Run: `edm-cli campaign delete <id>`
Expected: interactive confirmation prompt, then `Deleted campaign <id>` after answering `y`.

- [ ] **Step 9: (Separately, whenever the user is actually ready to send a real campaign)**

The user runs `edm-cli campaign send <id>` themselves (or explicitly asks an agent to run it with `--yes` for a specific campaign they've already reviewed). Confirm it prints incrementing `sent X / failed Y / total Z` progress lines and ends with `Send completed.`, and cross-check the final counts against `edm-cli campaign get <id>`.
