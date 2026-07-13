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
