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
