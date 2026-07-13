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
